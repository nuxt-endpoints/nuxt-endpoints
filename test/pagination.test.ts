import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteHandler } from '../src/runtime'
import { parseValidator } from '../src/runtime/validator'

type RuntimeRouteHandler = {
  __endpoint_contract__: { definition: { query: unknown; responses: Record<number, unknown> } }
}

describe('cursor pagination contract', () => {
  it('generates query and response validators from pagination', async () => {
    const handler = defineRouteHandler({
      pagination: { kind: 'cursor', item: z.object({ id: z.number() }) },
      handler: () => ({ items: [{ id: 1 }], nextCursor: 'next' }),
    }) as unknown as RuntimeRouteHandler
    const contract = handler.__endpoint_contract__.definition

    await expect(
      parseValidator(contract.query as never, { cursor: 'page-2', limit: '10' }),
    ).resolves.toEqual({
      success: true,
      value: { cursor: 'page-2', limit: 10 },
    })
    await expect(parseValidator(contract.query as never, {})).resolves.toEqual({
      success: true,
      value: { limit: 20 },
    })
    await expect(
      parseValidator(contract.responses[200] as never, {
        items: [{ id: 1 }],
        nextCursor: 'page-2',
      }),
    ).resolves.toMatchObject({ success: true })
  })

  it('rejects duplicate pagination-owned declarations for JavaScript and cast paths', () => {
    expect(() =>
      defineRouteHandler({
        pagination: { kind: 'cursor', item: z.object({ id: z.number() }) },
        validate: { query: z.object({ cursor: z.string().optional() }) },
        handler: () => ({ items: [] }),
      } as never),
    ).toThrow(/pagination owns validate\.query\.cursor/)

    expect(() =>
      defineRouteHandler({
        pagination: { kind: 'cursor', item: z.object({ id: z.number() }) },
        validate: { response: { 200: z.object({ items: z.array(z.object({ id: z.number() })) }) } },
        handler: () => ({ items: [] }),
      } as never),
    ).toThrow(/pagination owns validate\.response\[200\]/)
  })

  it('retains non-pagination query fields and non-success responses', async () => {
    const handler = defineRouteHandler({
      pagination: { kind: 'cursor', item: z.object({ id: z.number() }) },
      validate: {
        query: z.object({ category: z.string().optional() }),
        response: { 404: z.object({ message: z.string() }) },
      },
      handler: () => ({ items: [{ id: 1 }] }),
    }) as unknown as RuntimeRouteHandler
    const contract = handler.__endpoint_contract__.definition

    await expect(
      parseValidator(contract.query as never, { category: 'news', limit: '5' }),
    ).resolves.toEqual({
      success: true,
      value: { category: 'news', limit: 5 },
    })
    expect(contract.responses[404]).toBeDefined()
    expect(contract.responses[200]).toBeDefined()
  })
})
