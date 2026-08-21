# Askme App Shell — Comp A (Linear Split)

Scope: full application redesign. Visitor mode: **Operate**.

## Direction

- **Canon path** with craft bar **Linear + Readwise Reader + Vercel** (not Arc) for density/hierarchy
- **Locked look (user pick 2026-08-21):** forest accent `#14532D`, sage paper `#EEF1EF` / raised `#F6F8F6`, **Public Sans** chrome + **Newsreader** reading
- **Locked Brief layout (T2b-4):** History persistent; digest center; floating Insight `28rem`, inset top/bottom `3.25rem` / right `1.1rem`; **Summary | Ask** underline tabs (forest active); default Summary
- Slim labeled sidebar (~9.5rem), top job banners
- Sparse forest accent; active nav = ink on stage; 2rem controls, 5–6px radius
- English default with EN/ZH toggle in sidebar

## Audience & job

Power users triaging high-volume source updates; scan digest, drill into items, ask follow-up questions.

## Constraints (from PRODUCT.md)

- Local-first, no cloud account
- Logo required (SVG in `frontend/public/logo.svg`)
- Accessibility: focus rings, semantic dialogs, keyboard nav
- Full i18n EN/ZH across shell, routes, modals, and contexts

## Status (2026-08-21)

- Visual tokens + T2b-4 Brief float carbonized
- i18n: complete for UI chrome and status messages
- Responsive: brief/ask stack at ≤900px Brief tabs / ≤768px shell

## Deferred (non-blocking)

- Comp mock per-item bookmark/overflow menus (not in product scope)
- Ask panel「New chat」button (clear chat exists in composer flow)
