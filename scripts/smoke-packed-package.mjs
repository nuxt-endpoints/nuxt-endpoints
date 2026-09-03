import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const arguments_ = process.argv.slice(2)
if (arguments_[0] === '--') arguments_.shift()
const [tarballArgument, nuxtVersion = '4.5.0', upstreamRoot] = arguments_

if (!tarballArgument) {
  throw new Error('Usage: smoke-packed-package.mjs <package.tgz> [nuxt-version] [upstream-root]')
}

const tarballPath = isAbsolute(tarballArgument)
  ? tarballArgument
  : resolve(process.cwd(), tarballArgument)
const smokeRoot = await mkdtemp(join(tmpdir(), 'nuxt-endpoints-package-smoke-'))

try {
  await mkdir(join(smokeRoot, 'server/api'), { recursive: true })
  await mkdir(join(smokeRoot, 'server/endpoints'), { recursive: true })

  await writeFile(join(smokeRoot, '.node-version'), '22.19.0\n')
  await writeFile(
    join(smokeRoot, 'pnpm-workspace.yaml'),
    `allowBuilds:
  'esbuild@0.28.2': true
${
  upstreamRoot
    ? `overrides:
  h3: link:${join(upstreamRoot, 'h3')}
  fetchdts: link:${join(upstreamRoot, 'fetchdts')}
  nitro: link:${join(upstreamRoot, 'nitro')}
`
    : ''
}
`,
  )
  await writeFile(
    join(smokeRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'nuxt-endpoints-package-smoke',
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.8.0',
        dependencies: {
          nuxt: nuxtVersion,
          'nuxt-endpoints': pathToFileURL(tarballPath).href,
          zod: '^4.4.3',
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(smokeRoot, 'nuxt.config.ts'),
    `export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  endpoints: { openApi: true },
})
`,
  )
  await writeFile(
    join(smokeRoot, 'server/endpoints/runtime.ts'),
    `import { createMemoryIdempotencyStorage } from 'nuxt-endpoints/runtime'

const storage = createMemoryIdempotencyStorage()

export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: () => 'packed-smoke',
    authorization: 'middleware',
  },
  routes: {
    '/api/echo': {
      post: {
        idempotency: {
          fingerprint: ({ body }) => body,
          leaseTtlMs: 15_000,
          replayTtlMs: 60_000,
        },
      },
    },
  },
})
`,
  )
  await writeFile(
    join(smokeRoot, 'server/routes.config.ts'),
    `import { z } from 'zod'
import { defineServerRouteConfig } from 'nuxt-endpoints/runtime'

export default defineServerRouteConfig({
  responses: {
    503: z.object({ error: z.literal('unavailable') }),
  },
})
`,
  )
  await writeFile(
    join(smokeRoot, 'server/api/echo.post.ts'),
    `import { z } from 'zod'

export default defineRouteHandler({
  validate: {
    body: z.object({ message: z.string() }),
    response: {
      201: z.object({ message: z.string() }),
    },
  },
  idempotency: {
    enabled: true,
    headerName: 'Idempotency-Key',
    required: true,
  },
  handler: (event) => event.respond(201, event.validated.body),
})
`,
  )

  run('vp', ['install'], smokeRoot)
  run('vp', ['exec', 'nuxi', 'prepare'], smokeRoot)

  const endpointTypes = await readFile(join(smokeRoot, '.nuxt/types/endpoints.d.ts'), 'utf8')
  const serverImports = await readFirstFile([
    join(smokeRoot, '.nuxt/types/nitro/nitro-imports.d.ts'),
    join(smokeRoot, '.nuxt/types/nitro-imports.d.ts'),
  ])

  assertIncludes(endpointTypes, "path: '/api/echo'", 'generated endpoint path')
  assertIncludes(
    endpointTypes,
    'serverResponses: ServerRouteResponsesFor',
    'generated application response contract',
  )
  assertIncludes(serverImports, 'defineRouteHandler', 'defineRouteHandler server auto-import')
  assertSymbolExcludes(serverImports, 'defineEndpoint', 'defineEndpoint server auto-import')
  assertSymbolExcludes(
    serverImports,
    'defineEndpointHandler',
    'defineEndpointHandler server auto-import',
  )
  assertSymbolExcludes(serverImports, 'createResponse', 'createResponse server auto-import')
  assertSymbolExcludes(serverImports, 'respond', 'respond server auto-import')

  run('vp', ['exec', 'nuxi', 'build'], smokeRoot)
  console.log(`Packed artifact smoke test passed with Nuxt ${nuxtVersion}.`)
} finally {
  await rm(smokeRoot, { recursive: true, force: true })
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`Missing ${label}: ${expected}`)
  }
}

async function readFirstFile(paths) {
  for (const path of paths) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`None of the expected generated files exists: ${paths.join(', ')}`)
}

function assertSymbolExcludes(source, symbol, label) {
  if (new RegExp(`\\b${symbol}\\b`).test(source)) {
    throw new Error(`Unexpected ${label}: ${symbol}`)
  }
}
