---
version: 1
slug: "frontend-src-components-layout-appshell-tsx"
primary_target: "frontend/src/components/layout/AppShell.tsx"
related_targets: ["frontend/src/routes/ChatPage.tsx","frontend/src/App.tsx"]
---

# Askme App Shell — Comp C (Brief-first)

Scope: full application shell redesign within **canon** world. Visitor mode: **Operate**.
Craft bar: **Linear + Readwise Reader + Vercel** (user-confirmed; not Arc).

## Direction

- **Approved comp:** `.impeccable/mocks/comp-c-brief-first.webp` (Comp C)
- Slim **text** nav (Brief / Sources / Settings) — not icon-only 64px rail
- Brief owns the primary stage (full width digest)
- Ask is **on demand**: bottom floating composer + scoped-article chips — not a permanent split pane
- Cool neutrals + indigo sparingly; Geist UI; EN default + ZH toggle
- Dense chrome: 9.5rem sidebar, 2rem controls; active nav = stage fill + ink (not indigo wash)

## Audience & job

Power users triaging source updates: scan digest first, ask follow-ups without losing reading space.

## Constraints (from PRODUCT.md)

- Local-first, no cloud account
- Logo required (`frontend/public/logo.svg`)
- Accessibility hard requirement
- Full EN/ZH i18n

## Status

- Direction approved 2026-08-08
- Layout pass 2026-08-18: ~10rem text nav, Brief-full stage, Ask as bottom dock + on-demand drawer; header collapsed to one toolbar row
