/**
 * Disguise (lazy half): generated icons, the neutral web-app manifest and the
 * DOM surfaces that depend on them (favicon, touch icon, theme color, manifest
 * link). The tab title lives in identity.ts so it can never flash.
 *
 * Pure builders (icons, manifest) are unit-tested; the DOM part is idempotent
 * and reversible.
 *
 * Limits worth knowing: a home-screen shortcut that was installed *before*
 * enabling a disguise keeps its old name and icon (the OS owns that copy);
 * install after choosing a disguise. iOS Safari reads the apple-touch-icon and
 * apple-mobile-web-app-title; Chromium reads the generated manifest.
 */

import type { DisguiseId } from './prefs.ts'
import { DISGUISES, type ActiveDisguise } from './disguiseSpec.ts'

export { DISGUISES, isActiveDisguise, type ActiveDisguise, type DisguiseSpec } from './disguiseSpec.ts'

/** Simple generated SVG icon (512x512 viewBox). `rounded` adds the corner radius for favicons. */
export function iconSvg(id: ActiveDisguise, rounded = true): string {
  const rx = rounded ? 112 : 0
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
  if (id === 'notes') {
    const lines = [212, 262, 312, 362].map((y) => `<rect x="168" y="${y}" width="176" height="14" rx="7" fill="#d6d1c2"/>`).join('')
    return `${head}<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#f7c928"/></linearGradient></defs><rect width="512" height="512" rx="${rx}" fill="url(#g)"/><rect x="128" y="104" width="256" height="312" rx="28" fill="#fffdf4"/><rect x="128" y="104" width="256" height="64" rx="28" fill="#f2b705"/><rect x="128" y="140" width="256" height="28" fill="#f2b705"/>${lines}</svg>`
  }
  if (id === 'weather') {
    return `${head}<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5cb0ff"/><stop offset="1" stop-color="#2d6fd6"/></linearGradient></defs><rect width="512" height="512" rx="${rx}" fill="url(#g)"/><circle cx="200" cy="200" r="76" fill="#ffd54a"/><path d="M150 372a62 62 0 0 1 12-123 86 86 0 0 1 165-12 70 70 0 0 1 28 135z" fill="#ffffff"/></svg>`
  }
  const keys: string[] = []
  const colors = ['#a5a5a5', '#a5a5a5', '#ff9f0a', '#3a3a3c', '#3a3a3c', '#ff9f0a', '#3a3a3c', '#3a3a3c', '#ff9f0a']
  for (let i = 0; i < 9; i += 1) {
    const x = 112 + (i % 3) * 100
    const y = 204 + Math.floor(i / 3) * 76
    keys.push(`<rect x="${x}" y="${y}" width="88" height="64" rx="18" fill="${colors[i]}"/>`)
  }
  return `${head}<rect width="512" height="512" rx="${rx}" fill="#1c1c1e"/><rect x="112" y="96" width="288" height="84" rx="18" fill="#2c2c2e"/><rect x="304" y="128" width="72" height="18" rx="9" fill="#f2f2f7"/>${keys.join('')}</svg>`
}

export function iconDataUri(id: ActiveDisguise, rounded = true): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(id, rounded))}`
}

export interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

export interface WebManifest {
  id: string
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: 'standalone'
  background_color: string
  theme_color: string
  orientation: 'any'
  categories: string[]
  icons: ManifestIcon[]
}

/**
 * Neutral manifest: no shortcuts, no share target, no brand strings. URLs are
 * absolute because a blob: manifest cannot resolve relative ones.
 */
export function buildManifest(id: ActiveDisguise, origin: string, icons: ManifestIcon[]): WebManifest {
  const spec = DISGUISES[id]
  const root = `${origin.replace(/\/+$/, '')}/`
  return {
    id: root,
    name: spec.title,
    short_name: spec.shortName,
    description: spec.blurb,
    start_url: root,
    scope: root,
    display: 'standalone',
    background_color: spec.backgroundColor,
    theme_color: spec.themeColor,
    orientation: 'any',
    categories: ['utilities'],
    icons,
  }
}

export function manifestBlobText(manifest: WebManifest): string {
  return JSON.stringify(manifest)
}

// ── DOM application ─────────────────────────────────────────────────────────

interface Saved {
  el: Element
  attrs: Record<string, string | null>
  created?: boolean
}

let saved: Saved[] = []
let manifestUrl: string | null = null
let current: { id: DisguiseId; full: boolean } = { id: 'off', full: false }
let cspListener: ((event: Event) => void) | null = null
let renderToken = 0

function remember(el: Element, names: string[], created = false) {
  if (saved.some((entry) => entry.el === el)) return
  const attrs: Record<string, string | null> = {}
  for (const name of names) attrs[name] = el.getAttribute(name)
  saved.push({ el, attrs, created })
}

function setAttrs(el: Element, values: Record<string, string | null>) {
  remember(el, Object.keys(values))
  for (const [name, value] of Object.entries(values)) {
    if (value === null) el.removeAttribute(name)
    else el.setAttribute(name, value)
  }
}

function drawPng(svg: string, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const image = new Image()
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          canvas.getContext('2d')?.drawImage(image, 0, 0, size, size)
          resolve(canvas.toDataURL('image/png'))
        } catch { resolve(null) }
      }
      image.onerror = () => resolve(null)
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    } catch { resolve(null) }
  })
}

async function installInstallSurfaces(id: ActiveDisguise, token: number) {
  const square = iconSvg(id, false)
  const [png192, png512, png180] = await Promise.all([drawPng(square, 192), drawPng(square, 512), drawPng(square, 180)])
  if (token !== renderToken) return

  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (touch) {
    if (png180) setAttrs(touch, { href: png180, sizes: '180x180' })
    else touch.remove()
  }

  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (!link) return
  const icons: ManifestIcon[] = []
  if (png192) icons.push({ src: png192, sizes: '192x192', type: 'image/png', purpose: 'any' })
  if (png512) icons.push({ src: png512, sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: png512, sizes: '512x512', type: 'image/png', purpose: 'maskable' })
  const manifest = buildManifest(id, window.location.origin, icons)
  const url = URL.createObjectURL(new Blob([manifestBlobText(manifest)], { type: 'application/manifest+json' }))
  if (manifestUrl) URL.revokeObjectURL(manifestUrl)
  manifestUrl = url
  setAttrs(link, { href: url })
  // Fail closed: if a strict CSP blocks blob: manifests, drop the link rather than leak the branded one.
  if (!cspListener) {
    cspListener = (event) => {
      const violation = event as SecurityPolicyViolationEvent
      if (violation.effectiveDirective === 'manifest-src') document.querySelector('link[rel="manifest"]')?.remove()
    }
    document.addEventListener('securitypolicyviolation', cspListener)
  }
}

/**
 * Show neutral icons/colors. `full` also swaps the install surfaces (manifest +
 * touch icon); the quick concealment used by the lock screen only touches the
 * favicon and colors.
 */
export function applyIcons(id: DisguiseId, full: boolean) {
  if (typeof document === 'undefined') return
  if (id === 'off') { restoreIcons(); return }
  if (current.id === id && (current.full || !full)) return
  const spec = DISGUISES[id]
  renderToken += 1

  let icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
  if (!icons.length) {
    const created = document.createElement('link')
    created.rel = 'icon'
    document.head.appendChild(created)
    saved.push({ el: created, attrs: {}, created: true })
    icons = [created]
  }
  for (const el of icons) setAttrs(el, { href: iconDataUri(id), type: 'image/svg+xml', sizes: null })

  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) setAttrs(meta, { content: spec.themeColor })
  const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
  if (appleTitle) setAttrs(appleTitle, { content: spec.shortName })

  current = { id, full: full || current.full }
  if (full) void installInstallSurfaces(id, renderToken)
}

export function restoreIcons() {
  if (typeof document === 'undefined' || current.id === 'off') return
  renderToken += 1
  for (const { el, attrs, created } of saved) {
    if (created) { el.remove(); continue }
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null) el.removeAttribute(name)
      else el.setAttribute(name, value)
    }
  }
  saved = []
  if (manifestUrl) { URL.revokeObjectURL(manifestUrl); manifestUrl = null }
  if (cspListener) { document.removeEventListener('securitypolicyviolation', cspListener); cspListener = null }
  current = { id: 'off', full: false }
}
