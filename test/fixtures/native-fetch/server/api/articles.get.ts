import { z } from 'zod'

const Article = z.object({ id: z.number(), title: z.string() })
const articles = [
  { id: 1, title: 'One' },
  { id: 2, title: 'Two' },
  { id: 3, title: 'Three' },
]

export default defineEndpoint({
  pagination: { kind: 'cursor', item: Article },
  responses: { 429: z.object({ retryAfter: z.number() }) },
  handler: (event) => {
    const start = event.validated.query.cursor ? Number(event.validated.query.cursor) : 0
    const end = Math.min(start + event.validated.query.limit, articles.length)
    return {
      items: articles.slice(start, end),
      ...(end < articles.length ? { nextCursor: String(end) } : {}),
    }
  },
})
