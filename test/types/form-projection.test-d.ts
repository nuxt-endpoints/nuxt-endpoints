import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineRouteHandler, formOf } from '../../src/runtime'
import type { NativeFormProjectionConstraint, NativeFormRefusal } from '../../src/runtime'

// A form projection is only honest if a browser could produce the request the
// contract describes. These pin the refusals - a browser cannot set headers,
// cannot add a query string to where the bridge forwards the submission, and
// cannot send an `Idempotency-Key`. See src/runtime/form-projection.ts.
//
// These prove the refusal compiles to an error; the block below proves it is
// the right refusal. They are separate because `defineRouteHandler` is
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
    const handler = defineRouteHandler({
      form: { action: '/todos/new', redirect: '/todos/{id}' },
      validate: {
        body: { 'application/json': Todo, 'application/x-www-form-urlencoded': TodoForm },
        response: { 201: z.object({ id: z.number() }) },
      },
      handler: (event) => event.respond(201, { id: 1 }),
    })

    expectTypeOf(handler).not.toBeAny()
  })

  it('accepts a multipart-only contract', () => {
    defineRouteHandler({
      form: { action: '/uploads' },
      validate: {
        body: { 'multipart/form-data': z.object({ file: z.file() }) },
        response: { 201: z.object({ ok: z.boolean() }) },
      },
      handler: (event) => event.respond(201, { ok: true }),
    })
  })

  it('accepts an explicitly selected GET form and types its query', () => {
    defineRouteHandler({
      form: { action: '/search', method: 'get' },
      validate: {
        query: z.object({ q: z.string(), page: z.coerce.number().optional() }),
        response: { 200: z.object({ items: z.array(z.string()) }) },
      },
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
      validate: {
        query: z.object({ q: z.string() }),
        body: { 'application/x-www-form-urlencoded': TodoForm },
        response: { 200: z.object({ items: z.array(z.string()) }) },
      },
      handler: () => ({ items: [] }),
    }

    // @ts-expect-error GET carries fields in the URL and does not redirect after an action.
    defineRouteHandler(definition)
  })

  // Each refusal hoists its argument into a variable so the call has a single
  // expression to fail on. Passed inline, the failure is reported once per
  // property of the object literal, and a directive can only cover one line.
  it('refuses a body no browser can encode', () => {
    const definition = {
      form: { action: '/todos/new' },
      validate: {
        body: { 'application/json': Todo },
        response: { 201: z.object({ id: z.number() }) },
      },
      handler: () => ({ id: 1 }),
    }

    // @ts-expect-error a native <form> cannot send application/json
    defineRouteHandler(definition)
  })

  it('refuses a single-schema body, which is JSON by definition', () => {
    const definition = {
      form: { action: '/todos/new' },
      validate: { body: Todo, response: { 201: z.object({ id: z.number() }) } },
      handler: () => ({ id: 1 }),
    }

    // @ts-expect-error a single `body` schema is read as JSON
    defineRouteHandler(definition)
  })

  it('refuses a required request header', () => {
    const definition = {
      form: { action: '/todos/new' },
      validate: {
        headers: z.object({ 'x-tenant': z.string() }),
        body: { 'application/x-www-form-urlencoded': TodoForm },
        response: { 201: z.object({ id: z.number() }) },
      },
      handler: () => ({ id: 1 }),
    }

    // @ts-expect-error a native <form> cannot send request headers
    defineRouteHandler(definition)
  })

  it('allows a header declaration that requires nothing', () => {
    // Nothing is required, so a browser that sends none of them still produces
    // a valid request.
    defineRouteHandler({
      form: { action: '/todos/new' },
      validate: {
        headers: OptionalHeaders,
        body: { 'application/x-www-form-urlencoded': TodoForm },
        response: { 201: z.object({ id: z.number() }) },
      },
      handler: (event) => event.respond(201, { id: 1 }),
    })
  })

  it('refuses a required query parameter', () => {
    const definition = {
      form: { action: '/todos/new' },
      validate: {
        query: z.object({ list: z.string() }),
        body: { 'application/x-www-form-urlencoded': TodoForm },
        response: { 201: z.object({ id: z.number() }) },
      },
      handler: () => ({ id: 1 }),
    }

    // @ts-expect-error the bridge forwards the submission with no query string
    defineRouteHandler(definition)
  })

  it('refuses an idempotent route', () => {
    const definition = {
      form: { action: '/todos/new' },
      idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
      validate: {
        body: { 'application/x-www-form-urlencoded': TodoForm },
        response: { 201: z.object({ id: z.number() }) },
      },
      handler: () => ({ id: 1 }),
    }

    // @ts-expect-error a native <form> cannot send an Idempotency-Key
    defineRouteHandler(definition)
  })
})

describe('which rule refused', () => {
  type FormBody = { 'application/x-www-form-urlencoded': typeof TodoForm }
  type Constraint<
    QUERY = undefined,
    HEADERS = undefined,
    BODY = FormBody,
    IDEM = undefined,
  > = NativeFormProjectionConstraint<{ action: '/todos/new' }, QUERY, HEADERS, BODY, IDEM>
  type GetConstraint<
    QUERY = typeof Todo,
    HEADERS = undefined,
    BODY = undefined,
    IDEM = undefined,
  > = NativeFormProjectionConstraint<
    { action: '/search'; method: 'get' },
    QUERY,
    HEADERS,
    BODY,
    IDEM
  >

  it('accepts a browser-submittable contract', () => {
    expectTypeOf<Constraint>().toEqualTypeOf<unknown>()
    expectTypeOf<
      Constraint<undefined, undefined, { 'multipart/form-data': typeof Todo }>
    >().toEqualTypeOf<unknown>()
    expectTypeOf<GetConstraint>().toEqualTypeOf<unknown>()
  })

  it('names the encoding rule for a body no browser can send', () => {
    expectTypeOf<
      Constraint<undefined, undefined, { 'application/json': typeof Todo }>
    >().toEqualTypeOf<
      NativeFormRefusal<"A native <form> can only send 'application/x-www-form-urlencoded' or 'multipart/form-data'. Declare one on validate.body - formOf() derives it from the JSON member.">
    >()
  })

  it('names the header rule, and only for a required header', () => {
    expectTypeOf<Constraint<undefined, typeof Todo>>().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send request headers, so validate.headers cannot require any.'>
    >()
    expectTypeOf<Constraint<undefined, typeof OptionalHeaders>>().toEqualTypeOf<unknown>()
    // The GET branch carries its own copy of this refusal, so it is pinned on
    // its own: a reword or a broken branch on one side must fail a test.
    expectTypeOf<GetConstraint<typeof Todo, typeof Todo>>().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send request headers, so validate.headers cannot require any.'>
    >()
    expectTypeOf<GetConstraint<typeof Todo, typeof OptionalHeaders>>().toEqualTypeOf<unknown>()
  })

  it('names the query rule, and only for a required parameter', () => {
    expectTypeOf<Constraint<typeof Todo>>().toEqualTypeOf<
      NativeFormRefusal<'A POST form reaches the endpoint with no query string, so validate.query cannot require any.'>
    >()
    expectTypeOf<Constraint<typeof OptionalHeaders>>().toEqualTypeOf<unknown>()
  })

  it('requires a query contract and no body for GET', () => {
    expectTypeOf<GetConstraint<undefined>>().toEqualTypeOf<
      NativeFormRefusal<'A GET form needs validate.query to declare its fields.'>
    >()
    expectTypeOf<GetConstraint<typeof Todo, undefined, FormBody>>().toEqualTypeOf<
      NativeFormRefusal<'A GET form sends fields in the query string, so validate.body must be omitted.'>
    >()
  })

  it('names the idempotency rule', () => {
    expectTypeOf<
      Constraint<undefined, undefined, FormBody, { enabled: true; headerName: 'x'; required: true }>
    >().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send an Idempotency-Key header, so an idempotent route cannot declare form.'>
    >()
    // The GET branch's copy, pinned for the same reason as the header rule's.
    expectTypeOf<
      GetConstraint<
        typeof Todo,
        undefined,
        undefined,
        { enabled: true; headerName: 'x'; required: true }
      >
    >().toEqualTypeOf<
      NativeFormRefusal<'A native <form> cannot send an Idempotency-Key header, so an idempotent route cannot declare form.'>
    >()
  })

  it('reports the encoding rule first, when more than one applies', () => {
    // The body is what the author has to change either way, so it leads.
    expectTypeOf<
      Constraint<typeof Todo, typeof Todo, { 'application/json': typeof Todo }>
    >().toEqualTypeOf<
      NativeFormRefusal<"A native <form> can only send 'application/x-www-form-urlencoded' or 'multipart/form-data'. Declare one on validate.body - formOf() derives it from the JSON member.">
    >()
  })
})
