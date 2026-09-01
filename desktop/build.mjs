/**
 * Builds both halves of the desktop app: the planner, then the shell.
 *
 * The planner is the same source the web build uses, with two build-time
 * settings that only make sense here. `VITE_BASE=./` makes every asset
 * reference relative, since the app is served from the root of its own scheme
 * rather than from a repository subpath. `VITE_PUBLIC_URL` tells Share where
 * the app lives on the web: a link to `app://ikeahacker` would open on nobody
 * else's machine, so a shared plan has to point at the published site.
 *
 * Run from `desktop/`. Both settings come from this package's `publicSite`,
 * which is also what the shell refreshes the catalogue from.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const { publicSite } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))

const run = (command, args, cwd, env = {}) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })

console.log(`Building the planner for ${publicSite}`)
run('npm', ['run', 'build'], repo, { VITE_BASE: './', VITE_PUBLIC_URL: publicSite })

console.log('Building the shell')
run('npx', ['tsc', '-p', '.'], here)
