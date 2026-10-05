import { test, expect, type Page } from '@playwright/test'
import { webcrypto } from 'node:crypto'
import { installAppFixture } from './fixtures'

/**
 * Vault / privacy layer — fully mocked, on-device only.
 * Prefs and PIN records are seeded once per tab (sessionStorage marker) so a
 * reload behaves like a real reload instead of re-seeding.
 */

const PRIVACY_KEY = 'media-codex-privacy-v1'
const STORE_KEY = 'media-codex-store'

async function pinRecord(pin: string) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16))
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, key, 256))
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
  return { v: 1, alg: 'PBKDF2-SHA256', iter: 1000, salt: b64(salt), hash: b64(bits), len: pin.length }
}

async function seed(page: Page, prefs: Record<string, unknown> | null, extra: Record<string, string> = {}) {
  await installAppFixture(page)
  await page.addInitScript(
    ([key, value, more]) => {
      if (sessionStorage.getItem('__pv_seeded')) return
      sessionStorage.setItem('__pv_seeded', '1')
      if (value) localStorage.setItem(key as string, value as string)
      for (const [k, v] of Object.entries(more as Record<string, string>)) localStorage.setItem(k, v)
    },
    [PRIVACY_KEY, prefs ? JSON.stringify(prefs) : null, extra] as const
  )
}

const pad = (page: Page) => page.getByRole('group', { name: 'PIN keypad' })
async function typePin(page: Page, pin: string) {
  for (const digit of pin) await pad(page).getByRole('button', { name: digit, exact: true }).click()
}
const lockDialog = (page: Page) => page.getByRole('dialog', { name: /Enter your PIN|Locked for a moment/ })
const tile = (page: Page) => page.locator('[data-testid="video-tile"]').first()
/** The shortcut chunk loads lazily right after startup; wait until it is live. */
/**
 * Two real Escape presses. A heavily loaded CI box can stretch the gap past the 450 ms double-press
 * window, so retry until the expected screen is showing (data-privacy is set synchronously by the
 * handler, so reading it right after the presses is race-free).
 */
async function doubleEscape(page: Page, reached: (privacy: string | null) => boolean) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    if (reached(await page.evaluate(() => document.documentElement.getAttribute('data-privacy')))) return
  }
  throw new Error('double-Escape was never registered')
}
const toDecoy = (page: Page) => doubleEscape(page, (v) => v === 'decoy')
const fromDecoy = (page: Page) => doubleEscape(page, (v) => v !== 'decoy')
const decoyTitle = (page: Page) => page.getByRole('heading', { name: 'Notes', level: 1 })
const armed = (page: Page) => expect(page.locator('html')).toHaveAttribute('data-pv-armed', '')

test.describe('app lock', () => {
  test('set a PIN in Settings, lock on reload, wrong PIN is refused, right PIN restores the page', async ({ page }) => {
    await seed(page, null)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Privacy & Vault' })).toBeVisible()
    await page.getByRole('button', { name: 'Set PIN' }).click()
    await page.getByLabel('PIN (4–8 digits)').fill('4827')
    await page.getByLabel('Confirm PIN').fill('4827')
    await page.getByRole('button', { name: 'Set PIN' }).click()
    await expect(page.getByTestId('vault-summary')).toContainText('PIN on')

    // Only a hash is stored.
    const stored = await page.evaluate((k) => localStorage.getItem(k), PRIVACY_KEY)
    expect(stored).toContain('PBKDF2-SHA256')
    expect(stored).not.toContain('4827')

    await page.reload()
    await expect(lockDialog(page)).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe('/') // real URL is not left in the address bar while locked

    await typePin(page, '0000')
    await expect(page.getByText(/Incorrect PIN/)).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)

    await typePin(page, '4827')
    await expect(page.locator('#main-content')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/settings') // restored after unlock
  })

  test('nothing sensitive renders before unlock (no flash of content)', async ({ page }) => {
    await seed(page, { pin: await pinRecord('2468') })
    await page.addInitScript(() => {
      const w = window as unknown as { __seen: boolean }
      w.__seen = false
      new MutationObserver(() => {
        if (document.querySelector('#main-content, [data-testid="video-tile"], nav, aside')) w.__seen = true
      }).observe(document, { childList: true, subtree: true })
    })
    await page.goto('/media')
    await expect(lockDialog(page)).toBeVisible()
    await page.waitForTimeout(1200) // let live queries / lazy chunks settle
    expect(await page.evaluate(() => (window as unknown as { __seen: boolean }).__seen)).toBe(false)
    expect(await page.locator('img, video').count()).toBe(0)
    await typePin(page, '2468')
    await expect(tile(page)).toContainText('Studio signal')
    expect(await page.evaluate(() => (window as unknown as { __seen: boolean }).__seen)).toBe(true)
  })

  test('repeated wrong PINs trigger a persisted backoff, even the right PIN is refused during it', async ({ page }) => {
    await seed(page, { pin: await pinRecord('1357') })
    await page.goto('/media')
    for (let i = 0; i < 3; i += 1) {
      await typePin(page, '9999')
      await page.waitForTimeout(150)
    }
    await expect(page.getByRole('heading', { name: 'Locked for a moment' })).toBeVisible()
    await expect(pad(page).getByRole('button', { name: '1', exact: true })).toBeDisabled()
    const lockout = JSON.parse((await page.evaluate(() => localStorage.getItem('media-codex-lockout-v1'))) ?? '{}')
    expect(lockout.failures).toBe(3)
    expect(lockout.lockedUntil).toBeGreaterThan(Date.now())

    await page.reload() // the pause survives a reload
    await expect(page.getByRole('heading', { name: 'Locked for a moment' })).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)
  })

  test('forgot PIN erases everything, but only after the confirmation phrase', async ({ page }) => {
    await seed(page, { pin: await pinRecord('1357') }, { 'media-codex-test-marker': 'x', 'media-codex-progress-v1': '{"a":1}' })
    await page.goto('/media')
    await page.getByRole('button', { name: 'Forgot PIN?' }).click()
    const erase = page.getByRole('button', { name: 'Erase and start over' })
    await expect(erase).toBeDisabled()
    await page.getByLabel(/Type ERASE EVERYTHING/).fill('erase')
    await expect(erase).toBeDisabled()
    await page.getByLabel(/Type ERASE EVERYTHING/).fill('erase everything')
    await expect(erase).toBeEnabled()
    await erase.click()
    await expect(page.locator('#main-content')).toBeVisible() // no PIN any more: straight into the app
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => ['media-codex-test-marker', 'media-codex-progress-v1', 'media-codex-privacy-v1', 'media-codex-lockout-v1'].includes(k)))
    expect(left).toEqual([])
  })

  test('idle timeout and "hidden right away" lock the app', async ({ page }) => {
    await seed(page, { pin: await pinRecord('1357'), lockOnLoad: false, idleMinutes: 1, hiddenSeconds: 0 })
    await page.clock.install()
    await page.goto('/media')
    await expect(page.locator('#main-content')).toBeVisible()
    await armed(page)
    await expect(lockDialog(page)).toHaveCount(0)
    await page.clock.fastForward(61_000)
    await expect(lockDialog(page)).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)

    await typePin(page, '1357')
    await expect(page.locator('#main-content')).toBeVisible()
    await armed(page)
    // Tab hidden (hiddenSeconds: 0) locks immediately — before an app switcher can snapshot the page.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(lockDialog(page)).toBeVisible()
  })
})

test.describe('device unlock (WebAuthn)', () => {
  test('a user-verifying platform authenticator unlocks without the PIN; PIN stays the fallback', async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'virtual authenticator is driven over CDP on desktop')
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    await seed(page, { pin: await pinRecord('1357'), lockOnLoad: false })
    await page.goto('/settings')
    const toggle = page.getByRole('switch', { name: 'Unlock with this device' })
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    const stored = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PRIVACY_KEY))!)
    expect(stored.biometric.id.length).toBeGreaterThan(8)
    expect([-7, -257]).toContain(stored.biometric.alg)
    expect(stored.biometric.key).toBeTruthy() // public key kept locally to verify every assertion

    await page.getByRole('button', { name: 'Lock', exact: true }).click()
    await expect(lockDialog(page)).toBeVisible()
    const device = page.getByRole('button', { name: 'Unlock with this device' })
    await expect(device).toBeVisible()

    // Authenticator refuses user verification: stay locked, show the PIN fallback hint.
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false })
    await device.click()
    await expect(page.getByText(/Use your PIN/)).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)

    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true })
    await device.click()
    await expect(page.locator('#main-content')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/settings')

    // Removing the PIN also removes the device credential (it is only a shortcut to the PIN).
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByLabel('Current PIN').fill('1357')
    await page.getByRole('button', { name: 'Remove PIN' }).click()
    await expect(page.getByTestId('vault-summary')).toContainText('No PIN')
    const after = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PRIVACY_KEY))!)
    expect(after.pin).toBeNull()
    expect(after.biometric).toBeNull()
  })
})

test.describe('panic / quick-hide', () => {
  test('double-Escape swaps the whole UI for the decoy and double-Escape again restores it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcut')
    await seed(page, { panicEscape: true })
    await page.goto('/media')
    await expect(tile(page)).toContainText('Studio signal')
    await expect(page).toHaveTitle(/Media Codex/)
    await armed(page)

    await toDecoy(page)
    await expect(decoyTitle(page)).toBeVisible()
    await expect(page).toHaveTitle('Notes')
    await expect(page.locator('html')).toHaveAttribute('data-privacy', 'decoy')
    // Still in force after a reload (until revealed), so a refresh or a discarded tab cannot undo it.
    await page.reload()
    await expect(decoyTitle(page)).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)
    await armed(page)
    await expect(page.locator('#main-content, [data-testid="video-tile"]')).toHaveCount(0)
    expect(await page.locator('video, img').count()).toBe(0)
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/Studio|Library|Codex|18\+/i)

    await fromDecoy(page)
    await expect(tile(page)).toContainText('Studio signal')
    await expect(page).toHaveTitle(/Library.*Media Codex/)
    expect(new URL(page.url()).pathname).toBe('/media')
  })

  test('panic closes an open detail sheet, stops its video and leaves fullscreen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcut')
    await seed(page, { panicEscape: true })
    await page.goto('/media')
    await tile(page).click()
    await expect(page.locator('video').first()).toBeAttached()
    await armed(page)
    await page.evaluate(() => document.documentElement.requestFullscreen().catch(() => undefined))
    await toDecoy(page)
    await expect(decoyTitle(page)).toBeVisible()
    expect(await page.locator('video').count()).toBe(0)
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('video')).every((v) => v.paused))).toBe(true)
  })

  test('with a PIN set, revealing the decoy asks for the PIN', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcut')
    await seed(page, { panicEscape: true, pin: await pinRecord('7391'), lockOnLoad: false, disguise: 'calc' })
    await page.goto('/media')
    await expect(tile(page)).toBeVisible()
    await armed(page)
    await toDecoy(page)
    await expect(page.getByRole('group', { name: 'Calculator keys' })).toBeVisible()
    await expect(page).toHaveTitle('Calculator')
    // The calculator decoy really calculates.
    await page.getByRole('button', { name: '7', exact: true }).click()
    await page.getByRole('button', { name: '×', exact: true }).click()
    await page.getByRole('button', { name: '6', exact: true }).click()
    await page.getByRole('button', { name: '=', exact: true }).click()
    await expect(page.getByRole('status').or(page.locator('output'))).toContainText('42')

    await fromDecoy(page)
    await expect(lockDialog(page)).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)
    await typePin(page, '7391')
    await expect(tile(page)).toBeVisible()
  })

  test('hide button and three-finger tap work on touch; press-and-hold the decoy title to return', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch gesture')
    await seed(page, { panicButton: true, panicTouch: true })
    await page.goto('/media')
    await expect(tile(page)).toBeVisible()
    await armed(page)

    await page.getByRole('button', { name: 'Hide screen now' }).tap()
    await expect(decoyTitle(page)).toBeVisible()
    const title = decoyTitle(page)
    const box = (await title.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(900)
    await page.mouse.up()
    await expect(tile(page)).toBeVisible()

    await page.evaluate(() => {
      const touches = [0, 1, 2].map((i) => new Touch({ identifier: i, target: document.body, clientX: 80 + i * 60, clientY: 300 }))
      const fire = (type: string, list: Touch[]) => document.body.dispatchEvent(new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: touches, bubbles: true, cancelable: true }))
      fire('touchstart', touches)
      fire('touchend', [])
    })
    await expect(decoyTitle(page)).toBeVisible()
    await expect(page.locator('#main-content')).toHaveCount(0)
  })

  test('panic navigates the tab to the configured safe URL', async ({ page }) => {
    await page.route('https://safe.example.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Safe</title><h1>Safe page</h1>' }))
    await seed(page, { panicButton: true, safeUrl: 'https://safe.example.org/home' })
    await page.goto('/media')
    await expect(tile(page)).toBeVisible()
    await page.getByRole('button', { name: 'Hide screen now' }).click()
    await page.waitForURL('https://safe.example.org/home')
    await expect(page.getByRole('heading', { name: 'Safe page' })).toBeVisible()
  })

  test('the safe address is only used when it is a valid http(s) URL', async ({ page, isMobile }) => {
    test.skip(isMobile, 'covered on desktop')
    await seed(page, null)
    await page.goto('/settings')
    const input = page.getByLabel('Safe address')
    await input.fill('javascript:alert(1)')
    await input.blur()
    await expect(page.getByRole('alert')).toContainText('valid')
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PRIVACY_KEY)) ?? '{}').safeUrl ?? '').toBe('')
    await input.fill('example.org/weather')
    await input.blur()
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PRIVACY_KEY))!).safeUrl).toBe('https://example.org/weather')
  })
})

test.describe('disguise', () => {
  test('picking a disguise changes title, favicon, theme color and a neutral manifest; turning it off restores the brand', async ({ page }) => {
    await seed(page, null)
    await page.goto('/settings')
    await expect(page).toHaveTitle(/Settings — Media Codex/)
    await page.getByRole('group', { name: 'Disguise' }).getByRole('button', { name: /Calculator/ }).click()

    await expect(page).toHaveTitle('Calculator')
    await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute('href', /^data:image\/svg\+xml/)
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#1c1c1e')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Calc')
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /^blob:/)
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /^data:image\/png/)

    const manifest = await page.evaluate(async () => {
      const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href
      const text = await (await fetch(href)).text()
      return { text, json: JSON.parse(text) }
    })
    expect(manifest.json.name).toBe('Calculator')
    expect(manifest.json.short_name).toBe('Calc')
    expect(manifest.text).not.toMatch(/codex|media|share_target|shortcuts/i)
    expect(manifest.json.icons.length).toBeGreaterThan(0)

    // Survives a reload and other pages that set their own titles.
    await page.goto('/search')
    await expect(page).toHaveTitle('Calculator')
    await page.goto('/settings')
    await expect(page).toHaveTitle('Calculator')

    await page.getByRole('group', { name: 'Disguise' }).getByRole('button', { name: /Media Codex/ }).click()
    await expect(page).toHaveTitle(/Settings — Media Codex/)
    await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute('href', '/favicon.svg')
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Media Codex')
  })

  test('while locked the tab shows a neutral identity even without a disguise', async ({ page }) => {
    await seed(page, { pin: await pinRecord('1357') })
    await page.goto('/media')
    await expect(lockDialog(page)).toBeVisible()
    await expect(page).toHaveTitle('Notes')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Notes')
    await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute('href', /^data:image\/svg\+xml/)
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/Codex|adult|18\+/i)
    await typePin(page, '1357')
    await expect(page).toHaveTitle(/Media Codex/)
  })
})

test.describe('incognito', () => {
  async function recordWrites(page: Page) {
    await page.addInitScript(() => {
      const w = window as unknown as { __writes: string[] }
      w.__writes = []
      const real = Storage.prototype.setItem
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (this === localStorage) w.__writes.push(key)
        return real.call(this, key, value)
      }
    })
  }
  const storeHistory = (page: Page) =>
    page.evaluate((k) => {
      const raw = localStorage.getItem(k)
      const state = raw ? JSON.parse(raw).state : {}
      return { viewed: state.recentlyViewed ?? [], keys: Object.keys(localStorage).filter((x) => x.startsWith('media-codex')) }
    }, STORE_KEY)

  async function viewAndSearch(page: Page) {
    await page.goto('/media')
    const detail = page.getByRole('dialog', { name: /Studio signal/ })
    await expect(async () => {
      if (!(await detail.isVisible())) await tile(page).click() // a click can land on a card still animating in
      await expect(detail).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
    await page.waitForTimeout(500)
    await page.goto('/search')
    const search = page.getByPlaceholder('Search — or filter: tag:jock')
    await search.fill('Studio signal')
    await search.press('Enter')
    await page.waitForTimeout(700)
  }

  test('control: without incognito, viewing and searching are recorded', async ({ page }) => {
    test.slow() // several full page loads
    await recordWrites(page)
    await seed(page, null)
    await viewAndSearch(page)
    // Recording is asynchronous (debounced writes): poll instead of sleeping.
    await expect.poll(async () => (await storeHistory(page)).viewed, { timeout: 10_000 }).toContain('rg-signal-studio')
    await expect
      .poll(async () => (await storeHistory(page)).keys.some((k) => k === 'media-codex-taste-v1' || k === 'media-codex-ai-recent-v1'), { timeout: 10_000 })
      .toBe(true)
  })

  test('incognito: no history keys are written and recently viewed stays empty; leaving it resumes recording', async ({ page }) => {
    test.slow() // several full page loads
    await recordWrites(page)
    await seed(page, null)
    await page.goto('/settings')
    await page.getByRole('switch', { name: 'Incognito session' }).click()
    await expect(page.getByRole('switch', { name: 'Incognito session' })).toHaveAttribute('aria-checked', 'true')
    expect(await page.evaluate(() => sessionStorage.getItem('media-codex-incognito-v1'))).toBe('1')

    await viewAndSearch(page) // full reloads in between: incognito survives them (same tab)
    const { viewed, keys } = await storeHistory(page)
    expect(viewed).not.toContain('rg-signal-studio')
    for (const key of ['media-codex-progress-v1', 'media-codex-taste-v1', 'media-codex-ai-recent-v1', 'media-codex-concierge-v1']) expect(keys, key).not.toContain(key)
    const attempted = await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)
    expect(attempted.filter((k) => /progress|taste|ai-recent|concierge/.test(k))).toEqual([])

    // Turn it off: the app reloads and normal recording resumes.
    await page.goto('/settings')
    // Incognito must still be on after all those full page loads in the same tab.
    await expect(page.getByRole('switch', { name: 'Incognito session' })).toHaveAttribute('aria-checked', 'true')
    expect(await page.evaluate(() => sessionStorage.getItem('media-codex-incognito-v1'))).toBe('1')
    const reloaded = page.waitForEvent('load') // turning it off reloads the app
    await page.getByRole('switch', { name: 'Incognito session' }).click()
    await reloaded
    await expect(page.getByRole('switch', { name: 'Incognito session' })).toHaveAttribute('aria-checked', 'false')
    expect(await page.evaluate(() => sessionStorage.getItem('media-codex-incognito-v1'))).toBeNull()
    await viewAndSearch(page)
    await expect.poll(async () => (await storeHistory(page)).viewed, { timeout: 10_000 }).toContain('rg-signal-studio')
  })
})

test.describe('clear everything', () => {
  test('wipes media-codex storage, IndexedDB and Cache Storage, then reloads', async ({ page }) => {
    test.slow() // several full page loads
    await seed(page, { disguise: 'notes' }, { 'media-codex-progress-v1': '{"x":1}', 'media-codex-collections-v1': '[]', 'media-codex-test-marker': '1' })
    await page.goto('/settings')
    await page.evaluate(async () => {
      sessionStorage.setItem('media-codex-session-marker', '1')
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('media-codex-test-db', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('s')
        request.onsuccess = () => { request.result.close(); resolve() }
        request.onerror = () => reject(request.error)
      })
      await (await caches.open('media-codex-shell-v5')).put('/x', new Response('x'))
      await (await caches.open('some-other-cache')).put('/y', new Response('y'))
    })
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toContain('media-codex-test-db')

    const clear = page.getByRole('button', { name: 'Clear everything now' })
    await clear.click() // first tap only arms it
    await expect(page.getByRole('button', { name: 'Tap again to erase' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('media-codex-test-marker'))).toBe('1')
    const reloaded = page.waitForURL('**/media')
    await page.getByRole('button', { name: 'Tap again to erase' }).click()
    await reloaded
    await expect(page.locator('#main-content')).toBeVisible()

    const left = await page.evaluate(async () => ({
      local: Object.keys(localStorage).filter((k) => ['media-codex-test-marker', 'media-codex-progress-v1', 'media-codex-collections-v1', 'media-codex-privacy-v1'].includes(k)),
      session: sessionStorage.getItem('media-codex-session-marker'),
      dbs: (await indexedDB.databases()).map((d) => d.name),
      caches: await caches.keys(),
    }))
    expect(left.local).toEqual([])
    expect(left.session).toBeNull()
    expect(left.dbs).toEqual([])
    expect(left.caches).toEqual([])
    await expect(page).toHaveTitle(/Media Codex/) // disguise preference is gone with everything else
  })
})

test.describe('screen guard', () => {
  test('blur thumbnails until hovered (desktop) or tapped (touch)', async ({ page, isMobile }) => {
    await seed(page, { blurThumbs: true })
    await page.goto('/media')
    await expect(tile(page)).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-pv-blur', '')
    const img = tile(page).locator('img').first()
    await expect(img).toBeAttached()
    const filter = () => img.evaluate((el) => { const s = getComputedStyle(el); return `${s.filter}|${s.opacity}` })
    await expect.poll(filter).toMatch(/blur|\|0\.07/)

    if (isMobile) {
      await img.tap() // first tap reveals, does not open
      await expect(img).toHaveAttribute('data-pv-show', '')
      await expect.poll(filter).not.toMatch(/blur/)
    } else {
      await tile(page).hover()
      await expect.poll(filter).toMatch(/^none\|1$/)
    }
  })

  test('blur-on-switch-away veils the app when the window loses focus', async ({ page }) => {
    await seed(page, { blurAway: true })
    await page.goto('/media')
    await expect(tile(page)).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-pv-away', '')
    await page.evaluate(() => {
      document.hasFocus = () => false
      window.dispatchEvent(new Event('blur'))
    })
    await expect(page.locator('html')).toHaveAttribute('data-pv-away', '')
    await page.evaluate(() => {
      document.hasFocus = () => true
      window.dispatchEvent(new Event('focus'))
    })
    await expect(page.locator('html')).not.toHaveAttribute('data-pv-away', '')
  })

  test('nothing is added to the page when no vault option is enabled', async ({ page }) => {
    await seed(page, null)
    await page.goto('/media')
    await expect(tile(page)).toBeVisible()
    const attrs = await page.evaluate(() => ({ privacy: document.documentElement.hasAttribute('data-privacy'), blur: document.documentElement.hasAttribute('data-pv-blur'), away: document.documentElement.hasAttribute('data-pv-away'), hide: !!document.querySelector('.pv-hide') }))
    expect(attrs).toEqual({ privacy: false, blur: false, away: false, hide: false })
    await expect(page).toHaveTitle(/Media Codex/)
  })
})
