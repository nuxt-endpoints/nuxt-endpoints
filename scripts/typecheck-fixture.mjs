// Type-checks the basic fixture against its own generated types.
//
// `vp run test:typecheck` deliberately excludes `test/fixtures/**`, and the
// fixture's own `tsconfig` is Nuxt's. So the one place the library is consumed
// the way an application consumes it - route files calling
// `defineRouteHandler`, and a page calling the generated client - went
// unchecked, and a contract shape that did not type-check for a handler could
// pass every check. This closes that hole without needing a server: `nuxi
// prepare` writes the generated types, then tsc reads them plus `typecheck.ts`.
//
// The generated route union references each handler through
// `typeof import('…route.ts')`, so tsc pulls the fixture's route files into the
// program and reports their errors too. The fixture also imports Nuxt's
// generated `server-routes.d.ts`, so the ordinary Nuxt typed-fetch projection
// and NE's status-aware projection are checked in the same program.
import { execFile } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = join(repositoryRoot, 'test/fixtures/basic')
const buildDir = join(fixtureRoot, '.nuxt')

async function existingFiles(paths) {
  const files = []
  for (const path of paths) {
    try {
      await access(path)
      files.push(path)
    } catch {
      // Optional generated files vary slightly by Nuxt/Nitro version.
    }
  }
  return files
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, { cwd: repositoryRoot, ...options })
  } catch (error) {
    const message = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n')
    throw new Error(message)
  }
}

await run(join(repositoryRoot, 'node_modules/.bin/nuxi'), ['prepare', 'test/fixtures/basic'])

const nuxtRoot = dirname(require.resolve('nuxt/package.json'))
const tsconfigPath = join(buildDir, 'fixture-typecheck.json')
const files = await existingFiles([
  join(buildDir, 'types/imports.d.ts'),
  join(buildDir, 'server-routes.d.ts'),
  join(buildDir, 'types/endpoints.d.ts'),
  join(fixtureRoot, 'schema-provider-typecheck.ts'),
  join(fixtureRoot, 'typecheck.ts'),
])

if (!files.some((file) => file.endsWith('types/endpoints.d.ts'))) {
  throw new Error('The fixture did not generate #endpoints types; nothing would be checked.')
}

await mkdir(dirname(tsconfigPath), { recursive: true })
await writeFile(
  tsconfigPath,
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: ['node'],
        paths: {
          '#app/composables/asyncData': [join(nuxtRoot, 'dist/app/composables/asyncData.d.ts')],
          '#endpoints': ['./types/endpoints.d.ts'],
        },
      },
      files,
    },
    null,
    2,
  )}\n`,
)

const tsc = join(dirname(require.resolve('@typescript/native/package.json')), 'bin/tsc')

// tsc exits non-zero on a type error, which `run` turns into a throw. Reported
// as plain diagnostics and an exit code instead, so a failure reads like every
// other check rather than like the script itself crashed.
let output = ''
try {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [tsc, '--pretty', 'false', '-p', tsconfigPath],
    { cwd: fixtureRoot },
  )
  output = `${stdout}${stderr}`.trim()
} catch (error) {
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message
}

if (output !== '') {
  console.error(output)
  process.exitCode = 1
} else {
  console.log(`fixture types check clean (${files.length} generated files)`)
}
