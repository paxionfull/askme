---
target: AppShell / Brief workspace
total_score: 35
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
p2_count: 2
timestamp: 2026-08-07T11-09-57Z
slug: frontend-src-components-layout-appshell-tsx
---
# Design Critique — AppShell / Brief (re-run 5)

Method: dual-agent (A: 7f3c9ff3-9436-4185-a47c-e5b66604fc09 · B: 3e3b87fa-0644-45d7-90fd-e39e120a612c)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Ready / jobs / skeletons solid |
| 2 | Match System / Real World | 4 | Digest → Add to Ask → Ask workflow |
| 3 | User Control and Freedom | 3 | No undo for Add to Ask / scope |
| 4 | Consistency and Standards | 3 | “N articles” vs “N sources”; mobile `.ui-btn` vs `hidden` |
| 5 | Error Prevention | 3 | Section/cluster Add still easy to over-scope |
| 6 | Recognition Rather Than Recall | 4 | Desktop rail + mobile bottom labeled nav |
| 7 | Flexibility and Efficiency | 3 | Shortcuts present; gated silent no-ops + alert cheat sheet |
| 8 | Aesthetic and Minimalist Design | 3 | Mobile chrome distill claimed but Regenerate still visible |
| 9 | Error Recovery | 4 | Job banners + syndication collapse trust |
| 10 | Help and Documentation | 4 | Help Today + `?` shortcut |
| **Total** | | **35/40** | **Good** |

## Design Specificity Verdict

**LLM:** Authored for Askme (Brief/Ask split, Add to Ask, EN/ZH, indigo). Soft spots: Inter/Linear vocabulary; dual disclosure copy; `window.alert` shortcuts.

**Deterministic scan:** CLI `frontend/src` → `[]` (exit 0). Browser Brief 13 / Sources 3 / Settings 7. Real-ish: `layout-transition`, `flat-type-hierarchy`, Settings `tiny-text` (11px). FP: overlay `text-occlusion`, Inter `overused-font`, Brief `nested-cards` heuristic.

**Visual overlays:** live-server :8400 injection OK on Brief/Sources/Settings; server stopped after run.

## Overall Impression

**27 → 30 → 34 → 36 → 35.** Bottom nav, EventBlock “N articles”, geometric A logo, and shortcuts landed. Score dipped because mobile Regenerate hide is broken (`.ui-btn { display:inline-flex }` beats Tailwind `hidden`), so H8 fell 4→3; dual articles/sources metaphor and chrome density remain.

## What's Working

1. Mobile bottom labeled Brief / Sources / Settings / Help (+ lang) with rail hidden ≤768.
2. EventBlock collapsed “3 articles” progressive disclosure.
3. Status craft: Ready, TopJobBanner, labeled wayfinding, Help/`?`.

## Priority Issues

### [P1] Mobile Regenerate hide fails
- **What:** `ui-btn hidden … sm:inline-flex` still shows Regenerate at ~390px beside ⋯.
- **Why:** Claimed chrome distill is false in browser; thumb zone stays crowded.
- **Fix:** Wrapper hide, `!important` max-sm rule, or don’t put `ui-btn` on that control.
- **Suggested:** `/impeccable polish`

### [P2] Dual metaphors — “N articles” vs “N sources”
- **What:** EventBlock vs TitleClusterRow use different count labels for the same expand pattern.
- **Why:** Two mental models for one disclosure.
- **Fix:** One owned word everywhere + same expand chrome.
- **Suggested:** `/impeccable clarify`

### [P2] Mobile Brief chrome still stacks before first digest row
- **What:** Scope + Ready + Regenerate + ⋯ + Digest/Ask + Jump + second ⋯.
- **Why:** First job is scan; controls steal first viewport.
- **Fix:** Default scope closed on narrow; single overflow; demote Jump.
- **Suggested:** `/impeccable distill`

### [P3] Shortcut feedback & discoverability
- **What:** Gated `G`/`Shift+R` silent; composer uses `window.alert`.
- **Fix:** Toast/disabled reason; shortcuts in Help, not alert.
- **Suggested:** `/impeccable harden`

### [P3] No undo for Add to Ask
- **Fix:** Clear-last / undo chip / confirm on section Add.
- **Suggested:** `/impeccable harden`

## Persona Red Flags

**Alex:** Shortcuts exist but silent no-ops feel broken; alert cheat sheet cheap.
**Jordan:** Bottom labels help; dense mobile chrome + articles/sources dual model remain.
**Local researcher:** Strong digest→ask; accidental section Add without undo; mobile regen vs reading.

## Cognitive Load

3/8 failures → moderate (single focus, chunking, one-thing-at-a-time on mobile chrome).

## Minor Observations

- Two “More brief actions” on narrow (header + tree).
- Logo absent from mobile bottom chrome (brand weak).
- Detector: layout-transition / flat-type-hierarchy / Settings tiny-text worth polish backlog, not P1 UX.

## Questions to Consider

1. If Regenerate must stay one tap on phone, why hide only Export?
2. Should the product own one word — articles or sources?
3. Could mobile Brief chrome be only date + scope chip + ⋯?
4. Would failed `G` saying “Template required” beat silence?
