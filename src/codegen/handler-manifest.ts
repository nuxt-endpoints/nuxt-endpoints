import { toImportPath } from './shared'

export type EndpointHandlerManifestDescriptor = {
  handler: string
  route: string
  method: string
}

// Pure builder: returns the `#nuxt-endpoints/server-handlers` content
// (module.ts registers it through `addServerTemplate`).
export function generateEndpointHandlerManifest(
  handlers: readonly EndpointHandlerManifestDescriptor[],
): string {
  if (handlers.length === 0) {
    return 'export const handlers = []\n'
  }

  const entries = handlers.map(
    (handler) => `  {
    route: ${JSON.stringify(handler.route)},
    method: ${JSON.stringify(handler.method)},
    load: () => import(${JSON.stringify(toImportPath(handler.handler))}).then((module) => module.default),
  }`,
  )

  return `export const handlers = [\n${entries.join(',\n')}\n]\n`
}
