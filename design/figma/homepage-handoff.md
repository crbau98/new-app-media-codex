# Homepage Figma Handoff

This package translates the current homepage in [app/templates/index.html](/Users/chasebauman/Documents/App research codex/app/templates/index.html) and [app/static/styles.css](/Users/chasebauman/Documents/App research codex/app/static/styles.css) into a Figma-ready design spec.

## Deliverables

- `homepage-wireframe.svg`
  - import this into Figma as the base desktop frame
- `homepage-tokens.json`
  - color, type, spacing, radius, and shadow tokens from the live app

## Recommended Figma File Structure

Create one page named `Homepage`.

Create these top-level frames:

1. `Homepage / Desktop / 1440`
2. `Homepage / Tablet / 1024`
3. `Homepage / Mobile / 390`
4. `Components`
5. `Tokens`

## Desktop Frame

- Frame size: `1440 x 3200`
- Outer page fill:
  - base: `#EFE4D2`
  - overlay 1: warm radial glow, top-right
  - overlay 2: green radial glow, bottom-left
  - main gradient: `#F7EEDF -> #ECDFCB`
- Content container:
  - max width: `1320`
  - side margin inside frame: `60`
  - top padding: `32`
  - bottom padding: `56`

## Grid

- Desktop:
  - `12` columns
  - container width `1320`
  - gutter `20`
  - margin `60`
- Tablet:
  - `8` columns
  - gutter `16`
  - margin `32`
- Mobile:
  - `4` columns
  - gutter `12`
  - margin `10`

## Visual Direction

- Tone: editorial research dashboard, not SaaS-blue and not sterile clinical
- Typography:
  - display/headings: `IBM Plex Serif`
  - UI/body: `IBM Plex Sans`
- Surface style:
  - translucent warm paper cards
  - soft borders
  - large radii
  - deep blurred shadow
- Interaction style:
  - pill navigation
  - chip-based exploration
  - dense but breathable panels

## Homepage Sections

### 1. Hero

Two-column header.

- Left card width ratio: `1.8fr`
- Right card width ratio: `1fr`
- Gap: `20`
- Card radius: `24`

Left card content:

- Eyebrow: `Continuous source monitor`
- H1: app name
- Lead paragraph describing the research monitor
- Status chip row

Right card content:

- Section title: `Controls`
- Secondary button: `Refresh`
- Secondary button: `Open command palette`
- Primary button: `Run crawl now`
- Admin token field
- Save/Clear token actions
- Export actions
- Saved-view actions
- Safety warning copy

### 2. Workspace Navigation

Sticky panel under hero.

- Title: `Workspace`
- Summary text on left
- Shortcut chip on right: `Ctrl/Cmd+K`
- Row 1:
  - `All`
  - `Overview`
  - `Topics`
  - `Review`
  - `Media`
- Row 2:
  - `Overview`
  - `Topic explorer`
  - `Source captures`
  - `Images`

### 3. Topic Workspace

Panel with 3 functional clusters:

- Saved topics / Recent pivots
- Topic boards with board note
- Topic notebook
- Compare topics

Use nested cards or boxed regions inside the main panel if you want the Figma file to feel more explicit than the coded version.

### 4. Stats Strip

Five cards:

1. Items
2. Images
3. Hypotheses
4. Saved queue
5. Last completed crawl (wide card)

Desktop behavior:

- `repeat(5, 1fr)` grid
- last card spans `2` columns in the current visual language

### 5. Overview Grid

Two-column asymmetric grid.

- Left column: `1.35fr`
- Right column: `1fr`
- Gap: `18`

Panels:

- Research hypotheses
- Review queue
- Run history
- Source coverage
- Theme activity
- Run source breakdown
- Observed signals

The hypotheses panel is the anchor card and should visually read as the primary analysis surface.

### 6. Topic Explorer

Large panel with:

- title + summary
- baseline selector
- save/apply/clear actions
- topic chips
- diff summary chips
- suggested related-signal chips
- 3-column spotlight card grid
- compare panel row

### 7. Source Captures

Large browse panel with:

- title + result summary
- full filter toolbar
- active filters row
- bulk action bar
- 3-column card grid
- load more action

### 8. Image Stream

Gallery panel with:

- title + summary
- image type filter
- 4-column image grid
- load more action

## Components To Build In Figma

Create these as reusable components:

1. `Button / Primary / Pill`
2. `Button / Secondary / Pill`
3. `Button / Ghost / Pill`
4. `Chip / Default`
5. `Chip / Subtle`
6. `Chip / Warning`
7. `Card / Panel`
8. `Card / Stat`
9. `Card / Content`
10. `Card / Queue`
11. `Field / Input`
12. `Field / Select`
13. `Field / Textarea`
14. `Dialog / Standard`
15. `Dialog / Command Palette`

## Type Scale

Use these desktop targets:

- H1:
  - family: `IBM Plex Serif`
  - size: `76`
  - line height: `74`
  - weight: `600`
- H2:
  - family: `IBM Plex Serif`
  - size: `22`
  - line height: `28`
  - weight: `600`
- H3:
  - family: `IBM Plex Serif`
  - size: `16`
  - line height: `22`
  - weight: `600`
- Eyebrow:
  - family: `IBM Plex Sans`
  - size: `12`
  - line height: `16`
  - weight: `600`
  - letter spacing: `14%`
  - uppercase
- Body:
  - family: `IBM Plex Sans`
  - size: `16`
  - line height: `25`
  - weight: `400`
- Meta:
  - family: `IBM Plex Sans`
  - size: `14`
  - line height: `22`
  - weight: `400`
- Chip:
  - family: `IBM Plex Sans`
  - size: `14`
  - line height: `18`
  - weight: `600`

## Spacing System

Base unit: `4`

Recommended token set:

- `4`
- `6`
- `8`
- `10`
- `12`
- `14`
- `18`
- `20`
- `22`
- `24`
- `28`
- `32`
- `56`

## Radius

- Large panel: `24`
- Secondary panel / modal image: `18`
- Input: `16`
- Pills/chips/buttons: `999`

## Shadow

- Main panel shadow:
  - `0 26 80 0 rgba(86, 50, 30, 0.12)`

## Interaction Notes

- Workspace nav stays sticky
- Current workspace mode uses filled accent pill
- Topic chips open topic explorer state
- Command palette opens on `Ctrl/Cmd+K`
- Cards feel clickable with subtle lift, not heavy hover chrome
- Mobile collapses major grids to one column

## Responsive Notes

At `1120` and below:

- hero collapses to one column
- overview grid collapses to one column
- stats collapse to one column
- cards and image grid collapse to one column

At `720` and below:

- shell width becomes near-full bleed with `10` px side inset
- large radii reduce from `24` to `20`
- modal padding reduces

## Import Steps

1. In Figma, create a new file.
2. Import `homepage-wireframe.svg`.
3. Create local color/text/effect styles from `homepage-tokens.json`.
4. Convert repeated pills, buttons, panels, and cards into components.
5. Duplicate the imported desktop frame to make tablet/mobile variants.

## Suggested Next Figma Pass

After importing, refine these areas first:

1. Add real content density hierarchy inside the overview panels.
2. Give the topic workspace stronger internal grouping with nested surfaces.
3. Make the command palette feel more premium with stronger contrast and active-row emphasis.
