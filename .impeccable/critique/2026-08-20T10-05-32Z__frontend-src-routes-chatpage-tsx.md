---
target: frontend/src/routes/ChatPage.tsx
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-20T10-05-32Z
slug: frontend-src-routes-chatpage-tsx
---
# Critique: frontend/src/routes/ChatPage.tsx (Brief Stage)

Method: dual-agent (A: a0b0f3bb-95ef-4232-b49c-1f2078b9cb36 · B: cbc36adf-ce9f-46ff-850c-5e0058190c59)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Ready + 默认最新 History；Ask 仍靠 Enable Ask 暗示索引态 |
| 2 | Match System / Real World | 3 | Enable Ask 改善明显；Brief scope 内 Rule 仍偏系统语 |
| 3 | User Control and Freedom | 3 | History/Regenerate/scope 可用；Add 无批量撤销 |
| 4 | Consistency and Standards | 3 | Geist 体系一致；中栏树 vs Insight 同源双呈现 |
| 5 | Error Prevention | 3 | Generate 门禁、Regenerate 确认 |
| 6 | Recognition Rather Than Recall | 3 | 自动打开最新；仍需记得 Enable Ask |
| 7 | Flexibility and Efficiency | 2 | 无 History/分类快捷键；无真批量 Add |
| 8 | Aesthetic and Minimalist Design | 3 | Geist/密度大升；重点关注 indigo wash + 四栏并行仍吵 |
| 9 | Error Recovery | 3 | alert + Enable Ask 链路清楚 |
| 10 | Help and Documentation | 3 | Help + Ready 短提示；术语门槛降低但仍非零 |
| **Total** | | **29/40** | **Good** |

Trend: 24 → 28 → **29** (+1)。P0 仍为 0。主矛盾从「皮肤是 Inter SaaS」转为「Reader 摘要诚实度 + Ask 闭环摩擦」。

## Design Specificity Verdict

**LLM assessment:** 四栏 Brief 仍是 Askme 指纹。Geist + 紧 chrome + stage-fill active nav 已把皮肤推离「Inter + indigo wash SaaS」，贴近 Linear+Vercel。Indigo 仍在 logo、Send、History 点、重点关注 wash 上冒头，但不再整页洗色。Readwise 只兑现一半：中栏 hairline 安静，Insight 仍是链接清单镜像，非散文摘要。结构专属；皮肤已离开 generic indigo SaaS，尚未三标杆齐平。

**Deterministic scan:** CLI `detect.mjs` 退出码 0、零静态发现。浏览器 runtime：`cramped-padding`、`overused-font`(geist — ignoreValues 已登记但注入未带 config，视为已知 intentional)、`flat-type-hierarchy`、`layout-transition`(body width)。以设计评审为准；runtime 作补充。

## Overall Impression

Craft 第一刀奏效：首屏读作产品面，不再是模板脸。下一刀该砍 **Insight 与中栏的双重阅读**，以及 **Enable Ask 挡闭环**——否则峰-终仍停在半成品。

## What's Working

- Geist + 9.5rem 侧栏 + 2rem 控件 + active nav = stage/ink：首次像 Vercel/Linear chrome
- 阅读主路径：自动选 History、Brief scope 折叠、桌面 Add hover、Insight markdown、Enable Ask 文案
- CLI 干净；先前 raw MD / Build index / Get started P0–P1 基本关闭

## Priority Issues

### [P1] Digest 树与 Insight 摘要双轨同内容
- **Why:** 拆掉 Reader 单一阅读真相；注意力被右栏链接清单拉扯
- **Fix:** Insight 改 3–5 句散文摘要或选中态详情；默认同源列表折叠
- **Suggested command:** `/impeccable distill`

### [P1] Enable Ask 仍挡追问闭环
- **Why:** 文案好了，门禁还在；峰-终卡在半成品
- **Fix:** Ready 后透明建索/自动 Enable；失败才显式 CTA
- **Suggested command:** `/impeccable onboard`

### [P2] 重点关注 section 仍用 indigo focus-wash
- **Why:** 违反 Indigo Sparingly；「重点」靠紫色证明自己
- **Fix:** 字重/左边线表强调，背景改中性
- **Suggested command:** `/impeccable quieter`

### [P2] 无 History/分类快捷键、无真批量 Add
- **Why:** 57 篇下效率不达 Linear
- **Fix:** 键盘跳转 + 分类级 Add + 撤销条
- **Suggested command:** `/impeccable harden`

### [P3] Brief scope 展开后配置与阅读同权
- **Why:** 配置决策回流扫读区
- **Fix:** 阅读态只留 Regenerate 进配置
- **Suggested command:** `/impeccable distill`

## Persona Red Flags

**Alex:** 无键盘加速/真批量；Enable Ask 多一步；Insight 像调试侧栏。

**Jordan:** 四栏不知先看哪；Enable Ask 仍像神秘开关；Rule 要猜。

**Digest follower:** 能扫；Insight 复读打断；追问被卡住。

## Minor Observations

- History 选中 accent-soft + 左点：合法 selection，仍偏 indigo 习惯
- focus 标题 1.35rem 略跳出 rem ramp（page-title 1.25rem）
- runtime `overused-font: geist` = intentional craft bar（config ignore 未注入浏览器）
- `flat-type-hierarchy`：提醒继续收紧字号阶梯，非换回 Inter

## Provocative Questions

- 若 Insight 只保留「人话摘要 + Ask」，中栏是否才配叫 Brief Stage？
- Enable Ask 若对用户不可见，Askme 还需要 Insight 上半截吗？
- 重点关注能否不用紫色证明自己？
- Linear chrome 已赢——Reader 还缺哪一刀？
- 57 个 Add 是功能，还是还没敢做「选中再问」？
