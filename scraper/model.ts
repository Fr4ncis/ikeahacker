/**
 * Finding and reading IKEA's own 3D models.
 *
 * Every product page that has a model links it, in several formats and
 * qualities, under web-api.ikea.com. Only the plain glTF ones are read here:
 * the rest are Draco-compressed, which needs a decoder, and about half of the
 * catalogue publishes an uncompressed variant anyway. A product with none
 * keeps the shape its type implies.
 *
 * glTF is a small enough format to read directly. A binary .glb is a header
 * and two chunks, JSON then bytes, and all that is wanted from it is the
 * positions and the triangles that index them -- no materials, no textures,
 * no animation. That is 80 lines against a dependency, and it means nothing
 * new ships in the app.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Triangle } from './voxel.ts'

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '.cache/models')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/**
 * The uncompressed model on a product page, if there is one.
 *
 * The `1.2` asset family publishes plain `glb` and `gltf` beside the Draco
 * ones; the `geomagical` family is Draco whatever the path says. Quality goes
 * up with the number, and the lowest is plenty for something about to be
 * reduced to a few dozen cubes.
 */
export function findModelUrl(html: string): string | null {
  const urls = html.match(/https:\/\/web-api\.ikea\.com\/dimma\/assets\/1\.2\/[^"' ]+\.glb[^"' ]*/g) ?? []
  const plain = urls.filter((u) => u.includes('/glb/') && !u.includes('glb_draco'))
  if (!plain.length) return null
  // Lowest quality first: iqp1/rqp1 before iqp2, and so on.
  return plain.sort((a, b) => quality(a) - quality(b))[0]
}

const quality = (url: string) => Number(url.match(/\/[ir]qp(\d)\//)?.[1] ?? 9)

interface Gltf {
  accessors?: {
    bufferView?: number
    byteOffset?: number
    componentType: number
    count: number
    type: string
  }[]
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[]
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[]
  nodes?: {
    mesh?: number
    children?: number[]
    matrix?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
  }[]
  scenes?: { nodes?: number[] }[]
  scene?: number
  extensionsUsed?: string[]
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const COMPONENT_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

/** Column-major 4x4 multiply, matching glTF's own convention. */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** A node's own transform, however it chose to express it. */
function localMatrix(node: NonNullable<Gltf['nodes']>[number]): number[] {
  if (node.matrix) return node.matrix
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  // Quaternion to a rotation matrix, scaled and then translated.
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ]
  return [
    r[0] * sx, r[1] * sx, r[2] * sx, 0,
    r[3] * sy, r[4] * sy, r[5] * sy, 0,
    r[6] * sz, r[7] * sz, r[8] * sz, 0,
    tx, ty, tz, 1,
  ]
}

const apply = (m: number[], p: [number, number, number]): [number, number, number] => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

export class UnreadableModel extends Error {}

/**
 * Reads the triangles out of a binary glTF.
 *
 * Node transforms are applied as the scene graph is walked. Skipping them
 * would be fine for the single-node models and quietly wrong for the rest,
 * which is the worse kind of wrong: the shape would still look like furniture.
 */
export function readGlb(buffer: Buffer): Triangle[] {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') throw new UnreadableModel('not a glb')

  const chunks: { type: string; start: number; length: number }[] = []
  for (let at = 12; at + 8 <= buffer.length; ) {
    const length = buffer.readUInt32LE(at)
    const type = buffer.toString('ascii', at + 4, at + 8)
    chunks.push({ type, start: at + 8, length })
    at += 8 + length
  }
  const json = chunks.find((c) => c.type.startsWith('JSON'))
  const bin = chunks.find((c) => c.type.startsWith('BIN'))
  if (!json || !bin) throw new UnreadableModel('missing chunks')

  const gltf = JSON.parse(buffer.toString('utf8', json.start, json.start + json.length)) as Gltf
  if (gltf.extensionsUsed?.some((e) => e.includes('draco'))) throw new UnreadableModel('draco compressed')

  const read = (index: number): number[][] => {
    const accessor = gltf.accessors?.[index]
    if (!accessor || accessor.bufferView === undefined) throw new UnreadableModel('accessor without data')
    const view = gltf.bufferViews?.[accessor.bufferView]
    if (!view) throw new UnreadableModel('missing buffer view')

    const size = COMPONENT_BYTES[accessor.componentType]
    const count = COMPONENT_COUNT[accessor.type]
    if (!size || !count) throw new UnreadableModel(`unsupported accessor ${accessor.componentType}/${accessor.type}`)

    const stride = view.byteStride || size * count
    const base = bin.start + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const values: number[][] = []
    for (let i = 0; i < accessor.count; i++) {
      const at = base + i * stride
      const row: number[] = []
      for (let c = 0; c < count; c++) {
        const o = at + c * size
        row.push(
          accessor.componentType === 5126
            ? buffer.readFloatLE(o)
            : accessor.componentType === 5125
              ? buffer.readUInt32LE(o)
              : accessor.componentType === 5123
                ? buffer.readUInt16LE(o)
                : buffer.readUInt8(o),
        )
      }
      values.push(row)
    }
    return values
  }

  const tris: Triangle[] = []
  const emit = (meshIndex: number, matrix: number[]) => {
    for (const primitive of gltf.meshes?.[meshIndex]?.primitives ?? []) {
      // Only plain triangles; anything else is not worth a special case here.
      if ((primitive.mode ?? 4) !== 4 || primitive.attributes.POSITION === undefined) continue
      const positions = read(primitive.attributes.POSITION).map(
        (p) => apply(matrix, [p[0], p[1], p[2]]) as [number, number, number],
      )
      const indices = primitive.indices !== undefined ? read(primitive.indices).map((i) => i[0]) : positions.map((_, i) => i)
      for (let i = 0; i + 2 < indices.length; i += 3) {
        tris.push([positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]])
      }
    }
  }

  const walk = (index: number, parent: number[]) => {
    const node = gltf.nodes?.[index]
    if (!node) return
    const matrix = multiply(parent, localMatrix(node))
    if (node.mesh !== undefined) emit(node.mesh, matrix)
    for (const child of node.children ?? []) walk(child, matrix)
  }

  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? gltf.nodes?.map((_, i) => i) ?? []
  for (const root of roots) walk(root, IDENTITY)

  if (!tris.length) throw new UnreadableModel('no triangles')
  return tris
}

/** Fetches a model, remembering which articles have none so a re-run is cheap. */
export async function fetchModel(itemNo: string, pipUrl: string): Promise<Triangle[] | null> {
  await mkdir(CACHE_DIR, { recursive: true })
  const noteFile = resolve(CACHE_DIR, `${itemNo}.url`)

  let url: string | null = null
  try {
    const noted = await readFile(noteFile, 'utf8')
    url = noted === '' ? null : noted
  } catch {
    const res = await fetch(pipUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' },
    })
    url = res.ok ? findModelUrl(await res.text()) : null
    await writeFile(noteFile, url ?? '')
  }
  if (!url) return null

  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  try {
    return readGlb(Buffer.from(await res.arrayBuffer()))
  } catch (err) {
    if (err instanceof UnreadableModel) return null
    throw err
  }
}
