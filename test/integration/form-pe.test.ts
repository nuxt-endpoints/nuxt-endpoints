import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Covers docs/progressive-enhancement.md end to end: the bridge middleware the
// module registers, and the `useEndpointForm` projection the page renders.
//
// A native submission is driven directly rather than through a browser, because
// what identifies one is a pair of request headers a browser sets on a
// navigation - `Sec-Fetch-Mode: navigate` and an HTML `Accept`. Driving those
// from `fetch` tests exactly what the bridge branches on. The enhanced path
// needs real JavaScript, so it lives in the browser-gated block below.
const playgroundRoot = fileURLToPath(new URL('../../playground', import.meta.url))
const browserE2E = process.env.NUXT_ENDPOINTS_BROWSER_E2E === '1'
const browserFlowTimeout = 120000

const navigation = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'sec-fetch-mode': 'navigate',
}

if (process.env.NUXT_ENDPOINTS_E2E === '1') {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuxt-endpoints-form-pe-'))
  process.env.NUXT_PLAYGROUND_DATABASE_PATH = join(temporaryDirectory, 'playground.sqlite')

  const { createPage, fetch, setup } = await import('@nuxt/test-utils/e2e')

  describe('progressive enhancement', async () => {
    await setup({
      rootDir: playgroundRoot,
      browser: browserE2E,
      server: true,
      port: Number(process.env.NUXT_ENDPOINTS_FORM_PE_E2E_PORT || 53494),
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

    it('renders the contract as HTML constraints on the fallback form', async () => {
      // The first validation layer: the browser enforces these with no
      // JavaScript at all, and they came from the endpoint's own schema rather
      // than being written twice.
      const html = await fetch('/form-pe').then((response) => response.text())

      expect(html).toContain('name="name"')
      expect(html).toContain('required')
      expect(html).toContain('minlength="1"')
      // `age` is an optional integer, so it carries a step but no requirement,
      // and none of Zod's safe-integer bounds.
      expect(html).toContain('name="age"')
      expect(html).not.toContain('9007199254740991')
    })

    it('renders the form element from the declaration, not from the template', async () => {
      // `action`, `method` and `enctype` come from `useEndpointForm`, so a page cannot
      // post somewhere the endpoint never declared.
      const html = await fetch('/form-pe').then((response) => response.text())

      expect(html).toContain('action="/form-pe"')
      expect(html).toContain('method="post"')
      expect(html).toContain('enctype="application/x-www-form-urlencoded"')
    })

    it('derives file input attributes from the schema that validates the file', async () => {
      const html = await fetch('/form-pe/upload').then((response) => response.text())

      expect(html).toContain('enctype="multipart/form-data"')
      expect(html).toContain('name="attachment"')
      expect(html).toContain('type="file"')
      expect(html).toContain('accept="text/plain"')
      // `.max(80)` on the name, declared once on the endpoint.
      expect(html).toContain('maxlength="80"')
    })

    it('answers a successful native submission with 303 to the declared target', async () => {
      const response = await fetch('/form-pe', {
        method: 'POST',
        redirect: 'manual',
        headers: { ...navigation, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'Ada', age: '36' }).toString(),
      })

      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe('/form-pe?created=101')
    })

    it('lets the endpoint coerce its own declared form encoding', async () => {
      // The bridge forwards the body untouched, so a 303 proves the endpoint's
      // own `application/x-www-form-urlencoded` member accepted `"45"` for a
      // field declared as an integer.
      const accepted = await fetch('/form-pe', {
        method: 'POST',
        redirect: 'manual',
        headers: { ...navigation, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'Grace', age: '45' }).toString(),
      })
      expect(accepted.status).toBe(303)

      // An empty numeric input means "not provided" rather than `NaN`, and the
      // field is optional, so this must still succeed.
      const omitted = await fetch('/form-pe', {
        method: 'POST',
        redirect: 'manual',
        headers: { ...navigation, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'Grace', age: '' }).toString(),
      })
      expect(omitted.status).toBe(303)
    })

    it('keeps the endpoint callable with a form encoding and no bridge', async () => {
      // The point of declaring the encoding rather than converting it: an
      // ordinary HTTP client posting a form body straight to the endpoint is
      // accepted, so the bridge is not load-bearing.
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ name: 'Ada', age: '36' }).toString(),
      })

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toEqual({ id: 101, name: 'Ada', age: 36 })
    })

    it('documents both request encodings in the OpenAPI document', async () => {
      const schema = await (await fetch('/_endpoints/schema')).json()
      const content = schema.paths['/api/users'].post.requestBody.content

      expect(Object.keys(content).sort()).toEqual([
        'application/json',
        'application/x-www-form-urlencoded',
      ])
    })

    it('renders the page with issues and submitted values in the same request', async () => {
      const response = await fetch('/form-pe', {
        method: 'POST',
        redirect: 'manual',
        headers: { ...navigation, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: '', age: '36' }).toString(),
      })

      // No redirect: this response *is* the page, so nothing had to be carried
      // across a second request.
      expect(response.status).toBe(400)
      expect(response.headers.get('content-type')).toContain('text/html')

      const html = await response.text()
      expect(html).toContain('Native form, no JavaScript')
      expect(html).toContain('data-testid="issues"')
      expect(html).toContain('Rejected with 400')
      // The value the user typed is redisplayed.
      expect(html).toContain('value="36"')
    })

    it('leaves an ordinary fetch call untouched', async () => {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada', age: 36 }),
      })

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toEqual({ id: 101, name: 'Ada', age: 36 })
    })

    it('does not intercept a POST to the page URL that asks for JSON', async () => {
      const response = await fetch('/form-pe', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ name: 'Ada' }).toString(),
      })

      expect(response.status).not.toBe(303)
    })

    it('forwards multipart bodies and cookies through the internal call', async () => {
      const body = new FormData()
      body.set('name', 'Katherine')
      body.set('attachment', new File(['hello world'], 'note.txt', { type: 'text/plain' }))

      const response = await fetch('/form-pe/upload', {
        method: 'POST',
        redirect: 'manual',
        headers: { ...navigation, cookie: 'pe-session=alice' },
        body,
      })

      expect(response.status).toBe(303)
      const location = response.headers.get('location') ?? ''
      expect(location).toContain('stored=Katherine')
      // The file arrived intact...
      expect(location).toContain('size=11')
      // ...and so did the credential, which no header copies for you.
      expect(location).toContain('session=alice')
    })

    it('reports a rejected upload on the upload page itself', async () => {
      const body = new FormData()
      body.set('name', '')
      body.set('attachment', new File(['hello'], 'note.txt', { type: 'text/plain' }))

      const response = await fetch('/form-pe/upload', {
        method: 'POST',
        redirect: 'manual',
        headers: { ...navigation, cookie: 'pe-session=alice' },
        body,
      })

      expect(response.status).toBe(400)
      const html = await response.text()
      expect(html).toContain('Native file upload, no JavaScript')
      expect(html).toContain('data-testid="issues"')
      // The name survived the round trip even though the file could not: a
      // browser refuses to let a page set the value of `<input type="file">`.
      expect(html).not.toContain('data-testid="stored"')
    })

    // The enhanced path needs a real event loop and a real `submit` event, so
    // it is gated the same way the other browser flows are - see
    // test/integration/playground.test.ts.
    const describeBrowser = browserE2E ? describe : describe.skip
    describeBrowser('enhanced path (NUXT_ENDPOINTS_BROWSER_E2E=1)', () => {
      it(
        'submits without navigating and renders the endpoint issues in place',
        async () => {
          const page = await createPage('/form-pe')
          await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)

          // A single space passes `minlength="1"`, so the browser submits it
          // and only the endpoint's own refinement can reject it - the third
          // validation layer, reached without the page knowing about it.
          await page.locator('input[name="name"]').fill(' ')
          await page.locator('button[type="submit"]').click()

          await page.locator('[data-testid="issues"]').waitFor()
          await expect(page.locator('[data-testid="failed"]').textContent()).resolves.toContain(
            'Rejected with 400',
          )
          // No navigation happened: still the same URL, and no 303 was followed.
          expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/form-pe')
          // What was typed is still in the field, because nothing re-rendered.
          await expect(page.locator('input[name="name"]').inputValue()).resolves.toBe(' ')

          await page.close()
        },
        browserFlowTimeout,
      )

      it(
        'navigates to the declared target after a successful submission',
        async () => {
          const page = await createPage('/form-pe')
          await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)

          await page.locator('input[name="name"]').fill('Ada')
          await page.locator('input[name="age"]').fill('36')
          await page.locator('button[type="submit"]').click()

          await page.locator('[data-testid="created"]').waitFor()
          // The same target the native path is sent to by the `303`, resolved
          // from the same declaration.
          expect(new URL(page.url()).search).toBe('?created=101')

          await page.close()
        },
        browserFlowTimeout,
      )
    })
  })
} else {
  describe.skip('progressive enhancement bridge', () => {
    it('runs with NUXT_ENDPOINTS_E2E=1', () => {})
  })
}
