# Item Drawer — Click Fixes, oEmbed Preview & Summary Enhancement

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every item card reliably clickable, open a wider resizable drawer with Summary/Preview tabs, oEmbed-powered post rendering for X/Reddit, and richer summary display with inline term highlighting.

**Architecture:** Fix the title-click bug in SourceCard, add a draggable resize handle to ItemDrawer, add Summary|Preview tabs, add a backend /api/items/{id}/oembed proxy endpoint (httpx, already installed), and sanitize injected HTML with DOMPurify before rendering.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, Tailwind CSS v4, FastAPI, httpx, DOMPurify

---

### Task 1: Install DOMPurify

Files: frontend/package.json (via npm)

Step 1: Install
  cd frontend && npm install dompurify @types/dompurify

Step 2: Commit
  git add frontend/package.json frontend/package-lock.json
  git commit -m "chore: install dompurify for oEmbed HTML sanitization"

---

### Task 2: Backend oEmbed proxy endpoint

Files: app/api/items.py

Add import at top: import httpx

Add before browse_router block:

  @router.get("/{item_id}/oembed")
  def item_oembed(item_id: int) -> JSONResponse:
      from app.main import db
      item = db.get_item(item_id)
      if not item:
          raise HTTPException(status_code=404, detail="Item not found")
      source_type = (item.get("source_type") or "").lower()
      url = item.get("url") or ""
      oembed_map: dict[str, str] = {
          "x": f"https://publish.twitter.com/oembed?url={url}&omit_script=false&theme=dark",
          "twitter": f"https://publish.twitter.com/oembed?url={url}&omit_script=false&theme=dark",
          "reddit": f"https://www.reddit.com/oembed?url={url}",
      }
      oembed_url = oembed_map.get(source_type)
      if not oembed_url:
          return JSONResponse({"error": "no_oembed"})
      try:
          resp = httpx.get(oembed_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=8.0, follow_redirects=True)
          resp.raise_for_status()
          data = resp.json()
          return JSONResponse({"html": data.get("html") or ""})
      except Exception:
          return JSONResponse({"error": "fetch_failed"})

Verify: curl -s http://127.0.0.1:8000/api/items/1/oembed | python3 -m json.tool
Expected: JSON with html or error key

Commit: git add app/api/items.py && git commit -m "feat: add GET /api/items/{id}/oembed proxy endpoint"

---

### Task 3: Frontend api client

Files: frontend/src/lib/api.ts

In the api object, add:
  itemOembed: (id: number) => apiFetch<{ html?: string; error?: string }>(`/api/items/${id}/oembed`),

Verify: cd frontend && npx tsc --noEmit 2>&1 | head -20
Commit: git add frontend/src/lib/api.ts && git commit -m "feat: add api.itemOembed client method"

---

### Task 4: Fix SourceCard

Files: frontend/src/features/items/SourceCard.tsx

4a. Replace title <a> with plain <p> (remove stopPropagation that blocks drawer):

  OLD (around line 190):
    <a href={item.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[15px] font-semibold ...">
      <Highlighted ... />
    </a>

  NEW:
    <p className={cn('text-[15px] font-semibold line-clamp-2 leading-snug', visited ? 'text-text-secondary' : 'text-text-primary')}>
      <Highlighted text={item.title || ''} query={searchQuery} />
    </p>

4b. Strengthen root div hover classes:
  OLD: 'hover:border-accent/30 hover:bg-bg-elevated'
  NEW: 'hover:border-accent/50 hover:bg-bg-elevated hover:shadow-md'
  Also add: title="Click to open detail"

4c. Add expand chevron before closing </div> of card:
  <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
    <ChevronRight size={14} className="text-accent/60" />
  </div>

Commit: git add frontend/src/features/items/SourceCard.tsx && git commit -m "fix: card title opens drawer; stronger hover affordance + chevron"

---

### Task 5: ItemDrawer — resizable width

Files: frontend/src/features/items/ItemDrawer.tsx

Add state + resize handlers at top of ItemDrawer function:

  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    const stored = localStorage.getItem('drawerWidth')
    return stored ? Math.min(720, Math.max(340, parseInt(stored, 10))) : 480
  })
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = drawerWidth
    function onMouseMove(ev: MouseEvent) {
      if (!isResizing.current) return
      const delta = resizeStartX.current - ev.clientX
      const newWidth = Math.min(720, Math.max(340, resizeStartWidth.current + delta))
      setDrawerWidth(newWidth)
      localStorage.setItem('drawerWidth', String(newWidth))
    }
    function onMouseUp() {
      isResizing.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [drawerWidth])

Change aside: remove hardcoded w-[400px], add style={{ width: drawerWidth + 'px' }}
Add drag handle as first child of aside:
  <div onMouseDown={onResizeMouseDown} className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10" aria-hidden />

Commit: git add frontend/src/features/items/ItemDrawer.tsx && git commit -m "feat: resizable drawer width with localStorage persistence"

---

### Task 6: ItemDrawer — tabs, oEmbed, richer summary

Files: frontend/src/features/items/ItemDrawer.tsx

6a. Add tab state:
  const [activeTab, setActiveTab] = useState<'summary' | 'preview'>('summary')
  useEffect(() => { setActiveTab('summary') }, [selectedItemId])

6b. Add HighlightedSummary component (above ItemDrawer):
  Splits summary text by compound/mechanism terms.
  Compounds get bg-teal/15 text-teal marks.
  Mechanisms get bg-accent/15 text-accent marks.
  Falls back to plain text if no terms.

6c. Add NativeContentPreview component (above ItemDrawer):
  literature/pubmed/arxiv/biorxiv: rounded border card with abstract + author + date
  lpsg: forum-style card with avatar initial, username, date, body text
  others: plain content + "Open original" link button

6d. Add OEmbedPreview component (above ItemDrawer):
  - Fetches api.itemOembed(item.id) on mount
  - Imports DOMPurify dynamically, sanitizes html (ADD_TAGS iframe/blockquote/script, ADD_ATTR allow/src/async)
  - On success: renders sanitized html (html is DOMPurify-sanitized before rendering to prevent XSS)
  - Loads Twitter widget script for x/twitter items
  - On error: renders NativeContentPreview fallback
  - Shows Spinner while loading

6e. Add tab bar in drawer (after header, before body):
  Two buttons: "Summary" and "Preview"
  Active tab: border-b-2 border-accent text-accent
  Inactive: border-transparent text-text-muted

6f. Split drawer body into tab panes:
  summary tab: existing content but with HighlightedSummary instead of plain summary
  preview tab: OEmbedPreview for x/twitter/reddit, NativeContentPreview for others

6g. Add keyboard hint footer (before closing aside):
  text-[10px] font-mono: "<- -> navigate . Esc close" left, "N/total" right

Commit: git add frontend/src/features/items/ItemDrawer.tsx && git commit -m "feat: drawer tabs, oEmbed preview, inline term highlighting, keyboard hint"

---

### Task 7: Final verification

- Screenshot Items tab — confirm hover state on cards
- Click a card title — drawer opens (not URL navigation)
- Click Summary / Preview tabs — both render correctly
- Drag left drawer edge — resizes, persists on reopen
- Keyboard arrows navigate items, Esc closes
