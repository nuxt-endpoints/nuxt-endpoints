import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const arguments_ = process.argv.slice(2)
if (arguments_[0] === '--') arguments_.shift()
const [tarballArgument, nuxtVersion = '4.5.0'] = arguments_

if (!tarballArgument) {
  throw new Error('Usage: smoke-packed-package.mjs <package.tgz> [nuxt-version]')
}

const tarballPath = isAbsolute(tarballArgument)
  ? tarballArgument
  : resolve(process.cwd(), tarballArgument)
const smokeRoot = await mkdtemp(join(tmpdir(), 'nuxt-endpoints-package-smoke-'))
let application
let applicationOutput = ''

try {
  await mkdir(join(smokeRoot, 'server/api'), { recursive: true })
  await mkdir(join(smokeRoot, 'server/endpoints'), { recursive: true })

  await writeFile(join(smokeRoot, '.node-version'), '22.19.0\n')
  await writeFile(
    join(smokeRoot, 'pnpm-workspace.yaml'),
    `allowBuilds:
  'esbuild@0.28.2': true
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
  handler: (event) => {
    return event.respond(201, event.validated.body)
  },
})
`,
  )
  await writeFile(
    join(smokeRoot, 'server/api/upload.post.ts'),
    `import { z } from 'zod'

export default defineRouteHandler({
  validate: {
    body: {
      'multipart/form-data': z.object({
        name: z.string(),
        file: z.file().max(5000).mime('text/plain'),
      }),
    },
    response: {
      201: z.object({ name: z.string() }),
    },
  },
  handler: (event) => {
    return event.respond(201, { name: event.validated.body.name })
  },
})
`,
  )

  run('vp', ['install'], smokeRoot)
  run('vp', ['exec', 'nuxi', 'prepare'], smokeRoot)

  const endpointTypes = await readFile(join(smokeRoot, '.nuxt/types/endpoints.d.ts'), 'utf8')
  const serverImports = await readFile(join(smokeRoot, '.nuxt/types/nitro-imports.d.ts'), 'utf8')

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

  const port = await getAvailablePort()
  application = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: smokeRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  application.stdout.on('data', (chunk) => {
    applicationOutput += chunk
  })
  application.stderr.on('data', (chunk) => {
    applicationOutput += chunk
  })

  const schema = await fetchSchema(`http://127.0.0.1:${port}/_endpoints/schema`)
  const file =
    schema.paths['/api/upload'].post.requestBody.content['multipart/form-data'].schema.properties
      .file

  assertEqual(file.type, 'string', 'z.file() OpenAPI type')
  assertEqual(file.format, 'binary', 'z.file() OpenAPI format')
  assertEqual(file.contentEncoding, 'binary', 'z.file() OpenAPI content encoding')
  assertEqual(file.contentMediaType, 'text/plain', 'z.file() OpenAPI media type')
  assertEqual(file.maxLength, 5000, 'z.file() OpenAPI maximum length')
  assertEqual(
    schema.paths['/api/echo'].post.responses['503'].content['application/json'].schema.properties
      .error.const,
    'unavailable',
    'application response OpenAPI schema',
  )
  console.log(`Packed artifact smoke test passed with Nuxt ${nuxtVersion}.`)
} finally {
  await stopApplication(application)
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

function assertSymbolExcludes(source, symbol, label) {
  if (new RegExp(`\\b${symbol}\\b`).test(source)) {
    throw new Error(`Unexpected ${label}: ${symbol}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}: expected ${expected}, received ${actual}`)
  }
}

async function getAvailablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )

  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a port for the packed artifact smoke test.')
  }
  return address.port
}

async function fetchSchema(url) {
  let lastError

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (application?.exitCode !== null) {
      throw new Error(
        `Packed application exited before serving OpenAPI.\n${applicationOutput.trim()}`,
      )
    }

    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
      lastError = new Error(`OpenAPI returned ${response.status}: ${await response.text()}`)
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(
    `Packed application did not serve OpenAPI: ${lastError?.message ?? 'unknown error'}\n${applicationOutput.trim()}`,
  )
}

async function stopApplication(child) {
  if (!child || child.exitCode !== null) return

  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}
