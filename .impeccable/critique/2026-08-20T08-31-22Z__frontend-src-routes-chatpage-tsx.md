---
target: frontend/src/routes/ChatPage.tsx
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-20T08-31-22Z
slug: frontend-src-routes-chatpage-tsx
---
# Critique: frontend/src/routes/ChatPage.tsx (Brief Stage)

Method: dual-agent (A: 3b758cb7-ef10-496c-add3-0a74af500608 · B: c6e57d4f-ad8f-404c-a127-7b5485ca728f)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | History 已有简报时 Stage 仍显示 Get started；Insight 复用 setup，真实状态不可见 |
| 2 | Match System / Real World | 2 | Template↔rules 用词打架；Build index / No index 是 RAG 黑话 |
| 3 | User Control and Freedom | 3 | Stop/Regenerate 确认、History 可选、移动 tabs 可用；缺批量撤销 Add to Ask |
| 4 | Consistency and Standards | 2 | 术语不一；空态教程式 chrome 与已加载 Digest 密度分裂；History 列头与行网格错位 |
| 5 | Error Prevention | 3 | 无 LLM/rule 时 Generate 禁用；Regenerate 有确认 |
| 6 | Recognition Rather Than Recall | 2 | History 不默认选中；Ask How-to 在 Ready 时仍占位 |
| 7 | Flexibility and Efficiency | 2 | Enter/Esc 有；缺 History/分类快捷键；大量同构 Add to Ask 无批量 |
| 8 | Aesthetic and Minimalist Design | 2 | Shell 克制尚可；Stage 卡片叠层 + Add to Ask 洪水 + 空态说明书墙破坏阅读静默 |
| 9 | Error Recovery | 3 | role=alert、Ask 空态链到 Build index、History 失败提示清楚 |
| 10 | Help and Documentation | 3 | Help / Getting Started / How-to 齐全，但帮助挤占主阅读舞台 |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** Brief 四栏 IA（sidebar | BriefHistoryRail | digest stage | BriefInsightPanel）是 Askme 产品指纹：Digest 居中、Ask 在 Insight、「Summarized by Askme」有语义。但视觉执行仍是 Inter + indigo `#5E6AD2` + 冷灰 hairline 的品类 Linear-SaaS 脸——与 PRODUCT 的 Linear+Arc craft bar 同方向，却未到 Arc 冷静阅读：有 History 时仍渲染 Get started 六步墙，Insight 重复 setup，DigestTreeView「Add to Ask」成片铺开。结构有 Askme 指纹；皮肤仍可被换成另一个 indigo SaaS。

**Deterministic scan:** CLI `detect.mjs` 对 ChatPage + brief/* + AppShell 退出码 0、**零静态发现**。浏览器 runtime 注入检出 5 条：`low-contrast`（移动 tabs 激活态 indigo-on-wash 4.1:1）、`line-length`（`p.brief-home-hint` ~114ch）、`overused-font`（Inter 100%）、`layout-transition`（body width）、`text-occlusion`（疑似 detector overlay 伪影，标为假阳性）。LLM 抓住的空态/认知/操作噪声问题 detector 基本未覆盖——以设计评审为准，runtime 对比度与行长是补充证据。

**Visual overlays:** 注入成功；页标题设为 `[Human] Askme Brief`。若本机仍开着该标签，可看到 runtime 高亮。`text-occlusion` 视为 overlay 伪影，不当产品问题。

## Overall Impression

骨架对（Brief Stage），首屏错（有简报却还在 onboarding）。最大机会：默认打开最新 History，把 Stage 还给扫读；再把「Add to Ask」从常驻洪水收成附属操作——这才是去 AI 化的核心，而不是再加装饰。

## What's Working

- 四栏 Brief Stage 与 DESIGN「digest owns center / Ask in Insight」一致，产品骨架对
- AppShell 细标签侧栏 + logo/wordmark + EN/中文，品牌槽与 a11y 基线（skip link、landmarks）到位
- 已加载 Digest：日期标题、Ready/Regenerate/Export、分类折叠，比空态更接近 Linear 操作 chrome；Regenerate 有确认

## Priority Issues

### [P0] 有 History 时仍默认 Get started
- **Why:** 打断「跟进→筛选」；空态教程式喧宾夺主；状态可见性崩盘
- **Fix:** 有 history 则默认选最新并加载 Stage/Insight；Get started 仅零简报出现
- **Suggested command:** `/impeccable onboard`

### [P1] 桌面四栏 + 配置条 + Insight how-to 无单一焦点
- **Why:** Operate+Read 变成多任务墙；认知负载清单失败约 7/8
- **Fix:** 阅读态降权 Generate 工具；Ask 空态改一条情境提示；配置 progressive disclosure
- **Suggested command:** `/impeccable distill`

### [P1] DigestTreeView「Add to Ask」同权重按钮洪水
- **Why:** 扫读被操作噪声淹没；不像 Arc 冷静阅读；典型 AI-tool slop
- **Fix:** hover/focus 才露操作，或 section 级批量；默认只保留标题层级
- **Suggested command:** `/impeccable quieter`

### [P2] Insight「Summarized by Askme」无摘要时复用 setup hint（像假摘要）
- **Why:** 破坏签名面板可信度
- **Fix:** 无摘要显示空/骨架，勿复用 briefHint
- **Suggested command:** `/impeccable clarify`

### [P2] Template / rules / Build index / No index 术语分裂
- **Why:** 用户要翻译系统语言
- **Fix:** 统一 Digest rule；index 用用户语（如 Enable Ask on this brief）
- **Suggested command:** `/impeccable clarify`

## Persona Red Flags

**Alex (Power User):** 首屏被 Get started patronize；53× Add to Ask 无 bulk；无 History/分类键盘加速。

**Jordan (First-Timer):** Template≠rules；「Build an index…」「No index」无白话；四栏不知先看哪；How to use 像内部 API 说明。

**Digest follower（PRODUCT 日更追随者）:** History「重点关注」可见但 Stage 空；点开才进入扫读；Ask 被 index 门挡住，难完成「筛选后追问」。

## Minor Observations

- History 列头 Articles/Sources 与行网格错位
- ≤900px tabs 有效降载，桌面缺同等 progressive disclosure
- 分类 section 卡片化偏重，接近 card-stack slop
- Runtime：移动 tab 激活态对比度不足；home hint 行长过长；Inter 全页（与 DESIGN 一致，属 intentional 风险）

## Questions to Consider

- 若 History 永远自动打开最新简报，Get started 还该出现在 Stage 正中吗？
- 「Add to Ask」是阅读附属，还是 scoped-chat 才是主角？视觉权重是否说反了？
- Insight 上半若从不显示真摘要，删掉是否更诚实？
- Inter+indigo 是 Linear+Arc 终点，还是还没做出 Arc 阅读舞台的密度与静默？
