import { defineEndpoint } from '../../../../../src/runtime'

export default defineEndpoint({
  handler: () => ({ name: 'Tom', count: 1 }),
})
