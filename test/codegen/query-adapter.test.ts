import { describe, expect, it } from 'vitest'
import { generateEndpointQueryPlugin } from '../../src/codegen'

describe('generateEndpointQueryPlugin', () => {
  it('embeds the configured staleTime into the default query options', () => {
    expect(generateEndpointQueryPlugin(60_000)).toContain('staleTime: 60000,')
    expect(generateEndpointQueryPlugin(5_000)).toContain('staleTime: 5000,')
  })

  it('dehydrates on the server and hydrates on the client', () => {
    const content = generateEndpointQueryPlugin(60_000)

    expect(content).toContain('if (import.meta.server)')
    expect(content).toContain('vueQueryState.value = dehydrate(queryClient)')
    expect(content).toContain('if (import.meta.client)')
    expect(content).toContain('hydrate(queryClient, vueQueryState.value)')
  })
})
