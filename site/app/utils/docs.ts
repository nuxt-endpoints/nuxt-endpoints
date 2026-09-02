export interface DocsNavItem {
  label: string
  to: string
}

export interface DocsNavSection {
  label: string
  items: readonly DocsNavItem[]
}

export const docsNavSections = [
  {
    label: 'Getting Started',
    items: [
      { label: 'Introduction', to: '/docs' },
      { label: 'Getting Started', to: '/docs/getting-started' },
    ],
  },
  {
    label: 'Guides',
    items: [
      { label: 'Define Endpoints', to: '/docs/endpoints' },
      { label: 'Generated Client', to: '/docs/client' },
      { label: 'Responses', to: '/docs/responses' },
      { label: 'Pinia Colada', to: '/docs/pinia-colada' },
      { label: 'OpenAPI', to: '/docs/openapi' },
      { label: 'Schema Libraries', to: '/docs/schema-libraries' },
      { label: 'Idempotency', to: '/docs/idempotency' },
      { label: 'Low-level HTTP', to: '/docs/low-level-http' },
      { label: 'Incremental Adoption', to: '/docs/incremental-adoption' },
    ],
  },
  {
    label: 'Concepts',
    items: [
      { label: 'Mental Model', to: '/docs/mental-model' },
      { label: 'Why Nuxt Endpoints?', to: '/docs/why-nuxt-endpoints' },
      { label: 'Comparison', to: '/docs/comparison' },
      { label: 'Limits', to: '/docs/limits' },
    ],
  },
] as const satisfies readonly DocsNavSection[]

export const docsNav = docsNavSections.flatMap((section) => section.items)
