/**
 * Updates from the project's own GitHub releases.
 *
 * The installers are not signed, and an unsigned app cannot update itself
 * silently: Squirrel on macOS refuses to swap an app it cannot verify. So this
 * does the honest half of the job. It finds out whether a newer release
 * exists, downloads the right file for the machine it is running on, checks
 * the bytes against the hash GitHub publishes, and then hands over to the
 * installer -- which on Windows means running it and stepping aside, and on
 * macOS and Linux means opening what was downloaded and letting the person
 * finish it. Nothing is installed without being asked for.
 *
 * All of it runs in the main process. The renderer never sees the network, so
 * the page's content policy stays as tight as it was.
 */
import { app, net, shell } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A published release, as much of one as this cares about. */
interface Release {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
  body?: string | null
  html_url: string
  assets: { name: string; size: number; digest?: string | null; browser_download_url: string }[]
}

export interface UpdateAsset {
  name: string
  url: string
  size: number
  /** The sha256 GitHub publishes for the asset, when it publishes one. */
  sha256: string | null
}

export interface UpdateInfo {
  version: string
  notes: string
  url: string
  /** The file for this platform, or nothing when the release has none. */
  asset: UpdateAsset | null
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; version: string }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; received: number; total: number }
  | { status: 'ready'; info: UpdateInfo; file: string; manual: boolean }
  | { status: 'failed'; message: string }

/**
 * Compares two versions the way releases are numbered here: three numbers,
 * and anything after a dash is a pre-release and sorts below the plain
 * version. Returns > 0 when `a` is newer.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2)
    return { numbers: core.split('.').map((n) => Number(n) || 0), pre: pre ?? '' }
  }
  const left = parts(a)
  const right = parts(b)

  for (let i = 0; i < Math.max(left.numbers.length, right.numbers.length); i++) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (left.pre === right.pre) return 0
  // A pre-release of the same numbers is older than the release itself.
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre < right.pre ? -1 : 1
}

/** What this platform installs from. */
function assetSuffix(platform = process.platform, arch = process.arch): { ext: string; arch: string } {
  if (platform === 'darwin') return { ext: '.dmg', arch }
  if (platform === 'win32') return { ext: '.exe', arch }
  return { ext: '.AppImage', arch }
}

/**
 * The release to offer, or nothing when there is nothing newer.
 *
 * Kept apart from the fetching so it can be tested against a real release
 * payload without pretending to be an older version of the app.
 */
export function pickUpdate(
  current: string,
  release: Release | null,
  platform = process.platform,
  arch = process.arch,
): UpdateInfo | null {
  if (!release || release.draft || release.prerelease) return null
  const version = release.tag_name.replace(/^v/, '')
  if (compareVersions(version, current) <= 0) return null

  const { ext, arch: want } = assetSuffix(platform, arch)
  const candidates = release.assets.filter((a) => a.name.endsWith(ext))
  // The file naming this machine's architecture, or one that names none and is
  // therefore for all of them. Never a file that names a different one: an
  // Intel Mac offered the arm64 build downloads 90 MB it cannot open, so it is
  // better to have no download and a link to the release page.
  const asset =
    candidates.find((a) => a.name.toLowerCase().includes(want)) ??
    candidates.find((a) => !/arm64|x64|x86_64|ia32|i386/i.test(a.name))

  return {
    version,
    notes: (release.body ?? '').trim().slice(0, 2000),
    url: release.html_url,
    asset: asset
      ? {
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
          sha256: asset.digest?.replace(/^sha256:/, '') ?? null,
        }
      : null,
  }
}

/** owner/repo, read from this package's own repository field. */
export function repoSlug(repository: string): string {
  const match = repository.match(/github\.com[/:]([^/]+\/[^/.]+)/)
  if (!match) throw new Error(`Not a GitHub repository: ${repository}`)
  return match[1]
}

async function fetchLatestRelease(slug: string): Promise<Release> {
  const res = await net.fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `ikeahacker/${app.getVersion()}` },
  })
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
  return (await res.json()) as Release
}

/** Where downloads go: outside the app, which is read-only once installed. */
const downloadDir = () => join(app.getPath('userData'), 'updates')

/**
 * Fetches an asset and checks it against the hash from the release.
 *
 * A download that does not match is deleted rather than kept, because the
 * next thing that happens to this file is that someone runs it.
 */
export async function downloadAsset(
  asset: UpdateAsset,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const host = new URL(asset.url).host
  if (host !== 'github.com' && !host.endsWith('.githubusercontent.com')) {
    throw new Error(`Refusing to download from ${host}`)
  }

  const res = await net.fetch(asset.url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)

  const chunks: Uint8Array[] = []
  const hash = createHash('sha256')
  let received = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    hash.update(value)
    received += value.byteLength
    onProgress(received, asset.size)
  }

  const digest = hash.digest('hex')
  if (asset.sha256 && digest !== asset.sha256) {
    throw new Error('The download did not match the hash GitHub published for it')
  }
  if (received !== asset.size) throw new Error(`Expected ${asset.size} bytes, got ${received}`)

  const dir = downloadDir()
  await mkdir(dir, { recursive: true })
  // Only ever keep the download in hand.
  for (const stale of await readdir(dir).catch(() => [])) {
    if (stale !== asset.name) await rm(join(dir, stale), { force: true })
  }
  const file = join(dir, asset.name)
  await writeFile(file, Buffer.concat(chunks))
  return file
}

/**
 * Hands the downloaded file to whatever installs it.
 *
 * Only Windows can carry on by itself: its installer replaces the app and
 * relaunches. macOS gets the disk image opened, ready to drag across, and
 * Linux gets the AppImage shown in a file manager, because replacing a
 * running AppImage underneath itself is a good way to lose it. The return
 * value says whether the app is on its way out or the person has work to do.
 */
export async function installUpdate(file: string): Promise<{ quitting: boolean }> {
  if (process.platform === 'win32') {
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
    setTimeout(() => app.quit(), 400)
    return { quitting: true }
  }

  if (process.platform === 'darwin') {
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
    return { quitting: false }
  }

  shell.showItemInFolder(file)
  return { quitting: false }
}

export async function checkForUpdate(repository: string): Promise<UpdateInfo | null> {
  return pickUpdate(app.getVersion(), await fetchLatestRelease(repoSlug(repository)))
}
