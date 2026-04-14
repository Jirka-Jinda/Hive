# UI Design System — AI Workspace Manager

> **This file is the source of truth for all UI work.**
> Before making any frontend change, read this file and apply these rules.
> After fixing a UI issue, extract the rule here so it stays current.

---

## 1. Color Palette

| Role | Tailwind token | Hex |
|---|---|---|
| App background | `bg-gray-950` | `#030712` |
| Panel / sidebar background | `bg-gray-900` | `#111827` |
| Elevated surface (cards, form areas) | `bg-gray-800` | `#1f2937` |
| Input background | `bg-gray-900` | `#111827` |
| Border (default) | `border-gray-700` | `#374151` |
| Border (subtle / panel divider) | `border-gray-800` | `#1f2937` |
| Border (transparent overlay) | `border-gray-700/60` or `border-gray-800/80` | — |
| Primary accent | `indigo-500 / indigo-600` | `#6366f1 / #4f46e5` |
| Primary accent hover | `indigo-500` | `#6366f1` |
| Success / active fullscreen | `emerald-600` | `#059669` |
| Danger hover | `red-950/30 … red-950/40` | — |
| Text — primary | `text-gray-100` | `#f3f4f6` |
| Text — secondary | `text-gray-300` | `#d1d5db` |
| Text — muted | `text-gray-500` | `#6b7280` |
| Text — disabled / placeholder | `text-gray-600` | `#4b5563` |
| Text — section labels | `text-gray-500` | — |
| Text — accent link / toggle | `text-indigo-400` | `#818cf8` |

Do **not** introduce new colors outside this palette without updating this file.

---

## 2. Typography

| Use | Classes |
|---|---|
| App title (header) | `text-sm font-semibold text-gray-100 tracking-[0.08em] uppercase` |
| Panel / section header | `text-[11px] font-bold text-indigo-400 tracking-[0.12em] uppercase` |
| Section labels (above lists) | `text-[10px] font-bold text-gray-500 uppercase tracking-widest` |
| Body text | `text-sm text-gray-300` |
| Small / list item text | `text-xs text-gray-300` |
| Monospace / badge label | `text-xs font-medium` |
| Error messages | `text-xs text-red-400` |
| Placeholder text | `placeholder-gray-600` |

---

## 3. Buttons

### 3.1 Toggle buttons (expand/collapse inline forms)

```
inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium
```

> **Always use `text-xs` (12 px) for toggle/add buttons regardless of the size of the adjacent section label.**

| State | Extra classes |
|---|---|
| Active (form open) | `bg-indigo-600 border-indigo-500 text-white` |
| Inactive | `bg-gray-800 border-gray-700 text-indigo-400 hover:bg-gray-750 hover:text-indigo-300 hover:border-gray-600` |

When the form is open, the label switches from `+ Add` / `+ New` to `✕` (or shows a separate cancel button).

### 3.2 Primary action buttons (submit / save)

```
w-full text-xs bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed
```

### 3.3 Icon buttons (toolbar / header)

Define class constants inside the component to avoid repetition:

```ts
const iconBtnBase = 'inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-all font-medium';
const iconBtnDefault = `${iconBtnBase} bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600`;
```

For conditional active states (e.g. fullscreen), use `iconBtnBase` with the active variant:
```tsx
className={`${iconBtnBase} ${active
    ? 'bg-emerald-600/90 border-emerald-500 text-white shadow-sm shadow-emerald-950/60'
    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
}`}
```

Small 24 × 24 variant (inside panel sub-headers) — also define as a constant:
```ts
const panelHdrBtnCls = 'inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-all text-sm leading-none font-medium';
```

Active / toggled icon button (e.g. fullscreen on): add
```
bg-emerald-600/90 border-emerald-500 text-white shadow-sm shadow-emerald-950/60
```

Collapse / expand full-height tab (`‹` `›`):
```ts
const collapseTabCls = 'w-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors text-base flex-shrink-0 font-medium';
```
Add `border-r border-gray-800` for left edge, `border-l border-gray-800` for right edge.

### 3.4 Danger / delete buttons

Inline small delete (hidden until row hover):
```
inline-flex items-center justify-center w-4 h-4 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/40 ml-1 opacity-0 group-hover:opacity-100 transition-all text-sm shrink-0
```

Larger bordered delete (list item row):
```
inline-flex items-center text-xs px-2 py-1 rounded border bg-gray-900 border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-800/50 hover:bg-red-950/30 transition-all
```

### 3.5 Tab / pill toggle (local vs git, etc.)

Container:
```
flex gap-1 p-0.5 bg-gray-900/60 rounded border border-gray-700/50
```

Tab button — active:
```
flex-1 text-xs py-0.5 rounded bg-indigo-600 text-white font-medium transition-colors
```

Tab button — inactive:
```
flex-1 text-xs py-0.5 rounded text-gray-400 hover:text-gray-200 transition-colors
```

---

## 4. Form Inputs

### Text input
```
w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md
placeholder-gray-600 text-gray-100
focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30
transition-all
```

### Select
```
w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100
focus:outline-none focus:border-indigo-500 transition-all
```

Small inline select (`text-xs`):
```
bg-gray-900 border border-gray-700 text-xs px-1.5 py-1.5 rounded-md text-gray-100
focus:outline-none focus:border-indigo-500 transition-all
```

### Form card (wrapping a create/edit form inside a panel)
```
p-2.5 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-2
```

### Field label (inside form)
```
text-xs text-gray-500 block mb-1 font-medium
```

---

## 5. Panels & Surfaces

### Modal backdrop + container
```
fixed inset-0 bg-black/60 flex items-center justify-center z-50
```
Inner container:
```
bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg shadow-2xl overflow-hidden
```

### Modal / panel header strip
```
flex items-center justify-between px-4 py-3 border-b border-gray-800/80
```

### Panel sub-header (sidebar sections, right panel top bar)
```
flex items-center justify-between px-3 py-2.5 border-b border-gray-800/80 bg-gray-950/40 shrink-0
```

### Sidebar aside element
```
flex flex-col border-r border-gray-800/80 bg-gray-900 overflow-hidden flex-shrink-0
```

### Right MD panel wrapper
```
flex-shrink-0 overflow-hidden   (width controlled by useDragResize inline style)
```

### Drag resize handle (vertical, between panels)
```
w-1 cursor-col-resize bg-gray-800/60 hover:bg-indigo-500/60 active:bg-indigo-500 transition-colors flex-shrink-0
```
Also add `user-select: none` (handled globally in `index.css` for `.cursor-col-resize`).

### List item row (repos, sessions, files)
```
group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-xs
```

Selected state: `bg-indigo-700/80 text-white`
Default state: `text-gray-300 hover:bg-gray-800`

### Badge (type labels)
```
text-xs px-1.5 py-0.5 rounded font-medium
```

Per type:
- `skill` → `bg-purple-900 text-purple-300`
- `tool` → `bg-blue-900 text-blue-300`
- `instruction` → `bg-green-900 text-green-300`
- `other` → `bg-gray-700 text-gray-400`

---

## 6. Layout

- Root: `flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden`
- Top app bar: `grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]` — title left, centered controls pill, right empty spacer
- Content row: `flex flex-1 overflow-hidden min-w-0`
- Left sidebar `<aside>`: flex-shrink-0, width driven by `useDragResize(260, 180, 520, 'right')`
- Right MD panel: flex-shrink-0, width driven by `useDragResize(260, 160, 440, 'left')`
- **Both panels default to the same initial width (260 px).**
- Main content area: `flex-1 flex overflow-hidden min-w-0`
- Both sidebars are collapsible — collapsed state shows a `w-7` tab button with `›` or `‹`

---

## 7. Scrollbars

Defined globally in `index.css`:
- Width / height: 6 px
- Track: transparent
- Thumb: `#374151` (gray-700), radius 3 px
- Thumb hover: `#6366f1` (indigo-500)

---

## 8. Spacing & Sizing Conventions

| Element | Standard |
|---|---|
| Panel internal padding | `p-2` or `p-2.5` |
| Section gap between label and list | `mb-1` or `mb-1.5` |
| Gap between form fields | `space-y-2` |
| Divider between sidebar sections | `border-t border-gray-700` |
| Toolbar center pill padding | `px-3 py-1.5` |
| Toolbar pill gap between button groups | `gap-3` with `w-px h-6 bg-gray-700/80` divider |

---

## 9. Icons

- All icons are inline SVG, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`
- Toolbar icon size: `w-4 h-4` (inside `w-8 h-8` button)
- Panel sub-header icon size: `w-3.5 h-3.5` (inside `w-6 h-6` button)
- Source: Heroicons outline set
- **Fullscreen expand icon** — use clean corner-bracket path (no arc commands, perfectly symmetric):
  `d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"`
- **Fullscreen compress icon** (already correct):
  `d="M9 9H5V5m10 4h4V5m-4 10h4v4m-10-4H5v4"`

---

## 10. MD File Panel — Data Rules

- The panel **always shows both Central and Repo sections**.
- Central files are always visible regardless of whether a repo is selected.
- The Repo section only renders if `selectedRepo` is non-null.
- When a repo is selected (`selectRepo` in `RepoList`), the store is populated as:
  ```ts
  const centralFiles = useAppStore.getState().mdFiles.filter(f => f.scope === 'central');
  setMdFiles([...centralFiles, ...repoFiles]);
  ```
  This preserves central files while appending repo-scoped files.

---

## 11. Fullscreen

- Toggle via F11 key or the fullscreen icon button in the header pill.
- In Electron: delegate to `window.electronAPI.toggleFullscreen()` / `isFullscreen()` / `onFullscreenChange()`.
- In browser: use `document.documentElement.requestFullscreen()` / `document.exitFullscreen()`.
- Button active state uses the emerald variant (see §3.3) to clearly indicate the fullscreen state.

---

## 12. Rules Extracted From Bug Fixes

| Fix | Rule |
|---|---|
| Ctrl+S used a stale `save` closure in Monaco's `onMount` | Always bind Monaco commands via a `useRef` that is kept in sync with `useEffect`, never directly to a `useCallback` function |
| Central files disappeared when switching repos | `selectRepo` must merge `[...centralFiles, ...repoFiles]`, never replace the whole `mdFiles` array with repo-only results |
| MD file create visible only after full reload | After `api.mdfiles.create`, always do `setMdFiles([...mdFiles, file])` immediately in the same handler |
| Fullscreen icon bottom-left bracket misaligned | Use straight-line corner bracket paths (`H`, `v`, `h`, `V`) — never arc commands — so all 4 corners are geometrically identical |
| Duplicate button class strings in the same component | Extract to `const` variables inside the component; reuse via template literals for conditional variants |
| Inconsistent `font-medium` across buttons | Every button that renders visible text must include `font-medium`. Icon-only buttons should include it for API consistency. |
