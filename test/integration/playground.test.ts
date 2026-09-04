import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const playgroundRoot = fileURLToPath(new URL('../../playground', import.meta.url))
const browserE2E = process.env.NUXT_ENDPOINTS_BROWSER_E2E === '1'

// Each browser flow drives a dozen or more real round trips through Chromium,
// so Vitest's 5s default expires mid-scenario rather than on a real failure.
const browserFlowTimeout = 120000

if (process.env.NUXT_ENDPOINTS_E2E === '1') {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuxt-endpoints-playground-'))
  process.env.NUXT_PLAYGROUND_DATABASE_PATH = join(temporaryDirectory, 'playground.sqlite')

  const { $fetch, createPage, fetch, setup } = await import('@nuxt/test-utils/e2e')

  describe('SQLite and Pinia Colada playground integration', async () => {
    await setup({
      rootDir: playgroundRoot,
      browser: browserE2E,
      server: true,
      port: Number(process.env.NUXT_ENDPOINTS_PLAYGROUND_E2E_PORT || 53493),
      setupTimeout: 120000,
      ...(browserE2E
        ? {
            browserOptions: {
              type: 'chromium' as const,
              launch: {
                headless: true,
                executablePath: process.env.NUXT_ENDPOINTS_BROWSER_EXECUTABLE_PATH,
              },
            },
          }
        : {}),
    })

    afterAll(() => {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    })

    it('SSR-renders and hydrates the SQLite-backed Pinia Colada query', async () => {
      const indexHtml = await $fetch<string>('/')
      const endpointsHtml = await $fetch<string>('/endpoints')
      const html = await $fetch<string>('/sqlite-colada')

      expect(indexHtml).toContain('Choose a focused demo')
      expect(indexHtml).toContain('href="/sqlite-colada"')
      expect(endpointsHtml).toContain('HTTP contract inspector')
      expect(endpointsHtml).toContain('Guided scenarios')
      expect(endpointsHtml).toContain('Server')
      expect(endpointsHtml).toContain('Runtime exchange')
      expect(endpointsHtml).toContain('$endpoint(&#39;/api/users&#39;)')
      expect(endpointsHtml).toContain('Choose what you want to verify')
      expect(endpointsHtml).toContain('What to confirm')
      expect(endpointsHtml).toContain('x-client-version')
      expect(endpointsHtml).toContain('400 Validation Error')
      expect(html).toContain('SQLite + Pinia Colada')
      expect(html).toContain('Ada Lovelace')
      expect(html).toContain('Grace Hopper')
      expect(html).toContain('\\u002Fapi\\u002Fsqlite\\u002Fusers')
    })

    it('demonstrates typed headers and declared HTTP response statuses', async () => {
      const success = await fetch('/api/users/1?includeAge=true', {
        headers: { 'x-client-version': 'integration/1.0' },
      })
      const secondUser = await fetch('/api/users/2?includeAge=true', {
        headers: { 'x-client-version': 'integration/1.0' },
      })
      const notFound = await fetch('/api/users/999?includeAge=true', {
        headers: { 'x-client-version': 'integration/1.0' },
      })
      const missingHeader = await fetch('/api/users/1?includeAge=true')

      expect(success.status).toBe(200)
      await expect(success.json()).resolves.toMatchObject({
        id: 1,
        name: 'Tom',
        clientVersion: 'integration/1.0',
      })
      expect(secondUser.status).toBe(200)
      await expect(secondUser.json()).resolves.toMatchObject({
        id: 2,
        name: 'Jane',
        clientVersion: 'integration/1.0',
      })
      expect(notFound.status).toBe(404)
      await expect(notFound.json()).resolves.toEqual({ message: 'User not found' })
      expect(missingHeader.status).toBe(400)
      const missingHeaderBody = await missingHeader.json()
      expect(missingHeaderBody).toMatchObject({
        statusMessage: 'Validation Error',
      })
      expect(missingHeaderBody).not.toHaveProperty('stack')
      expect(missingHeaderBody).not.toHaveProperty('url')
    })

    it('keeps every try-it-yourself claim observable at runtime', async () => {
      const created = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada', age: 36 }),
      })
      const invalidCreate = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '', age: -1 }),
      })
      const search = await fetch('/api/users/search?q=ja&limit=1')
      const invalidSearch = await fetch('/api/users/search?q=ja&limit=11')
      const legacy = await fetch('/api/legacy-stats')
      const schema = await $fetch<Record<string, any>>('/_endpoints/schema')

      expect(created.status).toBe(201)
      await expect(created.json()).resolves.toEqual({
        id: 'Ada Lovelace/42',
        name: 'Ada',
        age: 36,
      })
      expect(invalidCreate.status).toBe(400)
      const invalidCreateBody = await invalidCreate.json()
      expect(invalidCreateBody).toMatchObject({
        statusMessage: 'Validation Error',
      })
      expect(invalidCreateBody).not.toHaveProperty('stack')

      expect(search.status).toBe(200)
      await expect(search.json()).resolves.toEqual({
        items: [{ id: 2, name: 'Jane' }],
        total: 2,
      })
      expect(invalidSearch.status).toBe(400)
      const invalidSearchBody = await invalidSearch.json()
      expect(invalidSearchBody).toMatchObject({
        statusMessage: 'Validation Error',
        data: {
          query: [
            {
              type: 'max_value',
              input: 11,
              requirement: 10,
              path: ['limit'],
              code: 'max_value',
            },
          ],
        },
      })
      expect(invalidSearchBody).not.toHaveProperty('stack')

      expect(legacy.status).toBe(200)
      await expect(legacy.json()).resolves.toMatchObject({ totalUsers: 4 })
      expect(schema.paths).toHaveProperty('/api/users')
      expect(schema.paths).not.toHaveProperty('/api/legacy-stats')
    })

    it('replays one completed POST and rejects a changed fingerprint', async () => {
      const request = (name: string) =>
        fetch('/api/sqlite/users', {
          method: 'POST',
          body: JSON.stringify({ name }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'playground-integration-request',
          },
        })

      const first = await request('Katherine Johnson')
      const replay = await request('Katherine Johnson')
      const conflict = await request('Changed payload')
      const users = await $fetch<{ items: Array<{ id: number; name: string }> }>(
        '/api/sqlite/users',
      )

      expect(first.status).toBe(201)
      expect(replay.status).toBe(201)
      expect(conflict.status).toBe(422)
      await expect(first.json()).resolves.toEqual(await replay.json())
      await expect(conflict.json()).resolves.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      })
      expect(users.items.filter(({ name }) => name === 'Katherine Johnson')).toHaveLength(1)
      expect(users.items).toHaveLength(3)
    })

    // Grouped and gated by `describe`/`describe.skip` rather than a bare `if`,
    // so a run without NUXT_ENDPOINTS_BROWSER_E2E=1 reports these as skipped
    // instead of making them vanish from the reporter entirely - the same
    // reason the outer NUXT_ENDPOINTS_E2E gate has a skipped placeholder.
    const describeBrowser = browserE2E ? describe : describe.skip
    describeBrowser('browser flows (NUXT_ENDPOINTS_BROWSER_E2E=1)', () => {
      it(
        'runs the status-aware HTTP contract inspector',
        async () => {
          const page = await createPage('/endpoints')

          await page.getByRole('button', { name: 'Run 404 Not Found scenario' }).click()
          await page.getByRole('status').filter({ hasText: '404 Not Found' }).waitFor()

          const responseStage = page.getByRole('article').filter({ hasText: 'HTTP response' })
          await expect(responseStage.locator('pre').textContent()).resolves.toContain(
            'User not found',
          )

          await page.getByRole('button', { name: 'Run 201 Created scenario' }).click()
          await page.getByRole('status').filter({ hasText: '201 Created' }).waitFor()
          await expect(responseStage.locator('pre').textContent()).resolves.toContain(
            '"name": "Sid"',
          )

          await page.getByRole('button', { name: 'Run 400 Validation Error scenario' }).click()
          await page.getByRole('status').filter({ hasText: '400 Validation Error' }).waitFor()
          await expect(responseStage.locator('pre').textContent()).resolves.toContain('max_value')
          await expect(responseStage.locator('pre').textContent()).resolves.not.toContain('stack')

          await page.close()
        },
        browserFlowTimeout,
      )

      it(
        'keeps the selected request, guidance, form, and result together',
        async () => {
          const page = await createPage('/endpoints')
          const inspector = page.getByRole('region', { name: 'HTTP contract inspector' })
          const tryItYourself = page.getByRole('region', {
            name: 'Choose what you want to verify',
          })
          const exercise = page.getByRole('article', { name: 'Request form' })
          const output = page.getByRole('article', { name: 'Request result' })
          const sectionStyles = async (locator: typeof inspector) =>
            locator.evaluate((element) => {
              const style = getComputedStyle(element)
              return {
                borderTopWidth: style.borderTopWidth,
                borderRadius: style.borderRadius,
                backgroundColor: style.backgroundColor,
                paddingTop: style.paddingTop,
              }
            })
          const exerciseBox = await exercise.boundingBox()
          const outputBox = await output.boundingBox()

          await expect(sectionStyles(tryItYourself)).resolves.toEqual(
            await sectionStyles(inspector),
          )
          expect(exerciseBox).not.toBeNull()
          expect(outputBox).not.toBeNull()
          expect(Math.abs(exerciseBox!.y - outputBox!.y)).toBeLessThan(8)
          expect(outputBox!.x).toBeGreaterThan(exerciseBox!.x)

          await page.getByLabel('User ID').fill('1')
          await page.getByRole('button', { name: 'Fetch user' }).click()
          await output.getByRole('status').filter({ hasText: 'success' }).waitFor()
          await expect(output.locator('pre').textContent()).resolves.toContain('"name": "Tom"')

          await page.getByLabel('User ID').fill('999')
          await page.getByRole('button', { name: 'Fetch user' }).click()
          await output.getByRole('status').filter({ hasText: 'error' }).waitFor()
          await expect(output.locator('pre').textContent()).resolves.toContain('"status": 404')

          await page.getByRole('button', { name: /api\/users\/search/ }).click()
          await expect(exercise.textContent()).resolves.toContain(
            'Valibot transforms the query string',
          )
          await expect(output.locator('pre').textContent()).resolves.toContain(
            'Run the selected request',
          )

          await page.getByRole('button', { name: /\$endpoint\('\/api\/users'\)/ }).click()
          await page.getByLabel('Name').fill('')
          await page.getByLabel('Age').fill('-1')
          await page.getByRole('button', { name: 'Create user' }).click()
          await output.getByRole('status').filter({ hasText: 'error' }).waitFor()
          await expect(output.locator('pre').textContent()).resolves.toContain('"status": 400')

          await page.getByLabel('Name').fill('Ada')
          await page.getByLabel('Age').fill('36')
          await page.getByRole('button', { name: 'Create user' }).click()
          await output.getByRole('status').filter({ hasText: 'success' }).waitFor()
          await expect(output.locator('pre').textContent()).resolves.toContain('"status": 201')

          await page.getByRole('button', { name: /api\/users\/search/ }).click()
          await page.getByLabel('Query').fill('ja')
          await page.getByLabel('Limit').fill('1')
          await page.getByRole('button', { name: 'Search users' }).click()
          await output.getByRole('status').filter({ hasText: 'success' }).waitFor()
          await expect(output.locator('pre').textContent()).resolves.toContain('"total": 2')

          await page.getByLabel('Limit').fill('11')
          await page.getByRole('button', { name: 'Search users' }).click()
          await output.getByRole('status').filter({ hasText: 'error' }).waitFor()
          await expect(output.locator('pre').textContent()).resolves.toContain('"status": 400')

          await page.getByRole('button', { name: /plain \$fetch/ }).click()
          await page.getByRole('button', { name: 'Fetch legacy stats' }).click()
          await output.getByRole('status').filter({ hasText: 'success' }).waitFor()
          await expect(output.locator('pre').textContent()).resolves.toContain('"totalUsers": 4')

          await page.close()
        },
        browserFlowTimeout,
      )

      it(
        'hydrates Pinia Colada, invalidates after a mutation, and replays without another row',
        async () => {
          const page = await createPage('/sqlite-colada')
          const input = page.getByLabel('New SQLite user')
          const users = page.getByRole('list', { name: 'SQLite users' }).getByRole('listitem')
          const initialCount = await users.count()

          await input.fill('Dorothy Vaughan')
          await page.getByRole('button', { name: 'Add with a new idempotency key' }).click()
          await page.getByText('Dorothy Vaughan', { exact: true }).waitFor()

          expect(await users.count()).toBe(initialCount + 1)

          await input.fill('Keep this draft')
          await page.getByRole('button', { name: 'Replay the same POST' }).click()
          await page.getByText('The completed response was replayed', { exact: false }).waitFor()

          expect(await input.inputValue()).toBe('Keep this draft')
          expect(await users.count()).toBe(initialCount + 1)

          await page.close()
        },
        browserFlowTimeout,
      )
    })
  })
} else {
  describe.skip('SQLite and Pinia Colada playground integration', () => {
    it('runs with NUXT_ENDPOINTS_E2E=1', () => {})
  })
}
