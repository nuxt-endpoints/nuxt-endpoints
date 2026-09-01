import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import * as v from 'valibot'
import { z } from 'zod'
import { z as z4 } from 'zod/v4'
import { parseValidator, toJsonSchema } from '../src/runtime'
import type { StandardSchemaLike } from '../src/runtime'

const numberFromString = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      const value = input as { id: string }
      const id = Number(value.id)
      if (Number.isNaN(id)) {
        return {
          issues: [{ path: ['id'], message: 'Expected numeric string', code: 'invalid_number' }],
        }
      }
      return { value: { id } }
    },
  },
} satisfies StandardSchemaLike<{ id: string }, { id: number }>

const zodLikeString = {
  safeParse(input: unknown) {
    if (typeof input === 'string') {
      return { success: true, data: input.toUpperCase() } as const
    }
    return {
      success: false,
      error: { issues: [{ message: 'Expected string' }] },
    } as const
  },
}

describe('parseValidator', () => {
  it('parses Standard Schema-like validators', async () => {
    const result = await parseValidator(numberFromString, { id: '123' })

    expect(result).toEqual({
      success: true,
      value: { id: 123 },
    })
  })

  it('normalizes Standard Schema-like validation failures', async () => {
    const result = await parseValidator(numberFromString, { id: 'abc' })

    expect(result).toEqual({
      success: false,
      issues: [{ path: ['id'], message: 'Expected numeric string', code: 'invalid_number' }],
    })
  })

  it('parses Zod-like safeParse validators', async () => {
    const result = await parseValidator(zodLikeString, 'tom')

    expect(result).toEqual({
      success: true,
      value: 'TOM',
    })
  })

  it('normalizes Zod-like safeParse validation failures', async () => {
    const result = await parseValidator(zodLikeString, 1)

    expect(result).toEqual({
      success: false,
      issues: [{ message: 'Expected string' }],
    })
  })

  it('parses real Zod schemas', async () => {
    const result = await parseValidator(z.object({ id: z.coerce.number() }), { id: '123' })

    expect(result).toEqual({
      success: true,
      value: { id: 123 },
    })
  })

  it('normalizes real Zod validation failures', async () => {
    const result = await parseValidator(z.object({ id: z.number() }), { id: 'abc' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues[0]?.path).toEqual(['id'])
    }
  })

  it('parses real Valibot schemas through Standard Schema', async () => {
    const result = await parseValidator(
      v.object({
        id: v.pipe(v.string(), v.transform(Number)),
      }),
      { id: '123' },
    )

    expect(result).toEqual({
      success: true,
      value: { id: 123 },
    })
  })

  it('normalizes real Valibot validation failures', async () => {
    const result = await parseValidator(v.object({ id: v.number() }), { id: 'abc' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues[0]?.message).toContain('Expected number')
      expect(result.issues[0]?.path?.[0]).toMatchObject({ key: 'id' })
    }
  })

  it('parses real Effect schemas through the Effect Standard Schema adapter', async () => {
    const result = await parseValidator(
      Schema.Struct({
        id: Schema.NumberFromString,
        name: Schema.String,
      }),
      { id: '123', name: 'Ada' },
    )

    expect(result).toEqual({
      success: true,
      value: { id: 123, name: 'Ada' },
    })
  })

  it('normalizes real Effect schema validation failures', async () => {
    const result = await parseValidator(
      Schema.Struct({
        id: Schema.Number,
      }),
      { id: 'abc' },
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues[0]?.message).toContain('Expected number')
    }
  })
})

describe('toJsonSchema', () => {
  it('converts common Zod schemas to JSON Schema', () => {
    const schema = toJsonSchema(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(20),
        age: z.number().int().min(0).optional(),
        active: z.boolean(),
        tags: z.array(z.string()).min(1),
        role: z.enum(['admin', 'member']),
        deletedAt: z.string().datetime().nullable(),
      }),
    )

    expect(schema).toMatchObject({
      type: 'object',
      required: ['id', 'name', 'active', 'tags', 'role', 'deletedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 20 },
        age: { type: 'integer', minimum: 0 },
        active: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
        role: { type: 'string', enum: ['admin', 'member'] },
        deletedAt: {
          anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
        },
      },
    })
  })

  it('converts Zod unions and literals', () => {
    expect(
      toJsonSchema(
        z.union([
          z.literal('draft'),
          z.literal('published'),
          z.object({ archived: z.literal(true) }),
        ]),
      ),
    ).toMatchObject({
      anyOf: [
        { type: 'string' },
        { type: 'string' },
        {
          type: 'object',
          required: ['archived'],
          properties: {
            archived: { type: 'boolean' },
          },
        },
      ],
    })
  })

  it('converts Zod v4 schemas structurally', () => {
    expect(
      toJsonSchema(
        z4.object({
          id: z4.string().uuid(),
          count: z4.number().int().min(1),
        }),
      ),
    ).toMatchObject({
      type: 'object',
      required: ['id', 'count'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        count: { type: 'integer', minimum: 1 },
      },
    })
  })

  it('converts Zod files with their binary constraints', () => {
    expect(toJsonSchema(z.file().max(5000).mime('text/plain'))).toMatchObject({
      type: 'string',
      format: 'binary',
      contentEncoding: 'binary',
      contentMediaType: 'text/plain',
      maxLength: 5000,
    })
  })

  it('documents Zod dates as their JSON wire representation', () => {
    expect(toJsonSchema(z.object({ createdAt: z.date() }))).toMatchObject({
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
      },
    })
  })

  it('converts common Valibot schemas through the Valibot JSON Schema converter', () => {
    expect(
      toJsonSchema(
        v.object({
          id: v.pipe(v.string(), v.uuid()),
          name: v.pipe(v.string(), v.minLength(1)),
          age: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
        }),
      ),
    ).toEqual({
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer', minimum: 0 },
      },
    })
  })

  it('converts Valibot pipelines as output schemas by default', () => {
    expect(toJsonSchema(v.pipe(v.string(), v.transform(Number), v.number()))).toEqual({
      type: 'number',
    })
  })

  it('can convert Valibot pipelines as input schemas', () => {
    expect(
      toJsonSchema(v.pipe(v.string(), v.transform(Number), v.number()), undefined, {
        mode: 'input',
      }),
    ).toEqual({
      type: 'string',
    })
  })

  it('delegates Valibot variants and intersections to the official converter', () => {
    expect(
      toJsonSchema(
        v.variant('type', [
          v.object({ type: v.literal('a'), a: v.string() }),
          v.object({ type: v.literal('b'), b: v.number() }),
        ]),
      ),
    ).toMatchObject({
      oneOf: [
        {
          type: 'object',
          required: ['type', 'a'],
          properties: {
            type: { const: 'a' },
            a: { type: 'string' },
          },
        },
        {
          type: 'object',
          required: ['type', 'b'],
          properties: {
            type: { const: 'b' },
            b: { type: 'number' },
          },
        },
      ],
    })

    expect(
      toJsonSchema(v.intersect([v.object({ a: v.string() }), v.object({ b: v.number() })])),
    ).toMatchObject({
      allOf: [
        {
          type: 'object',
          required: ['a'],
          properties: { a: { type: 'string' } },
        },
        {
          type: 'object',
          required: ['b'],
          properties: { b: { type: 'number' } },
        },
      ],
    })
  })

  it('converts common Effect schemas through the official JSON Schema converter', () => {
    expect(
      toJsonSchema(
        Schema.Struct({
          id: Schema.Number,
          name: Schema.String.pipe(Schema.minLength(1)),
        }),
      ),
    ).toMatchObject({
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'number' },
        name: { type: 'string', minLength: 1 },
      },
    })
  })
})
