import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  handler: () => ({ name: 'Tom', count: 1 }),
})
