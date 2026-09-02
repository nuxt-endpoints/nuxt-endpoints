import type { BundledLanguage } from 'shiki'

export const contractSteps = [
  {
    shortTitle: 'Definition',
    title: 'Define a route contract beside its handler.',
    description: [
      { text: 'Choose ' },
      { text: 'Zod, Valibot, or Effect Schema', tone: 'server' },
      { text: ', then declare the HTTP boundary in the route itself.' },
    ],
    serverCode: `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }), // '123' → 123
  handler: (event) => ({
    id: event.validated.params.id,
    name: 'Ada',
  }),
})`,
    clientCode: '',
    highlightLines: {
      serverCode: [1, 2],
      clientCode: [],
    },
    serverEffect: 'The route, its contract, and its handler stay in one file.',
    clientEffect: 'The file path and HTTP method become the client identity.',
    runtimeEffect: 'The params schema validates real requests at runtime.',
  },
  {
    shortTitle: 'Request',
    title: 'Receive validated request values.',
    description: [
      { text: 'Request data is parsed before your handler runs. Server code receives ' },
      { text: 'validated values', tone: 'server' },
      { text: ' instead of raw strings.' },
    ],
    serverCode: `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  handler: (event) => {
    const userId = event.validated.params.id // number — validated & coerced
  },
})`,
    clientCode: '',
    highlightLines: {
      serverCode: [3, 4, 5],
      clientCode: [],
    },
    serverEffect: '`params.id` is type-safe inside the handler.',
    clientEffect: 'No client surface is introduced in this step.',
    runtimeEffect: 'The same schema validates real HTTP path params at runtime.',
  },
  {
    shortTitle: 'Inference',
    title: 'Use a type-safe client call.',
    description: [
      { text: 'Client calls are checked for path, method, and params. The ' },
      { text: 'returned status data is inferred from server code', tone: 'client' },
      { text: ', so unknown fields fail in TypeScript.' },
    ],
    serverCode: `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  handler: async (event) => {
    const user = await findUserById(event.validated.params.id)
    return user // client types are inferred from here
  },
})`,
    clientCode: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
}) // result.body: typed from the handler return
console.log(\`id: \${result.body.id}, name: \${result.body.name}\`)`,
    highlightLines: {
      serverCode: [3, 4, 5],
      clientCode: [1, 2, 3, 4, 5],
    },
    serverEffect: 'The handler return becomes the inferred status-200 body.',
    clientEffect: 'The generated client uses it in the status-aware result.',
    runtimeEffect: 'No response schema is required for this lightweight path.',
  },
  {
    shortTitle: 'Response',
    title: 'Make response types explicit.',
    description: [
      { text: 'Add response schemas after the handler works. TypeScript checks ' },
      { text: 'returned status responses', tone: 'server' },
      { text: ', so handlers can only return the statuses and body shapes you declared.' },
    ],
    serverCode: `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: { // now the handler is checked against these
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: async (event) => {
    const user = await findUserById(event.validated.params.id)
    return user ?? event.respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})
if (result.status === 200) console.log(result.body.name)`,
    highlightLines: {
      serverCode: [3, 4, 5, 6, 7, 8, 11],
      clientCode: [],
    },
    serverEffect: '`validate.response` turns the inferred shape into explicit status contracts.',
    clientEffect: 'The client keeps the same call shape and response type.',
    runtimeEffect: 'Runtime response validation uses the same schemas automatically.',
  },
  {
    shortTitle: 'Result',
    title: 'Branch by response status.',
    description: [
      { text: 'Status and body stay together, so checking the status gives ' },
      { text: 'type narrowing', tone: 'client' },
      { text: ' for the matching response body.' },
    ],
    serverCode: `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: {
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: async (event) => {
    const user = await findUserById(event.validated.params.id)
    return user ?? event.respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})
// checking the status narrows the body type
if (result.status === 404) console.log(result.body.message)
if (result.status === 200) console.log(result.body.name)`,
    highlightLines: {
      serverCode: [],
      clientCode: [1, 2, 3, 6, 7],
    },
    serverEffect: '`validate.response` declares each possible status body.',
    clientEffect: 'Awaiting the request narrows body types from the status check.',
    runtimeEffect: 'Runtime response validation still follows the declared status schemas.',
  },
  {
    shortTitle: 'Async Data',
    title: 'Use typed results with Nuxt async data.',
    description: [
      { text: 'Pages can keep the typed status result and still get ' },
      { text: 'data, pending, error, and refresh', tone: 'client' },
      { text: ' for Nuxt-style state.' },
    ],
    serverCode: `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: {
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: async (event) => {
    const user = await findUserById(event.validated.params.id)
    return user ?? event.respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `const { data: result, pending, error, refresh } = await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})`,
    highlightLines: {
      serverCode: [],
      clientCode: [1, 2, 3],
    },
    serverEffect: 'No new server shape is required for Nuxt async data.',
    clientEffect: '`useEndpoint` keeps status-aware body types inside async data state.',
    runtimeEffect: 'Refreshes and deduped executions reuse the generated endpoint request.',
  },
  {
    shortTitle: 'Pinia Colada',
    title: 'Use the endpoint with Pinia Colada.',
    description: [
      { text: 'Generated options pass the same typed request into ' },
      { text: 'useQuery', tone: 'client' },
      { text: '. Colada owns the cache while the endpoint contract owns the types.' },
    ],
    serverCode: `export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: {
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: async (event) => {
    const user = await findUserById(event.validated.params.id)
    return user ?? event.respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `import { useQuery } from '@pinia/colada'

const request = $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})
const user = useQuery(request.queryOptions())

if (user.data.value?.status === 200) {
  user.data.value.body.name // User — typed from the endpoint
}`,
    highlightLines: {
      serverCode: [3, 4, 5, 6, 7],
      clientCode: [1, 3, 4, 5, 7, 8, 10],
    },
    serverEffect: 'The route method, path, and request input form a stable query key.',
    clientEffect: 'The query options preserve the endpoint request and response types.',
    runtimeEffect: 'Pinia Colada owns caching, invalidation, and background refreshes.',
  },
] as const satisfies {
  shortTitle: string
  title: string
  description: {
    text: string
    tone?: 'server' | 'client' | 'runtime'
  }[]
  serverCode: string
  clientCode: string
  highlightLines: Record<'serverCode' | 'clientCode', number[]>
  serverEffect: string
  clientEffect: string
  runtimeEffect: string
}[]

export const magicCodeBlocks = [
  {
    side: 'Server',
    title: 'server/api/users/[id].get.ts',
    lang: 'ts',
    codeKey: 'serverCode',
  },
  {
    side: 'Client',
    title: 'pages/users/[id].vue',
    lang: 'ts',
    codeKey: 'clientCode',
    visibleFromStep: 2,
  },
] as const satisfies {
  side: 'Server' | 'Client'
  title: string
  lang: BundledLanguage
  codeKey: 'serverCode' | 'clientCode'
  visibleFromStep?: number
}[]
