import { defineEndpointHandler } from '../../../../../src/runtime'
import { siblingEndpoint } from './sibling.get.endpoint-contract'

export default defineEndpointHandler(siblingEndpoint, ({ query }) => {
  return { name: query.name, sibling: true }
})
