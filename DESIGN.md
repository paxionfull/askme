---
name: Askme
description: Local digest tool at Linear + Readwise Reader craft — Public Sans chrome, Newsreader reading, forest accent on sage paper, dense Brief stage with Insight Ask.
colors:
  surface: "#eef1ef"
  surface-raised: "#f6f8f6"
  ink: "#1a1f1c"
  ink-muted: "#6b736e"
  border: "#d7ddd9"
  border-strong: "#c5cdc8"
  accent: "#14532d"
  accent-soft: "#ecfdf5"
  accent-hover: "#166534"
  link: "#3f4a44"
  on-accent: "#f0fdf4"
  success: "#15803d"
  success-soft: "#f0fdf4"
  warning: "#b45309"
  warning-text: "#92400e"
  warning-soft: "#fffbeb"
  error-soft: "#fef2f2"
  danger: "#dc2626"
  danger-text: "#991b1b"
  danger-hover: "#b91c1c"
  danger-track: "#fecaca"
typography:
  body:
    fontFamily: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  page-title:
    fontFamily: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  label:
    fontFamily: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  compact:
    fontFamily: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  micro:
    fontFamily: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
  nav:
    fontFamily: '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  reading:
    fontFamily: '"Newsreader Variable", "Newsreader", Georgia, "Times New Roman", serif'
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.65
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: "5px"
  panel: "6px"
spacing:
  sidebar-width: "9.5rem"
  control-height: "2rem"
  content-narrow: "44rem"
  content-medium: "1200px"
  content-wide: "1500px"
  brief-measure: "42rem"
  ask-composer: "40rem"
components:
  button-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.3rem 0.65rem"
    height: "2rem"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0.3rem 0.65rem"
    height: "2rem"
  button-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "0.3rem 0.65rem"
    height: "2rem"
  input-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.3rem 0.55rem"
    height: "2rem"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "0.3rem 0.5rem"
    height: "2rem"
  nav-link-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.3rem 0.5rem"
    height: "2rem"
---

# Design System: Askme

## Overview

**Creative North Star: "The Brief Stage"**

Askme is a precision local digest tool on a **sage-paper** desk: Linear-dense chrome, Readwise Reader–calm content priority, clear product hierarchy. **UI face is Public Sans**; **digest / Insight / article prose is Newsreader**. Accent is **forest green** (`#14532D`)—action, selection indicator, and progress only. The shell keeps a slim labeled sidebar; Brief is a four-column stage (history | digest | Insight with summary + Ask). Craft bar remains **Linear + Readwise Reader + Vercel** for density and hierarchy (not Arc); the locked palette and type are the user-selected set below—not indigo, not cold pure-white, not Geist.

**Key Characteristics:**

- Sage stage `#EEF1EF` with raised `#F6F8F6` (never pure white) and `#D7DDD9` hairline borders
- Forest accent `#14532D` for primary buttons and progress—not for large active-nav washes
- Slim text sidebar (~9.5rem) with logo + wordmark; active nav = ink on stage fill (not accent wash)
- Control height 2rem / radius 5–6px for Linear density
- Brief history rail; digest categories single column, content-first hairlines; floating Insight with Summary | Ask tabs (T2b-4)
- **Public Sans** for chrome; **Newsreader** for reading surfaces; system mono for code
- English default UI with persistent EN/ZH toggle
- SVG logo in the brand slot (`frontend/public/logo.svg`)
- Accessibility: skip link, landmarks, live regions, modal focus trap, keyboard-reachable hover actions

## Accessibility

- **Landmarks:** Text sidebar `aside`, `#main-content` `main`, route-level `h1` per page; Ask dock/drawer as labeled `region`s.
- **Skip link:** `.app-skip-link` — visible on focus, jumps to main content (EN/ZH via i18n).
- **Dialogs:** `useModalA11y` — focus trap, Esc close, restore focus; `aria-modal` + labelled titles.
- **Live regions:** `TopJobBanner` (`status`/`alert` + progressbar); route errors use `role="alert"`.
- **Keyboard:** Hover-only actions expose `focus-visible:opacity-100` or `focus-within:opacity-100`; overflow/context menus support arrow keys + Esc via `useMenuKeyboard`. Ask drawer toggle uses `aria-expanded` / `aria-controls`.
- **Touch targets:** `.ui-icon-btn` (32px desktop / 44px ≤768px); `.ui-btn` / inputs min 32px desktop, 44px ≤768px; inline citations `.ui-chip-btn` (24px min).
- **Motion:** Prefer authored, short transitions. Under `prefers-reduced-motion`, kill animations but keep brief color/opacity transitions for focus and state feedback.

## Colors

Restrained sage-neutral stack with one forest accent used sparingly. Chosen from the design-choices board (墨绿 / 薄青灰).

### Primary

- **Forest Accent** (`#14532D`): Primary buttons, progress bars, guide links, focus ring.
- **Forest Wash** (`#ECFDF5`): Soft fills only when needed (chips, rare accent buttons)—not default active nav.
- **Forest Hover** (`#166534`): Primary button hover.
- **On Accent** (`#F0FDF4`): Text on solid forest fills.

### Neutral

- **Stage** (`#EEF1EF`), **Raised** (`#F6F8F6`), **Ink** (`#1A1F1C`), **Muted** (`#6B736E`), **Border** (`#D7DDD9` / strong `#C5CDC8`), **Link Ink** (`#3F4A44`).
- **Danger** (`#DC2626` / text `#991B1B`), **Warning** (`#B45309` / text `#92400E`) with soft washes — use tokens, not raw Tailwind red/amber.

### Named Rules

**The Forest Sparingly Rule.** Accent marks actions, selection indicators, and progress—not large background fields or active-nav fills.

**The Non-White Stage Rule.** Stage and raised panels stay on the sage paper ramp; do not reintroduce pure `#FFFFFF` raised panels or cold `#FAFAFA` stage as defaults.

## Typography

**UI Font:** Public Sans (ui-sans-serif / system-ui fallbacks). **Reading Font:** Newsreader for digest markdown, Insight summary, and article body. **Mono:** system ui-monospace stack for code. Fixed rem scale for product UI.

**Character:** Compact Linear UI chrome; Reader-comfortable serif prose in digest / Insight. Split faces are intentional.

### Hierarchy

- **Page title** (600, 1.25rem, -0.03em): Route `h1` / Brief stage date — Public Sans.
- **Title** (600, 0.9375rem, -0.02em): Panel headings, sidebar brand name — Public Sans.
- **Body** (400, 0.875rem / 1.5): Default UI copy — Public Sans.
- **Reading** (400, ~0.9375rem / 1.65): `.markdown-body`, digest article titles, Insight summary — Newsreader.
- **Compact** (500, 0.8125rem): Buttons, inputs, desktop nav labels.
- **Label** (500, 0.75rem): Field labels and meta.
- **Micro** (600, 0.6875rem): Lang toggle segments, mobile bottom-nav labels, dense chips.

### Named Rules

**The Fixed Rem Ramp Rule.** Product UI uses the documented rem steps; do not invent ad-hoc display clamps for chrome.

**The Split Face Rule.** Chrome (shell, controls, nav, settings) uses Public Sans; long-form reading surfaces use Newsreader. Do not put Newsreader on buttons/nav; do not put Public Sans on digest prose by default. Do not reintroduce Geist/Inter/Roboto as the product face.

## Layout

Brief route: labeled sidebar + persistent History rail + digest stage, with a **floating Insight panel** (not an abutting fourth column).

- **Desktop sidebar:** `--sidebar-width: 9.5rem`; raised surface, right hairline; brand row then vertical nav; Help + EN/ZH at foot. Active link = stage fill + ink (not accent wash).
- **Brief history rail (~17.5rem):** scrollable list of past briefs (no pagination, no status badges). **Persistent.**
- **Digest stage (flex):** date as page title; reading-mode toolbar collapses scope; categories single column, hairline sections. Desktop reserves right padding so content clears the float.
- **Insight float (locked T2b-4):** absolute panel, width `28rem`, inset `top/bottom 3.25rem`, `right 1.1rem`; raised surface, hairline border, panel radius, soft lift shadow — **does not share an edge with the digest column**. Internal **Summary | Ask** underline tabs (active = forest accent text + underline). Default tab: Summary (full-height reading). Ask tab: full-height thread + composer.
- **Top strip:** Job banners sit above the shell row.
- **Content widths:** narrow 44rem, medium 1200px, wide 1500px via `.app-content-*`.
- **≤900px (Brief):** History | Brief | Ask tabs; Ask tab shows the insight panel full-bleed (tabs still Summary | Ask inside).

### Named Rules

**The Brief Stage Rule.** Digest owns the center reading stage; Summary and Ask live in the floating Insight panel (or the Ask mobile tab)—not a bottom dock and not an abutting right column.

**The Insight Float Rule.** Insight must float with visible gap from the digest stage edges (T2b-4 insets). Summary and Ask are mutually exclusive tabs so each can use full panel height.

**The Text Nav Rule.** Desktop navigation is a ~9.5rem labeled sidebar (icon + readable label), not an icon-only 64px rail.

**The Dense Control Rule.** Desktop controls target `--control-height: 2rem`; touch breakpoints raise to ≥44px.

## Elevation & Depth

Flat panels with hairline borders by default. Lift appears only for modals, the Ask conversation drawer, and the active lang-toggle segment.

### Shadow Vocabulary

- **Modal lift** (`0 16px 40px color-mix(in srgb, var(--ink) 12%, transparent)`): Dialogs only.
- **Ask drawer lift** (`0 -8px 28px color-mix(in srgb, var(--ink) 8%, transparent)`): Upward soft lift when the conversation drawer is open.
- **Lang segment** (`0 1px 2px color-mix(in srgb, var(--ink) 8%, transparent)`): Active EN/ZH segment in the toggle.

### Named Rules

**The Flat-By-Default Rule.** Resting chrome and panels stay border-flat. Shadows respond to overlay or open-drawer state only.

## Shapes

5px controls (`.ui-btn`, inputs, nav links), 6px panels (`.ui-panel`, modals)—Linear-tight radius. Citation chips use full pill radius (9999px). No neobrutalist hard offsets.

## Components

Primitives live as `.ui-*` and shell classes in `frontend/src/index.css`.

### Buttons

- **Shape:** 5px radius; desktop min-height 2rem.
- **Default:** Raised sage, hairline border, ink text.
- **Primary:** Solid forest / on-accent text.
- **Accent:** Rare forest wash fill (Think on)—prefer default/ghost when possible.
- **Ghost / Danger:** Transparent muted or soft-danger wash.
- **Icon button:** 32×32 desktop min, transparent until hover.
- **Focus:** Forest focus ring at ~55% mix, 2px outline / 2px offset.

### Chips

- **Citation / index (`.ui-chip-btn`):** Pill, 24px min; forest wash when active in content.

### Cards / Containers

- **Raised panel (`.ui-panel`):** Sage raised, 1px border, 6px radius—settings sections. Digest sections use hairlines, not stacked cards.

### Inputs / Fields

- **Style:** Raised fill, 5px radius, 1px border, 0.8125rem type, 2rem min height (44px ≤768px).
- **Focus:** Forest-tinted border + softer focus ring.

### Navigation

- **Desktop:** Icon (16px) + compact label; active = stage fill + ink + 600 weight (not accent wash).
- **Brand:** Logo SVG + “Askme” wordmark in the sidebar header.
- **Mobile:** Bottom bar, micro labels, 48px min height per item.
- **Lang toggle:** Segmented EN/中文 at nav foot.

### Ask / Insight

- **Float:** Desktop Insight is a floating panel (28rem, inset 3.25rem vertical / 1.1rem right)—not flush with digest.
- **Tabs:** Summary | Ask (underline, forest active). Default Summary; each tab owns full panel height.
- **Summary:** Markdown “Summarized by Askme” in Newsreader; empty honesty when uncached.
- **Ask:** Thread + composer when Ask tab is active.
- **Reading toolbar:** Ready + Regenerate + Export; scope fields behind Brief scope disclosure.

### TopJobBanner

Progress / success / warning / error / neutral tones—semantic washes, not accent fills for warnings/errors.

## Internationalization

- **Default locale:** English (`en`).
- **Toggle:** Sidebar / bottom-nav EN / 中文 segmented control; persists to `localStorage`.
- **Copy:** All UI strings via `frontend/src/i18n/messages.ts` and `useLocale()` / `formatMessage()`.
- **User content:** Article titles and generated digest body remain in source language.

## Do's and Don'ts

### Do:

- **Do** keep History rail persistent; keep Insight as a floating Summary | Ask tab panel (T2b-4 insets), not an abutting column.
- **Do** keep the ~9.5rem labeled sidebar (logo + wordmark + text nav + Help) on desktop.
- **Do** keep EN default with one-click ZH toggle in the shell chrome.
- **Do** keep the logo SVG in the brand slot.
- **Do** use Public Sans for chrome and Newsreader for reading surfaces.
- **Do** keep forest accent sparse; keep sage paper (non-white) stage/raised.
- **Do** keep desktop control height at 2rem; raise on touch breakpoints.
- **Do** preserve focus-visible outlines on all interactive elements.
- **Do** use `.ui-icon-btn` for compact icon-only controls.
- **Do** use `.ui-chip-btn` for inline citation/index chips.

### Don't:

- **Don't** restore an abutting Insight column or stack Summary above Ask in the same scroll without tabs.
- **Don't** paint active nav with accent wash by default.
- **Don't** reintroduce indigo, pure-white raised panels, or Geist/Inter/Roboto as the product face.
- **Don't** stack decorative cards in the digest reading stage.
- **Don't** put Newsreader on chrome controls or Public Sans on digest long-form by default.
