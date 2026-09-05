import type {
  $EndpointClient,
  $EndpointPathResponse,
  $UseEndpoint,
  $UseEndpointForm,
  EndpointMethod,
  EndpointPath,
} from '#endpoints'
import { infiniteQueryOptions, mutationOptions, queryOptions } from '#endpoints/colada'
import type {
  RequestBody as NuxtServerRequestBody,
  RequestQuery as NuxtServerRequestQuery,
  Response as NuxtServerResponse,
} from './.nuxt/server-routes'

type Equal<LEFT, RIGHT> =
  (<VALUE>() => VALUE extends LEFT ? 1 : 2) extends <VALUE>() => VALUE extends RIGHT ? 1 : 2
    ? true
    : false
type Assert<VALUE extends true> = VALUE

export type NuxtServerUserResponseAgreement = Assert<
  Equal<NuxtServerResponse<'/api/users', 'POST'>, { id: number; name: string }>
>
declare const nuxtServerUserBody: NuxtServerRequestBody<'/api/users', 'POST'>
declare const nuxtServerSearchQuery: NuxtServerRequestQuery<'/api/search', 'GET'>
export const nuxtServerUserBodyAsExpected: { name: string } = nuxtServerUserBody
export const expectedUserBodyAsNuxtServerBody: NuxtServerRequestBody<'/api/users', 'POST'> = {
  name: 'Sid',
}
export const nuxtServerSearchQueryAsExpected: { q: string } = nuxtServerSearchQuery
export const expectedSearchQueryAsNuxtServerQuery: NuxtServerRequestQuery<'/api/search', 'GET'> = {
  q: 'search',
}
declare const client: $EndpointClient
declare const useClient: $UseEndpoint
declare const useForm: $UseEndpointForm

function checkForm() {
  const form = useForm('/api/notes', { method: 'post', body: { title: '' } })

  // The element's own attributes come from the declaration, not the template.
  form.attrs.action.startsWith('/')
  form.attrs.enctype.toUpperCase()

  // One attribute set per declared field, named from the schema's input.
  form.fields.title.name.toUpperCase()
  form.fields.title.maxlength?.toFixed()
  form.fields.pinned.name.toUpperCase()
  // @ts-expect-error `titel` is not a declared field
  void form.fields.titel

  // The result keeps the declared status union - including the fact that a
  // declared 400 shares that status with the module's own validation error, so
  // it still has to be narrowed.
  form.submit(new URLSearchParams({ title: 'Ada' })).then((result) => {
    if (result.status === 201) result.body.title.toUpperCase()
    if (result.status === 400 && 'message' in result.body) result.body.message.toUpperCase()
    if (result.status === 400 && 'statusCode' in result.body) {
      result.body.data.body?.map((issue) => issue.message.toUpperCase())
    }
  })

  form.values.value.title.toUpperCase()
  form.status.value?.toFixed()
  form.allIssues.value.map((issue) => issue.message.toUpperCase())
  form.issues.value.title?.map((issue) => issue.path?.join('.').toUpperCase())

  // @ts-expect-error `/api/users` declares no form projection
  useForm('/api/users', { method: 'post', body: { name: '' } })
}
export type FormProjectionChecked = ReturnType<typeof checkForm>

async function checkClient() {
  const user = await client('/api/users/:id', { method: 'get', params: { id: '1' } })
  if (user.status === 200) user.body.name.toUpperCase()
  if (user.status === 404) user.body.message.toUpperCase()
  if (user.status === 401) user.body.error.toUpperCase()

  const userCall = client('/api/users/:id', { method: 'get', params: { id: '1' } })
  const namedUser = await client.getUser({ params: { id: '1' } })
  if (namedUser.status === 200) namedUser.body.name.toUpperCase()
  if (namedUser.status === 404) namedUser.body.message.toUpperCase()
  queryOptions(userCall)
  // @ts-expect-error Colada adapters are functions, not request methods.
  userCall.queryOptions()
  // @ts-expect-error GET requests cannot become mutation options.
  mutationOptions(userCall)
  // @ts-expect-error .result() was replaced by awaiting the request.
  userCall.result()
  // @ts-expect-error names are properties, not alternate path arguments.
  await client('getUser', { params: { id: '1' } })

  const raw = await userCall.raw()
  if (raw.status === 200) (await raw.json()).id.toFixed()

  // @ts-expect-error params use the validator input type.
  await client('/api/users/:id', { method: 'get', params: { id: 1 } })

  const created = await client('/api/users', { method: 'post', body: { name: 'Sid' } })
  if (created.status === 201) created.body.id.toFixed()
  if (created.status === 401) created.body.error.toUpperCase()
  if (created.status === 429) created.body.retryAfter.toFixed()
  const createUserCall = client('/api/users', { method: 'post', body: { name: 'Sid' } })
  mutationOptions(createUserCall)
  // @ts-expect-error unsafe methods cannot become query options.
  queryOptions(createUserCall)
  // @ts-expect-error Colada adapters are functions, not request methods.
  createUserCall.mutationOptions()
  // @ts-expect-error body.name is required.
  await client('/api/users', { method: 'post', body: {} })

  const idempotent = await client('/api/idempotent', {
    method: 'post',
    body: { amount: 100 },
  })
  if (idempotent.status === 201) idempotent.body.id.toFixed()

  const central = await client('/api/idempotent-central', {
    method: 'post',
    body: { amount: 100 },
    idempotencyKey: true,
  })
  if (central.status === 201) central.body.id.toFixed()

  const search = await client('/api/search', { method: 'get', query: { q: 'nuxt' } })
  if (search.status === 200) search.body.items[0]?.toUpperCase()

  const articlesCall = client('/api/articles', { method: 'get', query: { limit: 2 } })
  const articles = infiniteQueryOptions(articlesCall)
  articles.query({ signal: new AbortController().signal, pageParam: undefined }).then((page) => {
    page.items[0]?.title.toUpperCase()
    page.nextCursor?.toUpperCase()
  })
  // @ts-expect-error only a route declaring pagination can become infinite-query options.
  infiniteQueryOptions(userCall)

  const separated = await client('/api/separated', {
    method: 'get',
    query: { name: 'nuxt' },
  })
  if (separated.status === 200) separated.body.separated.valueOf()

  const sibling = await client('/api/sibling', {
    method: 'get',
    query: { name: 'nuxt' },
  })
  if (sibling.status === 200) sibling.body.sibling.valueOf()

  const serialized = await client('/api/serialized', { method: 'get', query: {} })
  if (serialized.status === 200) {
    serialized.body.createdAt.toUpperCase()
    // @ts-expect-error Date is serialized on the wire.
    serialized.body.createdAt.getTime()
  }

  const upload = await client('/api/upload', {
    method: 'post',
    mediaType: 'multipart/form-data',
    body: new FormData(),
  })
  if (upload.status === 201) upload.body.bodyMediaType.toUpperCase()

  const state = useClient('/api/users/:id', {
    method: 'get',
    params: { id: '1' },
    key: 'user:1',
  })
  if (state.data.value?.status === 200) state.data.value.body.name.toUpperCase()
  if (state.data.value?.status === 404) state.data.value.body.message.toUpperCase()
  if (state.data.value?.status === 401) state.data.value.body.error.toUpperCase()

  const transformed = useClient('/api/users/:id', {
    method: 'get',
    params: { id: '1' },
    transform: (result) => result.status,
  })
  transformed.data.value?.toFixed()

  const multiGet = await client('/api/multi', { method: 'get', query: { name: 'nuxt' } })
  if (multiGet.status === 200) multiGet.body.name.toUpperCase()
  const multiPut = await client('/api/multi', { method: 'put', body: { name: 'nuxt' } })
  if (multiPut.status === 200) multiPut.body.name.toUpperCase()
  // @ts-expect-error delete is not declared on the group.
  await client('/api/multi', { method: 'delete' })

  const exported = await client('/api/export', { method: 'get', query: {} })
  exported.body.getReader()

  const report = await client('/custom/report', { method: 'get', query: { id: 'r_1' } })
  if (report.status === 200) report.body.source.toUpperCase()

  const merged = await client('/api/merged', { method: 'get', query: { id: '1' } })
  if (merged.status === 200) merged.body.id.toFixed()
  if (merged.status === 404) merged.body.message.toUpperCase()
}

const userResponse: $EndpointPathResponse<'/api/users/:id', 'get'> = {
  status: 200,
  ok: true,
  body: { id: 1, name: 'Tom' },
  headers: new Headers(),
}

const searchPath: EndpointPath = '/api/search'
const searchMethod: EndpointMethod<'/api/search'> = 'get'
const multiPutMethod: EndpointMethod<'/api/multi'> = 'put'

void checkClient
void userResponse
void searchPath
void searchMethod
void multiPutMethod
