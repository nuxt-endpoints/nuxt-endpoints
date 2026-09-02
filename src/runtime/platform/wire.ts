import type { Serialize } from 'nuxt/app'

type Simplify<TYPE> = TYPE extends readonly unknown[] | Date
  ? TYPE
  : { [KEY in keyof TYPE]: Simplify<TYPE[KEY]> }

/**
 * JSON response shape exposed to Nuxt clients.
 *
 * Nuxt owns the transport serialization used by its typed fetch API. The
 * status-discriminated result in client.ts remains NE-owned because the route
 * tree carries one ordinary success response plus the full contract metadata.
 */
export type EndpointWireValue<VALUE> = Simplify<Serialize<VALUE>>
