import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fixtureRoot = fileURLToPath(new URL('../fixtures/query-auto', import.meta.url))

if (process.env.NUXT_ENDPOINTS_E2E === '1') {
  const { $fetch, setup, useTestContext } = await import('@nuxt/test-utils/e2e')

  describe('TanStack Query auto setup integration', async () => {
    await setup({
      rootDir: fixtureRoot,
      browser: false,
      server: true,
      port: Number(process.env.NUXT_ENDPOINTS_QUERY_AUTO_E2E_PORT || 53492),
      setupTimeout: 120000,
    })

    it('generates the auto setup plugin with the configured stale time', async () => {
      const buildDir = useTestContext().nuxt?.options.buildDir
      expect(buildDir).toBeTruthy()

      const plugin = await readFile(join(buildDir!, 'endpoints-query-plugin.ts'), 'utf8')
      expect(plugin).toContain("useState<DehydratedState | null>('nuxt-endpoints-vue-query'")
      expect(plugin).toContain('staleTime: 60000')
    })

    it('renders and dehydrates query data during SSR', async () => {
      const html = await $fetch<string>('/query-user')
      const payload = extractNuxtPayload(html)

      expect(html).toContain('query-user: Tom')
      expect(payload).toContain('nuxt-endpoints-vue-query')
      expect(payload).toContain('queryHash')
      expect(payload).toContain('\\u002Fapi\\u002Fusers\\u002F:id')
      expect(payload).toContain('Tom')
    })

    it('forwards cookies and isolates query caches between SSR requests', async () => {
      const [alice, bob] = await Promise.all([
        $fetch<string>('/query-whoami', {
          headers: { cookie: 'session=alice' },
        }),
        $fetch<string>('/query-whoami', {
          headers: { cookie: 'session=bob' },
        }),
      ])

      expect(alice).toContain('query-whoami: alice')
      expect(alice).not.toContain('query-whoami: bob')
      expect(bob).toContain('query-whoami: bob')
      expect(bob).not.toContain('query-whoami: alice')
    })
  })
} else {
  describe.skip('TanStack Query auto setup integration', () => {
    it('runs with NUXT_ENDPOINTS_E2E=1', () => {})
  })
}

function extractNuxtPayload(html: string): string {
  const match = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([^<]*)<\/script>/)
  if (!match?.[1]) {
    throw new Error('Nuxt SSR payload was not found')
  }

  return match[1]
}
