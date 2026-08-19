import type {
  $EndpointClient,
  $EndpointPathResponse,
  $EndpointResponse,
  $UseEndpoint,
  $UseEndpointResult,
  EndpointMethod,
  EndpointPath,
} from '#endpoints'

declare const client: $EndpointClient
declare const useClient: $UseEndpoint
declare const useResultClient: $UseEndpointResult

async function checkClient() {
  const user = await client('/api/users/:id', { method: 'get', params: { id: '1' } })
  user.id.toFixed()
  user.name.toUpperCase()

  const userAlias = await client('getUser', { params: { id: '1' } })
  userAlias.name.toUpperCase()

  const userPropertyAlias = await client.getUser({ params: { id: '1' } })
  userPropertyAlias.name.toUpperCase()

  const userResult = await client('/api/users/:id', {
    method: 'get',
    params: { id: '1' },
  }).result()
  if (userResult.status === 200) {
    userResult.body.id.toFixed()
  }
  if (userResult.status === 404) {
    userResult.body.message.toUpperCase()
  }

  const userRawResponse = await client('/api/users/:id', {
    method: 'get',
    params: { id: '1' },
  }).raw()
  if (userRawResponse.status === 200) {
    const body = await userRawResponse.json()
    body.id.toFixed()
  }

  const userCall = client('/api/users/:id', { method: 'get', params: { id: '1' } })

  // @ts-expect-error effect is only available when endpoints.client.effect is enabled.
  userCall.effect()
  // @ts-expect-error resultEffect is not part of the client surface.
  userCall.resultEffect()
  // @ts-expect-error rawEffect is not part of the client surface.
  userCall.rawEffect()

  // @ts-expect-error params.id must use the validator input type.
  await client('/api/users/:id', { method: 'get', params: { id: 1 } })
  // @ts-expect-error params.id must use the validator input type.
  await client('getUser', { params: { id: 1 } })
  // @ts-expect-error params.id must use the validator input type.
  await client.getUser({ params: { id: 1 } })

  const created = await client('/api/users', { method: 'post', body: { name: 'Sid' } })
  created.id.toFixed()

  const createdByMethod = await client('createUser', { body: { name: 'Sid' } })
  createdByMethod.id.toFixed()

  const idempotent = await client('createIdempotentItem', {
    body: { amount: 100 },
    idempotencyKey: 'request-1',
  })
  idempotent.id.toFixed()

  // @ts-expect-error idempotencyKey is required by endpoint metadata.
  await client('createIdempotentItem', { body: { amount: 100 } })

  const idempotentCentral = await client('createIdempotentCentralItem', {
    body: { amount: 100 },
    idempotencyKey: 'request-1',
  })
  idempotentCentral.id.toFixed()

  // @ts-expect-error idempotencyKey is required by endpoint metadata.
  await client('createIdempotentCentralItem', { body: { amount: 100 } })

  // @ts-expect-error body.name is required.
  await client('/api/users', { method: 'post', body: {} })
  // @ts-expect-error body.name is required.
  await client('createUser', { body: {} })

  const search = await client('/api/search', { method: 'get', query: { q: 'nuxt' } })
  search.items[0]?.toUpperCase()

  const separated = await client('/api/separated', {
    method: 'get',
    query: { name: 'nuxt' },
  })
  separated.name.toUpperCase()
  separated.separated.valueOf()

  const separatedByOperation = await client('getSeparated', { query: { name: 'nuxt' } })
  separatedByOperation.name.toUpperCase()

  const sibling = await client('getSibling', { query: { name: 'nuxt' } })
  sibling.name.toUpperCase()
  sibling.sibling.valueOf()

  const serialized = await client('getSerialized')
  serialized.createdAt.toUpperCase()
  // @ts-expect-error Date is serialized to a string on the HTTP wire.
  serialized.createdAt.getTime()

  // @ts-expect-error operation calls are generated only when operation is declared.
  await client('search', { query: { q: 'nuxt' } })

  // Media-type-map body: omitting `mediaType` defaults to the map's
  // `application/json` member, typing `body` the same as a single-schema
  // contract would.
  const uploadedByDefault = await client('/api/upload', {
    method: 'post',
    body: { name: 'Sid' },
  })
  uploadedByDefault.name.toUpperCase()
  uploadedByDefault.bodyMediaType.toUpperCase()

  // Selecting `multipart/form-data` types `body` as the wire value (FormData)
  // rather than the member schema's input.
  const uploadedByMultipart = await client('createUpload', {
    mediaType: 'multipart/form-data',
    body: new FormData(),
  })
  uploadedByMultipart.bodyMediaType.toUpperCase()

  // @ts-expect-error body must be FormData once multipart/form-data is selected.
  await client('createUpload', { mediaType: 'multipart/form-data', body: { name: 'Sid' } })

  const userState = await useClient('/api/users/:id', {
    method: 'get',
    params: { id: '1' },
    key: 'user:1',
  })
  userState.data.value?.name.toUpperCase()
  userState.pending.value.valueOf()
  await userState.refresh()

  const userOperationState = await useClient('getUser', {
    params: { id: '1' },
    key: 'user-operation:1',
  })
  userOperationState.data.value?.name.toUpperCase()

  // @ts-expect-error useEndpoint does not expose property aliases.
  await useClient.getUser({ params: { id: '1' } })

  const userResultState = await useResultClient('/api/users/:id', {
    method: 'get',
    params: { id: '1' },
    key: 'user-result:1',
  })
  if (userResultState.data.value?.status === 404) {
    userResultState.data.value.body.message.toUpperCase()
  }
  if (userResultState.data.value?.status === 200) {
    userResultState.data.value.body.name.toUpperCase()
  }
  // @ts-expect-error useEndpointResult does not expose non-serializable Headers in async data.
  void userResultState.data.value?.headers

  const userResultOperationState = await useResultClient('getUser', {
    params: { id: '1' },
    key: 'user-result-operation:1',
  })
  if (userResultOperationState.data.value?.status === 200) {
    userResultOperationState.data.value.body.id.toFixed()
  }

  // Multi-method group: every declared method is callable on the one path,
  // and each carries its own request and response contract.
  const multiGet = await client('/api/multi', { method: 'get', query: { name: 'nuxt' } })
  multiGet.name.toUpperCase()

  const multiPut = await client('/api/multi', { method: 'put', body: { name: 'nuxt' } })
  multiPut.name.toUpperCase()

  const multiGetByOperation = await client('getMulti', { query: { name: 'nuxt' } })
  multiGetByOperation.name.toUpperCase()

  const multiPutByOperation = await client('putMulti', { body: { name: 'nuxt' } })
  multiPutByOperation.name.toUpperCase()

  // @ts-expect-error delete is not declared on the group.
  await client('/api/multi', { method: 'delete' })

  // @ts-expect-error the put member's body follows its own schema.
  await client('/api/multi', { method: 'put', body: { name: 1 } })

  const searchState = await useClient('/api/search', {
    method: 'get',
    query: { q: 'nuxt' },
    key: 'search:nuxt',
  })
  searchState.data.value?.items[0]?.toUpperCase()

  // @ts-expect-error useEndpoint keeps endpoint request options strict.
  await useClient('/api/users/:id', { method: 'get', params: { id: 1 } })
}

const userResponse: $EndpointResponse<'getUser'> = {
  id: 1,
  name: 'Tom',
}

const userPathResponse: $EndpointPathResponse<'/api/users/:id', 'get'> = {
  id: 1,
  name: 'Tom',
}

const searchPath: EndpointPath = '/api/search'
const searchMethod: EndpointMethod<'/api/search'> = 'get'

// A group contributes one entry per declared method, so the path's method
// union carries both.
const multiGetMethod: EndpointMethod<'/api/multi'> = 'get'
const multiPutMethod: EndpointMethod<'/api/multi'> = 'put'

const invalidUserResponse: $EndpointResponse<'getUser'> = {
  // @ts-expect-error response id is generated from the endpoint response schema and must be a number.
  id: 'wrong',
  name: 'Tom',
}

void checkClient
void userResponse
void userPathResponse
void searchPath
void searchMethod
void multiGetMethod
void multiPutMethod
void invalidUserResponse
