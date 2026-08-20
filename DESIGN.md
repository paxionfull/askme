---
name: Askme
description: Local digest tool at Linear + Readwise Reader + Vercel craft bar — Geist UI, cool neutrals, sparse indigo, dense chrome, Brief stage with Insight Ask.
colors:
  surface: "#fafafa"
  surface-raised: "#ffffff"
  ink: "#171717"
  ink-muted: "#737373"
  border: "#e5e5e5"
  border-strong: "#d4d4d4"
  accent: "#5e6ad2"
  accent-soft: "#f3f4fb"
  accent-hover: "#4f5abf"
  link: "#404040"
  on-accent: "#ffffff"
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
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  page-title:
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  label:
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  compact:
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  micro:
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
  nav:
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  mono:
    fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
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

Askme is a precision local digest tool on a cool neutral desk: Linear-dense chrome, Readwise Reader–calm content priority, Vercel-clear product hierarchy. **UI face is Geist (Vercel craft bar, intentional)**; indigo is sparse—action, selection indicator, and progress only. The shell keeps a slim labeled sidebar; Brief is a four-column stage (history | digest | Insight with summary + Ask). Expression stays Operate-mode familiar; craft bar is **Linear + Readwise Reader + Vercel** (canon / category standard; not Arc).

**Key Characteristics:**

- Cool `#FAFAFA` stage with white raised panels and `#E5E5E5` hairline borders
- Indigo accent `#5E6AD2` for primary buttons and progress—not for large active-nav washes
- Slim text sidebar (~9.5rem) with logo + wordmark; active nav = ink on stage fill (not indigo wash)
- Control height 2rem / radius 5–6px for Linear density
- Brief history rail; digest categories single column, content-first hairlines; Ask in Insight
- **Geist / Geist Mono** at fixed rem steps (replaces Inter)
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

Restrained neutral stack (slightly cooler Vercel greys) with one indigo accent used sparingly.

### Primary

- **Indigo Accent** (`#5E6AD2`): Primary buttons, progress bars, guide links, focus ring.
- **Indigo Wash** (`#F3F4FB`): Soft fills only when needed (chips, rare accent buttons)—not default active nav.
- **Indigo Hover** (`#4F5ABF`): Primary button hover.
- **On Accent** (`#FFFFFF`): Text on solid indigo fills.

### Neutral

- **Stage** (`#FAFAFA`), **Raised** (`#FFFFFF`), **Ink** (`#171717`), **Muted** (`#737373`), **Border** (`#E5E5E5` / strong `#D4D4D4`), **Link Ink** (`#404040`).
- **Danger** (`#DC2626` / text `#991B1B`), **Warning** (`#B45309` / text `#92400E`) with soft washes — use tokens, not raw Tailwind red/amber.

### Named Rules

**The Indigo Sparingly Rule.** Accent marks actions, selection indicators, and progress—not large background fields or active-nav fills.

## Typography

**Body Font:** Geist (ui-sans-serif / system-ui fallbacks). **Mono:** Geist Mono for code. Fixed rem scale for product UI. Chosen for the Vercel craft-bar commitment (not Inter).

**Character:** Compact Linear UI chrome; Reader-comfortable prose in digest markdown. No display serif pairing.

### Hierarchy

- **Page title** (600, 1.25rem, -0.03em): Route `h1` / Brief stage date.
- **Title** (600, 0.9375rem, -0.02em): Panel headings, sidebar brand name.
- **Body** (400, 0.875rem / 1.5): Default UI copy.
- **Compact** (500, 0.8125rem): Buttons, inputs, desktop nav labels.
- **Label** (500, 0.75rem): Field labels and meta.
- **Micro** (600, 0.6875rem): Lang toggle segments, mobile bottom-nav labels, dense chips.

### Named Rules

**The Fixed Rem Ramp Rule.** Product UI uses the documented rem steps; do not invent ad-hoc display clamps for chrome.

**The Geist Face Rule.** UI chrome and body use Geist; code uses Geist Mono. Do not reintroduce Inter/Roboto as the product face.

## Layout

Brief route uses a four-column stage inside the shell: labeled sidebar + Brief history rail + digest stage + Insight (summary + Ask).

- **Desktop sidebar:** `--sidebar-width: 9.5rem`; raised surface, right hairline; brand row then vertical nav; Help + EN/ZH at foot. Active link = stage fill + ink (not indigo wash).
- **Brief history rail (~17.5rem):** scrollable list of past briefs (no pagination, no status badges).
- **Digest stage (flex):** date as page title; reading-mode toolbar collapses scope; categories single column, hairline sections.
- **Insight pane (~22.5rem):** top “Summarized by Askme” markdown excerpt; bottom Ask composer.
- **Top strip:** Job banners sit above the shell row.
- **Content widths:** narrow 44rem, medium 1200px, wide 1500px via `.app-content-*`.
- **≤900px (Brief):** History | Brief | Ask tabs; one pane at a time.

### Named Rules

**The Brief Stage Rule.** Digest owns the center reading stage; Ask lives in the right Insight pane (or the Ask mobile tab)—not a bottom dock.

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
- **Default:** Raised white, hairline border, ink text.
- **Primary:** Solid indigo / on-accent text.
- **Accent:** Rare indigo wash fill (Think on)—prefer default/ghost when possible.
- **Ghost / Danger:** Transparent muted or soft-danger wash.
- **Icon button:** 32×32 desktop min, transparent until hover.
- **Focus:** Indigo focus ring at ~55% mix, 2px outline / 2px offset.

### Chips

- **Citation / index (`.ui-chip-btn`):** Pill, 24px min; indigo wash when active in content.

### Cards / Containers

- **Raised panel (`.ui-panel`):** White, 1px border, 6px radius—settings sections. Digest sections use hairlines, not stacked cards.

### Inputs / Fields

- **Style:** White fill, 5px radius, 1px border, 0.8125rem type, 2rem min height (44px ≤768px).
- **Focus:** Indigo-tinted border + softer focus ring.

### Navigation

- **Desktop:** Icon (16px) + compact label; active = stage fill + ink + 600 weight (not indigo wash).
- **Brand:** Logo SVG + “Askme” wordmark in the sidebar header.
- **Mobile:** Bottom bar, micro labels, 48px min height per item.
- **Lang toggle:** Segmented EN/中文 at nav foot.

### Ask / Insight

- **Insight:** Markdown-rendered “Summarized by Askme”; Ask composer below.
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

- **Do** keep the Brief four-column stage: history rail + digest + Insight (summary/Ask).
- **Do** keep the ~9.5rem labeled sidebar (logo + wordmark + text nav + Help) on desktop.
- **Do** keep EN default with one-click ZH toggle in the shell chrome.
- **Do** keep the logo SVG in the brand slot.
- **Do** use Geist for UI and Geist Mono for code.
- **Do** keep desktop control height at 2rem; raise on touch breakpoints.
- **Do** preserve focus-visible outlines on all interactive elements.
- **Do** use `.ui-icon-btn` for compact icon-only controls.
- **Do** use `.ui-chip-btn` for inline citation/index chips.

### Don't:

- **Don't** restore the bottom Ask dock as the home composition.
- **Don't** paint active nav with indigo wash by default.
- **Don't** reintroduce Inter/Roboto as the product UI face.
- **Don't** stack decorative cards in the digest reading stage.
- **Don't** invent ad-hoc type sizes outside the rem ramp for chrome.
