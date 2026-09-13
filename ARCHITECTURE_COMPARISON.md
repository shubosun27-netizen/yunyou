# 辅助架构方案对比

> 目标：一套辅助逻辑覆盖多个传奇平台，零登录适配成本
> 日期：2026-09-13

---

## 一、现状分析

### 当前架构（托管模式）

```
┌──────────────────────────────────────────────────────┐
│  控制页 (platform-main.js / layout-preview.html)      │
│                                                      │
│  - 用户登录（自己写的鉴权逻辑）                         │
│  - 读 sessionStorage 里的鉴权凭证                       │
│  - <iframe src="game.html">                           │
│  - 通过 postMessage 双向通信                           │
└─────────────────────┬────────────────────────────────┘
                      │ iframe 同源加载
                      ▼
┌──────────────────────────────────────────────────────┐
│  game.html（从 106u 扒下源码 + 注入辅助逻辑）           │
│                                                      │
│  第1层：游戏启动壳（加载 egret / qufu1.min.js）          │
│  第2层：辅助钩子 IIFE（postMessage 硬编码 39 处）        │
│  第3层：sessionStorage 鉴权参数注入（1处）               │
└──────────────────────────────────────────────────────┘
```

### 核心痛点

| 痛点 | 说明 |
|---|---|
| **多平台登录适配地狱** | 每个平台的登录API、鉴权载体、风控校验、token生命周期各不相同，每加一个平台可能要写几百行登录代码 |
| **维护成本高** | 游戏引擎文件（egret.min.js、qufu1.min.js）要跟着每个平台的版本走，官方升级一次就得重新扒一次 |
| **跨域限制** | 如果想加载别的平台游戏页，iframe 跨域根本无法注入代码 |

### game.html 内部依赖统计

通过 grep 确认：

| 依赖类型 | 出现次数 | 位置 | 作用 |
|---|---|---|---|
| `window.parent.postMessage` | **39 处** | 辅助钩子 IIFE 内 | 数据推送 / 命令接收 / 握手确认 |
| `sessionStorage.js_gameVars` | **1 处** | 启动层 mergeAuthGameVars() | 鉴权参数注入 |

**改造关键点集中且可控**——39 处 postMessage + 1 处鉴权读取，改完即可解耦。

---

## 二、方案详解

### 方案 A：托管模式（现状，不改）

就是现在的架构，控制页 iframe 加载自己托管的 game.html。

**架构图**

```
用户 → 控制页 → 自己的游戏服务器 → game.html（你托管）
                      ↓
              egret + qufu1.min.js + 你的辅助钩子
```

**登录适配策略**

每个平台单独适配一套登录流程：

```javascript
// platform/auth-adapters/106u.js
function login106u(username, password) {
    // 1. 调 106u 的登录 API（要逆向、要处理签名）
    // 2. 处理可能的验证码
    // 3. 从返回数据中提取 token / sessionId
    // 4. 拼出 js_gameVars 写入 sessionStorage
    return jsGameVars;
}

// platform/auth-adapters/leyou.js
function loginLeyou(username, password) {
    // 完全不同的一套 API、参数、鉴权逻辑
}
```

**优点**
- 完全可控，同源无限制
- 零用户门槛（打开你的控制页就行）
- 不需要用户装任何插件或客户端

**缺点**
- ❌ **每个平台的登录逻辑全要自己写**——这是最大的坑
- ❌ 要为每个平台维护一套游戏引擎文件（egret.min.js 等）
- ❌ 官方域名变化、CDN 路径变化都要跟着改
- ❌ 服务器成本（托管游戏引擎）
- ❌ 跨域的平台根本不支持

**适用场景**：只做 1-2 个固定平台时够用

---

### 方案 B：油猴脚本 / 浏览器扩展（注入模式）

用户在自己的浏览器里打开游戏页，油猴自动注入辅助代码。

#### 什么是油猴（Tampermonkey）

一个免费的 Chrome / Edge / Firefox 浏览器插件（全球几千万用户），功能就是：

> 你写一段 JS 脚本，告诉它 "访问 `*.106u.com` 时把这段代码注入到页面里"，以后每次打开自动注入。

**架构图**

```
用户打开 Chrome
  │
  ├─ 访问 https://www.106u.com/game.html（官方域名）
  │     │
  │     ├─ 官方登录 → 官方自己的登录流程 → 官方自己把 cookie/session 写好
  │     │
  │     ├─ 官方加载 egret + qufu1.min.js
  │     │
  │     └─ 油猴插件检测到域名匹配 → 把你的 aux-hook.js 注入到页面主上下文
  │           │
  │           └─ hook MessageHandler.prototype.received 等原型链
  │                 → 辅助功能正常工作（Boss监控、自动答题、拍卖竞价...）
  │
  ├─ 访问 https://www.leyou.com/game.html
  │     └─ 油猴同样注入（@match 覆盖多个域名）
```

**关键：为什么油猴能解决登录适配？**

```
托管模式：你的游戏页在你的域名下 → cookie 属于官方域名 → 跨域读不到 → 必须自己实现登录
油猴模式：游戏页就在官方域名下 → cookie 官方自己写 → 游戏引擎自己带 → 你根本不用管登录
```

你的辅助 JS 全程**不需要知道 token 长啥样**，也**不需要读 httponly cookie**——因为你 hook 的是**已经拿着有效登录态在跑的游戏引擎的内存对象**，旁路监听而已。

#### 开发步骤

**步骤 1：抽离辅助钩子代码（aux-hook.js）**

从 game.html 里把辅助钩子 IIFE 切出来，做两个改造：

**改造 1：Transport 层抽象（替换 39 处 window.parent.postMessage）**

```javascript
// ===== 统一通信层，同时支持 iframe 托管模式 和 独立运行模式 =====
var Transport = {
    _mode: 'auto',

    init: function() {
        if (window.parent && window.parent !== window) {
            this._mode = 'iframe';
        } else {
            this._mode = 'independent';
        }
    },

    send: function(type, payload) {
        if (this._mode === 'iframe') {
            // 托管模式：postMessage 给父页面
            try {
                window.parent.postMessage({
                    type: type,
                    payload: payload,
                    ts: Date.now()
                }, '*');
            } catch(e) {}
        } else {
            // 独立模式：写 localStorage 给外部控制页轮询（可选）
            try {
                localStorage.setItem('__aux_event', JSON.stringify({
                    type: type,
                    payload: payload,
                    ts: Date.now()
                }));
            } catch(e) {}
        }
    },

    onCommand: function(handler) {
        // 两种模式统一监听 postMessage
        window.addEventListener('message', function(e) {
            var d = e.data || {};
            if (d.type === 'gameCommand') {
                handler(d.action, d.payload);
            }
        });
        // 独立模式额外支持 localStorage 命令注入
        window.addEventListener('storage', function(e) {
            if (e.key === '__aux_command') {
                try {
                    var cmd = JSON.parse(e.newValue);
                    if (cmd && cmd.action) handler(cmd.action, cmd.payload);
                } catch(err) {}
            }
        });
    },

    log: function(msg, level) {
        try {
            var color = {
                info: '#3498db',
                warn: '#f39c12',
                error: '#e74c3c',
                ok: '#27ae60'
            }[level] || '#9b59b6';
            console.log('%c[Aux] ' + msg, 'color:' + color + ';font-weight:bold');
        } catch(e) {}
    }
};
Transport.init();
```

然后原来所有的：
```javascript
// 原来
if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'bossEvent', payload: payload }, '*');
}
// 改成
Transport.send('bossEvent', payload);
```

**改造 2：鉴权读取改为多源兜底**

```javascript
// 原来 game.html 里的写法（第192-204行）
(function mergeAuthGameVars() {
    var raw = sessionStorage.getItem("js_gameVars");
    if (!raw) return;
    var auth = JSON.parse(raw);
    // ...覆盖默认值
})();

// 改成：优先读官方引擎自己的全局变量
function readGameVars() {
    // 官方引擎启动后肯定会把鉴权参数写到某个全局变量里
    if (window.js_gameVars && window.js_gameVars.username) {
        return window.js_gameVars;
    }
    if (window.__LAUNCHER__ && __LAUNCHER__.gameVars) {
        return __LAUNCHER__.gameVars;
    }
    // 兜底：读 cookie（用 document.cookie，不是 httponly 的都能读到）
    try {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var c = cookies[i].trim();
            if (c.indexOf('roleId=') === 0 || c.indexOf('username=') === 0) {
                // 从 cookie 里提取关键信息
            }
        }
    } catch(e) {}
    // 最终兜底：读游戏内存对象（最可靠，引擎已经解析好了）
    try {
        if (window.gd && gd.player) {
            return {
                username: gd.player.roleName || '',
                roleId: Transport.normalizeId(gd.player.uid),
                level: gd.player.level,
                mapId: gd.map ? gd.map.curMapId : 0
            };
        }
    } catch(e) {}
    return {};
}
```

**步骤 2：写油猴脚本壳**

```javascript
// ==UserScript==
// @name         原始传奇通用辅助
// @namespace    https://your-github-username.github.io/aux
// @version      1.0.0
// @description  一套辅助跑遍所有原始传奇平台，自动注入游戏页面
// @author       YourName
// @match        *://*106u*.com/*
// @match        *://*106u*.cn/*
// @match        *://*leyou*.com/*
// @match        *://*其他平台域名*/*
// @run-at       document-end
// @grant        none
// @run-in       main_world
// ==/UserScript==

(function() {
    // 把 aux-hook.js 的代码内联在这里（IIFE 形式）
    // 或者用 @require 远程引用（需要自己托管 CDN）

    var auxHookCode = `
    (function() {
        // ===== 这里是抽出来的完整 aux-hook.js 代码 =====
        // 包含 Transport 层
        // 包含所有 hook 安装函数
        // 包含 __gameBridge 暴露对象
        // 包含自动化逻辑（自动答题、拍卖竞价等）

        console.log('[Aux] 辅助钩子已注入，等待游戏引擎加载...');

        // 等 MessageHandler 出现后安装 hook
        function boot() {
            if (window.MessageHandler && MessageHandler.prototype && MessageHandler.prototype.received) {
                installSocketHook();
                installBossNotifyHook();
                installQunyingTurboHook();
                // ... 其他 hook
                Transport.log('所有 hook 已安装', 'ok');
            } else {
                setTimeout(boot, 100);
            }
        }
        boot();
    })();
    `;

    // 注入到页面主上下文（main world），这样才能 hook 游戏引擎的全局原型链
    var script = document.createElement('script');
    script.textContent = auxHookCode;
    script.setAttribute('data-aux-injected', 'true');
    (document.head || document.documentElement).appendChild(script);
})();
```

**关于 @match 多域名覆盖**

```javascript
// 通配符写法，一个脚本覆盖所有平台
@match        *://*/game*
@match        *://*yscq*/*
@match        *://*chuanshi*/*

// 如果某个平台用的是 /index.html 路由，可以更精确
@match        https://www.106u.com/game
@match        https://game.106u.com/index.html
```

**步骤 3：分发方式**

| 方式 | 说明 |
|---|---|
| GreasyFork.org（推荐） | 用户点 "Install" 一键装，自动更新 |
| GitHub Raw | 用户手动下载 .user.js，拖进浏览器 |
| 自建 CDN | 用户在地址栏粘贴 `javascript:` 书签（bookmarklet） |

**优点**
- ✅ **零登录适配**——官方自己做
- ✅ 一个脚本覆盖所有同引擎平台
- ✅ 不需要服务器托管游戏资源
- ✅ 分发简单，用户装个插件+点一下
- ✅ 不暴露，注入的 JS 和页面原生代码无区别

**缺点**
- ❌ 用户需要装浏览器插件（门槛很低，但毕竟多一步）
- ❌ 需要用户用 Chrome/Edge/Firefox 等支持插件的浏览器
- ⚠️ 不能读取 httponly cookie（但其实不需要，因为你 hook 的是内存对象）
- ❌ 没有桌面端能力（通知、全局快捷键等）

---

### 方案 C：Electron 客户端（注入模式）

把 Chromium 内核打包进一个桌面 exe，在里面打开游戏页并注入辅助代码。

#### 什么是 Electron

一个开源框架，让你用 HTML + CSS + JS 做跨平台桌面应用。VS Code、Discord、Slack、Notion 都是 Electron 做的。

```
Electron = Chromium 内核（浏览器） + Node.js（后端能力） + 注入/控制 API
```

**架构图**

```
┌────────────────────────────────────────────────────────────┐
│  Electron 主进程（Node.js，你写）                           │
│                                                            │
│  - 创建 BrowserWindow 窗口                                  │
│  - preload 脚本（在页面加载前就注入 aux-hook.js）             │
│  - 拦截网络请求（可选）                                      │
│  - 读写本地文件（存用户配置、存辅助脚本）                     │
│  - IPC 与渲染进程通信                                       │
│  - 托盘图标 / 桌面通知 / 全局快捷键                          │
└──────────────────────┬─────────────────────────────────────┘
                       │ loadURL('https://www.106u.com/game')
                       │ preload: preload.js
                       ▼
┌────────────────────────────────────────────────────────────┐
│  渲染进程（内嵌的 Chromium）                                 │
│                                                            │
│  - 展示 106u 官方游戏页                                     │
│  - 用户自己登录 → 官方登录 → 进服                            │
│  - preload.js → 在游戏引擎加载前就 hook 好原型链              │
│  - aux-hook.js 正常工作                                     │
└────────────────────────────────────────────────────────────┘
```

#### 开发步骤

**目录结构**

```
electron-client/
├── package.json
├── main.js                    # 主进程：创建窗口 + 注入
├── preload.js                 # preload 脚本：往页面塞 aux-hook.js
├── aux-hook.js                # 和油猴版本共用同一份代码（零重复）
├── config/
│   └── platforms.json         # 平台列表
└── build/
    └── icon.ico
```

**package.json**

```json
{
    "name": "yscq-aux-client",
    "version": "1.0.0",
    "description": "原始传奇通用辅助客户端",
    "main": "main.js",
    "scripts": {
        "start": "electron .",
        "pack": "electron-builder --dir",
        "dist": "electron-builder"
    },
    "devDependencies": {
        "electron": "^28.0.0",
        "electron-builder": "^24.9.1"
    }
}
```

**main.js**

```javascript
const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

// 平台列表（也可以从远程拉取，做动态更新）
const PLATFORMS = [
    { id: '106u', name: '106u', url: 'https://www.106u.com/game', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    { id: 'leyou', name: '乐游', url: 'https://game.leyou.com/index', userAgent: 'Mozilla/5.0 ...' },
];

function createWindow(platformId) {
    const platform = PLATFORMS.find(p => p.id === platformId) || PLATFORMS[0];

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,      // 关掉隔离 → preload 能直接访问页面 window → 最稳的注入方式
            nodeIntegration: false,       // 关掉 Node 集成 → 安全
            sandbox: false,
            devTools: false               // 可以打开方便调试
        },
        // 伪装成普通 Chrome，防止网站检测 Electron
        userAgent: platform.userAgent
    });

    mainWindow.loadURL(platform.url);

    // 方式2：页面加载完后主动执行注入（备选，preload 更稳）
    // mainWindow.webContents.on('did-finish-load', () => {
    //     var auxCode = fs.readFileSync(path.join(__dirname, 'aux-hook.js'), 'utf-8');
    //     mainWindow.webContents.executeJavaScript(auxCode);
    // });

    // 拦截并修改游戏引擎加载的资源（可选）
    // mainWindow.webContents.session.webRequest.onBeforeRequest(
    //     { urls: ['*://*/js/game.min.js'] },
    //     (details, callback) => {
    //         // 可以把 game.min.js 先替换成本地版本做额外 hook
    //     }
    // );
}

// 主进程与 preload 通信
ipcMain.on('aux-ready', (event, payload) => {
    console.log('[Main] Aux hook ready:', payload);
    // 可以把这个状态存本地、推送桌面通知等
});

ipcMain.on('aux-event', (event, data) => {
    // 渲染进程（aux-hook）发来的事件
    // 比如 Boss 刷新 → 主进程弹通知
    if (data.type === 'bossEvent' && data.payload && data.payload.event === 'refresh') {
        new Notification('Boss 刷新', {
            body: data.payload.mapName + ' 已刷新！'
        });
    }
});

// 全局快捷键示例
app.whenReady().then(() => {
    globalShortcut.register('Ctrl+Shift+Q', () => {
        // 快捷切换群英汇自动答题
        mainWindow.webContents.executeJavaScript(
            'window.__auxCmd && window.__auxCmd("setQunyingTurbo", {enabled: true})'
        );
    });
    createWindow('106u');
});
```

**preload.js**

```javascript
const fs = require('fs');
const path = require('path');

// Electron 的 preload 在页面任何脚本之前执行
// 关掉 contextIsolation 后可以直接访问页面的 window

(function injectAuxHook() {
    try {
        // 读取本地 aux-hook.js（和油猴版本完全相同的一份文件）
        var auxPath = path.join(__dirname, 'aux-hook.js');
        var auxCode = fs.readFileSync(auxPath, 'utf-8');

        // 包装成 IIFE，注入到页面主上下文
        var wrappedCode = '(function() {' + auxCode + '})();';

        var script = document.createElement('script');
        script.textContent = wrappedCode;
        script.setAttribute('data-aux-injected', 'true');

        // 等 document.head 可用时插入
        if (document.head) {
            document.head.appendChild(script);
        } else {
            document.addEventListener('DOMContentLoaded', function() {
                document.head.appendChild(script);
            });
        }
    } catch(e) {
        console.error('[Electron preload] 注入失败:', e);
    }
})();

// 注入完成后通知主进程
try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('aux-ready', { ts: Date.now() });
} catch(e) {}
```

**运行**

```bash
cd electron-client
npm install
npm start           # 开发模式启动
npm run dist        # 打包成 exe（~150MB）
```

**优点**
- ✅ **同样零登录适配**
- ✅ 所有油猴的能力 + 桌面端能力
- ✅ 可以做平台选择下拉框，一个客户端跑所有平台
- ✅ 托盘图标、桌面通知、全局快捷键
- ✅ preload 注入比油猴更早，更不容易被游戏检测
- ✅ 可以做多开窗口（同时开多个平台账号）
- ✅ 可以做自动更新辅助代码

**缺点**
- ❌ **用户门槛最高**——下载安装 150MB+ 的 exe
- ❌ **打包、签名、自动更新要维护**（electron-builder + code signing + autoUpdater）
- ❌ **开发成本高**——要学 Electron 主进程/渲染进程模型
- ❌ 游戏可能检测 Electron 特征（`navigator.userAgent` 里的 Electron 字样），虽然可以改 UA 绕过
- ❌ 跨平台打包（Windows / macOS / Linux）每个平台都要打一遍
- ❌ 客户端体积大（Chrome 内核 + Node.js 打包进去了）

---

## 三、横向对比总表

| 维度 | A 托管模式（现状） | B 油猴脚本 | C Electron 客户端 |
|---|---|---|---|
| **核心思路** | 自己托管游戏页 + 自己做登录 | 用户自己在官方页登录 + 注入辅助 | 用户自己在官方页登录 + Electron 壳注入 |
| **登录适配成本** | ❌ 每个平台单独写一套 | ✅ **零成本** | ✅ **零成本** |
| **用户门槛** | ✅ 打开控制页就行 | 装插件（2分钟） | ❌ 下载安装 150MB+ |
| **分发难度** | ✅ 零（自己的网站） | ✅ GreasyFork 一键安装 | ❌ 打包+签名+自动更新 |
| **辅助代码复用** | game.html 硬编码 | aux-hook.js（独立文件） | aux-hook.js（**和油猴共用同一份**） |
| **桌面端能力** | ❌ 无 | ❌ 无 | ✅ 通知/快捷键/多开/托盘 |
| **被游戏检测风险** | 低 | 低（和原生JS无区别） | 中（可改UA绕过） |
| **启动速度** | 快 | 快 | 慢（Chromium 冷启动 ~2-3秒） |
| **开发成本** | 低（已完成） | 低（抽文件+写脚本壳） | 高（Electron 学习+打包） |
| **维护成本** | 高（游戏引擎跟更） | 低（引擎官方维护） | 中（辅助低+打包高） |
| **适合平台数量** | 1-2 个 | **3+ 个（通配符覆盖）** | 3+ 个 |
| **跨域问题** | 自己域名托管就没跨域 | ✅ 在官方域名下运行 | ✅ 在官方域名下运行 |
| **代码注入时机** | 页面加载完 | document-end（早） | preload（**最早**） |

---

## 四、推荐方案与实施路线

### 分阶段实施

```
阶段 0：地基（必做，不影响现有功能）
├─ 1. Transport 层抽象（替换 game.html 里 39 处 postMessage）
├─ 2. 鉴权读取改为多源兜底（不碰 sessionStorage，优先读官方全局变量）
└─ 结果：iframe 托管模式不受任何影响，但 game.html 里的辅助代码具备了独立运行能力

阶段 1：先做油猴（投入最低，验证最快）
├─ 3. 把辅助钩子 IIFE 从 game.html 切出来 → aux-hook.js
├─ 4. 写油猴脚本壳（~50行）
├─ 5. 在 GreasyFork 发布
└─ 结果：用户装脚本就能用，支持多平台，零登录适配

阶段 2：按需做 Electron（可选，做了就是"有客户端"）
├─ 6. 新建 electron-client/ 目录
├─ 7. 写 main.js + preload.js + platforms.json
├─ 8. preload 里直接引用 aux-hook.js（和油猴那份一样）
├─ 9. 打包成 exe
└─ 结果：给需要桌面端的用户一个安装包
```

### 关键：aux-hook.js 是单一事实源

```
aux-hook.js（唯一一份）
    │
    ├─ game.html 引用 → <script src="aux-hook.js">  → 托管模式
    ├─ 油猴脚本 @require → 注入到页面主上下文          → 油猴模式
    └─ Electron preload.js → fs.readFileSync → 注入   → 客户端模式
```

**三种模式用的是完全相同的辅助代码**，改一处三个地方自动生效。

### 阶段 0 改完后的验证标准

| 验证项 | 方法 |
|---|---|
| 托管模式（现有功能） | 打开控制页 → iframe 加载 game.html → 所有辅助功能正常 → 不打回退 |
| Transport send | Console 里看 postMessage 是否正常 |
| Transport independent 模式 | 把 game.html 直接在浏览器打开（不走 iframe）→ 看 Console 是否有 `[Aux]` 日志 → 自动化逻辑是否正常运行 |

---

## 五、技术风险与应对

| 风险 | 影响 | 概率 | 应对 |
|---|---|---|---|
| 某个平台的游戏引擎类名不同（MessageHandler 等） | hook 失效 | 低（你已确认版本一致） | aux-hook.js 里按平台配置 hook 点，或者自动探测类名 |
| 平台加了 JS 混淆/反调试 | hook 代码被检测 | 低（原型链 hook 和原生代码行为完全一致，没有特征） | 尽量 preload 注入（Electron）或最早时机注入（油猴 document-start） |
| 油猴被浏览器策略禁用（企业/学校） | 用户装不了 | 中 | 保留 Electron 客户端作为备选 |
| Electron 被游戏 UA 检测 | 游戏页拒绝加载 | 中 | 修改 main.js 里的 userAgent，伪装成普通 Chrome |
| 游戏引擎升级导致 hook 点失效 | 所有平台一起挂 | 低（同引擎版本同步更新） | aux-hook.js 做自动版本检测，发现类名缺失时在 Console 输出警告 |

---

## 六、快速开始 checklist

如果决定动手，阶段 0 的实际改动清单：

| # | 改动 | 文件 | 影响范围 | 回退方式 |
|---|---|---|---|---|
| 1 | 新增 Transport 对象 | game.html 辅助 IIFE 内部开头 | 新代码块，不影响已有逻辑 | 删除 Transport 定义即可 |
| 2 | 替换 39 处 `window.parent.postMessage` → `Transport.send` | game.html 辅助 IIFE 内 | 纯机械替换，Transport.send 在 iframe 模式下内部就是 window.parent.postMessage | 全局搜索替换回来 |
| 3 | 替换 1 处 `sessionStorage.getItem("js_gameVars")` → `readGameVars()` | game.html 启动层 mergeAuthGameVars 处 | 新增 readGameVars 函数，优先返回已有 js_gameVars 对象 | 改回原来的 sessionStorage 读取 |

**阶段 0 完成后跑 build.ps1 确认无错误，然后验证：**

```
验证点 1：npm run build → 无 error
验证点 2：控制页 → iframe 加载 game.html → 辅助功能全部正常 → 不打回退
验证点 3：直接在浏览器打开 game.html（file:// 或 http://）→ Console 有 [Aux] 日志 → 独立模式正常
```