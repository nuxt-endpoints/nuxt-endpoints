import type { BundledLanguage } from 'shiki'

export const contractSteps = [
  {
    shortTitle: 'Definition',
    title: 'Define params with your schema library.',
    description: [
      { text: 'Choose ' },
      { text: 'Zod, Valibot, or Effect Schema', tone: 'server' },
      { text: ' for request params, then reuse that schema for types, clients, and OpenAPI.' },
    ],
    serverCode: `export const endpoint = defineEndpoint({
  params: z.object({ id: z.coerce.number() }), // '123' → 123
})`,
    clientCode: '',
    highlightLines: {
      serverCode: [],
      clientCode: [],
    },
    serverEffect: 'The params schema becomes the source for server types.',
    clientEffect: 'No client surface is introduced in this step.',
    runtimeEffect: 'The same params schema can validate real requests at runtime.',
  },
  {
    shortTitle: 'Request',
    title: 'Receive validated request values.',
    description: [
      { text: 'Request data is parsed before your handler runs. Server code receives ' },
      { text: 'validated values', tone: 'server' },
      { text: ' instead of raw strings.' },
    ],
    serverCode: `export default defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  handler: ({ params }) => {
    const userId = params.id // number — validated & coerced
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
      { text: 'returned data is inferred from server code', tone: 'client' },
      { text: ', so unknown fields fail in TypeScript.' },
    ],
    serverCode: `export default defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  handler: async ({ params }) => {
    const user = await findUserById(params.id)
    return user // client types are inferred from here
  },
})`,
    clientCode: `const user = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
}) // user: typed from the handler return
console.log(\`id: \${user.id}, name: \${user.name}\`)`,
    highlightLines: {
      serverCode: [3, 4, 5],
      clientCode: [1, 2, 3, 4, 5],
    },
    serverEffect: 'The handler return becomes the inferred success body.',
    clientEffect: 'The generated client uses the inferred success body type.',
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
    serverCode: `export default defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  responses: { // now the handler is checked against these
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: async ({ params, respond }) => {
    const user = await findUserById(params.id)
    return user ?? respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `const user = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})
console.log(\`id: \${user.id}, name: \${user.name}\`)`,
    highlightLines: {
      serverCode: [3, 4, 5, 6, 9],
      clientCode: [],
    },
    serverEffect: '`responses` turns the inferred shape into explicit 200 and 404 contracts.',
    clientEffect: 'The client keeps the same call shape and response type.',
    runtimeEffect: 'Runtime response validation can be enabled from the same schemas.',
  },
  {
    shortTitle: 'Naming',
    title: 'Name the operation.',
    description: [
      { text: 'An operation name gives the route a readable client call and a stable ' },
      { text: 'OpenAPI operationId', tone: 'operation' },
      { text: '. Path-based calls still work.' },
    ],
    serverCode: `export default defineEndpoint({
  operation: 'getUser', // names the client call & operationId
  params: z.object({ id: z.coerce.number() }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: async ({ params, respond }) => {
    const user = await findUserById(params.id)
    return user ?? respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `const user = await $endpoint.getUser({
  params: { id: '123' },
})
console.log(\`id: \${user.id}, name: \${user.name}\`)`,
    highlightLines: {
      serverCode: [2],
      clientCode: [1],
    },
    serverEffect: '`operation: "getUser"` does not replace the path contract.',
    clientEffect: '`$endpoint.getUser(...)` calls the operation target.',
    runtimeEffect: 'OpenAPI can use `getUser` as the operationId.',
  },
  {
    shortTitle: 'Result',
    title: 'Branch by response status.',
    description: [
      { text: 'Status and body stay together, so checking the status gives ' },
      { text: 'type narrowing', tone: 'client' },
      { text: ' for the matching response body.' },
    ],
    serverCode: `export default defineEndpoint({
  operation: 'getUser',
  params: z.object({ id: z.coerce.number() }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: async ({ params, respond }) => {
    const user = await findUserById(params.id)
    return user ?? respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `const result = await $endpoint.getUser({ params: { id: '123' } }).result()
// checking the status narrows the body type
if (result.status === 404) console.log(result.body.message)
if (result.status === 200) console.log(result.body.name)`,
    highlightLines: {
      serverCode: [],
      clientCode: [1, 3, 4],
    },
    serverEffect: '`responses` declares each possible status body.',
    clientEffect: 'The result call narrows body types from the status check.',
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
    serverCode: `export default defineEndpoint({
  operation: 'getUser',
  params: z.object({ id: z.coerce.number() }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: async ({ params, respond }) => {
    const user = await findUserById(params.id)
    return user ?? respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `const { data: result, pending, error, refresh } = await useEndpointResult('getUser', {
  params: { id: '123' },
})`,
    highlightLines: {
      serverCode: [],
      clientCode: [1, 2, 3],
    },
    serverEffect: 'No new server shape is required for Nuxt async data.',
    clientEffect: '`useEndpointResult` keeps status-aware body types inside async data state.',
    runtimeEffect: 'Refreshes and deduped executions reuse the generated endpoint request.',
  },
  {
    shortTitle: 'Vue Query',
    title: 'Use the endpoint with Vue Query.',
    description: [
      { text: 'Generated options pass the same typed request into ' },
      { text: 'useQuery', tone: 'client' },
      { text: '. Vue Query owns the cache while the endpoint contract owns the types.' },
    ],
    serverCode: `export default defineEndpoint({
  operation: 'getUser',
  params: z.object({ id: z.coerce.number() }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: async ({ params, respond }) => {
    const user = await findUserById(params.id)
    return user ?? respond(404, { message: 'User not found' })
  },
})`,
    clientCode: `import { useQuery } from '@tanstack/vue-query'
import { endpointQueryOptions } from '#endpoints/query'

const user = useQuery(
  endpointQueryOptions.getUser({
    params: { id: '123' },
  }),
)

user.data.value?.name // User — typed from the endpoint`,
    highlightLines: {
      serverCode: [2],
      clientCode: [1, 2, 4, 5, 6, 7, 8, 10],
    },
    serverEffect: 'The operation name becomes a stable generated query key.',
    clientEffect: 'The query options preserve the endpoint request and response types.',
    runtimeEffect: 'Vue Query owns caching, retries, invalidation, and background refreshes.',
  },
] as const satisfies {
  shortTitle: string
  title: string
  description: {
    text: string
    tone?: 'server' | 'client' | 'runtime' | 'operation'
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
