import { z } from 'zod'
import { formOf } from '../../src/runtime'

// Shared on purpose, and deliberately not under `shared/`: that name is
// reserved by Nuxt and resolves differently. The page needs the same
// declaration the endpoint validates with, and importing the server route
// module into a page would drag the handler - and everything it imports -
// into the client bundle.
export const UserInput = z.object({
  // `min(1)` becomes `minlength` and the browser enforces it; the refinement
  // cannot be expressed in HTML at all, so only the endpoint can reject it.
  // That difference is the point of the third validation layer in the design
  // document - the form gets what HTML can carry, and nothing is duplicated.
  name: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, { message: 'Name cannot be blank' }),
  age: z.number().int().nonnegative().optional(),
})

// The form-encoded member is derived from the JSON one, so its output is the
// same type and the handler sees no union. Declaring the encoding rather than
// converting it in a middleware keeps the endpoint callable with
// `curl -d 'name=Ada'`, and the OpenAPI document says so.
// See docs/progressive-enhancement.md.
export const UserFormInput = formOf(UserInput)
