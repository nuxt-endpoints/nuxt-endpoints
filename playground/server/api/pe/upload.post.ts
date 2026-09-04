import { getCookie } from 'h3'
import { z } from 'zod'
import { defineRouteHandler } from '../../../../src/runtime'

// Exists for the progressive-enhancement proof of concept: it declares a
// multipart body with a real file, so the tests can prove that an upload
// survives the bridge's internal call, and it echoes the session cookie to
// prove that credentials do too.
export default defineRouteHandler({
  summary: 'Store a note with an attachment',
  form: {
    from: '/form-pe/upload',
    redirect: '/form-pe/upload?stored={name}&size={size}&session={session}',
  },
  validate: {
    body: {
      'multipart/form-data': z.object({
        name: z.string().trim().min(1).max(80),
        attachment: z.file().max(4096).mime('text/plain'),
      }),
    },
    response: {
      201: z.object({
        name: z.string(),
        size: z.number(),
        session: z.string(),
      }),
    },
  },
  handler: async (event) => {
    const { name, attachment } = event.validated.body
    return event.respond(201, {
      name,
      size: (await attachment.text()).length,
      session: getCookie(event, 'pe-session') ?? 'anonymous',
    })
  },
})
