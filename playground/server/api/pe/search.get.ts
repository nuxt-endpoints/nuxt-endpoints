import { z } from 'zod'
import { defineRouteHandler } from '../../../../src/runtime'

const SearchQuery = z.object({
  q: z.string().optional(),
})

const names = ['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson']

export default defineRouteHandler({
  form: {
    action: '/form-pe/search',
    method: 'get',
  },
  validate: {
    query: SearchQuery,
    response: {
      200: z.object({ items: z.array(z.string()) }),
    },
  },
  handler: ({ validated }) => {
    const term = validated.query.q?.trim().toLowerCase() ?? ''
    return { items: names.filter((name) => name.toLowerCase().includes(term)) }
  },
})
