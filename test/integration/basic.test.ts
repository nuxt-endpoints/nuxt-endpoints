import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const fixtureRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

if (process.env.NUXT_ENDPOINTS_E2E === '1') {
  const { $fetch, fetch, setup, useTestContext } = await import('@nuxt/test-utils/e2e')

  describe('Nuxt integration', async () => {
    await setup({
      rootDir: fixtureRoot,
      browser: false,
      server: true,
      port: Number(process.env.NUXT_ENDPOINTS_E2E_PORT || 53491),
      setupTimeout: 120000,
    })

    it('serves endpoint handlers through Nuxt', async () => {
      await expect($fetch('/api/users/123')).resolves.toEqual({
        id: 123,
        name: 'Tom',
      })
    })

    it('renders generated useEndpoint calls through Nuxt async data', async () => {
      await expect($fetch<string>('/')).resolves.toContain('nuxt-endpoints fixture: Tom')
    })

    it('serves declared error responses with their bare bodies', async () => {
      const response = await fetch('/api/users/404')
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toEqual({ message: 'Not found' })
    })

    it('preserves success status responses at runtime', async () => {
      const response = await fetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Sid' }),
        headers: {
          'content-type': 'application/json',
        },
      })

      await expect(response.json()).resolves.toEqual({
        id: 1,
        name: 'Sid',
      })
      expect(response.status).toBe(201)
    })

    it('accepts a media-type-map body via its application/json member', async () => {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: JSON.stringify({ name: 'Sid' }),
        headers: {
          'content-type': 'application/json',
        },
      })

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toEqual({
        name: 'Sid',
        bodyMediaType: 'application/json',
      })
    })

    it('rejects a media-type-map body whose Content-Type matches no declared member', async () => {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: '<p>nope</p>',
        headers: {
          'content-type': 'text/html',
        },
      })

      expect(response.status).toBe(415)
      const body = await response.json()
      expect(body.statusMessage).toBe('Unsupported Media Type')
      expect(body.data.received).toBe('text/html')
    })

    it('includes every declared media type in the OpenAPI request body for a media-type-map contract', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      const requestBody = schema.paths['/api/upload'].post.requestBody

      expect(requestBody.required).toBe(true)
      expect(requestBody.content).toHaveProperty('application/json')
      expect(requestBody.content).toHaveProperty('multipart/form-data')
    })

    it('sends a multipart/form-data body through $endpoint using the mediaType option', async () => {
      await expect($fetch<string>('/upload')).resolves.toContain(
        'upload: Multipart via multipart/form-data',
      )
    })

    it('serializes response-schema outputs to their JSON wire representation', async () => {
      await expect($fetch('/api/serialized')).resolves.toEqual({
        createdAt: '2026-08-14T00:00:00.000Z',
      })

      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      const responseSchema =
        schema.paths['/api/serialized'].get.responses[200].content['application/json'].schema

      expect(responseSchema.properties.createdAt).toEqual(
        expect.objectContaining({ type: 'string', format: 'date-time' }),
      )
    })

    it('serves an endpoint whose contract is defined in a separate module', async () => {
      await expect($fetch('/api/separated')).resolves.toEqual({
        name: 'separated',
        separated: true,
      })
      await expect($fetch('/api/separated', { query: { name: 'custom' } })).resolves.toEqual({
        name: 'custom',
        separated: true,
      })
    })

    it('includes separated-contract routes in the OpenAPI document', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')

      expect(schema.paths['/api/separated']).toBeDefined()
      expect(schema.paths['/api/separated'].get.operationId).toBe('getSeparated')
    })

    it('serves an endpoint whose contract is a sibling .endpoint-contract file', async () => {
      await expect($fetch('/api/sibling')).resolves.toEqual({
        name: 'sibling',
        sibling: true,
      })
      await expect($fetch('/api/sibling', { query: { name: 'custom' } })).resolves.toEqual({
        name: 'custom',
        sibling: true,
      })

      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      expect(schema.paths['/api/sibling'].get.operationId).toBe('getSibling')
    })

    it('does not register sibling contract files as Nitro routes', async () => {
      const response = await fetch('/api/sibling.get.endpoint-contract')
      expect(response.status).toBe(404)
    })

    it('dispatches every declared method of a multi-method group', async () => {
      await expect($fetch('/api/multi', { query: { name: 'from-get' } })).resolves.toEqual({
        name: 'from-get',
      })
      await expect(
        $fetch('/api/multi', { method: 'PUT', body: { name: 'from-put' } }),
      ).resolves.toEqual({ name: 'from-put' })
    })

    it('answers undeclared, HEAD, and OPTIONS requests from the group contract', async () => {
      const notAllowed = await fetch('/api/multi', { method: 'DELETE' })
      expect(notAllowed.status).toBe(405)
      expect(notAllowed.headers.get('allow')).toBe('GET, HEAD, OPTIONS, PUT')

      const options = await fetch('/api/multi', { method: 'OPTIONS' })
      expect(options.status).toBe(204)
      expect(options.headers.get('allow')).toBe('GET, HEAD, OPTIONS, PUT')

      const head = await fetch('/api/multi', { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(head.headers.get('content-type')).toContain('application/json')
      await expect(head.text()).resolves.toBe('')
    })

    it('documents every group member as its own OpenAPI operation', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')

      expect(schema.paths['/api/multi'].get.operationId).toBe('getMulti')
      expect(schema.paths['/api/multi'].put.operationId).toBe('putMulti')
    })

    it('injects route metadata and replays idempotent endpoint responses', async () => {
      const request = () =>
        fetch('/api/idempotent', {
          method: 'POST',
          body: JSON.stringify({ amount: 100 }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'integration-request-1',
          },
        })

      const first = await request()
      const second = await request()

      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      await expect(first.json()).resolves.toEqual({ id: 1, amount: 100 })
      await expect(second.json()).resolves.toEqual({ id: 1, amount: 100 })
    })

    it('replays idempotent responses for an endpoint backed by the central policy', async () => {
      const request = () =>
        fetch('/api/idempotent-central', {
          method: 'POST',
          body: JSON.stringify({ amount: 100 }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'integration-central-request-1',
          },
        })

      const first = await request()
      const second = await request()

      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      await expect(first.json()).resolves.toEqual(await second.json())
    })

    it('requires the idempotency key for the central-policy-backed endpoint', async () => {
      const response = await fetch('/api/idempotent-central', {
        method: 'POST',
        body: JSON.stringify({ amount: 100 }),
        headers: { 'content-type': 'application/json' },
      })

      expect(response.status).toBe(400)
    })

    it('includes idempotency metadata in generated clients and OpenAPI', async () => {
      const buildDir = getBuildDir(useTestContext)
      const endpointClient = await readFile(join(buildDir, 'endpoints.ts'), 'utf8')
      const queryClient = await readFile(join(buildDir, 'endpoints-query.ts'), 'utf8')
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')

      expect(endpointClient).toContain('"headerName": "Idempotency-Key"')
      expect(endpointClient).toContain('"required": true')
      expect(queryClient).toContain('"headerName": "Idempotency-Key"')
      expect(schema.paths['/api/idempotent'].post.parameters).toContainEqual(
        expect.objectContaining({
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
        }),
      )
      expect(schema.paths['/api/idempotent'].post.responses[409].content).toHaveProperty(
        'application/problem+json',
      )
    })

    it('generates endpoint types from Nuxt/Nitro routes only for endpoint contracts', async () => {
      const buildDir = getBuildDir(useTestContext)
      const endpointTypes = await readFile(join(buildDir, 'types/endpoints.d.ts'), 'utf8')
      const endpointClient = await readFile(join(buildDir, 'endpoints.ts'), 'utf8')
      const nitroRoutes = await readFile(join(buildDir, 'types/nitro-routes.d.ts'), 'utf8')

      expect(endpointTypes).toContain("operation: 'getUser'")
      expect(endpointTypes).toContain("operation: 'createUser'")
      expect(endpointTypes).toContain("operation: 'getDynamic'")
      expect(endpointTypes).toContain("operation: 'getSerialized'")
      expect(endpointTypes).toContain("path: '/api/search'")
      expect(endpointTypes).toContain('export type $UseEndpoint')
      expect(endpointTypes).toContain('export type $UseEndpointResult')
      expect(endpointClient).toContain(
        "import { createUseAsyncData } from '#app/composables/asyncData'",
      )
      expect(endpointClient).toContain('export const __useEndpointAsyncData = createUseAsyncData()')
      expect(endpointClient).toContain('export const useEndpoint')
      expect(endpointClient).toContain('export const useEndpointResult')
      expect(endpointClient).not.toContain('export const useEndpointEffect')
      expect(endpointTypes).not.toContain('plain')
      expect(endpointTypes).toContain('EndpointClient<EndpointRouteEntry, EndpointClientFeatures>')
      expect(endpointTypes).toContain('result: true')
      expect(endpointTypes).toContain('raw: true')
      expect(nitroRoutes).toContain('interface InternalApi')
      expect(nitroRoutes).toContain("'/api/users/:id'")
    })

    it('generates TanStack Query client artifacts when endpoints.client.query is enabled', async () => {
      const buildDir = getBuildDir(useTestContext)
      const queryClient = await readFile(join(buildDir, 'endpoints-query.ts'), 'utf8')
      const queryTypes = await readFile(join(buildDir, 'types/endpoints-query.d.ts'), 'utf8')

      expect(queryClient).toContain('export const endpointQueryOptions')
      expect(queryClient).toContain('export const endpointMutationOptions')
      expect(queryClient).toContain('captureFetcher')
      expect(queryTypes).toContain('$EndpointQueryOptions')
      expect(queryTypes).toContain("operation: 'getUser'")
      expect(queryTypes).toContain("operation: 'createUser'")
      expect(queryTypes).toContain("operation: 'getDynamic'")
    })

    it('type-checks the generated #endpoints client against endpoint contracts', async () => {
      const buildDir = getBuildDir(useTestContext)
      const tsconfigPath = join(buildDir, 'endpoints-typecheck.json')
      const internalApiAgreementPath = join(buildDir, 'internal-api-agreement.ts')
      const nuxtRoot = dirname(require.resolve('nuxt/package.json'))
      const endpointTypes = await readFile(join(buildDir, 'types/endpoints.d.ts'), 'utf8')
      await writeFile(
        internalApiAgreementPath,
        generateInternalApiAgreementTypecheck(endpointTypes),
        'utf8',
      )
      const generatedTypeFiles = await existingFiles([
        join(buildDir, 'types/imports.d.ts'),
        join(buildDir, 'types/nitro-routes.d.ts'),
        join(buildDir, 'types/endpoints.d.ts'),
        internalApiAgreementPath,
        join(fixtureRoot, 'typecheck.ts'),
      ])

      await writeJson(tsconfigPath, {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          types: ['node'],
          paths: {
            '#app/composables/asyncData': [join(nuxtRoot, 'dist/app/composables/asyncData.d.ts')],
            '#endpoints': ['./types/endpoints.d.ts'],
          },
        },
        files: generatedTypeFiles,
      })

      const tsc = join(dirname(require.resolve('@typescript/native/package.json')), 'bin/tsc')
      const { stderr, stdout } = await runTypeScript([
        tsc,
        '--noEmit',
        '--pretty',
        'false',
        '-p',
        tsconfigPath,
      ])

      expect(stdout + stderr).toBe('')
    }, 30000)

    it('renders TanStack Query data during SSR', async () => {
      await expect($fetch<string>('/query-user')).resolves.toContain('query-user: Tom')
    })

    it('forwards request cookies to internal endpoints during SSR queries', async () => {
      await expect(
        $fetch<string>('/query-whoami', { headers: { cookie: 'session=alice' } }),
      ).resolves.toContain('query-whoami: alice')
    })

    it('isolates SSR query caches between users', async () => {
      const alice = await $fetch<string>('/query-whoami', {
        headers: { cookie: 'session=alice' },
      })
      const bob = await $fetch<string>('/query-whoami', {
        headers: { cookie: 'session=bob' },
      })

      expect(alice).toContain('alice')
      expect(alice).not.toContain('bob')
      expect(bob).toContain('bob')
      expect(bob).not.toContain('alice')
    })

    it('embeds dehydrated query state in the SSR payload', async () => {
      await expect($fetch<string>('/query-user')).resolves.toContain('nuxt-endpoints')
    })
  })
} else {
  describe.skip('Nuxt integration', () => {
    it('runs with NUXT_ENDPOINTS_E2E=1', () => {})
  })
}

function getBuildDir(useTestContext: () => { nuxt?: { options: { buildDir?: string } } }): string {
  const buildDir = useTestContext().nuxt?.options.buildDir
  if (!buildDir) {
    throw new Error('Nuxt buildDir is not available')
  }
  return buildDir
}

function generateInternalApiAgreementTypecheck(endpointTypes: string): string {
  // Each union member is one line, so a line carrying `__endpoint_contracts__`
  // came from a multi-method group. Nitro types a method-suffix-free route
  // file under `InternalApi[path]['default']`, so those paths are compared as
  // the union of their declared methods instead of method by method.
  const routes = endpointTypes
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/\| \{ path: '([^']+)', method: '([^']+)'/)
      if (!match) return []
      const [, path, method] = match
      return [{ path, method, group: line.includes('__endpoint_contracts__') }]
    })
    .filter((route) => route.path !== undefined && route.method !== undefined)
  if (routes.length === 0) {
    throw new Error('No generated endpoint routes were available for InternalApi comparison.')
  }

  const groupMethodsByPath = new Map<string, string[]>()
  for (const route of routes) {
    if (!route.group) continue
    const methods = groupMethodsByPath.get(route.path) ?? []
    methods.push(route.method)
    groupMethodsByPath.set(route.path, methods)
  }

  const singleAssertions = routes
    .filter((route) => !route.group)
    .map(
      ({ path, method }, index) =>
        `type RouteAgreement${index} = Assert<Equal<$EndpointPathResponse<${JSON.stringify(path)}, ${JSON.stringify(method)}>, InternalApi[${JSON.stringify(path)}][${JSON.stringify(method)}]>>`,
    )
  const groupAssertions = Array.from(groupMethodsByPath, ([path, methods], index) => {
    const union = methods
      .map((method) => `$EndpointPathResponse<${JSON.stringify(path)}, ${JSON.stringify(method)}>`)
      .join(' | ')
    return `type GroupRouteAgreement${index} = Assert<Equal<${union}, InternalApi[${JSON.stringify(path)}]['default']>>`
  })
  const assertions = [...singleAssertions, ...groupAssertions].join('\n')

  return `import type { $EndpointPathResponse } from '#endpoints'
import type { InternalApi } from 'nitropack/types'

type Equal<LEFT, RIGHT> =
  (<VALUE>() => VALUE extends LEFT ? 1 : 2) extends
  (<VALUE>() => VALUE extends RIGHT ? 1 : 2)
    ? (<VALUE>() => VALUE extends RIGHT ? 1 : 2) extends
      (<VALUE>() => VALUE extends LEFT ? 1 : 2)
      ? true
      : false
    : false
type Assert<VALUE extends true> = VALUE

${assertions}
`
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function existingFiles(paths: string[]) {
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

async function runTypeScript(args: string[]) {
  try {
    return await execFileAsync(process.execPath, args, {
      cwd: fixtureRoot,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    })
  } catch (error) {
    const result = error as Error & { stdout?: string; stderr?: string }
    throw new Error([result.message, result.stdout, result.stderr].filter(Boolean).join('\n'))
  }
}
