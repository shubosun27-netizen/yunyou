# legacy — 归档文件

本目录存放**不参与当前云游平台运行链路**的文件，仅供对照、查协议或历史参考。

**当前主入口**：根目录 `layout-preview.html` + `game.html`（iframe）。  
**勿把本目录下的 HTML 当主界面打开或维护。**

## 目录说明

| 路径 | 说明 |
|------|------|
| `index.html` | 较早一版单体控制台快照（已由 `layout-preview.html` 替代） |
| `index-root-monolith.html` | 根目录曾残留的较新单体控制台快照（2026-08 归档；与上一份哈希不同，故两份都保留） |
| `res.json` | 客户端配置导出，项目内无代码引用 |
| `config/*.json` | 游戏配置表本地副本（`0config`–`5config`），查副本条件、地图、NPC 等 |
| `scratch/` | 一次性调试脚本等，不参与构建与运行 |

## 重要：`main10` 不在本目录

根目录的 `main10.25144.1.min.js`（约 9MB）是 **运行时依赖**，不要移入 `legacy/`。

- 选区进游戏后，`qufu1.min.js` 会按 `main` + `js_gameVars.resVersion` + `.min.js` **同源相对路径**加载（当前为本地 `i.src = t`，非 CDN）。
- 开发查协议（UI `onClick` / Model）时，也请在**根目录**该文件中搜索。
- 配置表对照仍用本目录 `config/`。

## 归档原则（慎重）

1. **只归档已确认不进运行链的文件**；不确定则先留根目录并注明。
2. **优先移动/改名，避免直接删除**；两份内容不同时两份都留。
3. 与 `legacy/` 内已有文件字节级相同时，才允许去掉根目录重复拷贝（例如根 `res.json` 已去重）。
4. 运行链（`layout-preview*`、`platform*`、`game.html`、handlers、catalog、`main10`、`js/`、`qufu1` 等）不进本目录。
