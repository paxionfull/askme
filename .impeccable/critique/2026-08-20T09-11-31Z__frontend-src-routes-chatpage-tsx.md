---
target: frontend/src/routes/ChatPage.tsx
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-20T09-11-31Z
slug: frontend-src-routes-chatpage-tsx
---
# Critique: frontend/src/routes/ChatPage.tsx (Brief Stage)

Method: dual-agent (A: 8a322546-2f0f-451e-9592-c0efede92dc6 · B: 1741bbcd-7f36-43fa-9c99-95ef4d7e4c30)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | 有简报默认选最新 + Ready；index 门禁与 raw MD 摘要仍像坏态 |
| 2 | Match System / Real World | 2 | Template / Build index / No index 仍是系统黑话 |
| 3 | User Control and Freedom | 3 | History 可选、移动 tabs、Regenerate 确认；缺 Add-to-Ask 批量撤销 |
| 4 | Consistency and Standards | 3 | History 列对齐、移动 tab 对比度修好；Template↔rule、树 vs Insight 仍分裂 |
| 5 | Error Prevention | 3 | Generate 门禁、Regenerate 确认仍在 |
| 6 | Recognition Rather Than Recall | 3 | 默认打开最新简报；仍需记得 Build index；raw MD 强迫解码 |
| 7 | Flexibility and Efficiency | 2 | Enter/Esc 有；无 History/分类快捷键；53 个 Add 无真·批量流 |
| 8 | Aesthetic and Minimalist Design | 3 | Add hover + TOC 移除后扫读静默大升；工具栏常驻 + Insight raw MD 仍吵 |
| 9 | Error Recovery | 3 | role=alert、Ask 空态链到 Build index 清楚 |
| 10 | Help and Documentation | 3 | Help + Ready 短提示；术语仍要人翻译 |
| **Total** | | **28/40** | **Good** |

Trend: 24 → **28** (+4)。P0 已关；余下主矛盾从「空态抢舞台」变成「阅读态仍吵 + Insight 不像摘要」。

## Design Specificity Verdict

**LLM assessment:** Brief 四栏舞台仍是 Askme 指纹。有简报时默认选最新 History、Stage 进入 Ready 扫读，不再被 Get started 占位。视觉仍是 Inter + indigo + 冷灰 hairline 的 Linear 品类脸；Readwise Reader 气质未兑现——Insight「Summarized by Askme」把摘要以 raw markdown（`[标题](url)`）塞进 `pre-wrap`，像调试输出。结构有 Askme 特异性；皮肤仍可被换成另一个 indigo SaaS。

**Deterministic scan:** CLI `detect.mjs` 退出码 0、零静态发现。浏览器 runtime 注入检出 4 条：`cramped-padding`（`app-brief-stage` 底部贴边）、`overused-font`（Inter 100%）、`layout-transition`（body width）、`text-occlusion`（digest 标题「模型」被 `brief-stage-footer` 遮挡——滚动态需人工确认，不当绝对假阳性）。以设计评审为准；runtime 作补充。

## Overall Impression

首屏修好了：落地即扫读。下一刀该砍「阅读态配置条」和「Insight raw markdown」——否则 peak-end 仍卡在「摘要坏了 / 还要 Build index」。

## What's Working

- P0 落地：有 History 自动选最新；Get started 仅空库
- 桌面 Add-to-Ask hover/focus 揭示 + 移除 TOC tab bar，阅读噪声显著下降
- History Date/Articles 列对齐、移动 tab（ink + accent underline）更像成品 chrome

## Priority Issues

### [P1] Insight「Summarized by Askme」渲染 raw markdown
- **Why:** 砸穿 Readwise Reader 标杆；用户以为摘要坏了；与中栏 Digest 双重竞争
- **Fix:** SummaryMarkdown / 纯散文摘录；禁止裸 `[]()`；无摘要用 briefSummaryEmpty
- **Suggested command:** `/impeccable clarify`

### [P1] 阅读态 Stage 工具栏常驻 Group/Range/Template/Regenerate/Export
- **Why:** 扫读被配置决策打断；四栏已够忙
- **Fix:** 阅读态折叠 scope 到溢出菜单；主路径只留日期+状态+一个次要动作
- **Suggested command:** `/impeccable distill`

### [P2] Template / Build index / No index 术语分裂
- **Why:** 要翻译系统语才能「筛选后追问」
- **Fix:** 统一 Digest rule；index 改用户语（如 Enable Ask on this brief）
- **Suggested command:** `/impeccable clarify`

### [P2] 移动端 `(hover:none)` 下 Add to Ask 全量常驻
- **Why:** 桌面安静、手机洪水
- **Fix:** 行级 overflow / 长按 / 仅分类级入口
- **Suggested command:** `/impeccable quieter`

### [P3] digest-section 卡片叠层 + Inter/indigo 品类脸
- **Why:** 离 Vercel 冷静细节与 Reader 内容优先仍差一档
- **Fix:** 减弱 section 面，强化标题层级与焦点色稀疏度
- **Suggested command:** `/impeccable polish`

## Persona Red Flags

**Alex:** 无 History/分类键盘加速；53× Add 无真批量；Insight raw MD 像调试面板。

**Jordan:** Template≠规则白话；Build index 挡 Ask；四栏不知先看中栏还是右栏。

**Digest follower:** 首屏已能进扫读（改善）；手机 Add 洪水与 raw Insight 打断跟进；追问仍被 index 卡住。

## Minor Observations

- Ready 态 Ask 提示已短于 How-to 墙，但仍挂 Build index
- 中栏树与 Insight 摘要同源不同呈现，易造成「我在读哪一份」
- runtime `text-occlusion`：footer 遮挡 section 标题——滚动时可能是真问题，建议人工确认

## Provocative Questions

- 若 Insight 只展示 3–5 句人话摘要，中栏树是否才是唯一扫读真相？
- Template/Group/Range 是「生成前配置」还是「阅读时控件」——为何在 Ready 态同权？
- 「Add to Ask」在手机是否根本不该是行级按钮？
- Linear chrome + Reader 阅读：哪一侧赢了当前首屏？
- Build index 若改成一次透明后台动作，Ask 还会像半成品吗？
