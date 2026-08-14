---
name: Askme
description: Linear-grade local digest tool — cool neutrals, indigo accent, slim text nav, Brief-first stage with on-demand Ask dock.
colors:
  surface: "#fafafa"
  surface-raised: "#ffffff"
  ink: "#18181b"
  ink-muted: "#52525b"
  border: "#e4e4e7"
  border-strong: "#d4d4d8"
  accent: "#5e6ad2"
  accent-soft: "#eef0fb"
  accent-hover: "#4f5abf"
  link: "#3f3f46"
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
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  page-title:
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.35rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  label:
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.45
  compact:
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
  micro:
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.25
  nav:
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.01em"
rounded:
  control: "6px"
  panel: "8px"
spacing:
  sidebar-width: "10rem"
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
    padding: "0.4rem 0.75rem"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0.4rem 0.75rem"
  button-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "0.4rem 0.75rem"
  input-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.4rem 0.65rem"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "0.4rem 0.55rem"
    height: "2.25rem"
  nav-link-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "0.4rem 0.55rem"
    height: "2.25rem"
---

# Design System: Askme

## Overview

**Creative North Star: "The Brief Stage"**

Askme is a precision local digest tool on a cool neutral desk: Linear-dense chrome, Arc-calm reading, indigo reserved for action and selection. The shell is Comp C Brief-first — a slim labeled sidebar, digest as the full-width primary stage, and Ask as an on-demand bottom dock with an expandable conversation drawer. Expression stays Operate-mode familiar; craft bar is Linear + Arc (canon / category standard).

**Key Characteristics:**

- Cool `#FAFAFA` stage with white raised panels and `#E4E4E7` hairline borders
- Indigo accent `#5E6AD2` for primary buttons, active nav, progress fills
- Slim text sidebar (~10rem) with logo + wordmark, icon + label nav; mobile bottom nav
- Brief owns the reading stage; Ask dock + optional drawer — no permanent Brief|Ask split
- Inter UI type at fixed rem steps; ~42rem digest measure, ~40rem Ask composer
- English default UI with persistent EN/ZH toggle in the sidebar (and mobile bottom nav)
- SVG logo in the brand slot (`frontend/public/logo.svg`)
- Accessibility: skip link, landmarks, live regions, modal focus trap, keyboard-reachable hover actions

## Accessibility

- **Landmarks:** Text sidebar `aside`, `#main-content` `main`, route-level `h1` per page; Ask dock/drawer as labeled `region`s.
- **Skip link:** `.app-skip-link` — visible on focus, jumps to main content (EN/ZH via i18n).
- **Dialogs:** `useModalA11y` — focus trap, Esc close, restore focus; `aria-modal` + labelled titles.
- **Live regions:** `TopJobBanner` (`status`/`alert` + progressbar); route errors use `role="alert"`.
- **Keyboard:** Hover-only actions expose `focus-visible:opacity-100` or `focus-within:opacity-100`; overflow/context menus support arrow keys + Esc via `useMenuKeyboard`. Ask drawer toggle uses `aria-expanded` / `aria-controls`.
- **Touch targets:** `.ui-icon-btn` (36px) for icon chrome; `.ui-btn` / inputs min 36px desktop, 44px ≤768px; inline citations `.ui-chip-btn` (24px min).
- **Motion:** Prefer authored, short transitions. Under `prefers-reduced-motion`, kill animations but keep brief color/opacity transitions for focus and state feedback.

## Colors

Restrained neutral stack with one indigo accent and semantic washes.

### Primary

- **Indigo Accent** (`#5E6AD2`): Primary buttons, active navigation, progress bars, guide links.
- **Indigo Wash** (`#EEF0FB`): Active nav background, accent button fills.
- **Indigo Hover** (`#4F5ABF`): Primary button hover.
- **On Accent** (`#FFFFFF`): Text on solid indigo fills.

### Neutral

- **Stage** (`#FAFAFA`), **Raised** (`#FFFFFF`), **Ink** (`#18181B`), **Muted** (`#52525B`), **Border** (`#E4E4E7` / strong `#D4D4D8`), **Link Ink** (`#3F3F46`).
- **Danger** (`#DC2626` / text `#991B1B`), **Warning** (`#B45309` / text `#92400E`) with soft washes — use tokens, not raw Tailwind red/amber.

### Named Rules

**The Indigo Sparingly Rule.** Accent marks actions, selection, and progress—not large background fields.

## Typography

**Body Font:** Inter (ui-sans-serif / system-ui fallbacks). Fixed rem scale for product UI.

**Character:** Compact Linear UI chrome; Notion-comfortable prose in digest markdown. No display serif pairing.

### Hierarchy

- **Page title** (600, 1.35rem, -0.025em): Route `h1` (Brief, Sources, Settings).
- **Title** (600, 0.9375rem): Panel headings, sidebar brand name.
- **Body** (400, 0.875rem / 1.5): Default UI copy.
- **Compact** (500, 0.8125rem): Buttons, inputs, desktop nav labels.
- **Label** (500, 0.75rem): Field labels and meta.
- **Micro** (600, 0.6875rem): Lang toggle segments, mobile bottom-nav labels, dense chips.

### Named Rules

**The Fixed Rem Ramp Rule.** Product UI uses the documented rem steps; do not invent ad-hoc display clamps for chrome.

## Layout

Brief-first shell: labeled sidebar + full-width main; home route stages digest above a persistent Ask dock.

- **Desktop sidebar:** `--sidebar-width: 10rem`; raised surface, right hairline border; brand row (24px logo + wordmark) then vertical nav with icon + text label.
- **Main stage:** `#main-content` fills remaining width; Brief overview scrolls full-bleed within the stage; digest body centers at ~42rem; Ask composer centers at ~40rem.
- **Ask (Comp C):** Bottom `.app-ask-dock` always present on Brief (scoped chips + composer). Conversation is an expandable `.app-ask-drawer` above the dock (max ~48vh / 28rem), not a permanent side pane.
- **Top strip:** Job banners (LLM config, onboarding, refresh, digest) sit above the shell row.
- **Content widths:** narrow 44rem, medium 1200px, wide 1500px via `.app-content-*`.
- **≤768px:** Sidebar hidden; bottom nav with icon + micro label + lang toggle. Ask drawer max ~36vh / 16rem. Form controls min-height 44px. Sources stack: feed sidebar max ~40vh above article list.

### Named Rules

**The Brief Owns the Stage Rule.** Digest is the primary full-width surface. Ask is dock + optional drawer—never a permanent Brief|Ask split pane.

**The Text Nav Rule.** Desktop navigation is a ~10rem labeled sidebar (icon + readable label), not an icon-only 64px rail.

## Elevation & Depth

Flat panels with hairline borders by default. Lift appears only for modals, the Ask conversation drawer, and the active lang-toggle segment.

### Shadow Vocabulary

- **Modal lift** (`0 16px 40px color-mix(in srgb, var(--ink) 12%, transparent)`): Dialogs only.
- **Ask drawer lift** (`0 -8px 28px color-mix(in srgb, var(--ink) 8%, transparent)`): Upward soft lift when the conversation drawer is open.
- **Lang segment** (`0 1px 2px color-mix(in srgb, var(--ink) 8%, transparent)`): Active EN/ZH segment in the toggle.

### Named Rules

**The Flat-By-Default Rule.** Resting chrome and panels stay border-flat. Shadows respond to overlay or open-drawer state only.

## Shapes

6px controls (`.ui-btn`, inputs, nav links), 8px panels (`.ui-panel`, modals)—compact Linear radius. Citation chips use full pill radius (9999px). No neobrutalist hard offsets.

## Components

Primitives live as `.ui-*` and shell classes in `frontend/src/index.css`.

### Buttons

- **Shape:** Gently curved controls (6px).
- **Default:** Raised white, `#E4E4E7` border, ink text; hover stage fill + stronger border.
- **Primary:** Solid indigo / on-accent text; hover indigo-hover.
- **Accent:** Indigo wash fill, indigo text (e.g. Think on).
- **Ghost / Danger:** Transparent muted or soft-danger wash; solid danger for hard stops.
- **Icon button:** 36×36 min, transparent until hover.
- **Focus:** Indigo focus ring at ~55% mix, 2px outline / 2px offset.

### Chips

- **Citation / index (`.ui-chip-btn`):** Pill, 24px min; indigo wash when active in content.

### Cards / Containers

- **Raised panel (`.ui-panel`):** White, 1px border, 8px radius—settings sections and digest chrome. No nested card stacks for decoration.

### Inputs / Fields

- **Style:** White fill, 6px radius, 1px border, 0.8125rem type, 36px min height (44px ≤768px).
- **Focus:** Indigo-tinted border + softer focus ring (45% mix).

### Navigation

- **Desktop:** Horizontal icon (16px) + compact label (0.8125rem / 500) in a column nav; active = indigo wash + indigo text + 600 weight; optional progress dot on Brief/Sources.
- **Brand:** Logo SVG + “Askme” wordmark (title size) in the sidebar header.
- **Mobile:** Bottom bar, column icon + micro label (0.6875rem / 600), 48px min height per item.
- **Lang toggle:** Segmented EN/中文 control at nav foot; persists locale.

### Ask dock & drawer (signature)

- **Dock:** Raised strip, top hairline, safe-area padding; scoped-article chips + multiline composer + Think / Send.
- **Drawer:** Opens above the dock on demand; header with Ask title + Close; conversation scroll; upward soft shadow. Collapsed by default so Brief keeps the stage.

### TopJobBanner

Progress / success / warning / error / neutral tones for refresh, index, digest, and onboarding jobs—semantic washes, not accent fills for warnings/errors.

## Internationalization

- **Default locale:** English (`en`).
- **Toggle:** Sidebar / bottom-nav EN / 中文 segmented control; persists to `localStorage`.
- **Copy:** All UI strings via `frontend/src/i18n/messages.ts` and `useLocale()` / `formatMessage()`.
- **User content:** Article titles and generated digest body remain in source language.

## Do's and Don'ts

### Do:

- **Do** keep Brief as the full-width primary stage and Ask as dock + optional drawer.
- **Do** keep the ~10rem labeled sidebar (logo + wordmark + text nav) on desktop.
- **Do** keep EN default with one-click ZH toggle in the shell chrome.
- **Do** use the logo SVG in the brand slot.
- **Do** preserve focus-visible outlines on all interactive elements.
- **Do** use `.ui-icon-btn` (36×36px min) for compact icon-only controls (⋯, ↻, drag handles).
- **Do** use `.ui-chip-btn` for inline citation/index chips (24px min touch floor).
- **Do** use documented type steps (compact nav labels; micro for lang toggle / mobile nav).

### Don't:

- **Don't** restore a permanent Brief|Ask split pane or Brief/Ask mobile tab switcher as the home composition.
- **Don't** shrink the desktop nav back to an icon-only ~64px rail.
- **Don't** reintroduce warm parchment palette from the previous world.
- **Don't** use colored side-tab borders on cards or nav items.
- **Don't** hardcode UI strings outside `messages.ts`.
- **Don't** flood large surfaces with indigo wash—accent stays sparse.
