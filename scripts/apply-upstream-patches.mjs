import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const upstreamRoot = resolve(process.argv[2] || join(repositoryRoot, '.upstream'))
const prototypes = [
  ['h3', '7f4c1c901a15e2a6ac5c217a20fb638a740240f4'],
  ['nitro', 'cc9f56fcf2cc1bc8b19d1c81408853df8b1c7b07'],
  ['nuxt', 'd9dab5edf132eb2ba7882966ff21e6ca1c427a32'],
]

// Preflight every checkout before changing any files. Repeated runs are safe;
// a partially applied or conflicting patch requires explicit resolution.
const pending = []
for (const [name, expectedHead] of prototypes) {
  const cwd = join(upstreamRoot, name)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  if (head !== expectedHead) {
    throw new Error(`${name}: expected pinned prototype ${expectedHead}, received ${head}`)
  }
  const patches =
    name === 'nitro'
      ? ['nitro-contract-authoring', 'nitro-route-normalization']
      : [`${name}-route-normalization`]
  for (const patchName of patches) {
    const patch = join(repositoryRoot, 'patches/upstream', `${patchName}.patch`)
    const forward = spawnSync('git', ['apply', '--check', patch], { cwd, encoding: 'utf8' })
    if (forward.status === 0) {
      pending.push({ name: patchName, cwd, patch })
      continue
    }
    const reverse = spawnSync('git', ['apply', '--reverse', '--check', patch], {
      cwd,
      encoding: 'utf8',
    })
    if (reverse.status !== 0) {
      throw new Error(`${name}: patch conflicts with this checkout.\n${forward.stderr}`)
    }
    console.log(`${patchName}: already applied`)
  }
}

for (const { name, cwd, patch } of pending) {
  execFileSync('git', ['apply', patch], { cwd, stdio: 'inherit' })
  console.log(`${name}: applied`)
}
