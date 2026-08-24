# legacy — 归档文件

本目录存放**不参与当前云游平台运行链路**的文件，仅供对照、查协议或历史参考。

| 路径 | 说明 |
|------|------|
| `index.html` | 旧版单体控制台（已由 `layout-preview.html` 替代） |
| `main10.25144.1.min.js` | 游戏本体压缩包，开发时搜索 UI onClick / Model 协议用 |
| `res.json` | 客户端配置导出，项目内无代码引用 |
| `config/*.json` | 游戏配置表本地副本（`0config`–`5config`），查副本条件、地图、NPC 等 |

**当前主入口**：根目录 `layout-preview.html` + `game.html`（iframe）。
