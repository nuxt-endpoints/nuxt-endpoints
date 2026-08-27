import type { Serialize, Simplify } from 'nitropack/types'

/**
 * JSON response shape exposed to clients on the current Nitro 2 platform line.
 * Keep the Nitro-specific mapping isolated here so the Nuxt 5 typed-fetch
 * integration can replace this adapter without changing endpoint contracts.
 *
 * Two separate events land here, and only the second changes this file's
 * body. Nitro 3 keeps `Serialize`/`Simplify` in `nitro/types`, so that
 * migration is an import path. If nitrojs/nitro#2758 then rebuilds the fetch
 * types on fetchdts, this projection is rewritten against it — and the
 * status-discriminated result in client.ts stays owned there either way,
 * because fetchdts types one response per route, not one per status.
 */
export type EndpointWireValue<VALUE> = Simplify<Serialize<VALUE>>
