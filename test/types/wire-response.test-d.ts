import { describe, expectTypeOf, it } from 'vitest'
import type { Serialize } from 'nuxt/app'
import type {
  EndpointClient,
  StandardSchemaLike,
  StatusResponse,
  UseEndpointClient,
} from '../../src/runtime'

type Simplify<TYPE> = TYPE extends readonly unknown[] | Date
  ? TYPE
  : { [KEY in keyof TYPE]: Simplify<TYPE[KEY]> }

type Schema<OUTPUT> = StandardSchemaLike<unknown, OUTPUT>

type ServerOutput = {
  createdAt: Date
  nested: {
    updatedAt: Date
    omitted: () => void
  }
  values: Map<string, number>
  tags: Set<string>
  readonlyDates: readonly Date[]
  custom: {
    toJSON(): { token: string }
  }
  optional: string | undefined
}

type WireOutput = Simplify<Serialize<ServerOutput>>

type DeclaredRoute = {
  path: '/api/serialized'
  method: 'get'
  definition: {
    responses: {
      200: Schema<ServerOutput>
      422: Schema<{ rejectedAt: Date }>
    }
  }
}

type InferredRoute = {
  path: '/api/inferred-serialized'
  method: 'get'
  definition: {}
  handlerReturn:
    | ServerOutput
    | StatusResponse<202, { acceptedAt: Date }>
    | StatusResponse<400, { rejectedAt: Date }>
}

type Routes = DeclaredRoute | InferredRoute
type Client = EndpointClient<Routes>
type UseClient = UseEndpointClient<Routes>

declare const client: Client
declare const useClient: UseClient

describe('endpoint JSON wire response types', () => {
  it('serializes declared success bodies like Nitro InternalApi', async () => {
    const call = client('/api/serialized', { method: 'get' })
    expectTypeOf<Awaited<typeof call>>().toEqualTypeOf<
      | { status: 200; ok: true; body: WireOutput; headers: Headers }
      | { status: 422; ok: false; body: { rejectedAt: string }; headers: Headers }
    >()
    const response = await call
    if (response.status === 200) {
      expectTypeOf(response.body.createdAt).toEqualTypeOf<string>()
      expectTypeOf(response.body.tags).toEqualTypeOf<Record<string, never>>()
      expectTypeOf(response.body.readonlyDates).toEqualTypeOf<string[]>()
      expectTypeOf(response.body.custom).toEqualTypeOf<{ token: string }>()
      // @ts-expect-error JSON serialization omits function-valued object properties.
      void response.body.nested.omitted
    }

    const state = useClient('/api/serialized', { method: 'get' })
    expectTypeOf(state.data.value).toEqualTypeOf<
      | { status: 200; ok: true; body: WireOutput }
      | { status: 422; ok: false; body: { rejectedAt: string } }
      | undefined
    >()

    const raw = await call.raw()
    if (raw.status === 200) {
      expectTypeOf(await raw.json()).toEqualTypeOf<WireOutput>()
    }

    if (response.status === 200) {
      expectTypeOf(response.body).toEqualTypeOf<WireOutput>()
    }
    if (response.status === 422) {
      expectTypeOf(response.body).toEqualTypeOf<{ rejectedAt: string }>()
    }
  })

  it('serializes inferred handler and status-response bodies', async () => {
    const call = client('/api/inferred-serialized', { method: 'get' })
    expectTypeOf<Awaited<typeof call>>().toEqualTypeOf<
      | { status: 200; ok: true; body: WireOutput; headers: Headers }
      | { status: 202; ok: true; body: { acceptedAt: string }; headers: Headers }
      | { status: 400; ok: false; body: { rejectedAt: string }; headers: Headers }
    >()

    const result = await call
    if (result.status === 200) {
      expectTypeOf(result.body).toEqualTypeOf<WireOutput>()
    }
    if (result.status === 202) {
      expectTypeOf(result.body).toEqualTypeOf<{ acceptedAt: string }>()
    }
    if (result.status === 400) {
      expectTypeOf(result.body).toEqualTypeOf<{ rejectedAt: string }>()
    }

    const raw = await call.raw()
    if (raw.status === 202) {
      expectTypeOf(await raw.json()).toEqualTypeOf<{ acceptedAt: string }>()
    }
  })
})
