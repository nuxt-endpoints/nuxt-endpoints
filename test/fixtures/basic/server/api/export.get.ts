import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

export const endpoint = defineEndpoint({
  operation: 'exportUsers',
  query: z.object({ delimiter: z.string().optional() }),
  responses: {
    200: { stream: true, contentType: 'text/csv', description: 'CSV export' },
    404: z.object({ message: z.string() }),
  },
})

export default defineEndpointHandler(endpoint, ({ query, respond }) => {
  const delimiter = query.delimiter ?? ','
  const rows = [
    ['id', 'name'],
    ['u_1', 'Tom'],
  ]

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
})
