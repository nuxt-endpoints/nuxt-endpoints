import { defineRouteHandler } from '../../../../../src/runtime'
import { siblingContract } from '../contracts/sibling'

export default defineRouteHandler({
  operation: siblingContract.operation,
  validate: {
    query: siblingContract.query,
    response: siblingContract.responses,
  },
  handler: ({ query }) => ({ name: query.name, sibling: true }),
})
