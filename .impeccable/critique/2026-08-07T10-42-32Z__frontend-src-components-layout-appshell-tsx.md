---
target: AppShell / Brief workspace
total_score: 34
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
p2_count: 2
timestamp: 2026-08-07T10-42-32Z
slug: frontend-src-components-layout-appshell-tsx
---
# Design Critique — AppShell / Brief (re-run 3)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Ready/jobs strong; RouteFallback BRIEF chrome on non-Brief routes |
| 2 | Match System / Real World | 4 | Human Reasoning labels; Help Today daily language |
| 3 | User Control and Freedom | 3 | Stop/Clear/Regen confirm solid |
| 4 | Consistency and Standards | 3 | Wrong-route loading chrome |
| 5 | Error Prevention | 3 | Quieter Add; cluster add spam still easy |
| 6 | Recognition Rather Than Recall | 4 | 11px rail; Add visible; Think title/aria |
| 7 | Flexibility and Efficiency | 3 | Enter/drag/mobile tabs; few keyboard accelerators |
| 8 | Aesthetic and Minimalist Design | 4 | Quiet Add restores digest primacy |
| 9 | Error Recovery | 3 | Syndication twins still look like bugs |
| 10 | Help and Documentation | 4 | Today 3-step when configured |
| **Total** | | **34/40** | **Good** |

## Design Specificity Verdict

**LLM:** Authored for Askme digest→Ask loop. Generic spots: provider-flavored Reasoning dial; one-size BRIEF skeleton on every lazy route.

**Deterministic scan:** CLI clean []. Browser Brief 17 (layout-transition, nested-cards, Inter advisory, first-viewport overflow); Sources 3; Settings 6. text-occlusion mostly overlay noise. Inter intentional per DESIGN.md.

**Visual overlays:** live-server :8400 OK; stopped after run.

## Overall Impression

**27 → 30 → 34.** Shipped quieter Add, Help Today, humanized Reasoning, shell Suspense, Think hints, 11px rail. Remaining P1 is syndication same-title twins; P2 RouteFallback + chip border:0 conflict.

## What's Working

1. Quiet Add chips — discoverable without owning accent.
2. Help Today progressive disclosure.
3. Shell Suspense keeps rail; Think hints; rail labels readable.

## Priority Issues

### [P1] Syndication twins still look like failed dedupe
- Same title, different source URLs listed twice.
- Fix: collapse by normalized title with “N sources” expand; keep URL/id dedupe.
- Suggested: `/impeccable distill`

### [P2] RouteFallback hardcodes BRIEF on every lazy route
- Sources/Settings load under BRIEF eyebrow.
- Fix: route-aware or neutral skeleton.
- Suggested: `/impeccable polish`

### [P2] Add “outline” incomplete — `.ui-chip-btn { border: 0 }` kills border
- Fix: allow border on Add variant.
- Suggested: `/impeccable polish`

### [P3] Reasoning depth still 6-way implementer dial
- Auto default + Advanced.
- Suggested: `/impeccable distill`

### [P3] Mobile labeled 4rem rail taxes content
- Icon-only or bottom nav ≤768.
- Suggested: `/impeccable adapt`

## Persona Red Flags

**Alex:** wants keyboard/bulk scope.
**Jordan:** Help Today wins; Think still hover-heavy for meaning.
**Local researcher:** quiet Add helps; syndication twins burn scan trust.

## Cognitive Load

3/8 failures → moderate. Help Today now ≤4 options.

## Minor Observations

Skip link; EN/ZH excellent; logo reads as letter-mark at rail size.

## Questions to Consider

1. Collapse identical titles across sources, or keep separate Askable rows?
2. Must loading chrome match active rail route?
3. Show Think cost inline vs title-only?
4. Always-visible Ask pane worth desktop dual-focus tax?
