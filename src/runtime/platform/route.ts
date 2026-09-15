import { normalizeRoute } from 'h3'

// rou3 treats trailing slashes as equivalent when matching a route.
export function normalizeRuntimeRouteIdentity(route: string): string {
  return normalizeRoute(route).replace(/\/+$/, '') || '/'
}
