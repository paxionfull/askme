---
target: AppShell / Brief workspace
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
p2_count: 3
timestamp: 2026-08-07T10-31-02Z
slug: frontend-src-components-layout-appshell-tsx
---
# Design Critique — AppShell / Brief (re-run)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Ready/Regenerate strong; cold blank Loading |
| 2 | Match System / Real World | 3 | Templates/cookies/index labels land; Reasoning depth options still API names |
| 3 | User Control and Freedom | 3 | Regen confirm, clear scope, stop/cancel, locale |
| 4 | Consistency and Standards | 3 | Indigo Settings tabs; Think vs dialect |
| 5 | Error Prevention | 3 | Hover Add fixed; regen confirm; Add spam still easy |
| 6 | Recognition Rather Than Recall | 3 | Rail micro labels; Add always on; Think weak |
| 7 | Flexibility and Efficiency | 3 | Enter/drag/filters; few keyboard accelerators |
| 8 | Aesthetic and Minimalist Design | 3 | Scope distilled; solid indigo Add chips compete with scan |
| 9 | Error Recovery | 3 | Auth/job recovery; duplicate titles look like bugs |
| 10 | Help and Documentation | 3 | Help stays 6-step setup after configured |
| **Total** | | **30/40** | **Good** |

## Design Specificity Verdict

**LLM:** Authored for Askme once Brief lands (rail + digest + Ask loop). Boot Loading and provider-parameter Settings options remain interchangeable/generic.

**Deterministic scan:** CLI `frontend/src` → exit 0, **0 findings**. Browser inject: Brief 18 (undersized nav text 10px ×4, layout-transition, nested-cards, column-overflow); Sources 9; Settings 14. Most text-occlusion = overlay self-noise. Inter/overused-font advisory vs DESIGN.md.

**Visual overlays:** live-server :8400 injection OK; overlays on Brief; server stopped.

## Overall Impression

Prior P1s verified fixed; score **27 → 30**. Biggest new issue: always-on solid indigo Add chips over-corrected discoverability into scan competition. Next win is quiet-but-visible Add + humanize Reasoning depth options + branded cold start.

## What's Working

1. Ready + Regenerate + confirm modal — status/action split clean.
2. Progressive disclosure: scope details, Export ⋯, TOC select, mobile Digest|Ask.
3. Rail micro labels + gear; Ask path feedback “N articles added.”

## Priority Issues

### [P1] Solid indigo Add chips overload scan
- Quiet default (outline/soft), solid on hover/focus/touch; keep always visible.
- Suggested: `/impeccable quieter` or `/impeccable polish`

### [P2] Reasoning depth options still API parameter names
- Human labels; raw values internal; optional Advanced.
- Suggested: `/impeccable clarify`

### [P2] Cold-start blank Loading…
- Shell skeleton or branded splash.
- Suggested: `/impeccable onboard` or `/impeccable polish`

### [P2] Duplicate article titles in clusters
- Dedupe by URL/id in tree.
- Suggested: `/impeccable distill`

### [P3] Help forever 6-step; Think opaque; rail labels 10px (detector)
- Post-setup Today card; Think hint; bump nav label ≥11–12px.
- Suggested: `/impeccable clarify` / `/impeccable typeset`

## Persona Red Flags

**Alex:** Add discoverable; wants keyboard scope; How-to until scoped.
**Jordan:** Labels help; Help wall + Think + EN/ZH content mix.
**Local researcher:** Scope/TOC good; chip noise + duplicates slow scan.

## Cognitive Load

3/8 failures → moderate. >4 options: Help 6 steps; Reasoning depth 6 jargon options.

## Minor Observations

Skip link; Sources empty honest; EN/ZH toggle excellent; mobile 4rem rail eats width.

## Questions to Consider

1. Should digest own the accent, with Add as the quiet always-visible tool?
2. Help as setup forever, or Today: Update → Scan → Ask once configured?
3. Is Reasoning depth a user preference or implementer escape hatch?
4. Mobile: keep labeled 4rem rail or icon-only / bottom nav?
