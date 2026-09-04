import { z } from 'zod'
import { defineRouteHandler } from '../../../../src/runtime'
import { UserFormInput, UserInput } from '../../../contracts/user'

const User = z.object({
  id: z.number(),
  name: z.string(),
  age: z.number().optional(),
})

export default defineRouteHandler({
  // The page at `/form-pe` posts here natively; the bridge forwards it and
  // sends the browser to `redirect` on success. See
  // docs/progressive-enhancement.md.
  form: {
    from: '/form-pe',
    redirect: '/form-pe?created={id}',
  },
  validate: {
    body: {
      'application/json': UserInput,
      'application/x-www-form-urlencoded': UserFormInput,
    },
    response: {
      201: User,
    },
  },
  handler: (event) =>
    event.respond(201, { id: 101, name: event.validated.body.name, age: event.validated.body.age }),
})
