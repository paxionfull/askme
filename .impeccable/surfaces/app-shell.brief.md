# Askme App Shell — Comp A (Linear Split)

Scope: full application redesign. Visitor mode: **Operate**.

## Direction

- **Canon path** with craft bar **Linear + Readwise Reader + Vercel** (not Arc)
- **Approved comp:** `.impeccable/mocks/comp-a-linear-split.webp` (Comp A)
- Icon rail (56px), top job banners, brief + ask split on home route
- Cool neutrals + sparse indigo; Geist UI type; English default with EN/ZH toggle in sidebar
- Dense chrome: ~9.5rem sidebar, 2rem controls, 5–6px radius; active nav = ink on stage (not indigo wash)

## Audience & job

Power users triaging high-volume source updates; scan digest, drill into items, ask follow-up questions.

## Constraints (from PRODUCT.md)

- Local-first, no cloud account
- Logo required (SVG in `frontend/public/logo.svg`)
- Accessibility: focus rings, semantic dialogs, keyboard nav
- Full i18n EN/ZH across shell, routes, modals, and contexts

## Status (2026-08-07)

- i18n: complete for UI chrome and status messages
- Responsive: brief/ask stack at ≤768px
- DESIGN.md + sidecar updated; finish review disposition: **fix** → mobile stack applied

## Deferred (non-blocking)

- Comp mock per-item bookmark/overflow menus (not in product scope)
- Ask panel「New chat」button (clear chat exists in composer flow)
