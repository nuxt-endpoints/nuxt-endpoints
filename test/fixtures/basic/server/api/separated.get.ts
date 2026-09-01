import { defineRouteHandler } from '../../../../../src/runtime'
import { separatedContract } from '../contracts/separated'

export default defineRouteHandler({
  validate: {
    query: separatedContract.query,
    response: separatedContract.responses,
  },
  handler: (event) => ({ name: event.validated.query.name, separated: true }),
})
