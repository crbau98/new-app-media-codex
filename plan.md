# Media Codex Web App — Fix & Deploy Plan

## Goal
Take the existing React + FastAPI app, fix all frontend bugs, make it fully responsive (desktop + iPhone), build for production, and publish as a live web app.

## Constraints
- Backend (FastAPI) cannot run on this machine (Python 3.9 too old for fastapi 0.135.1).
- Frontend will be served as a standalone SPA with mock data fallback.
- Deployment via built-in `cloudflared` tunnel.

## Stage 1 — Core Bug Fixes (Frontend)

### 1.1 Layout & Navigation
- [ ] Fix TopBar to span correct width on desktop (account for sidebar width)
- [ ] Fix mobile hamburger menu to actually open sidebar
- [ ] Replace all `<a href="#/{path}">` in Navbar with `useNavigate` to prevent reloads
- [ ] Replace all `<a href="#/{path}">` in BottomTabBar with `useNavigate`
- [ ] Wire TopBar search input to navigate to Search page
- [ ] Ensure active route highlighting works correctly across all nav items

### 1.2 Media Interactions
- [ ] Wire MediaCard `onSelect` in Home page to open MediaDetail drawer
- [ ] Wire CinematicHero "Watch Now" button to open MediaDetail
- [ ] Wire SurpriseMe overlay "Play" button to open MediaDetail
- [ ] Ensure all "Play" buttons are functional (open detail with video player)
- [ ] Fix Creator Spotlight "View Profile" to open creator drawer
- [ ] Wire Explore page category grid clicks to navigate to media with category filter

### 1.3 State & UX Polish
- [ ] Fix Settings theme "auto" to listen to system preference changes
- [ ] Ensure toast notifications don't stack beyond screen
- [ ] Fix Command Palette to use `useNavigate` instead of `window.location.hash`
- [ ] Add missing `loading="lazy"` to all images where missing
- [ ] Fix Search page URL sync to not break hash routing
- [ ] Ensure body scroll lock works correctly in MediaDetail

## Stage 2 — iPhone Responsiveness

### 2.1 Viewport & Safe Areas
- [ ] Add `viewport-fit=cover` to viewport meta tag
- [ ] Add safe-area-inset padding for bottom tab bar and top bar
- [ ] Ensure notch/dynamic island doesn't overlap content

### 2.2 Touch & Mobile UX
- [ ] All tap targets >= 44px
- [ ] Prevent text selection on UI chrome
- [ ] Enable `-webkit-tap-highlight-color: transparent` globally
- [ ] Ensure horizontal scroll lists have `snap` and momentum scroll
- [ ] Add pull-to-refresh feel (optional but nice)
- [ ] Test grid layouts on 375px, 390px, 414px widths

### 2.3 Mobile-specific Layout
- [ ] Home: Reduce hero height on mobile
- [ ] Home: Stories rail should be fully scrollable
- [ ] Home: Category grids should be 2 columns on smallest screens
- [ ] Explore: Trending rail should be swipeable
- [ ] Creators: Cards should be 2 columns on mobile
- [ ] Search: Filter panel should be full-width on mobile
- [ ] Settings: Sections should stack cleanly
- [ ] Analytics: Charts should be readable on mobile

## Stage 3 — Build & Production Prep

- [ ] Add PWA manifest.json
- [ ] Add simple offline page (optional)
- [ ] Build production bundle (`npm run build`)
- [ ] Verify build output has no console errors
- [ ] Copy `dist/` to `app/static/dist/` for backend serving (future)

## Stage 4 — Deploy & Test

- [ ] Serve `dist/` with `python -m http.server` (port 8080)
- [ ] Tunnel via `cloudflared` to get public URL
- [ ] Test on desktop browser via webbridge
- [ ] Test on mobile viewport (iPhone 14 Pro, iPhone SE)
- [ ] Verify all pages load, all interactions work
- [ ] Check for any console errors

## Success Criteria
- [ ] App loads instantly at public URL
- [ ] All 6 pages (Home, Explore, Search, Creators, Settings, Analytics) render correctly
- [ ] Media detail drawer opens on every page where media cards are shown
- [ ] Navigation works on desktop sidebar, tablet rail, and mobile bottom tab bar
- [ ] No console errors
- [ ] Looks and feels native on iPhone (proper spacing, touch targets, scroll)
- [ ] Dark/light mode toggle works
- [ ] Search, filters, and sort all function

---
