import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineEndpoint } from '../../src/runtime'
import type { EndpointClientOptions, StandardSchemaLike } from '../../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

const schema = <INPUT, OUTPUT = INPUT>(): Schema<INPUT, OUTPUT> => {
  throw new Error('type-only schema')
}

// Parity probes for the single-define (merged) form. Every
// assertion here has a counterpart in endpoint.test-d.ts written against the
// two-call form.
describe('single-define endpoint types', () => {
  it('A: keeps operation a string literal', () => {
    const merged = defineEndpoint({
      operation: 'getMerged',
      responses: { 200: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    })

    expectTypeOf<
      (typeof merged)['__endpoint_contract__']['definition']['operation']
    >().toEqualTypeOf<'getMerged'>()
  })

  it('B: params is the coerced OUTPUT type inside the handler', () => {
    defineEndpoint({
      operation: 'getUserMerged',
      params: schema<{ id: string }, { id: number }>(),
      query: schema<{ include?: string }>(),
      responses: {
        200: schema<{ id: number; name: string }>(),
      },
      handler: ({ params, query }) => {
        expectTypeOf(params).toEqualTypeOf<{ id: number }>()
        expectTypeOf(params.id).toEqualTypeOf<number>()
        expectTypeOf(query).toEqualTypeOf<{ include?: string }>()
        return { id: params.id, name: 'Tom' }
      },
    })

    // Same probe with a real Zod coercion.
    defineEndpoint({
      operation: 'getZodMerged',
      params: z.object({ id: z.coerce.number() }),
      responses: { 200: z.object({ id: z.number() }) },
      handler: ({ params }) => {
        expectTypeOf(params.id).toEqualTypeOf<number>()
        return { id: params.id }
      },
    })
  })

  it('C: a return that does not match responses[200] is an error', () => {
    defineEndpoint({
      operation: 'badReturnMerged',
      responses: { 200: z.object({ id: z.number() }) },
      // @ts-expect-error the handler return must match responses[200].
      handler: () => ({ id: 'not-a-number' }),
    })
  })

  it('D: respond(404, ...) with a mismatched body is an error', () => {
    defineEndpoint({
      operation: 'respondMerged',
      responses: {
        200: z.object({ id: z.number() }),
        404: z.object({ message: z.string() }),
      },
      handler: ({ respond }) => respond(404, { message: 'gone' }),
    })

    defineEndpoint({
      operation: 'respondBadMerged',
      responses: {
        200: z.object({ id: z.number() }),
        404: z.object({ message: z.string() }),
      },
      // @ts-expect-error the 404 body is checked against its schema.
      handler: ({ respond }) => respond(404, { detail: 'gone' }),
    })
  })

  it('E: with no responses declared the return is inferred and widened', () => {
    const inferred = defineEndpoint({
      operation: 'inferredMerged',
      handler: () => ({ name: 'Tom', count: 1 }),
    })

    expectTypeOf<(typeof inferred)['__endpoint_handler_return__']>().toEqualTypeOf<{
      name: string
      count: number
    }>()
  })

  it('F: client option types derive from the assembled definition', () => {
    const merged = defineEndpoint({
      operation: 'clientMerged',
      params: schema<{ id: string }, { id: number }>(),
      body: schema<{ amount: string }, { amount: number }>(),
      responses: { 200: schema<{ ok: true }>() },
      handler: ({ body }) => {
        expectTypeOf(body).toEqualTypeOf<{ amount: number }>()
        return { ok: true } as const
      },
    })

    expectTypeOf<
      EndpointClientOptions<(typeof merged)['__endpoint_contract__']['definition']>
    >().toEqualTypeOf<{ params: { id: string }; body: { amount: string } }>()
  })

  it('G: media responses keep their negotiated literal union', () => {
    defineEndpoint({
      operation: 'mediaMerged',
      responses: {
        200: { media: ['text/csv', 'application/json'] },
        404: z.object({ message: z.string() }),
      },
      handler: ({ responseMediaType, respond }) => {
        expectTypeOf(responseMediaType).toEqualTypeOf<'text/csv' | 'application/json'>()
        return respond(404, { message: 'gone' })
      },
    })
  })

  it('H: tags and summary still type-check', () => {
    const merged = defineEndpoint({
      operation: 'taggedMerged',
      summary: 'Tagged',
      tags: ['merged'],
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    })

    expectTypeOf<
      (typeof merged)['__endpoint_contract__']['definition']['operation']
    >().toEqualTypeOf<'taggedMerged'>()
  })

  it('I: the two-call form is untouched', () => {
    const endpoint = defineEndpoint({
      operation: 'twoCall',
      params: schema<{ id: string }, { id: number }>(),
      responses: { 200: schema<{ id: number }>() },
    })

    expectTypeOf(endpoint.definition.operation).toEqualTypeOf<'twoCall'>()
  })
  it('J: literal-typed response bodies match without `as const`', () => {
    // The two-call form's `const` capture keeps `ok: true` narrow; the merged
    // form must too, or every literal/enum/tuple contract needs `as const`.
    defineEndpoint({
      operation: 'literalMerged',
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: () => ({ ok: true }),
    })

    defineEndpoint({
      operation: 'tupleMerged',
      responses: { 200: z.tuple([z.number(), z.string()]) },
      handler: () => [1, 'a'] as const,
    })
  })

  it('K: async handlers infer through the promise', () => {
    defineEndpoint({
      operation: 'asyncMerged',
      responses: { 200: z.object({ id: z.number() }) },
      handler: async () => ({ id: 1 }),
    })

    const inferred = defineEndpoint({
      operation: 'asyncInferredMerged',
      handler: async () => ({ name: 'Tom' }),
    })
    expectTypeOf<(typeof inferred)['__endpoint_handler_return__']>().toEqualTypeOf<{
      name: string
    }>()
  })

  it('L: a media-type-map body still discriminates', () => {
    defineEndpoint({
      operation: 'mapBodyMerged',
      body: { 'application/json': z.object({ a: z.string() }), 'text/csv': true },
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: ({ body, bodyMediaType }) => {
        expectTypeOf(bodyMediaType).toEqualTypeOf<'application/json' | 'text/csv'>()
        expectTypeOf(body).toEqualTypeOf<{ a: string } | Uint8Array>()
        return { ok: true }
      },
    })
  })

  it('M: an undeclared status is rejected by respond()', () => {
    defineEndpoint({
      operation: 'undeclaredStatusMerged',
      responses: { 200: z.object({ id: z.number() }) },
      // @ts-expect-error 418 is not a declared status.
      handler: ({ respond }) => respond(418, { id: 1 }),
    })
  })

  it('N: hand-written idempotency metadata is still rejected', () => {
    defineEndpoint({
      operation: 'idempotencyMerged',
      // @ts-expect-error idempotency metadata is created only by .idempotency().
      idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
      handler: () => ({ ok: true }),
    })
  })

  it('O: the idempotency slot carries options and lands as metadata', () => {
    const merged = defineEndpoint({
      operation: 'idempotentMerged',
      body: z.object({ amount: z.number() }),
      idempotency: {
        authorization: 'middleware',
        // The callbacks see the assembled contract, so the coerced body output
        // is available to them exactly as it is in the two-call form.
        scope: ({ body }) => {
          expectTypeOf(body).toEqualTypeOf<{ amount: number }>()
          return 'public'
        },
      },
      handler: () => ({ ok: true }),
    })

    expectTypeOf<
      (typeof merged)['__endpoint_contract__']['definition']['idempotency']
    >().toEqualTypeOf<{ enabled: true; headerName: 'Idempotency-Key'; required: false }>()

    // An empty slot still enables idempotency, exactly as `.idempotency()` with
    // no arguments does - it must not collapse the way an absent slot does.
    const bare = defineEndpoint({
      operation: 'bareIdempotentMerged',
      body: z.object({ amount: z.number() }),
      idempotency: {},
      handler: () => ({ ok: true }),
    })

    expectTypeOf<
      (typeof bare)['__endpoint_contract__']['definition']['idempotency']
    >().toEqualTypeOf<{ enabled: true; headerName: 'Idempotency-Key'; required: false }>()

    // ...and without the slot the assembled definition carries `undefined`, so
    // nothing downstream sees idempotency metadata.
    const none = defineEndpoint({
      operation: 'notIdempotentMerged',
      body: z.object({ amount: z.number() }),
      handler: () => ({ ok: true }),
    })

    expectTypeOf<
      (typeof none)['__endpoint_contract__']['definition']['idempotency']
    >().toEqualTypeOf<undefined>()
  })

  it('O2: a custom headerName and required: true are reflected in the type', () => {
    const merged = defineEndpoint({
      operation: 'requiredIdempotentMerged',
      body: z.object({ amount: z.number() }),
      idempotency: { authorization: 'middleware', headerName: 'X-Request-Key', required: true },
      handler: () => ({ ok: true }),
    })

    expectTypeOf<
      (typeof merged)['__endpoint_contract__']['definition']['idempotency']
    >().toEqualTypeOf<{ enabled: true; headerName: 'X-Request-Key'; required: true }>()

    // Required endpoints generate a key unless the caller supplies one.
    type Options = EndpointClientOptions<(typeof merged)['__endpoint_contract__']['definition']>
    expectTypeOf<Options>().toMatchTypeOf<{
      body: { amount: number }
      idempotencyKey?: string | true
    }>()
    expectTypeOf<
      {} extends Pick<Options, 'idempotencyKey'> ? 'optional' : 'required'
    >().toEqualTypeOf<'optional'>()
  })

  it('P: a typo in a slot name is rejected (the two-call form accepts it)', () => {
    defineEndpoint({
      operation: 'typoMerged',
      // @ts-expect-error 'respones' is not a contract slot.
      respones: { 200: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    })

    // The two-call form infers DEFINITION from the literal, so the same typo
    // passes silently there. No @ts-expect-error, deliberately.
    defineEndpoint({
      operation: 'typoTwoCall',
      respones: { 200: z.object({ id: z.number() }) },
    })
  })
})
