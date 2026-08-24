# Cursor Hooks — 自动校验

Agent 修改 `platform/parts/` 后会自动触发 `npm run validate`。

## 机制

| 事件 | 脚本 | 行为 |
|------|------|------|
| `postToolUse`（Write / StrReplace） | `post-write-validate.js` | 编辑 parts 后立刻 build+check，结果写入 `additional_context` |
| `stop` | `stop-validate.js` | 本轮结束前再跑一遍；失败则 `followup_message` 让 agent 继续修（最多 2 次） |

## 生效条件

1. 用 **文件夹** 打开项目：`File → Open Folder → html`（只开单个文件时 Hooks 不会加载）
2. 项目根目录存在 `.cursor/hooks.json`（已配置）
3. 本机已安装 **Node.js** 和 **npm**
4. **Cursor 版本较新**（建议 1.7+；Customize 页里的 Hooks 标签在更新版本才有）

## 在哪里看 Hooks（不是普通 Settings）

Hooks **不在** `File → Preferences → Settings`（`Ctrl+,`）里。

正确入口：

1. **Customize 页面**  
   - 打开右侧 **Agent / Chat** 面板  
   - 点面板上的 **齿轮（Customize）**  
   - 顶部标签里选 **Hooks**（与 Plugins、Rules、Skills 并列）

2. **输出通道（调试用）**  
   - `Ctrl+Shift+P` → 输入 `Hooks`  
   - 选 **Hooks: Show Output**（或类似「显示 Hooks 输出」）  
   - 可看到 hook 是否执行、报错信息

3. **没有 Hooks 标签时**  
   - 先 **升级 Cursor** 到最新版  
   - 确认打开的是 `html` **文件夹** 而非单个文件  
   - 重启 Cursor  
   - **没有 UI 也不影响运行**：只要 `.cursor/hooks.json` 在，Agent 写文件时仍会触发脚本

## 手动验证 hook 是否在跑

```powershell
cd html
echo '{"tool_input":{"file_path":"platform/parts/01-state-auth.js"}}' | node .cursor/hooks/post-write-validate.js
```

若输出含 `[platform-auto-validate] 已通过`，说明脚本本身正常；Agent 改 parts 后应同样触发。

## 关闭

临时删除或重命名 `.cursor/hooks.json` 即可。
