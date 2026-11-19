import { defineEndpoint } from '../../../../../src/runtime'
import { separatedContract } from '../contracts/separated'
export default defineEndpoint({
  validate: {
    query: separatedContract.query,
  },
  responses: separatedContract.responses,
  handler: (event) => ({ name: event.validated.query.name, separated: true }),
})
