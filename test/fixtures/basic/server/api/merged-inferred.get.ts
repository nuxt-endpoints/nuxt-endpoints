import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  operation: 'getMergedInferred',
  handler: () => ({ name: 'Tom', count: 1 }),
})
