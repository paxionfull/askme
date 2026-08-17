# Askme × 设计工作流（已切换）

> **2026-08：** Figma MCP / `askme-ui-figma` skill 已从本仓库移除。  
> 当前优先路径：**[Superdesign](https://superdesign.dev)**（无 Figma）+ Playwright 验收。

## 当前推荐

1. **1:1 交互原型：** `frontend/prototypes/askme-current-1to1.html`
   - 默认 **Live app**：iframe 接入本机 Vite（完整 React 交互 / 弹窗 / 菜单）
   - **Static snapshot**：实机 DOM 快照 + 已接线的 Help / Add source / Manage groups / Confirm / Overflow 等
   - **Banner catalog**：`/dev/banners`（生产组件 `TopJobBanner` 全态图鉴，不跑任务即可评审；原型顶栏第三按钮）
   - 启动：`frontend/prototypes/open-live-prototype.sh` 或 `cd frontend && npm run dev`
2. Skill / CLI：`.cursor/skills/superdesign/` · `~/.local/bin/superdesign`
3. Token：`frontend/design/tokens.json`（cool 为商用默认）
4. 浏览器验收：`.cursor/mcp.json` 中的 Playwright MCP
5. **顶栏通知图鉴：** `http://127.0.0.1:5173/dev/banners`（与 Live 同源组件）

### Superdesign 项目（本次）

- Canvas：https://superdesign.dev/teams/6671d59b-4051-4dfd-a948-199c5217ee3c/projects/2a19d7af-781b-41ba-ae56-d296937f20f2?live=1
- 选用方向：Reader-App Elegance

## 归档：旧 Figma 文件（可选参考）

此前生成的草稿仍在（非真源）：

```text
FIGMA_FILE_URL=https://www.figma.com/design/7gFKRtiT4R6snv0psQpbY3/Askme-UI
```

不必再接 Figma MCP；需要时可在浏览器直接打开。
