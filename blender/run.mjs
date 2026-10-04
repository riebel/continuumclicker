// Runs one of the scripts in this folder with Blender in the background:
//
//   node blender/run.mjs build_ship.py [args…]
//   node blender/run.mjs render.py preview.png --tier 3
//
// Blender is taken from $BLENDER, then the newest version in the usual install location, then
// `blender` on the PATH.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER
  const candidates = []
  if (process.platform === 'win32') {
    const root = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Blender Foundation')
    if (existsSync(root)) {
      const versions = readdirSync(root).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
      candidates.push(...versions.map((version) => join(root, version, 'blender.exe')))
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender')
  }
  return candidates.find((path) => existsSync(path)) ?? 'blender'
}

const [script, ...args] = process.argv.slice(2)
if (!script) {
  console.error('usage: node blender/run.mjs <script.py> [args…]')
  process.exit(2)
}
const here = dirname(fileURLToPath(import.meta.url))
const result = spawnSync(
  findBlender(),
  [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    join(here, script),
    '--',
    ...args,
  ],
  { stdio: 'inherit' },
)
if (result.error) {
  console.error(`Could not start Blender (${result.error.message}). Set BLENDER to its path.`)
  process.exit(1)
}
process.exit(result.status ?? 1)
