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
  if (user.status === 200) {
    user.body.id.toFixed()
    user.body.name.toUpperCase()
  }

  const userAlias = await client('getUser', { params: { id: '1' } })
  if (userAlias.status === 200) userAlias.body.name.toUpperCase()

  const userPropertyAlias = await client.getUser({ params: { id: '1' } })
  if (userPropertyAlias.status === 200) userPropertyAlias.body.name.toUpperCase()

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

  // One negative is enough here: which shapes `params` accepts is decided by
  // InferInput and is owned by test/types/client.test-d.ts. This file exists to
  // prove the *generated* surface, so it checks each call shape once.
  // @ts-expect-error params.id must use the validator input type.
  await client('/api/users/:id', { method: 'get', params: { id: 1 } })

  const created = await client('/api/users', { method: 'post', body: { name: 'Sid' } })
  created.body.id.toFixed()

  const createdByMethod = await client('createUser', { body: { name: 'Sid' } })
  createdByMethod.body.id.toFixed()

  const idempotent = await client('createIdempotentItem', {
    body: { amount: 100 },
    idempotencyKey: 'request-1',
  })
  idempotent.body.id.toFixed()

  await client('createIdempotentItem', { body: { amount: 100 } })

  const idempotentCentral = await client('createIdempotentCentralItem', {
    body: { amount: 100 },
    idempotencyKey: 'request-1',
  })
  idempotentCentral.body.id.toFixed()

  await client('createIdempotentCentralItem', { body: { amount: 100 } })

  // @ts-expect-error body.name is required.
  await client('/api/users', { method: 'post', body: {} })

  const search = await client('/api/search', { method: 'get', query: { q: 'nuxt' } })
  search.body.items[0]?.toUpperCase()

  const separated = await client('/api/separated', {
    method: 'get',
    query: { name: 'nuxt' },
  })
  separated.body.name.toUpperCase()
  separated.body.separated.valueOf()

  const separatedByOperation = await client('getSeparated', { query: { name: 'nuxt' } })
  separatedByOperation.body.name.toUpperCase()

  const sibling = await client('getSibling', { query: { name: 'nuxt' } })
  sibling.body.name.toUpperCase()
  sibling.body.sibling.valueOf()

  const serialized = await client('getSerialized', { query: {} })
  if (serialized.status === 200) {
    serialized.body.createdAt.toUpperCase()
    // @ts-expect-error Date is serialized to a string on the HTTP wire.
    serialized.body.createdAt.getTime()
  }

  const serializedError = await client('getSerialized', { query: { fail: 'true' } }).result()
  if (serializedError.status === 422) {
    serializedError.body.rejectedAt.toUpperCase()
    // @ts-expect-error status-specific Date output is serialized on the HTTP wire too.
    serializedError.body.rejectedAt.getTime()
  }

  // Media-type-map body: omitting `mediaType` defaults to the map's
  // `application/json` member, typing `body` the same as a single-schema
  // contract would.
  const uploadedByDefault = await client('/api/upload', {
    method: 'post',
    body: { name: 'Sid' },
  })
  uploadedByDefault.body.name.toUpperCase()
  uploadedByDefault.body.bodyMediaType.toUpperCase()

  // Selecting `multipart/form-data` types `body` as the wire value (FormData)
  // rather than the member schema's input.
  const uploadedByMultipart = await client('createUpload', {
    mediaType: 'multipart/form-data',
    body: new FormData(),
  })
  uploadedByMultipart.body.bodyMediaType.toUpperCase()

  const userState = await useClient('/api/users/:id', {
    method: 'get',
    params: { id: '1' },
    key: 'user:1',
  })
  if (userState.data.value?.status === 200) userState.data.value.body.name.toUpperCase()
  userState.pending.value.valueOf()
  await userState.refresh()

  const userOperationState = await useClient('getUser', {
    params: { id: '1' },
    key: 'user-operation:1',
  })
  if (userOperationState.data.value?.status === 200) {
    userOperationState.data.value.body.name.toUpperCase()
  }

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
  multiGet.body.name.toUpperCase()

  const multiPut = await client('/api/multi', { method: 'put', body: { name: 'nuxt' } })
  multiPut.body.name.toUpperCase()

  const multiGetByOperation = await client('getMulti', { query: { name: 'nuxt' } })
  multiGetByOperation.body.name.toUpperCase()

  const multiPutByOperation = await client('putMulti', { body: { name: 'nuxt' } })
  multiPutByOperation.body.name.toUpperCase()

  // @ts-expect-error delete is not declared on the group.
  await client('/api/multi', { method: 'delete' })

  // @ts-expect-error the put member's body follows its own schema.
  await client('/api/multi', { method: 'put', body: { name: 1 } })

  // A declared stream response is handed back unread: the client asks the
  // fetcher not to parse this route, so every status arrives as the live
  // stream - including the validated 404 the contract still declares.
  const exported = await client('exportUsers', { query: {} })
  exported.body.getReader()

  const exportedResult = await client('/api/export', { method: 'get', query: {} }).result()
  exportedResult.body.getReader()
  // @ts-expect-error a streaming route's body is never the parsed 404 shape.
  void exportedResult.body.message

  // A route registered through `nitro.handlers` is typed exactly like a
  // scanned one - the generated client cannot tell them apart.
  const customReport = await client('getCustomReport', { query: { id: 'r_1' } })
  customReport.body.id.toUpperCase()
  customReport.body.source.toUpperCase()

  // @ts-expect-error query.id is required by the endpoint contract.
  await client('getCustomReport', { query: {} })

  const searchState = await useClient('/api/search', {
    method: 'get',
    query: { q: 'nuxt' },
    key: 'search:nuxt',
  })
  searchState.data.value?.body.items[0]?.toUpperCase()

  // @ts-expect-error useEndpoint keeps endpoint request options strict.
  await useClient('/api/users/:id', { method: 'get', params: { id: 1 } })
}

const userResponse: $EndpointResponse<'getUser'> = {
  status: 200,
  ok: true,
  body: { id: 1, name: 'Tom' },
  headers: new Headers(),
}

const userPathResponse: $EndpointPathResponse<'/api/users/:id', 'get'> = {
  status: 200,
  ok: true,
  body: { id: 1, name: 'Tom' },
  headers: new Headers(),
}

const exportPathResponse: $EndpointPathResponse<'/api/export', 'get'> = {
  status: 200,
  ok: true,
  body: new ReadableStream<Uint8Array>(),
  headers: new Headers(),
}

const searchPath: EndpointPath = '/api/search'
const searchMethod: EndpointMethod<'/api/search'> = 'get'

// A group contributes one entry per declared method, so the path's method
// union carries both.
const multiGetMethod: EndpointMethod<'/api/multi'> = 'get'
const multiPutMethod: EndpointMethod<'/api/multi'> = 'put'

const invalidUserResponse: $EndpointResponse<'getUser'> = {
  status: 200,
  ok: true,
  body: {
    // @ts-expect-error response id is generated from the endpoint response schema and must be a number.
    id: 'wrong',
    name: 'Tom',
  },
  headers: new Headers(),
}

// PROTOTYPE: the single-define (merged) form must reach the generated client
// surface exactly like the two-call form does.
const mergedResponse: $EndpointResponse<'getMerged'> = {
  status: 200,
  ok: true,
  body: { id: 1, name: 'Merged' },
  headers: new Headers(),
}

const mergedPathResponse: $EndpointPathResponse<'/api/merged', 'get'> = {
  status: 200,
  ok: true,
  body: { id: 1, name: 'Merged' },
  headers: new Headers(),
}

const invalidMergedResponse: $EndpointResponse<'getMerged'> = {
  status: 200,
  ok: true,
  body: {
    // @ts-expect-error the merged form's 200 body still comes from its schema.
    id: 'wrong',
    name: 'Merged',
  },
  headers: new Headers(),
}

// No declared responses: the client body comes from the widened handler return.
const mergedInferredResponse: $EndpointResponse<'getMergedInferred'> = {
  status: 200,
  ok: true,
  body: { name: 'Tom', count: 1 },
  headers: new Headers(),
}

async function checkMergedClient() {
  const merged = await client('getMerged', { query: { id: '1' } })
  if (merged.status === 200) {
    merged.body.id.toFixed()
    merged.body.name.toUpperCase()
  }

  const mergedResult = await client('getMerged', { query: { id: '1' } }).result()
  if (mergedResult.status === 404) {
    mergedResult.body.message.toUpperCase()
  }

  // @ts-expect-error the merged form's query contract is still required.
  await client('getMerged', {})

  // @ts-expect-error the client sends the schema input, while the handler sees its numeric output.
  await client('getMerged', { query: { id: 1 } })
}

void checkClient
void checkMergedClient
void mergedResponse
void mergedPathResponse
void invalidMergedResponse
void mergedInferredResponse
void userResponse
void userPathResponse
void exportPathResponse
void searchPath
void searchMethod
void multiGetMethod
void multiPutMethod
void invalidUserResponse
