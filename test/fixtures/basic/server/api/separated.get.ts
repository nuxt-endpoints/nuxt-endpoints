import { defineRouteHandler } from '../../../../../src/runtime'
import { separatedContract } from '../contracts/separated'

export default defineRouteHandler({
  operation: separatedContract.operation,
  validate: {
    query: separatedContract.query,
    response: separatedContract.responses,
  },
  handler: (event) => ({ name: event.validated.query.name, separated: true }),
})
