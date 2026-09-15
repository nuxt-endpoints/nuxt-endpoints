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
  '@nuxt/kit': file:${join(upstreamRoot, 'nuxt/.prototype-pack/nuxt-kit-5.0.0-0.tgz')}
  '@nuxt/nitro-server': file:${join(upstreamRoot, 'nuxt/.prototype-pack/nuxt-nitro-server-5.0.0-0.tgz')}
  '@nuxt/schema': file:${join(upstreamRoot, 'nuxt/.prototype-pack/nuxt-schema-5.0.0-0.tgz')}
  '@nuxt/vite-builder': file:${join(upstreamRoot, 'nuxt/.prototype-pack/nuxt-vite-builder-5.0.0-0.tgz')}
  '@nuxt/vite-server': file:${join(upstreamRoot, 'nuxt/.prototype-pack/nuxt-vite-server-5.0.0-0.tgz')}
  h3: link:${join(upstreamRoot, 'h3')}
  fetchdts: link:${join(upstreamRoot, 'fetchdts')}
  nitro: link:${join(upstreamRoot, 'nitro')}
  nuxt: file:${join(upstreamRoot, 'nuxt/.prototype-pack/nuxt-5.0.0-20260903.d070492f.tgz')}
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
    `import { defineEndpoint } from 'nuxt-endpoints/runtime'
import { z } from 'zod'

export default defineEndpoint({
  request: {
    body: z.object({ message: z.string() }),
  },
  responses: {
    201: z.object({ message: z.string() }),
  },
  idempotency: true,
  handler: (event) => event.respond(201, event.validated.body),
})
`,
  )

  run('vp', ['install'], smokeRoot)
  run('vp', ['exec', 'nuxi', 'prepare'], smokeRoot)

  const endpointTypes = await readFile(join(smokeRoot, '.nuxt/types/endpoints.d.ts'), 'utf8')

  assertIncludes(endpointTypes, "path: '/api/echo'", 'generated endpoint path')
  assertIncludes(
    endpointTypes,
    'serverResponses: ServerRouteResponsesFor',
    'generated application response contract',
  )
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
