import { z } from 'zod'
import { defineRouteHandler, formOf } from '../../../../../src/runtime'

// Exists so the generated `useEndpointForm` is type-checked the way an
// application consumes it. The form-encoded member is derived from the JSON
// one, so the handler sees no union and the projection's field names come from
// this declaration. See docs/progressive-enhancement.md.
const NoteInput = z.object({
  title: z.string().min(1).max(120),
  pinned: z.boolean().optional(),
})

export default defineRouteHandler({
  form: {
    action: '/notes/new',
    redirect: '/notes/{id}',
  },
  validate: {
    body: {
      'application/json': NoteInput,
      'application/x-www-form-urlencoded': formOf(NoteInput),
    },
    response: {
      201: z.object({ id: z.number(), title: z.string() }),
      400: z.object({ message: z.string() }),
    },
  },
  handler: (event) => event.respond(201, { id: 1, title: event.validated.body.title }),
})
