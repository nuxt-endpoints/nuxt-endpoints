import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fixtureRoot = fileURLToPath(new URL('../fixtures/query-auto', import.meta.url))

if (process.env.NUXT_ENDPOINTS_E2E === '1') {
  const { $fetch, setup } = await import('@nuxt/test-utils/e2e')

  describe('Pinia Colada Nuxt integration', async () => {
    await setup({
      rootDir: fixtureRoot,
      browser: false,
      server: true,
      port: Number(process.env.NUXT_ENDPOINTS_QUERY_AUTO_E2E_PORT || 53492),
      setupTimeout: 120000,
    })

    it('renders and serializes query data during SSR', async () => {
      const html = await $fetch<string>('/query-user')
      const payload = extractNuxtPayload(html)

      expect(html).toContain('query-user: Tom')
      expect(payload).toContain('\\u002Fapi\\u002Fusers\\u002F:id')
      expect(payload).toContain('Tom')
    })

    it('executes mutation options through Pinia Colada and pins the idempotency key', async () => {
      const html = await $fetch<string>('/mutation-idempotent')

      const first = html.match(/mutation-first: ([^<]+)/)?.[1]
      const second = html.match(/mutation-second: ([^<]+)/)?.[1]

      expect(html).toContain('mutation-key: nuxt-endpoints v2 post /api/idempotent')
      expect(html).toContain('mutation-state: success')
      expect(first).toMatch(/^201:\d+:25$/)
      expect(second).toBe(first)
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
  describe.skip('Pinia Colada Nuxt integration', () => {
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
