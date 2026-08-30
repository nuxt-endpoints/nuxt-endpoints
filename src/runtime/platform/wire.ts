import type { Serialize, Simplify } from 'nitro/types'

/**
 * JSON response shape exposed to clients on the Nitro 3 platform line.
 * Keep the Nitro-specific mapping isolated here so the Nuxt 5 typed-fetch
 * integration can replace this adapter without changing endpoint contracts.
 *
 * Nitro 3 keeps `Serialize`/`Simplify` in `nitro/types`, so adopting it was an
 * import path. The remaining event is nitrojs/nitro#2758: if Nitro's fetch
 * types are rebuilt on fetchdts, this projection is rewritten against it. The
 * status-discriminated result in client.ts stays owned there either way,
 * because fetchdts's `EndpointMetadata` carries one `response` per route and
 * method, with no per-status key.
 */
export type EndpointWireValue<VALUE> = Simplify<Serialize<VALUE>>
