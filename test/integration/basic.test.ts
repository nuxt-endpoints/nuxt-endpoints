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
  const routes = Array.from(
    endpointTypes.matchAll(/\| \{ path: '([^']+)', method: '([^']+)'/g),
    ([, path, method]) => ({ path, method }),
  )
  if (routes.length === 0) {
    throw new Error('No generated endpoint routes were available for InternalApi comparison.')
  }
  const assertions = routes
    .map(
      ({ path, method }, index) =>
        `type RouteAgreement${index} = Assert<Equal<$EndpointPathResponse<${JSON.stringify(path)}, ${JSON.stringify(method)}>, InternalApi[${JSON.stringify(path)}][${JSON.stringify(method)}]>>`,
    )
    .join('\n')

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
