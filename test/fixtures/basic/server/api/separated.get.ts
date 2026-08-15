import { defineEndpointHandler } from '../../../../../src/runtime'
import { separatedEndpoint } from '../contracts/separated'

export default defineEndpointHandler(separatedEndpoint, ({ query }) => {
  return { name: query.name, separated: true }
})
