---
target: AppShell / Brief workspace
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
p2_count: 2
timestamp: 2026-08-07T10-13-31Z
slug: frontend-src-components-layout-appshell-tsx
---
# Design Critique — AppShell / Brief

Method: dual-agent (see chat header)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | TopJobBanner strong; cold-start blank Loading; “Generated” reads as status |
| 2 | Match System / Real World | 2 | Digest rule / Rebuild index / Skills / Cookie jargon |
| 3 | User Control and Freedom | 3 | Stop/dismiss/locale/clear chat OK; regenerate affordance unclear |
| 4 | Consistency and Standards | 3 | Settings active tab black vs indigo shell |
| 5 | Error Prevention | 2 | Primary Add to Ask invisible until hover |
| 6 | Recognition Rather Than Recall | 2 | Icon-only rail; hover-only primary actions |
| 7 | Flexibility and Efficiency | 3 | Enter send, filters, drag-scope; few accelerators |
| 8 | Aesthetic and Minimalist Design | 3 | Clean Split Desk; filter+tabs+Ask compete |
| 9 | Error Recovery | 3 | Auth CTAs and disabled Send titles help |
| 10 | Help and Documentation | 3 | Help Get started + Ask How to use; not searchable |
| **Total** | | **27/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** Authored for Askme once Brief+Ask and job chrome appear (local digest → RAG). Icon-only rail and Settings cards still read category-generic until digest content lands. Cold-start blank Loading erases brand.

**Deterministic scan:** CLI `detect.mjs frontend/src` → exit 0, **0 findings**. Browser inject on `/` → 23 runtime findings (7 low-contrast indigo-on-wash chips ~4.1:1; 7 layout-transition; page-level overused-font / flat-type-hierarchy; nested-cards on filter bar; first-viewport-column-overflow on `.app-brief-split`). `/sources` 3, `/settings` 5. Most `text-occlusion` hits are overlay self-interference (false positives).

**Visual overlays:** Injection succeeded via live-server :8400; overlays were visible on Brief desktop. Live-server stopped after Assessment B.

## Overall Impression

Strong Operate craft and product-specific Brief|Ask split, undermined by discoverability of the core “scope article → ask” path and status/action conflation on Generate/Regenerate. Biggest opportunity: make Add to Ask always visible (and contrast-safe) without sacrificing dense chrome.

## What's Working

1. Split Desk Brief composition — date title, indigo BRIEF label, left digest / right Ask.
2. TopJobBanner + nav busy dots for multi-job local workflows.
3. EN/ZH rail toggle and Help/How-to paths for bilingual Operate chrome.

## Priority Issues

### [P1] Hover-only Add to Ask
- **Why:** Primary post-scan action invisible; fails first-timers and touch; contradicts Ask “How to use.” Detector also flags chip low-contrast.
- **Fix:** Always-visible quiet chip; touch always-on; bump contrast to ≥4.5:1.
- **Suggested command:** `/impeccable clarify` or `/impeccable polish`

### [P1] “Generated” button doubles as Regenerate
- **Why:** Status/action conflation; accidental or missed regenerate.
- **Fix:** Separate Ready status from explicit Regenerate (confirm if overview exists).
- **Suggested command:** `/impeccable clarify`

### [P2] Icon-only rail + Settings glyph ambiguity
- **Why:** Recognition failure for Brief/Sources/Settings.
- **Fix:** Clearer Settings icon; coach marks or expand-on-hover labels.
- **Suggested command:** `/impeccable clarify`

### [P2] Brief chrome overload (filters + 5 tabs + Export + Ask)
- **Why:** Delays daily scan; detector nested-cards + column-overflow; mobile fold lost.
- **Fix:** Collapse scope into one menu; demote Export; mobile Ask behind toggle/sheet.
- **Suggested command:** `/impeccable distill` or `/impeccable layout`

### [P3] Settings/Sources jargon for returning locals
- **Why:** Daily triage re-surfaces Cookie / Skills / Rebuild index language.
- **Fix:** Plain labels + one-line why.
- **Suggested command:** `/impeccable clarify`

## Persona Red Flags

**Alex (Power User):** Must hunt hover for Add to Ask; no clear keyboard scope path; How-to steals Ask space once known.

**Jordan (First-Timer):** Icon-only nav; 6-step Help wall; Digest rule / Generated opaque; EN chrome + ZH content tabs looks broken.

**Local researcher (daily scan):** Rebuild index next to Update all feels like footgun; mobile drag tip dead; stacked chrome squeezes digest.

## Cognitive Load

6/8 checklist failures → high. Decision points >4: outline category tabs (5); Help Get started (6 steps).

## Minor Observations

- Skip link present (good).
- Settings black active tab vs indigo shell dialect split.
- Think toggle unexplained in empty Ask.
- Duplicate cluster titles can look like bugs.
- Inter-only / flat hierarchy detector hits largely match intentional DESIGN.md Operate scale (treat as advisory vs redesign mandate).

## Questions to Consider

1. If Add to Ask must stay quiet for density, what visible substitute teaches the ask path on day one?
2. Should Brief open as reading-first with scope one click away, or as a control panel that shows a digest?
3. Is “Generated” protecting users — or training them that status labels are buttons?
4. Should Help stay a 6-step setup forever, or become a short “Today: Update → Scan → Ask” once configured?
