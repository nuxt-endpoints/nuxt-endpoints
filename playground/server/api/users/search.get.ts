import * as v from 'valibot'

const users = [
  { id: 1, name: 'Tom' },
  { id: 2, name: 'Jane' },
  { id: 3, name: 'Janet' },
  { id: 101, name: 'Sid' },
]

const User = v.object({
  id: v.number(),
  name: v.string(),
})

// Valibot example: query strings are transformed to numbers before the
// handler runs, and the OpenAPI schema reflects the input (string) side.
export default defineEndpoint({
  operation: 'searchUsers',
  summary: 'Search users by name',
  query: v.object({
    q: v.pipe(v.string(), v.minLength(1)),
    limit: v.optional(
      v.pipe(
        v.string(),
        v.transform(Number),
        v.number(),
        v.integer(),
        v.minValue(1),
        v.maxValue(10),
      ),
    ),
  }),
  responses: {
    200: v.object({
      items: v.array(User),
      total: v.number(),
    }),
  },
  handler: ({ query }) => {
    const matches = users.filter((user) => user.name.toLowerCase().includes(query.q.toLowerCase()))

    return {
      items: matches.slice(0, query.limit ?? 10),
      total: matches.length,
    }
  },
})
