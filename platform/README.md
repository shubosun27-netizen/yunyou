# Platform 模块

`layout-preview.html` 的主逻辑已拆到本目录，通过 `build.ps1` 合并为根目录的 `platform-main.js`。

## 目录

| 文件 | 职责 |
|------|------|
| `parts/01-state-auth.js` | 存储 key、106u 登录、游戏 iframe 加载、登录后配置同步入口 |
| `parts/02-state-core.js` | 调度器/Boss/活动/魔影/群英汇等共享状态变量 |
| `parts/03-log-ui.js` | `$`、Tab、运行日志、状态栏、phase |
| `parts/04-catalog-modals.js` | 道具/地图/Boss/活动弹窗与目录 |
| `parts/04b-user-config.js` | 挂机方案：账号维度缓存 + 云端读写（UserConfigStore） |
| `parts/05-profile.js` | 方案 CRUD、fillEditor/readEditor |
| `parts/06-bridge-runtime.js` | `sendCmd`、runtime 面板 |
| `parts/07-scheduler-guards.js` | 调度优先级判断、活动检测、tick 间隔 |
| `parts/08-qunying-moying.js` | 群英汇 / 魔影来袭 / 皇陵叛乱专用会话 |
| `parts/09-boss-hunt.js` | Boss 猎杀状态机（队列、寻路、拾取） |
| `parts/10-farm-bag.js` | 背包自动化、NPC 回收、定时 tick |
| `parts/11-scheduler-loop.js` | `onRuntimeForScheduler` 主循环 |
| `parts/12-controls.js` | 启动/暂停/停止、手动操作 |
| `parts/13-message-bridge.js` | `postMessage` 与 game.html 桥接 |
| `parts/14-events.js` | Boss/活动事件通知 UI |
| `parts/15-bootstrap.js` | 自动保存、页面 load 初始化 |
| `parts/16-extra-boss.js` | 地下皇陵 / 恶魔广场（含圣域6-8层）配置与弹窗 |

## 已外置模块（与 platform 并列）

| 文件 | 职责 |
|------|------|
| `../tasks.js` | 任务 Tab UI + Runner |
| `../activity-runtime.js` | 通用日常活动 |
| `../farm-tactics.js` | 挂机高级策略 |
| `../pk-runtime.js` | PK Tab：默认模式 / 反击 / 仇人 / 行会 / 抢怪 |
| `../task-handlers.js` | iframe 内任务 handler 核心（公共 helpers + 注册） |
| `../task-handlers-wolong.js` | 卧龙山庄任务 handler（独立模块） |
| `../layout-preview.css` | 主界面样式 |

## 开发流程

1. 编辑 `platform/parts/*.js`（或 `layout-preview.css`）
2. 运行构建：

```powershell
cd html
powershell -File platform/build.ps1
```

3. 刷新浏览器验证 `layout-preview.html`

> **注意**：`platform-main.js` 为构建产物；日常修改请改 `parts/`，避免直接改合并文件。

## 避免「onclick 函数未定义」

`layout-preview.html` 里大量 `onclick="authLogin()"` 依赖 **`window.xxx` 全局函数**。  
`platform-main.js` 是一个 IIFE：**任一处语法错误都会导致整包解析失败**，后面的 `window.authLogin = …` 都不会执行，表现就是 `authLogin is not defined`。

**务必做到：**

1. 改完 `parts/` 后 **总是运行 `build.ps1`**（已内置 `check-parts.js` + `node --check`）
2. **不要**在 part 文件之间切断函数：每个 `function foo() { … }` 应完整位于同一个 part 内
3. 新增 HTML `onclick` 时，在对应 part 里写 `window.foo = function () { … }`，或改在 `15-bootstrap.js` 用 `addEventListener` 绑定
4. 若登录/启动按钮全部失效，先在浏览器控制台看是否有 **`Unexpected token`**；有则优先修语法

## 工程化流程（推荐）

```
改 platform/parts/*.js
    → npm run build      # 合并 + 分片校验 + 语法检查
    → npm run check      # 再扫 tasks.js 等并列模块
    → 浏览器 Ctrl+F5
```

| 命令 | 作用 |
|------|------|
| `npm run build` | `build.ps1`：合并 → `check-parts.js` → `node --check platform-main.js` |
| `npm run check` | `check-all.js`：分片 + 全部主 JS 语法 |
| `npm run check:parts` | 仅分片（花括号平衡、孤立 `}`、合并语法、onclick 导出） |
| `npm run validate` | `build` + `check` 一条龙 |

**提交前（可选）**：启用 Git hook，改 `parts/` 时自动 validate：

```bash
git config core.hooksPath .githooks
```

见 `.githooks/README.md`。Windows 下若 shell hook 不生效，提交前手动 `npm run validate` 即可。

### Agent 写代码后自动校验（Cursor Hooks）

已配置 `.cursor/hooks.json`：

- **Write / StrReplace** → `post-write-validate.js`：改 `platform/parts/` 后自动 `npm run validate`，结果通过 `additional_context` 回传给 Agent
- **stop** → `stop-validate.js`：一轮结束前再校验；失败则 `followup_message` 触发 Agent 继续修（`loop_limit: 2`）

需本机有 Node/npm。在 **Customize → Hooks** 或 `Ctrl+Shift+P` → Hooks 输出通道可调试（见 `.cursor/README.md`）。

### check-parts 会抓什么

| 检查 | 说明 |
|------|------|
| 孤立 `}` | part 第一行非空内容是 `}` → 可能截断了上一文件里的函数 |
| 花括号深度 | 全部分片顺序合并后深度应为 0 |
| 合并语法 | 内存合并后 `node --check` |
| 产物语法 | 磁盘上的 `platform-main.js` |
| onclick 警告 | HTML 里 `onclick="foo()"` 是否在 parts 里有 `window.foo =` |

### 编码规范（分片项目）

1. **一个函数只在一个 part 里**；跨 part 只放「完整顶层」`function` 或变量声明
2. **改 parts 必提交 platform-main.js**（或靠 pre-commit 自动 `git add`）
3. **不要手改 platform-main.js**；它是构建产物
4. 长期方向：新功能优先 `tasks.js` 式 `Module.init(api)`，少往 HTML 塞 `onclick`

**快速自检：**

```powershell
npm run validate
# 或
node --check platform-main.js
```

## 后续拆分方向

`07`–`11` 仍高度耦合（共享 hunt/phase 状态），暂保留在同一 IIFE 内按文件分片。若需进一步解耦，可引入 `PlatformApp` 共享上下文 + `init(api)` 注入（参考 `tasks.js`）。

**物品/背包**：配置读写与调度已在 `04`/`05`/`10` 分片；游戏侧桥接在 `game.html`。当前体量仍适合留在 platform IIFE 内，**暂不单独拆 `bag-module.js`**。若后续再扩大量商城/仓库交互，再按 `farm-tactics.js` 模式外置。
