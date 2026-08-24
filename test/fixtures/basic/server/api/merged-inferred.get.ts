import { defineEndpoint } from '../../../../../src/runtime'

// PROTOTYPE: merged form with no declared responses - the handler return is
// inferred and widened, exactly as the two-call form does.
export default defineEndpoint({
  operation: 'getMergedInferred',
  handler: () => ({ name: 'Tom', count: 1 }),
})
