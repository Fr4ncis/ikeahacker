/**
 * Signs the macOS app after packaging, with an ad-hoc signature.
 *
 * Not signing at all is not an option, whatever "unsigned" suggests. Electron
 * arrives linker-signed, and packaging renames the bundle and adds resources
 * to it, which leaves that signature describing something that no longer
 * exists. macOS rejects a broken signature far more firmly than a missing one:
 * v0.1.0 shipped this way and would not start at all, failing with "code has
 * no resources but signature indicates they must be present" rather than any
 * prompt a person could get past.
 *
 * An ad-hoc signature costs nothing, needs no certificate and no account, and
 * puts the app back where an unsigned app is meant to be: refused on the first
 * launch, with an Open Anyway to click. Notarisation, which would remove even
 * that, needs a paid Apple Developer account.
 *
 * The verification afterwards is the point of the exercise. A build whose
 * signature does not check out should fail here rather than on somebody's
 * machine.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const run = (args) => execFileSync('codesign', args, { stdio: 'inherit' })

  console.log(`  • ad-hoc signing  app=${app}`)
  // --deep is blunt, and deprecated for real identities, but it is the one
  // way to reach every helper and framework inside an Electron bundle with a
  // signature that has no certificate behind it to be careful about.
  run(['--force', '--deep', '--sign', '-', app])
  run(['--verify', '--deep', '--strict', '--verbose=2', app])
}
