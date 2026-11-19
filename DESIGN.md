---
name: Read IT
description: An offline reader for the books you already own — paper-quiet surfaces, one ink voice, one amber state, and a serif that holds up for hours.
colors:
  brand-ink: "#1e2a47"
  brand-ink-deep: "#141d33"
  brand-ink-wash: "#e6e9f0"
  amber: "#c8811a"
  amber-ink: "#8a5200"
  paper: "#faf7f1"
  surface: "#fffdf9"
  surface-sunken: "#efe9df"
  ink: "#141a24"
  ink-muted: "#5c6068"
  hairline: "#e0d9cc"
  control-edge: "#8d8a83"
  selection: "#d7dcec"
  scrim: "rgba(10, 14, 24, 0.46)"
  success: "#1c6b45"
  success-wash: "#e7f2ea"
  warning: "#7a4a00"
  warning-wash: "#fbf0d4"
  danger: "#a3231d"
  danger-wash: "#fbe8e5"
  info: "#12587e"
  info-wash: "#e5eff7"
  highlight-yellow: "#ffe9a0"
  highlight-green: "#c8ecc0"
  highlight-blue: "#cbe3fb"
  highlight-pink: "#ffd2e4"
typography:
  page-title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.011em"
  section-title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.011em"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.35
  reading-body:
    fontFamily: "'Literata', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand-ink}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.brand-ink-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
    typography: "{typography.label}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#fff8f6"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  banner-warning:
    backgroundColor: "{colors.warning-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    typography: "{typography.label}"
  banner-error:
    backgroundColor: "{colors.danger-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    typography: "{typography.label}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.label}"
  chip-selected:
    backgroundColor: "{colors.brand-ink-wash}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "36px"
    typography: "{typography.label}"
  nav-item-active:
    backgroundColor: "{colors.brand-ink-wash}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.md}"
    height: "44px"
    typography: "{typography.meta}"
---

# Design System: Read IT

## Overview

**Creative North Star: "The Reading Desk"**

Read IT is a desk, not an app store product. Paper underneath, ink on top, one lamp. A reader
opens it at 11pm with a chapter they have read twice and no signal to check a dictionary; nothing
on screen competes with the paragraph in front of them. The surface is warm paper (`#faf7f1`),
text is near-black ink (`#141a24`), and the only saturated colour on most screens is the deep
ink-blue of an action the reader actually chose, with amber marking state rather than intent.
Density is book-like: generous line height in the reading column, tight vertical rhythm in the
controls, no decorative cards nesting inside cards.

The system is deliberately **two-faced in one body**. UI chrome is the platform's own
sans (`system-ui`), because a reading tool shouldn't cost a font download to say "Import" and
should feel native under the thumb. Long-form text is Literata, a screen serif commissioned for
reading apps, self-hosted so the reader works with the network off. The two never mix inside one
sentence; the boundary is exactly the boundary between *this app* and *the book*.

Depth is nearly absent. Paper does not float. Shadows appear only where a thing genuinely leaves
the page — a sheet sliding up over content, a toast — and nowhere else. Hierarchy comes from
size, weight, colour temperature and hairline rules, in that order. The mood is quiet competence:
the tool of someone precise who does not need to impress you.

Hours of reading happen on this screen. That is the constraint every decision answers to:
nothing flashes, nothing bounces, nothing moves faster than a page turn, and the reader can
enlarge text to 200% without the layout losing its mind.

**Key Characteristics:**
- Warm paper ground, ink text, one ink-blue voice per screen, amber for state.
- Flat surfaces; hairline rules instead of shadows; depth reserved for sheets.
- Sans for chrome, Literata for text — never both in one block.
- 4px spacing rhythm, 44px minimum touch target, generous tap padding on phones.
- Complete light and dark themes; both are first-class, not an inverted afterthought.
- Motion is 120–240ms, eased, and always skippable via `prefers-reduced-motion`.

## Colors

A warm neutral ground with a single deep ink-blue brand ink, one amber for state, plus four
muted highlight tints that behave like physical markers. Everything saturated is either *the
reader's action* (ink), *a state* (amber), *a status* (success/warning/danger/info), or *a mark
the reader made* (highlights).

### Token names are public API

The values live in `src/styles.css` as CSS custom properties. **Only the values change; the
token names never do.** Every page stylesheet consumes them, so a rename is a breaking change.

| Design name | CSS token | Light | Dark |
|---|---|---|---|
| Brand Ink | `--accent` | `#1e2a47` | `#8ea2d6` |
| Brand Ink Deep | `--accent-hover` | `#141d33` | `#a8b8e2` |
| Brand Ink Wash | `--accent-soft` | `#e6e9f0` | `#1b2136` |
| Accent text on fill | `--accent-text` | — | `#0b1020` |
| Amber | `--amber` | `#c8811a` | `#e0a13c` |
| Amber Ink | `--amber-ink` | `#8a5200` | `#f0b964` |
| Paper | `--bg` | `#faf7f1` | `#0f1319` |
| Sheet | `--surface` | `#fffdf9` | `#171c25` |
| Raised | `--surface-raised` | `#fffdf9` | `#1f2530` |
| Sunken | `--surface-sunken` | `#efe9df` | `#0b0e14` |
| Ink | `--text` | `#141a24` | `#eceef2` |
| Muted Ink | `--muted` | `#5c6068` | `#9aa0ab` |
| Hairline | `--border` | `#e0d9cc` | `#2b323e` |
| Control Edge | `--border-control` | `#8d8a83` | `#5e6673` |
| Selection | `--selection-bg` | `#d7dcec` | `#2a3350` |
| Scrim | `--scrim` | `rgba(10,14,24,.46)` | `rgba(10,14,24,.46)` |

### Primary
- **Brand Ink** (`#1e2a47`): the brand and the only interactive colour. Filled primary
  buttons, links, the active navigation item, the focus ring, the app icon, and the
  `theme-color` the OS paints. In dark mode it lifts to **Lifted Ink** (`#8ea2d6`) with
  near-black text on top (`#0b1020`) so it stays legible as a fill.
- **Brand Ink Deep** (`#141d33`): hover/pressed for filled ink. One step darker only — the
  colour should not change character under the finger.
- **Brand Ink Wash** (`#e6e9f0`): the low-volume member of the family. Background of the
  active nav pill, selected chips, and `--accent-soft` surfaces. In dark mode it is `#1b2136`,
  an ink so dark it reads as a tint of the surface.

### State
- **Amber** (`#c8811a`): the one colour that marks *state* rather than intent — the reading
  progress fill, the format badge, the active state of a segmented control. It is never the
  colour of the primary action, never a second accent sitting beside ink, and never a wash
  behind body text. In dark mode it lifts to `#e0a13c`.
- **Amber Ink** (`#8a5200`, dark `#f0b964`): amber used *as text*, where it must pass 4.5:1 on
  its background. Measured: `#8a5200` on Sheet is **6.28:1** in light, `#f0b964` on Sheet is
  **9.62:1** in dark. Both clear the floor.
- **Amber as a fill carries ink text, never white.** `#141a24` on `#c8811a` is 5.49:1;
  white on `#c8811a` is 3.18:1, which is a large-text-only pair and fails the 11px badge.
  The badge is a fill with ink text on it.

### Neutral
- **Paper** (`#faf7f1`): the page ground in light mode. Warm, slightly cream — never pure
  white, which glares at night and looks like a spreadsheet.
- **Sheet** (`#fffdf9`): cards, inputs, the bottom nav, sheets. One step lighter than
  paper so a surface is legible *without* a shadow.
- **Sunken** (`#efe9df`): insets — progress tracks, badge fills, hover on secondary
  buttons. Reads as a shallow depression in the paper.
- **Ink** (`#141a24`): body and headings. 16.33:1 on paper.
- **Muted Ink** (`#5c6068`): metadata, hints, secondary paragraphs. 5.90:1 on paper —
  quiet but not a grey whisper.
- **Hairline** (`#e0d9cc`): 1px rules between rows, card borders, the nav's top edge.
  Decorative only (1.31:1); anything that must be *seen* uses Control Edge.
- **Control Edge** (`#8d8a83`): the border of inputs, selects, textareas, chips and
  secondary buttons. 3.22:1 on paper, so the control's boundary passes WCAG 1.4.11
  instead of vanishing on a bright screen.

Dark mode is a second complete set, not an inversion of the first: **Paper** becomes
`#0f1319` (near-black with a blue cast), **Sheet** `#171c25`, **Raised** `#1f2530`, **Ink**
`#eceef2`, **Muted Ink** `#9aa0ab`, **Hairline** `#2b323e`, **Control Edge** `#5e6673`.
Shadows deepen and lose their warm cast.

**One pair is tight and must be re-checked before the dark theme ships:** Control Edge
`#5e6673` on Sheet `#171c25` measures **2.95:1**, a hair under the 3:1 target for a control
boundary. On the page ground `#0f1319` it is 3.22:1, so an input drawn on Paper passes. Either
lift `--border-control` a step in dark mode or confirm every control sits on the ground and
not on a raised sheet — do not ship it unverified.

### Semantic
Each status is a triad: a text colour on a wash, with a border for the callout version. The text colour is what carries meaning; the wash only locates it.
- **Success** (`#1c6b45` on `#e7f2ea`): import finished, backup written, model ready.
- **Warning** (`#7a4a00` on `#fbf0d4`): scanned PDF, no text layer, degraded fallback.
- **Danger** (`#a3231d` on `#fbe8e5`): failed import, destructive confirmation. The
  *filled* danger button uses the same red as a solid (`#a3231d`, hover `#871d18`)
  with `#fff8f6` text — a red that is dark enough for white text, not a fire-engine
  red that shouts.
- **Info** (`#12587e` on `#e5eff7`): neutral guidance, "this needs a network".

Dark-mode status colours invert their logic: they are *light* inks (`#7ed3a3`,
`#f2c56b`, `#ff9f97`, `#8ec8ea`) on near-black washes, because a dark wash with dark
text is unreadable.

### Highlights
Four marker tints, each with an *ink* variant used for the ≥3:1 edge, underline, and
legend text. Yellow `#ffe9a0`/`#7a5c00`, green `#c8ecc0`/`#1f6b3a`, blue
`#cbe3fb`/`#14547f`, pink `#ffd2e4`/`#8a2350`. On paper the tint is a marker; the ink
is what you can still read at a glance. In dark mode the tints become translucent
(`rgba(...,0.24–0.26)`) so they tint the dark surface rather than pasting a bright
rectangle over it, and the inks stay light.

### Named Rules
**The One Voice Rule.** Ink is the reader's voice, not decoration. One ink element per
screen region: the primary action, or the active nav item, or the current selection. If two
things are ink and only one of them can be pressed, the other is wrong. Headings are text
ink, never brand ink.

**The Amber Rule.** Amber marks state, never intent. It belongs to the progress fill, the
format badge and the active state of a segmented control. It is never the primary action, and
it never appears twice in one region where ink already is.

**The Paper Not Glass Rule.** Surfaces are opaque paper. No translucency, no
backdrop blur, no gradients behind text. A surface earns its edge from a one-step
lighter fill and a hairline, not from a glow.

**The Ink On Tint Rule.** Semantic colour is applied as text/icon on a wash, never as
a wash on a wash. A warning banner is `--warning` text with `--warning-bg` behind it;
it is never a saturated amber slab with white text.

## Typography

**Display Font:** none. There is no display face; the page title is a 26px semibold
sans. This product has no marketing surface.
**Body Font (chrome):** `system-ui` (falls back to Segoe UI / Roboto / Helvetica).
**Reading Font:** Literata (falls back to Iowan Old Style, Palatino, Georgia).

**Character:** The chrome is the platform speaking — neutral, familiar, zero network
cost, and it renders in the reader's own script settings. Literata is the book
speaking: a screen-first serif with sturdy stems, open counters, and a slightly
generous x-height that survives a 390px column at 17px. The pairing is not decorative;
it marks the one boundary that matters in this app, between *using* Read IT and
*reading* it.

Literata is self-hosted (`public/fonts/literata-latin-wght-normal.woff2` and
`...-italic.woff2`, variable weight 200–900, Latin subset, 52 KB each) under the SIL
Open Font License 1.1 — license text ships at `public/fonts/OFL.txt`. Nothing is
fetched from a CDN, so the app reads identically on a train with no signal.

### Hierarchy
- **Page title** (600, 26px/1.2, −0.011em): one per screen, at the top, ink. Set with
  `text-wrap: balance` so a two-word title never orphans a word.
- **Section title** (600, 19px/1.2): card groups and settings sections, 24px above.
- **Card title** (600, 16px/1.35): the name of a thing in a list or card.
- **Body** (400, 16px/1.5): UI prose, form labels' neighbours, instructions. Measure
  capped at 68ch on UI pages.
- **Label** (600, 14px/1.35): buttons, field labels, list-row primary text. Sentence
  case, never uppercase except the 11px format badge.
- **Meta** (400, 12px/1.35): author, chapter count, timestamps, hints. Muted ink.
- **Badge** (700, 11px, 0.06em, uppercase): format only — PDF, EPUB, DOCX.
- **Reading body** (400, 17px/1.7, Literata): the book. 66ch measure, 1.7 line height,
  `text-wrap: pretty`, no hyphenation by default. The reader may scale it; lay out
  with `rem` so 200% zoom reflows rather than clips.

### Named Rules
**The Native Chrome Rule.** UI text is the platform's sans at a fixed rem scale.
No web font is loaded to render "Import". If a glyph is missing, the platform's
fallback is correct by definition.

**The Two Voices Rule.** Literata appears only inside reading content (chapter text,
the reading preview in Settings). It never appears in a button, label, banner, nav
item, or heading. A serif button is a costume.

**The Measure Rule.** Reading text stops at 66ch, UI prose at 68ch, regardless of how
wide the window is. On a 1280px screen the column is centred and the margin is the
point.

## Layout

**Model:** a single centred column, `720px` maximum, on a 4px spacing rhythm. Phone
first: 16px page gutters, `max(16px, env(safe-area-inset-top))` at the top, and
`calc(var(--nav-h) + 24px + env(safe-area-inset-bottom))` at the bottom so the fixed
navigation never covers the last row.

**Navigation:** below 900px, four labelled items in a fixed bottom bar (`--nav-h: 64px`
+ safe area). At ≥900px the bar becomes an `88px` left rail with the same items, the
column stays centred in the remaining width, and `--nav-h` drops to `0` so the bottom
padding disappears. The reading route opts out of global navigation entirely
(`.app--reading`): while reading, the reader's own toolbar is the way back.

**Density:** UI rows are 56px minimum; list rows on the Library are ~76px (two lines
plus a 4px progress bar). Controls are 44px (`--tap`), 48px (`--tap-comfort`) for
primary actions on touch. Vertical gaps come from the space scale — 8px inside a
control cluster, 12px between related rows, 16px between blocks, 24px between
sections, 48px before a page's final action.

**Breakpoints:** `900px` is the only structural breakpoint (bar → rail). Everything
else is fluid: the column is capped, never stretched, and text wraps.

**Safe areas:** every fixed element pads with `env(safe-area-inset-*)`; the bottom nav
is `height: calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))` with the inset as
bottom padding, so it sits above the gesture bar on Android and the home indicator on
iOS.

## Elevation & Depth

Flat by default. The system conveys depth tonally — paper, sheet, sunken — plus
hairlines, and reserves real shadows for the two surfaces that genuinely leave the
page: sheets and popovers. A card does not float; a card is a slightly lighter
rectangle of paper with a hairline edge.

### Shadow Vocabulary
- **Raise** (`0 1px 2px rgba(12, 28, 32, 0.06)`): a resting chip or the sticky bottom
  bar's top edge, where a 1px line alone would look printed-on.
- **Pop** (`0 12px 32px -14px rgba(12, 28, 32, 0.3), 0 2px 6px -2px rgba(12, 28, 32, 0.12)`):
  menus, popovers, anything anchored above content.
- **Sheet** (`0 -14px 40px -18px rgba(6, 20, 24, 0.36)`): the bottom sheet only, cast
  upward. Dark mode deepens all three and removes the warm cast.

### Named Rules
**The Flat-By-Default Rule.** Shadows are for things that float over content, not for
things that sit in it. If a shadow is doing the work a hairline could do, remove the
shadow.

**The No Glass Rule.** No `backdrop-filter`, no semi-transparent surfaces, no frosted
panels. The one translucency in the system is the sheet's scrim
(`rgba(10, 14, 24, 0.46)`), and that is a scrim, not a surface.

## Shapes

Soft, not round. Controls (buttons, inputs, chips excepted) carry a **10px** radius
(`--radius-md`); cards and sheets **14px** (`--radius-lg`); badges and the focus-ring
corner **4px**; only chips, progress tracks and the nav's active pill go fully round
(`999px`). Nothing is a circle except an icon button's hit area.

Edges are hairlines, 1px, never 2px, and never a coloured `border-left` stripe on a
card or callout — a thick left bar is a dashboard habit this product doesn't have.
Status is carried by the fill and the icon, not by a stripe. Dividers are horizontal
1px rules in Hairline; a row separator is the row's own `border-bottom`, so lists
never need a rule between every item *and* a container border.

## Components

Every component below exists as a class in `src/styles.css` and is shared by all
screens. Page-specific classes (`.lib-*`, `.rd-*`, `.tts-*`, `.backup-*`) style
*arrangement* only and must not redefine colour, type or shape.

### Buttons
- **Shape:** 10px radius, 44px min height, 16px horizontal padding, 14px/600 label,
  8px gap to a leading icon (18px, `currentColor`, stroke 1.7).
- **Primary:** filled Brand Ink, white text. One per view — the action the screen
  exists for.
- **Secondary:** sheet fill, Control Edge border, ink text. The alternative action.
- **Ghost:** no fill, no border, muted ink; hover shows Sunken. Used for low-emphasis
  toggles ("Add from web", "Paste text") and icon actions. A ghost button that owns an
  open panel sets `aria-expanded="true"` and turns into a Brand Ink Wash pill.
- **Danger:** solid Danger red with near-white text, only inside a confirmation.
- **Hover / Focus:** background and colour transition in 120ms `cubic-bezier(0.2,0,0,1)`.
  Focus is the global 2px ink ring at 2px offset — never a red or blue browser ring,
  never a shadow.
- **Disabled:** 55% opacity, `not-allowed`, never a different colour.

```html
<button class="btn btn-primary">Import</button>
<button class="btn btn-secondary">Settings</button>
<button class="btn btn-ghost" aria-expanded="false">Add from web</button>
<button class="btn btn-danger">Delete book</button>
```

### Chips (and the badge that isn't one)
- **Style:** pill, 36px high, Sheet fill, Control Edge border, 14px/500 ink. `.chip-tap`
  raises the height to 44px for touch filters.
- **State:** `aria-pressed="true"` (or `.is-active`) → Brand Ink Wash fill, ink border,
  ink semibold text. Selection reads as *held down*, not as a link.
- **Badge:** not a chip. 20px tall, 4px radius, 11px/700 uppercase, Sunken fill, muted
  ink — used for file format only (`PDF`, `EPUB`), never for status. A badge that marks
  state (a downloaded model, an ad-free session) is amber with ink text on it.

```html
<button class="chip chip-tap" aria-pressed="true">Chapter 4</button>
<span class="badge">EPUB</span>
```

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Sheet, always opaque.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Hairline. `.card-tight` reduces padding to 12px/16px.
- **Internal Padding:** 16px; a card that holds a list uses 0 and lets `.list-row`
  supply 12px vertical padding.

```html
<div class="card">
  <h3 class="card-title">On-device voice models</h3>
  <p class="card-body">Kokoro runs locally. Download once, then it works offline.</p>
</div>
```

### Inputs / Fields
- **Style:** full width, 44px min height, 10px radius, Sheet fill, 1px Control Edge,
  16px text (16px prevents iOS zoom-on-focus). Textareas start at 120px and resize
  vertically only.
- **Focus:** border turns ink **and** the global 2px ring appears. Two signals, because
  on a phone the ring alone is easy to miss under a thumb.
- **Label:** `.field-label` above, 14px/600, sentence case, 8px gap. A hint goes below
  in 12px muted ink. The label wraps the control so the tap target includes the text.

```html
<label class="field">
  <span class="field-label">Article address</span>
  <input class="input" type="url" autocomplete="url" />
  <span class="field-hint">Paste the address of a page you can already open.</span>
</label>
```

### Banners
- **Shape:** 10px radius, 12px/16px padding, 1px border, 18px leading icon that takes
  the status colour, title in the same colour, body in ink.
- **Variants:** `.banner-warning`, `.banner-error`, `.banner-info`, `.banner-success`.
  A bare `.banner` is a neutral note.
- **Behaviour:** lives in the flow, directly under whatever caused it, and is
  dismissible only when the user can act on it. It never floats over content.

```html
<div class="banner banner-warning" role="status">
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7">
    <path d="M12 3.8 2.7 19.4h18.6L12 3.8Z" /><path d="M12 9.6v4.2" /><path d="M12 16.6h.01" />
  </svg>
  <div>
    <p class="banner-title">Looks scanned</p>
    <p>This file has no text layer, so there is nothing to read or listen to.</p>
  </div>
</div>
```

### Progress
- **Shape:** 4px track, full radius, Sunken fill, amber fill, width transition 180ms.
- **Use:** reading progress on a book row, import progress. Always paired with a text
  value (`42%` in tabular numerals) — a bar alone is not information.
- **A11y:** `role="progressbar"` with `aria-valuenow`; when a row is not started, show
  no bar at all and say "Not started".

```html
<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42">
  <span style="width: 42%"></span>
</div>
```

### List rows
- **Style:** 56px minimum, 12px vertical padding, hairline between rows (row's own
  `border-bottom`), no outer card. The whole row is the link; actions sit at the end
  as `.btn.btn-icon.btn-ghost` with an `aria-label`.

```html
<ul class="list">
  <li class="list-row"><a href="/read/1">Notes on Nursing</a></li>
</ul>
```

### Disclosure row
- **Role:** the settings index row. A page of options is an index of collapsed rows,
  not a scroll: one card per group holds rows separated by hairlines, and only the row
  being read is open. Pressing a row opens it and closes the previous one; pressing the
  open row closes it, and Android Back closes it before it leaves the page.
- **Row:** the whole row is the button, 56px minimum, 10px/16px padding. Title 16px/600
  ink; an optional second line at 14px muted, one line with an ellipsis, carrying a live
  cheap value ("Kokoro · 1.0×", "Off", `v0.5.0 · Apache-2.0`) — never a number that would
  need a scan or a model probe to know. Trailing 18px inline-SVG chevron, 1.7px stroke,
  round caps, `currentColor`, rotating 90° in 120ms (it turns instantly under
  `prefers-reduced-motion`). Focus ring drawn inside the row's own edge so the card's
  rounded corner never clips it.
- **Heading:** the button lives inside the `h2` (`.disc-h`), so the row is still a
  heading in the outline and the button is named by its own text. A heading whose text
  is only the title, with a sibling button, is not this pattern.
- **Open body:** sits directly under its header inside the same card, with a hairline
  above and 16px padding. It is **never unmounted**: closed means `hidden`, so a model
  download or a timer inside a closed row keeps running. Shared styles do the work
  (`.disc`, `.disc-head`, `.disc-body`, `.disc-chevron`).
- **Second level:** native `<details class="disc-sub">` inside a panel — hairline above,
  no box, a 44px summary at 14px/600 with its own 7px `::after` border chevron
  (`list-style: none`, WebKit marker hidden). Native `<details name>` is not used to group
  rows: the minimum Android WebView is 110 and named groups arrive in 120.
- **Nested cards are neutralised:** a `.card` inside `.disc-body` loses its fill, border,
  radius and padding — a panel inside a row already sits on a surface.

```html
<section id="backup" class="disc" aria-labelledby="backup-h2">
  <h2 id="backup-h2" class="settings-h2 disc-h">
    <button type="button" class="disc-head" aria-expanded="false" aria-controls="backup-body">
      <span class="disc-text">
        <span class="disc-title">Backup</span>
        <span class="disc-summary">Last backup: never</span>
      </span>
      <svg class="disc-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6 15.5 12 9.5 18" /></svg>
    </button>
  </h2>
  <div class="disc-body" id="backup-body" hidden>…</div>
</section>
```

### Empty state
- **Character:** the page speaking in its own voice. Borderless text in the column
  (`.empty-state`), 48px ink mark, a 19px title, one teaching paragraph, optionally a
  short numbered list, then the actions. Use `.card.empty-state` when a bounded block
  is genuinely wanted (a panel inside settings), not by default.
- **Rule:** an empty state teaches the next action *and* names the constraint. "Your
  shelf is empty" plus how to import plus what a scanned PDF will do.

```html
<div class="empty-state">
  <svg class="empty-state-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7">
    <path d="M12 6.6C9.9 5.2 7.3 4.6 4.6 4.6H3v13h1.6c2.7 0 5.3.6 7.4 2 2.1-1.4 4.7-2 7.4-2H21v-13h-1.6c-2.7 0-5.3-.6-7.4-2Z" />
  </svg>
  <h2>Your shelf is empty</h2>
  <p>Read IT reads the books you already own. Import a PDF or EPUB and it stays on this device.</p>
  <div class="empty-state-actions">
    <button class="btn btn-primary">Import a file</button>
  </div>
</div>
```

### Sheet
- **Shape:** bottom sheet, 14px top corners, Sheet fill, Sheet shadow, max 85dvh,
  scrolls internally, 20px/16px padding plus the bottom safe-area inset.
- **Behaviour:** scrim behind (`rgba(10,14,24,.46)`), slides up 12px in 240ms,
  `role="dialog"` + `aria-modal`, focus moves in and returns to the trigger. On wide
  screens it stays a bottom sheet over the centred column rather than becoming a
  centred modal — the phone grammar is the product's grammar.
- **Actions:** `.sheet-actions` row, each button `flex: 1 1 8rem`, cancel first, the
  destructive action last and in `.btn-danger`.

```html
<div class="sheet-backdrop"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">
  <h2 id="sheet-t" class="sheet-title">Delete this book?</h2>
  <p class="muted">Highlights and notes made from it are removed too.</p>
  <div class="sheet-actions">
    <button class="btn btn-secondary">Keep it</button>
    <button class="btn btn-danger">Delete</button>
  </div>
</div>
```

### Navigation
- **Phone:** fixed bottom bar, Sheet fill, hairline top edge, four items. Each item is
  a 22px inline-SVG icon over an 11px/600 label, stacked in a 44px target with 3px gap.
  Default muted ink; **active** = Brand Ink Wash pill with ink icon and label. No
  underline indicators, no badges on the nav.
- **≥900px:** the same items become an 88px left rail, 56px targets, hairline right
  edge. The reading route hides the rail.
- **Rule:** icons are drawn on a 24px grid, 1.7px stroke, round caps and joins, fill
  none. No filled icons, no emoji, no icon fonts.

### App bar
- **Pattern:** `.app-bar` — page title (26px/600 ink) with an optional one-line
  `.app-bar-sub` beneath it (12–14px muted, e.g. "Stored on this device only"), and
  `.app-bar-actions` at the trailing edge holding at most one primary button plus one
  icon button. Not sticky: it scrolls away, because the content is the point.

## Do's and Don'ts

### Do:
- **Do** keep one ink action per screen region and let headings stay ink (One Voice Rule).
- **Do** reach for a hairline or a one-step tonal shift before reaching for a shadow.
- **Do** give every tappable thing 44px of height and, on touch, 48px for the primary.
- **Do** use `rem` for type and spacing so 200% text zoom reflows instead of clipping.
- **Do** put a leading 18px icon in ghost buttons that toggle a panel; bare ghost text
  reads as a link.
- **Do** pair a progress bar with its numeric value, and show no bar at all when a book
  is unstarted.
- **Do** write empty states that teach the next action and name the constraint.
- **Do** check both themes at 390px before calling a screen done; dark is not an
  afterthought.
- **Do** respect `prefers-reduced-motion` — the global block already collapses all
  animation to 0.01ms.

### Don't:
- **Don't** use ink for headings, decoration, or two competing actions on one screen.
- **Don't** use amber for the primary action, or put amber and ink side by side as two
  accents; amber is state.
- **Don't** put white text on an amber fill; use ink text on amber.
- **Don't** add a coloured `border-left` stripe to cards, callouts, or banners — status
  is the fill plus the icon.
- **Don't** use glass, blur, translucency, or gradient text anywhere.
- **Don't** put a kicker/eyebrow line above a heading; the heading is enough.
- **Don't** use `clamp()` type scales for product UI; the scale is fixed rem steps
  (11, 12, 14, 16, 17, 19, 22, 26, 32).
- **Don't** use Literata for UI chrome, or a display face anywhere (Two Voices Rule).
- **Don't** stack cards inside cards, or give a card a shadow to separate it from paper.
- **Don't** use emoji, icon fonts, or filled icon styles as interface icons.
- **Don't** animate longer than 240ms or bounce; a page turn is the reference motion.
- **Don't** let body text run wider than 68ch just because the window is wide.
