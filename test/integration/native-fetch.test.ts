import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

if (process.env.NUXT_ENDPOINTS_NATIVE_E2E === '1') {
  const { $fetch, setup, createPage } = await import('@nuxt/test-utils/e2e')
  describe('Nuxt native fetch', async () => {
    const expected = {
      collisionRejected: true,
      sameFunctions: true,
      available: true,
      error: 'user_not_found',
      raw: 'user_not_found',
      rejected: true,
    }
    await setup({
      rootDir: fileURLToPath(new URL('../fixtures/native-fetch', import.meta.url)),
      browser: true,
      browserOptions: { type: 'chromium', launch: { channel: 'chromium' } },
    })
    it('uses Nuxt’s own functions and preserves success, AsyncData errors, raw responses and rejections', async () => {
      const html = await $fetch<string>('/')
      expect(html).toContain(JSON.stringify(expected).replaceAll('"', '&quot;'))
    })
    it('preserves the same behavior when refreshing in a hydrated browser', async () => {
      const page = await createPage('/')
      try {
        await page.getByRole('button', { name: 'Refresh' }).click()
        const result = page.locator('#result[data-refreshed="true"]')
        expect(JSON.parse(await result.innerText())).toEqual(expected)
      } finally {
        await page.close()
      }
    })
  })
} else {
  it.skip('Nuxt 4.6 native fetch integration', () => {})
}
