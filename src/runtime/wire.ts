import type { Serialize, Simplify } from 'nitropack/types'

/**
 * JSON response shape exposed to clients on the current Nitro 2 platform line.
 * Keep the Nitro-specific mapping isolated here so the Nuxt 5 typed-fetch
 * integration can replace this adapter without changing endpoint contracts.
 */
export type EndpointWireValue<VALUE> = Simplify<Serialize<VALUE>>
