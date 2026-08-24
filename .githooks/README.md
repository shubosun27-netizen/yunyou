# Git hooks（可选）

本目录提供提交前自动校验，避免 `platform-main.js` 与 `parts/` 不同步或语法错误入库。

## 启用（一次性）

在 `html` 目录执行：

```bash
git config core.hooksPath .githooks
```

Windows 若 `pre-commit` 无执行权限，可改用：

```powershell
git config core.hooksPath .githooks
# 或在提交前手动: npm run validate
```

## pre-commit 行为

当暂存区包含以下路径时自动运行 `npm run validate`（build + check）：

- `platform/parts/**`
- `platform/build.ps1`
- `platform/check-*.js`

通过后会将更新后的 `platform-main.js` 加入本次提交。
