import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineEndpoint, formOf } from '../../src/runtime'
import type { NativeFormProjectionConstraint, NativeFormRefusal } from '../../src/runtime'
// A form projection is only honest if a browser could produce the request the
// contract describes. These pin the refusals - a browser cannot set headers,
// cannot add a query string to where the bridge forwards the submission, and
// cannot send an `Idempotency-Key`. See src/runtime/form-projection.ts.
//
// These prove the refusal compiles to an error; the block below proves it is
// the right refusal. They are separate because `defineEndpoint` is
// overloaded, and TypeScript reports the LAST overload when none match - so
// the message an author sees at the call site does not name the reason.
// Making it name the reason needs a trailing single-definition overload, and
// that was measured to move every method-group error off its own line instead
// (test/types/route-handler.test-d.ts) - a worse trade for a more common
// mistake. The reason is instead stated by the build, in resolveFormMetadata().
const Todo = z.object({ title: z.string().min(1) })
const TodoForm = formOf(Todo)
const OptionalHeaders = z.object({ 'accept-language': z.string().optional() })
describe('form projection compatibility', () => {
  it('accepts a contract a native form can satisfy', () => {
    const handler = defineEndpoint({
      form: { action: '/todos/new', redirect: '/todos/{id}' },
      request: {
        body: { 'application/json': Todo, 'application/x-www-form-urlencoded': TodoForm },
      },
      responses: { 201: z.object({ id: z.number() }) },
      handler: (event) => event.respond(201, { id: 1 }),
    })
    expectTypeOf(handler).not.toBeAny()
  })
  it('accepts a multipart-only contract', () => {
    defineEndpoint({
      form: { action: '/uploads' },
      request: {
        body: { 'multipart/form-data': z.object({ file: z.file() }) },
      },
      responses: { 201: z.object({ ok: z.boolean() }) },
      handler: (event) => event.respond(201, { ok: true }),
    })
  })
  it('accepts the same projection inside a method group', () => {
    defineEndpoint({
      post: {
        form: { action: '/todos/new', redirect: '/todos/{id}' },
        request: {
          body: { 'application/x-www-form-urlencoded': TodoForm },
        },
        responses: { 201: z.object({ id: z.number() }) },
        handler: (event) => event.respond(201, { id: 1 }),
      },
    })
  })
  it('accepts an explicitly selected GET form and types its query', () => {
    defineEndpoint({
      form: { action: '/search', method: 'get' },
      request: {
        query: z.object({ q: z.string(), page: z.coerce.number().optional() }),
      },
      responses: { 200: z.object({ items: z.array(z.string()) }) },
      handler: (event) => {
        expectTypeOf(event.validated.query).toEqualTypeOf<{
          q: string
          page?: number
        }>()
        return { items: [event.validated.query.q] }
      },
    })
  })
  it('refuses body and redirect declarations on a GET form', () => {
    const definition = {
      form: { action: '/search', method: 'get' as const, redirect: '/done' },
      request: {
        query: z.object({ q: z.string() }),
        body: { 'application/x-www-form-urlencoded': TodoForm },
      },
      responses: { 200: z.object({ items: z.array(z.string()) }) },
      handler: () => ({ items: [] }),
    }
    // @ts-expect-error GET carries fields in the URL and does not redirect after an action.
    defineEndpoint(definition)
  })
  // Each refusal hoists its argument into a variable so the call has a single
  // expression to fail on. Passed inline, the failure is reported once per
  // property of the object literal, and a directive can only cover one line.
  it('refuses a body no browser can encode', () => {
    const definition = {
      form: { action: '/todos/new' },
      request: {
        body: { 'application/json': Todo },
      },
      responses: { 201: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    }
    // @ts-expect-error a native <form> cannot send application/json
    defineEndpoint(definition)
  })
  it('refuses a single-schema body, which is JSON by definition', () => {
    const definition = {
      form: { action: '/todos/new' },
      request: { body: Todo },
      responses: { 201: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    }
    // @ts-expect-error a single `body` schema is read as JSON
    defineEndpoint(definition)
  })
  it('refuses a required request header', () => {
    const definition = {
      form: { action: '/todos/new' },
      request: {
        headers: z.object({ 'x-tenant': z.string() }),
        body: { 'application/x-www-form-urlencoded': TodoForm },
      },
      responses: { 201: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    }
    // @ts-expect-error a native <form> cannot send request headers
    defineEndpoint(definition)
  })
  it('allows a header declaration that requires nothing', () => {
    // Nothing is required, so a browser that sends none of them still produces
    // a valid request.
    defineEndpoint({
      form: { action: '/todos/new' },
      request: {
        headers: OptionalHeaders,
        body: { 'application/x-www-form-urlencoded': TodoForm },
      },
      responses: { 201: z.object({ id: z.number() }) },
      handler: (event) => event.respond(201, { id: 1 }),
    })
  })
  it('refuses a required query parameter', () => {
    const definition = {
      form: { action: '/todos/new' },
      request: {
        query: z.object({ list: z.string() }),
        body: { 'application/x-www-form-urlencoded': TodoForm },
      },
      responses: { 201: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    }
    // @ts-expect-error the bridge forwards the submission with no query string
    defineEndpoint(definition)
  })
  it('refuses an idempotent route', () => {
    const definition = {
      form: { action: '/todos/new' },
      idempotency: true,
      request: {
        body: { 'application/x-www-form-urlencoded': TodoForm },
      },
      responses: { 201: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    }
    // @ts-expect-error a native <form> cannot send an Idempotency-Key
    defineEndpoint(definition)
  })
})
describe('which rule refused', () => {
  type FormBody = {
    'application/x-www-form-urlencoded': typeof TodoForm
  }
  type Constraint<
    QUERY = undefined,
    HEADERS = undefined,
    BODY = FormBody,
    IDEM = undefined,
  > = NativeFormProjectionConstraint<
    {
      action: '/todos/new'
    },
    QUERY,
    HEADERS,
    BODY,
    IDEM
  >
  type GetConstraint<
    QUERY = typeof Todo,
    HEADERS = undefined,
    BODY = undefined,
    IDEM = undefined,
  > = NativeFormProjectionConstraint<
    {
      action: '/search'
      method: 'get'
    },
    QUERY,
    HEADERS,
    BODY,
    IDEM
  >
  it('accepts a browser-submittable contract', () => {
    expectTypeOf<Constraint>().toEqualTypeOf<unknown>()
    expectTypeOf<
      Constraint<
        undefined,
        undefined,
        {
          'multipart/form-data': typeof Todo
        }
      >
    >().toEqualTypeOf<unknown>()
    expectTypeOf<GetConstraint>().toEqualTypeOf<unknown>()
  })
  it('names the encoding rule for a body no browser can send', () => {
    expectTypeOf<
      Constraint<
        undefined,
        undefined,
        {
          'application/json': typeof Todo
        }
      >
    >().toEqualTypeOf<
      NativeFormRefusal<"A native <form> can only send 'application/x-www-form-urlencoded' or 'multipart/form-data'. Declare one on request.body - formOf() derives it from the JSON member.">
    >()
  })
  it('names the header rule, and only for a required header', () => {
    expectTypeOf<Constraint<undefined, typeof Todo>>().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send request headers, so request.headers cannot require any.'>
    >()
    expectTypeOf<Constraint<undefined, typeof OptionalHeaders>>().toEqualTypeOf<unknown>()
    // The GET branch carries its own copy of this refusal, so it is pinned on
    // its own: a reword or a broken branch on one side must fail a test.
    expectTypeOf<GetConstraint<typeof Todo, typeof Todo>>().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send request headers, so request.headers cannot require any.'>
    >()
    expectTypeOf<GetConstraint<typeof Todo, typeof OptionalHeaders>>().toEqualTypeOf<unknown>()
  })
  it('names the query rule, and only for a required parameter', () => {
    expectTypeOf<Constraint<typeof Todo>>().toEqualTypeOf<
      NativeFormRefusal<'A POST form reaches the endpoint with no query string, so request.query cannot require any.'>
    >()
    expectTypeOf<Constraint<typeof OptionalHeaders>>().toEqualTypeOf<unknown>()
  })
  it('requires a query contract and no body for GET', () => {
    expectTypeOf<GetConstraint<undefined>>().toEqualTypeOf<
      NativeFormRefusal<'A GET form needs request.query to declare its fields.'>
    >()
    expectTypeOf<GetConstraint<typeof Todo, undefined, FormBody>>().toEqualTypeOf<
      NativeFormRefusal<'A GET form sends fields in the query string, so request.body must be omitted.'>
    >()
  })
  it('names the idempotency rule', () => {
    expectTypeOf<
      Constraint<
        undefined,
        undefined,
        FormBody,
        {
          enabled: true
          headerName: 'x'
          required: true
        }
      >
    >().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send an Idempotency-Key header, so an idempotent route cannot declare form.'>
    >()
    // The GET branch's copy, pinned for the same reason as the header rule's.
    expectTypeOf<
      GetConstraint<
        typeof Todo,
        undefined,
        undefined,
        {
          enabled: true
          headerName: 'x'
          required: true
        }
      >
    >().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send an Idempotency-Key header, so an idempotent route cannot declare form.'>
    >()
  })
  it('reports the encoding rule first, when more than one applies', () => {
    // The body is what the author has to change either way, so it leads.
    expectTypeOf<
      Constraint<
        typeof Todo,
        typeof Todo,
        {
          'application/json': typeof Todo
        }
      >
    >().toEqualTypeOf<
      NativeFormRefusal<"A native <form> can only send 'application/x-www-form-urlencoded' or 'multipart/form-data'. Declare one on request.body - formOf() derives it from the JSON member.">
    >()
  })
})
