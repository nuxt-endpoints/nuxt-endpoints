import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const nuxtRoot = resolve(repositoryRoot, '../upstream/nuxt')
const packDirectory = join(nuxtRoot, '.prototype-pack')

const packages = ['schema', 'kit', 'nitro-server', 'vite-server', 'vite', 'nuxt']

mkdirSync(packDirectory, { recursive: true })

for (const packageDirectory of packages) {
  execFileSync(
    'pnpm',
    [
      '--dir',
      join(nuxtRoot, 'packages', packageDirectory),
      'pack',
      '--pack-destination',
      packDirectory,
    ],
    { cwd: nuxtRoot, stdio: 'inherit' },
  )
}
