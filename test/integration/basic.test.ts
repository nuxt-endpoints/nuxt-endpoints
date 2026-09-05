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

    it('serves the generated cursor-pagination contract', async () => {
      await expect($fetch('/api/articles?limit=2')).resolves.toEqual({
        items: [
          { id: 1, title: 'One' },
          { id: 2, title: 'Two' },
        ],
        nextCursor: '2',
      })
      await expect($fetch('/api/articles?limit=2&cursor=2')).resolves.toEqual({
        items: [{ id: 3, title: 'Three' }],
      })
    })

    it('documents pagination-generated query and response fields', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      const operation = schema.paths['/api/articles'].get

      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'cursor', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
        ]),
      )
      expect(operation.responses['200'].content['application/json'].schema).toMatchObject({
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array' },
          nextCursor: { type: 'string' },
        },
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

    it('wraps every handler with the application-wide hook', async () => {
      const response = await fetch('/api/users/123')

      expect(response.status).toBe(200)
      expect(response.headers.get('x-wrapped')).toBe('GET')
    })

    it('shapes contract failures with the application-wide validation hook', async () => {
      const mediaTypeMismatch = await fetch('/api/upload', {
        method: 'POST',
        body: '<p>nope</p>',
        headers: { 'content-type': 'text/html' },
      })

      expect(mediaTypeMismatch.status).toBe(422)
      await expect(mediaTypeMismatch.json()).resolves.toEqual({
        error: 'contract',
        kind: 'media-type',
        source: 'body',
      })

      const schemaFailure = await fetch('/api/search')
      expect(schemaFailure.status).toBe(422)
      await expect(schemaFailure.json()).resolves.toEqual({
        error: 'contract',
        kind: 'schema',
        source: 'query',
      })
    })

    it('includes every declared media type in the OpenAPI request body for a media-type-map contract', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      const requestBody = schema.paths['/api/upload'].post.requestBody

      expect(requestBody.required).toBe(true)
      expect(requestBody.content).toHaveProperty('application/json')
      expect(requestBody.content).toHaveProperty('multipart/form-data')
    })

    it('sends a labelled media-type body through $endpoint during SSR', async () => {
      await expect($fetch<string>('/upload')).resolves.toContain(
        'upload: Encoded via application/x-www-form-urlencoded',
      )
    })

    it('accepts a real multipart/form-data request', async () => {
      // Sent as a real HTTP request, the way a browser would: the Content-Type
      // boundary comes from building the request, which a server-side call to
      // a local route never does.
      const body = new FormData()
      body.append('name', 'Multipart')
      body.append('file', new File(['contents'], 'upload.txt', { type: 'text/plain' }))

      await expect($fetch('/api/upload', { method: 'POST', body })).resolves.toEqual({
        name: 'Multipart',
        bodyMediaType: 'multipart/form-data',
      })
    })

    it('documents a Zod file as a constrained binary multipart field', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      const file =
        schema.paths['/api/upload'].post.requestBody.content['multipart/form-data'].schema
          .properties.file

      expect(file).toMatchObject({
        type: 'string',
        format: 'binary',
        contentEncoding: 'binary',
        contentMediaType: 'text/plain',
        maxLength: 5000,
      })
    })

    it('streams the preferred media response when the request states no preference', async () => {
      const response = await fetch('/api/export?delimiter=;')

      expect(response.status).toBe(200)
      // Two representations are declared and `text/csv` is declared first, so
      // it is what a request expressing no preference gets.
      expect(response.headers.get('content-type')).toContain('text/csv')
      expect(response.headers.get('vary')).toBe('Accept')
      // Read it as a stream rather than with .text(): the point of the
      // declaration is that nothing buffered it on the way out.
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let received = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        received += decoder.decode(value, { stream: true })
      }

      expect(received).toBe('id;name\nu_1;Tom\n')
    })

    it('negotiates the JSON representation of the same status from Accept', async () => {
      const response = await fetch('/api/export', {
        headers: { accept: 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(response.headers.get('vary')).toBe('Accept')
      await expect(response.json()).resolves.toEqual([
        ['id', 'name'],
        ['u_1', 'Tom'],
      ])
    })

    it('routes an unacceptable Accept through the application onValidationError', async () => {
      const response = await fetch('/api/export', {
        headers: { accept: 'application/xml' },
      })

      // This fixture's server/endpoints/runtime.ts replaces every contract
      // failure with its own 422, and a negotiation refusal is one - so what
      // this asserts is that the 406 reaches the same extension point as a
      // schema or media-type failure rather than bypassing it. The default
      // 406 body is covered in test/media-response.test.ts.
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        error: 'contract',
        kind: 'accept',
        source: 'headers',
      })
      // The refusal varies on Accept even after the application reshaped it:
      // it is the response a cache must never reuse for a different Accept.
      expect(response.headers.get('vary')).toBe('Accept')
    })

    it('varies on Accept for every representation the endpoint serves', async () => {
      // The route negotiates, so `Vary` describes the route rather than one
      // answer: a cache holding the CSV must still know the JSON exists.
      const responses = await Promise.all([
        fetch('/api/export'),
        fetch('/api/export', { headers: { accept: 'text/csv' } }),
        fetch('/api/export', { headers: { accept: 'application/json' } }),
        fetch('/api/export', { headers: { accept: '*/*' } }),
      ])

      for (const response of responses) {
        expect(response.status).toBe(200)
        expect(response.headers.get('vary')).toBe('Accept')
      }
    })

    it('serves an endpoint whose route came from nitro.handlers, not from scanning', async () => {
      // The handler file lives outside every scanned directory, so this route
      // exists only because discovery reads Nitro's configured handlers too.
      await expect($fetch('/custom/report?id=r_1')).resolves.toEqual({
        id: 'r_1',
        source: 'custom-route',
      })

      const validationFailure = await fetch('/custom/report')
      expect(validationFailure.status).toBe(422)

      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      expect(schema.paths['/custom/report'].get.operationId).toBe('getCustomReport')
    })

    it('layers application-owned document metadata into the OpenAPI schema', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')

      // `document` is deep-merged, so the generated operations survive it.
      expect(schema.servers).toEqual([{ url: 'https://api.example.test' }])
      expect(schema.components.securitySchemes.bearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
      })
      expect(schema.paths['/api/users/{id}'].get.operationId).toBe('getApiUsersById')
      // `extend` runs last, on the merged document.
      expect(schema.security).toEqual([{ bearerAuth: [] }])
    })

    it('documents every declared media type of a media response in the OpenAPI schema', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      const response = schema.paths['/api/export'].get.responses['200']

      expect(response.description).toBe('User export')
      expect(Object.keys(response.content)).toEqual(['text/csv', 'application/json'])
      expect(response.content['text/csv'].schema).toEqual({
        type: 'string',
        contentEncoding: 'binary',
      })
      expect(response.content['application/json'].schema).toEqual({
        type: 'string',
        contentEncoding: 'binary',
      })
    })

    it('sends a validated body as application/problem+json and documents it as such', async () => {
      const response = await fetch('/api/problem')

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      await expect(response.json()).resolves.toEqual({
        type: 'https://example.com/probs/not-found',
        title: 'Not Found',
        status: 404,
      })

      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      expect(schema.paths['/api/problem'].get.responses['404'].content).toHaveProperty(
        'application/problem+json',
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
      expect(schema.paths['/api/separated'].get.operationId).toBe('getApiSeparated')
    })

    it('serves an endpoint whose contract values come from an ordinary server/contracts module', async () => {
      await expect($fetch('/api/sibling')).resolves.toEqual({
        name: 'sibling',
        sibling: true,
      })
      await expect($fetch('/api/sibling', { query: { name: 'custom' } })).resolves.toEqual({
        name: 'custom',
        sibling: true,
      })

      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')
      expect(schema.paths['/api/sibling'].get.operationId).toBe('getApiSibling')
    })

    it('does not register ordinary contract modules as Nitro routes', async () => {
      const response = await fetch('/contracts/sibling')
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

      expect(schema.paths['/api/multi'].get.operationId).toBe('getApiMulti')
      expect(schema.paths['/api/multi'].put.operationId).toBe('putApiMulti')
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

    it('uses route runtime settings for a bodyless fingerprint and a replayable 409', async () => {
      const request = () =>
        fetch('/api/idempotent-bodyless', {
          method: 'POST',
          headers: { 'idempotency-key': 'integration-bodyless-request-1' },
        })

      const first = await request()
      const second = await request()

      expect(first.status).toBe(409)
      expect(second.status).toBe(409)
      await expect(first.json()).resolves.toEqual({ executionCount: 1 })
      await expect(second.json()).resolves.toEqual({ executionCount: 1 })
    })

    it('uses an explicit route fingerprint for multipart File input', async () => {
      const request = () => {
        const body = new FormData()
        body.append('name', 'Multipart idempotency')
        body.append('file', new File(['contents'], 'upload.txt', { type: 'text/plain' }))
        return fetch('/api/idempotent-upload', {
          method: 'POST',
          body,
          headers: { 'idempotency-key': 'integration-upload-request-1' },
        })
      }

      const first = await request()
      const second = await request()

      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      await expect(first.json()).resolves.toEqual({
        executionCount: 1,
        name: 'Multipart idempotency',
      })
      await expect(second.json()).resolves.toEqual({
        executionCount: 1,
        name: 'Multipart idempotency',
      })
    })

    it('uses route hooks and falls back to application validation handling', async () => {
      const routeFailure = await fetch('/api/runtime-hooks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ada' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(routeFailure.status).toBe(409)
      await expect(routeFailure.json()).resolves.toEqual({ error: 'route', source: 'query' })

      const applicationFailure = await fetch('/api/runtime-hooks?q=ok', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      })
      expect(applicationFailure.status).toBe(422)
      await expect(applicationFailure.json()).resolves.toEqual({
        error: 'contract',
        kind: 'schema',
        source: 'body',
      })

      const success = await fetch('/api/runtime-hooks?q=ok', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ada' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(success.headers.get('x-wrapped')).toBe('POST')
    })

    it('includes idempotency metadata in the generated client and OpenAPI', async () => {
      const buildDir = getBuildDir(useTestContext)
      const endpointClient = await readFile(join(buildDir, 'endpoints.ts'), 'utf8')
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')

      expect(endpointClient).toContain('"headerName": "Idempotency-Key"')
      expect(endpointClient).toContain('"required": true')
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

    it('applies central path and method response contracts to OpenAPI', async () => {
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')

      expect(schema.paths['/api/users/{id}'].get.responses[401].content).toHaveProperty(
        'application/json',
      )
      expect(schema.paths['/api/users'].post.responses[401].content).toHaveProperty(
        'application/json',
      )
      expect(schema.paths['/api/users'].post.responses[429].content).toHaveProperty(
        'application/json',
      )
      expect(schema.paths['/api/search'].get.responses[401]).toBeUndefined()
    })

    it('generates endpoint types from Nuxt/Nitro routes only for endpoint contracts', async () => {
      const buildDir = getBuildDir(useTestContext)
      const endpointTypes = await readFile(join(buildDir, 'types/endpoints.d.ts'), 'utf8')
      const endpointClient = await readFile(join(buildDir, 'endpoints.ts'), 'utf8')
      const nitroRoutes = await readFile(join(buildDir, 'types/nitro-routes.d.ts'), 'utf8')

      expect(endpointTypes).toContain("path: '/api/users/:id'")
      expect(endpointTypes).toContain("method: 'get'")
      expect(endpointTypes).toContain("name: 'getUser'")
      expect(endpointClient).toContain('"name": "getUser"')
      expect(endpointTypes).toContain("path: '/api/search'")
      expect(endpointTypes).toContain('export type $UseEndpoint')
      expect(endpointTypes).not.toContain('$UseEndpointResult')
      expect(endpointClient).toContain(
        "import { createUseAsyncData } from '#app/composables/asyncData'",
      )
      expect(endpointClient).toContain('export const __useEndpointAsyncData = createUseAsyncData()')
      expect(endpointClient).toContain('export const useEndpoint')
      expect(endpointClient).not.toContain('useEndpointResult')
      expect(endpointTypes).not.toContain('plain')
      expect(endpointTypes).toContain(
        'EndpointMappedClient<EndpointRouteMap, EndpointClientFeatures>',
      )
      expect(endpointTypes).toContain('raw: true')
      expect(nitroRoutes).toContain('interface InternalApi')
      expect(nitroRoutes).toContain("'/api/users/:id'")
    })

    it('uses endpoint request Query adapters without generated Query factories', async () => {
      const buildDir = getBuildDir(useTestContext)
      const endpointClient = await readFile(join(buildDir, 'endpoints.ts'), 'utf8')

      expect(endpointClient).toContain('captureFetcher')
      await expect(access(join(buildDir, 'endpoints-query.ts'))).rejects.toThrow()
      await expect(access(join(buildDir, 'types/endpoints-query.d.ts'))).rejects.toThrow()
    })

    it('agrees with the generated Nitro InternalApi for every route', async () => {
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
      // Deliberately without `typecheck.ts`: `scripts/typecheck-fixture.mjs`
      // compiles it against the same generated types, and both run in
      // `pnpm check`, so including it here was the same tsc pass twice. What is
      // only provable with a real Nitro build stays - the generated
      // `InternalApi` this agreement file compares against.
      const generatedTypeFiles = await existingFiles([
        join(buildDir, 'types/imports.d.ts'),
        join(buildDir, 'types/nitro-routes.d.ts'),
        join(buildDir, 'types/endpoints.d.ts'),
        internalApiAgreementPath,
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

    it('renders Pinia Colada data during SSR', async () => {
      await expect($fetch<string>('/query-user')).resolves.toContain('query-user: Tom')
    })

    it('forwards request cookies to internal endpoints during SSR queries', async () => {
      await expect(
        $fetch<string>('/query-whoami', { headers: { cookie: 'session=alice' } }),
      ).resolves.toContain('query-whoami: alice')
    })

    // `useEndpoint` mirrors `useFetch`, so it has to forward the request the
    // same way. Without the captured `useRequestFetch()` the internal route
    // reads no cookie and renders `anonymous`.
    it('forwards request cookies to internal endpoints during SSR useEndpoint calls', async () => {
      await expect(
        $fetch<string>('/endpoint-whoami', { headers: { cookie: 'session=alice' } }),
      ).resolves.toContain('endpoint-whoami: alice')
    })

    it('isolates SSR useEndpoint results between users', async () => {
      const alice = await $fetch<string>('/endpoint-whoami', {
        headers: { cookie: 'session=alice' },
      })
      const bob = await $fetch<string>('/endpoint-whoami', {
        headers: { cookie: 'session=bob' },
      })

      expect(alice).toContain('alice')
      expect(alice).not.toContain('bob')
      expect(bob).toContain('bob')
      expect(bob).not.toContain('alice')
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
  // Each indexed method entry is one line. A method argument after `~routeDef` marks
  // the multi-method form. Nitro 2 types a method-suffix-free route file under
  // `InternalApi[path]['default']`, so those paths are compared as the union
  // of their declared methods instead of method by method.
  const routes = endpointTypes
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/\{ path: '([^']+)', method: '([^']+)'/)
      if (!match) return []
      const [, path, method] = match
      return [{ path, method, group: line.includes("['~routeDef'],") }]
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
        `type RouteAgreement${index} = Assert<Agrees<SuccessBody<$EndpointPathResponse<${JSON.stringify(path)}, ${JSON.stringify(method)}>>, InternalApi[${JSON.stringify(path)}][${JSON.stringify(method)}]>>`,
    )
  const groupAssertions = Array.from(groupMethodsByPath, ([path, methods], index) => {
    const union = methods
      .map(
        (method) =>
          `SuccessBody<$EndpointPathResponse<${JSON.stringify(path)}, ${JSON.stringify(method)}>>`,
      )
      .join(' | ')
    return `type GroupRouteAgreement${index} = Assert<Agrees<${union}, InternalApi[${JSON.stringify(path)}]['default']>>`
  })
  const assertions = [...singleAssertions, ...groupAssertions].join('\n')

  return `import type { $EndpointPathResponse } from '#endpoints'
import type { InternalApi } from 'nitropack/types'

// Mutual structural assignability is the contract here. Generated route
// helpers intentionally retain conditional aliases around the same concrete
// body, which the function-parameter equality trick treats as nominally
// different even when both public types accept exactly the same values.
type Equal<LEFT, RIGHT> = [LEFT] extends [RIGHT]
  ? [RIGHT] extends [LEFT]
    ? true
    : false
  : false
type Assert<VALUE extends true> = VALUE
type SuccessBody<RESULT> = Extract<RESULT, { ok: true }> extends { body: infer BODY }
  ? BODY
  : never

// A route that declares a stream response is exempt, and deliberately so.
// InternalApi describes what a parsing $fetch would produce for that route,
// while the whole point of the declaration is that this client does not parse
// it. The exemption is keyed on the exact client type a stream declaration
// produces, so a JSON route whose projection drifted cannot slip through it -
// and \`typecheck.ts\` asserts the streaming side positively.
type Agrees<LEFT, RIGHT> =
  Equal<LEFT, ReadableStream<Uint8Array>> extends true ? true : Equal<LEFT, RIGHT>

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
