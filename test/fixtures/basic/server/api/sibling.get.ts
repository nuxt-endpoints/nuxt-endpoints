import { defineEndpoint } from '../../../../../src/runtime'
import { siblingContract } from '../contracts/sibling'
export default defineEndpoint({
  validate: {
    query: siblingContract.query,
  },
  responses: siblingContract.responses,
  handler: (event) => ({ name: event.validated.query.name, sibling: true }),
})
