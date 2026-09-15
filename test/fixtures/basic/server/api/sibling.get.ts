import { defineEndpoint } from '../../../../../src/runtime'
import { siblingContract } from './sibling.get.endpoint-contract'
export default defineEndpoint({
  request: {
    query: siblingContract.query,
  },
  responses: siblingContract.responses,
  handler: (event) => ({ name: event.validated.query.name, sibling: true }),
})
