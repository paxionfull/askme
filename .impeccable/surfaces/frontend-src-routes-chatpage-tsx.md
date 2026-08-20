---
version: 1
slug: "frontend-src-routes-chatpage-tsx"
primary_target: "frontend/src/routes/ChatPage.tsx"
related_targets: ["frontend/src/components/brief/BriefHistoryRail.tsx","frontend/src/components/brief/BriefInsightPanel.tsx"]
---

---
version: 1
slug: "frontend-src-routes-chatpage-tsx"
primary_target: "frontend/src/routes/ChatPage.tsx"
related_targets:
  - "frontend/src/components/brief/BriefHistoryRail.tsx"
  - "frontend/src/components/brief/BriefInsightPanel.tsx"
---

# Brief Page — History Stage Insight (V1)

Visitor mode: **Operate + Read**.
Craft bar: **Linear + Readwise Reader + Vercel** (not Arc).

Four columns: AppShell sidebar (unchanged) | history rail (scroll, no badges) | digest stage (date title, single-column categories) | Insight (summary + Ask).

Mobile ≤900px: History | Brief | Ask tabs.

## Status

- P0 (2026-08-20): when history has items, auto-select latest and load Stage; Get started only if history is empty.
- Polish (2026-08-20): history column alignment; mobile tab contrast; Insight empty/summary honesty; Add-to-Ask hover-only; Ask ready hint.
