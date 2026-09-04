/**
 * The page-URL-to-endpoint map the bridge middleware reads, shared the same
 * way the OpenAPI document is - see openapi-state.ts.
 *
 * The bridge deliberately does not import the generated map itself. It is
 * registered as a server handler, so Nitro's route-contract extraction bundles
 * it before `nitro:init` has run, and anything it imports is resolved in that
 * pass. The startup plugin is not part of that build, so it reads the map and
 * hands it over here.
 */
export type FormRoute = {
  /** The endpoint a native submission to this page URL is forwarded to. */
  target: string
  method: string
  enctype: string
  redirect?: string
}

let formRoutes: Readonly<Record<string, FormRoute>> = {}

export function setFormRoutes(routes: Readonly<Record<string, FormRoute>>): void {
  formRoutes = routes
}

export function getFormRoute(pathname: string): FormRoute | undefined {
  return formRoutes[pathname]
}
