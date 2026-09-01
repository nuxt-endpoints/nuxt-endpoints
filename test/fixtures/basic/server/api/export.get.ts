import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  operation: 'exportUsers',
  validate: {
    query: z.object({ delimiter: z.string().optional() }),
    response: {
      // Two representations of the same status: the runtime negotiates from
      // `Accept`, and `text/csv` is the endpoint's own preference.
      200: { media: ['text/csv', 'application/json'], description: 'User export' },
      404: z.object({ message: z.string() }),
    },
  },
  handler: ({ query, responseMediaType, respond }) => {
    const delimiter = query.delimiter ?? ','
    const rows = [
      ['id', 'name'],
      ['u_1', 'Tom'],
    ]

    if (responseMediaType === 'application/json') {
      return respond(200, JSON.stringify(rows))
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const row of rows) {
          controller.enqueue(encoder.encode(`${row.join(delimiter)}\n`))
        }
        controller.close()
      },
    })

    return respond(200, stream)
  },
})
