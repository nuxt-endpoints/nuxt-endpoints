import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import * as v from 'valibot'
import { z } from 'zod'
import { formFieldAttributes, formOf, parseValidator, toJsonSchema } from '../src/runtime'

// `formOf()` derives the form-encoded member of a body contract from the JSON
// member. What matters is that the *output* is identical to the JSON member's,
// so a handler never sees a union, and that the rules a form needs are applied
// in one place. See docs/progressive-enhancement.md.

const User = z.object({
  name: z.string().min(1),
  age: z.number().int().nonnegative().optional(),
  subscribed: z.boolean(),
  tags: z.array(z.string()),
})

const parse = (schema: Parameters<typeof parseValidator>[0], input: unknown) =>
  parseValidator(schema, input)

describe('formOf', () => {
  it('coerces the string a form sends for a declared number', async () => {
    const result = await parse(formOf(User), {
      name: 'Ada',
      age: '36',
      subscribed: 'on',
      tags: 'math',
    })

    expect(result).toEqual({
      success: true,
      value: { name: 'Ada', age: 36, subscribed: true, tags: ['math'] },
    })
  })

  it('treats an empty numeric input as absent rather than NaN', async () => {
    // A form always sends the field, even when the user typed nothing. Reading
    // that as `NaN` would fail an optional field that should simply be missing.
    const result = await parse(formOf(User), {
      name: 'Ada',
      age: '',
      subscribed: 'on',
      tags: 'math',
    })

    expect(result.success).toBe(true)
    expect((result as { value: Record<string, unknown> }).value).not.toHaveProperty('age')
  })

  it('reads a missing checkbox as false and a present one as true', async () => {
    // An unticked checkbox sends no field at all, which for a form means
    // `false`. This is the rule SvelteKit pushes onto the author's schema.
    const missing = await parse(formOf(User), { name: 'Ada', tags: 'math' })
    expect(missing).toMatchObject({ success: true, value: { subscribed: false } })

    const present = await parse(formOf(User), {
      name: 'Ada',
      subscribed: 'on',
      tags: 'math',
    })
    expect(present).toMatchObject({ success: true, value: { subscribed: true } })

    // An explicitly false-ish value is honoured rather than treated as present.
    for (const value of ['', '0', 'false', 'off', 'no']) {
      const explicit = await parse(formOf(User), {
        name: 'Ada',
        subscribed: value,
        tags: 'math',
      })
      expect(explicit).toMatchObject({ success: true, value: { subscribed: false } })
    }
  })

  it('wraps a single value for a declared array and keeps a repeated one', async () => {
    const single = await parse(formOf(User), { name: 'Ada', subscribed: 'on', tags: 'math' })
    expect(single).toMatchObject({ success: true, value: { tags: ['math'] } })

    const repeated = await parse(formOf(User), {
      name: 'Ada',
      subscribed: 'on',
      tags: ['math', 'code'],
    })
    expect(repeated).toMatchObject({ success: true, value: { tags: ['math', 'code'] } })
  })

  it('leaves values it was not told to convert untouched', async () => {
    // A date is declared as a `date-time` string in JSON Schema, and so is a
    // plain string that happens to carry that format. Converting would break
    // the second, so neither is converted and a schema wanting a `Date` coerces
    // it itself.
    const schema = z.object({ at: z.coerce.date(), note: z.string() })
    const result = await parse(formOf(schema), { at: '2026-09-03T00:00:00Z', note: 'kept' })

    expect(result).toMatchObject({ success: true })
    expect((result as { value: { at: Date; note: string } }).value.at).toBeInstanceOf(Date)
    expect((result as { value: { note: string } }).value.note).toBe('kept')
  })

  it('hands a File through unchanged', async () => {
    const schema = z.object({ name: z.string(), attachment: z.file() })
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })

    const result = await parse(formOf(schema), { name: 'Ada', attachment: file })

    expect(result).toMatchObject({ success: true })
    expect((result as { value: { attachment: File } }).value.attachment).toBe(file)
  })

  it('accepts the wire values a form produces directly', async () => {
    const urlEncoded = new URLSearchParams()
    urlEncoded.set('name', 'Ada')
    urlEncoded.set('age', '36')
    urlEncoded.set('subscribed', 'on')
    urlEncoded.append('tags', 'math')
    urlEncoded.append('tags', 'code')

    await expect(parse(formOf(User), urlEncoded)).resolves.toEqual({
      success: true,
      value: { name: 'Ada', age: 36, subscribed: true, tags: ['math', 'code'] },
    })

    const multipart = new FormData()
    multipart.set('name', 'Ada')
    multipart.set('subscribed', 'on')
    multipart.set('tags', 'math')

    await expect(parse(formOf(User), multipart)).resolves.toMatchObject({
      success: true,
      value: { name: 'Ada', tags: ['math'] },
    })
  })

  it('reports the wrapped schema issues unchanged', async () => {
    const result = await parse(formOf(User), { name: '', subscribed: 'on', tags: 'math' })

    expect(result.success).toBe(false)
    expect((result as { issues: readonly { path?: unknown[] }[] }).issues[0]?.path).toEqual([
      'name',
    ])
  })

  it('produces the same output type as the JSON member for the same input', async () => {
    // The reason this helper exists: a handler reading a media-type-map body
    // sees the union of its members' outputs, so the two must agree.
    const asJson = await parse(User, { name: 'Ada', age: 36, subscribed: true, tags: ['math'] })
    const asForm = await parse(formOf(User), {
      name: 'Ada',
      age: '36',
      subscribed: 'on',
      tags: 'math',
    })

    expect(asForm).toEqual(asJson)
  })

  it('plans coercion from the fields a form sends, not the fields the handler gets', async () => {
    // The form carries a confirmation field the handler never sees. `formOf`
    // has to read the input direction to know `age` is a number at all - the
    // output direction of a transforming schema is unrepresentable and would
    // leave the plan empty.
    const Json = z.object({ email: z.string(), age: z.number().int() })
    const Form = Json.extend({ confirm: z.string() })
      .refine((value) => value.confirm === 'yes', { path: ['confirm'], message: 'must confirm' })
      .transform(({ confirm: _confirm, ...rest }) => rest)

    await expect(
      parse(formOf(Form), { email: 'a@b.co', age: '36', confirm: 'yes' }),
    ).resolves.toEqual({ success: true, value: { email: 'a@b.co', age: 36 } })

    // The cross-field rule still runs, and reports against the form's own field.
    const rejected = await parse(formOf(Form), { email: 'a@b.co', age: '36', confirm: 'no' })
    expect(rejected.success).toBe(false)
    expect((rejected as { issues: readonly { path?: unknown[] }[] }).issues[0]?.path).toEqual([
      'confirm',
    ])
  })

  it('documents itself with the declared field types', async () => {
    // Without this the generated document would describe the form member as an
    // opaque schema, because it is not one of the libraries the converter knows.
    //
    // The comparison is against the input direction: a request body documents
    // what a caller sends, and that is the direction this member is planned
    // from, so the two agree by construction.
    expect(toJsonSchema(formOf(User))).toEqual(toJsonSchema(User, {}, { mode: 'input' }))
  })

  it('rejects a body that a form cannot express, when the contract is defined', () => {
    expect(() => formOf(z.string())).toThrow(/object of form fields/)
    expect(() => formOf(z.object({ user: z.object({ name: z.string() }) }))).toThrow(
      /field "user" is an object/,
    )
    expect(() => formOf(z.object({ users: z.array(z.object({ name: z.string() })) }))).toThrow(
      /field "users" is an array of objects/,
    )
  })
})

describe('formFieldAttributes', () => {
  it('derives HTML constraints from the declared field types', () => {
    const attributes = formFieldAttributes(
      z.object({
        title: z.string().min(2).max(80),
        slug: z.string().regex(/^[a-z-]+$/),
        quantity: z.number().int().min(1).max(10),
        note: z.string().optional(),
      }),
    )

    expect(attributes).toEqual({
      title: { name: 'title', required: true, minlength: 2, maxlength: 80 },
      slug: { name: 'slug', required: true, pattern: '^[a-z-]+$' },
      quantity: { name: 'quantity', required: true, min: 1, max: 10, step: 1 },
      note: { name: 'note' },
    })
  })

  it('drops the safe-integer bounds Zod reports for a plain integer', () => {
    // `z.number().int()` reports `minimum: -9007199254740991`, which is Zod's
    // own limit rather than anything the author asked for. Rendering it would
    // put noise in the markup and imply a rule nobody wrote.
    expect(formFieldAttributes(z.object({ age: z.number().int() })).age).toEqual({
      name: 'age',
      required: true,
      step: 1,
    })
  })

  it('never marks a boolean required', () => {
    // On a checkbox `required` means "must be ticked". A declared boolean only
    // means the field is present, and an unticked box sends nothing at all -
    // which `formOf()` reads as `false`.
    expect(formFieldAttributes(z.object({ subscribed: z.boolean() })).subscribed).toEqual({
      name: 'subscribed',
    })
  })

  it('emits a type only where the format is the control', () => {
    const attributes = formFieldAttributes(
      z.object({
        email: z.string().email(),
        homepage: z.string().url(),
        attachment: z.file().mime('text/plain'),
        password: z.string().min(8),
      }),
    )

    expect(attributes.email).toEqual({ name: 'email', required: true, type: 'email' })
    expect(attributes.homepage).toEqual({ name: 'homepage', required: true, type: 'url' })
    expect(attributes.attachment).toEqual({
      name: 'attachment',
      required: true,
      type: 'file',
      accept: 'text/plain',
    })
    // Whether this is `text`, `password`, or `search` is the template's call.
    expect(attributes.password).toEqual({ name: 'password', required: true, minlength: 8 })
  })

  it('leaves out the pattern a format already carries', () => {
    // Zod emits a long pattern alongside `format: email`. The type expresses the
    // same rule, so repeating it would only bury the markup.
    expect(formFieldAttributes(z.object({ email: z.string().email() })).email).not.toHaveProperty(
      'pattern',
    )
  })

  it('converts an exclusive bound only where an integer makes it exact', () => {
    const integer = formFieldAttributes(z.object({ n: z.number().int().positive() })).n
    expect(integer).toEqual({ name: 'n', required: true, min: 1, step: 1 })

    // HTML cannot express "greater than 0" for a fractional field, so widening
    // it to `min="0"` would state something false.
    const fractional = formFieldAttributes(z.object({ n: z.number().positive() })).n
    expect(fractional).toEqual({ name: 'n', required: true })
  })

  it('reads the fields a form sends, not the ones the handler receives', () => {
    const Json = z.object({ email: z.string().email() })
    const Form = Json.extend({ confirmEmail: z.string().email() })
      .refine((value) => value.email === value.confirmEmail, { path: ['confirmEmail'] })
      .transform(({ confirmEmail: _confirmEmail, ...rest }) => rest)

    expect(Object.keys(formFieldAttributes(Form)).sort()).toEqual(['confirmEmail', 'email'])
  })

  it('carries a multipleOf through as a step', () => {
    expect(formFieldAttributes(z.object({ price: z.number().multipleOf(0.5) })).price).toEqual({
      name: 'price',
      required: true,
      step: 0.5,
    })
  })
})

describe('schema-library neutrality', () => {
  // Both helpers introspect only through the JSON Schema conversion, which is
  // already library-agnostic. The cleanup rules on top of it were tuned against
  // Zod's output, so the other supported libraries are pinned here rather than
  // assumed.
  const shapes = {
    zod: z.object({ name: z.string().min(2), age: z.number().int(), ok: z.boolean() }),
    valibot: v.object({
      name: v.pipe(v.string(), v.minLength(2)),
      age: v.pipe(v.number(), v.integer()),
      ok: v.boolean(),
    }),
    effect: Schema.Struct({
      name: Schema.String.pipe(Schema.minLength(2)),
      age: Schema.Number.pipe(Schema.int()),
      ok: Schema.Boolean,
    }),
  }

  for (const [library, schema] of Object.entries(shapes)) {
    it(`derives the same field attributes from ${library}`, () => {
      expect(formFieldAttributes(schema)).toEqual({
        name: { name: 'name', required: true, minlength: 2 },
        age: { name: 'age', required: true, step: 1 },
        // Never required: an unticked checkbox sends nothing.
        ok: { name: 'ok' },
      })
    })

    it(`coerces the same form input through ${library}`, async () => {
      await expect(parse(formOf(schema), { name: 'Ada', age: '36', ok: 'on' })).resolves.toEqual({
        success: true,
        value: { name: 'Ada', age: 36, ok: true },
      })
    })
  }
})
