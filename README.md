# 原始传奇 · 云游平台开发手册

本文档记录**云游平台**（挂机调度控制台）的架构、任务系统、调度器、游戏协议的正确用法与常见踩坑，供后续开发与维护参考。

**主入口**：`layout-preview.html`

---

## 0. 项目总览

### 这是什么

在浏览器里加载 H5 游戏（`game.html` + Egret 引擎），通过父页面调度器自动完成：

- 挂机 / 进图 / 背包辅助（使用、回收、熔炼、丢弃）
- Boss 猎杀（首领刷新推送、队列、拾取倒计时）
- 日常活动（通用活动 + 魔影来袭 / 群英汇 / 皇陵叛乱专用逻辑）
- 任务队列（副本、挖宝、卧龙寻路等）

### 目录结构（核心文件）

```
html/
├── layout-preview.html      # 主控制台 HTML 壳（~630 行，仅结构与 script 引用）
├── layout-preview.css       # 主界面样式
├── platform-main.js         # 主逻辑构建产物（由 platform/parts 合并）
├── platform/                # 主逻辑源码分片 + build.ps1
├── game.html                # 游戏 iframe + __gameBridge 桥接层
├── tasks.js                 # 任务 Tab：UI、队列 runner、配置持久化
├── task-handlers.js         # 任务 handler 核心（公共 helpers + 注册，iframe）
├── task-handlers-wolong.js  # 卧龙山庄任务 handler（独立模块）
├── activity-runtime.js      # 通用日常活动调度（魔影/群英汇/皇陵叛乱除外）
├── farm-tactics.js          # 挂机高级策略（换图、归属、走位等）
├── soul-hall.js             # 自动灵魂殿堂（材料达阈值→注入图鉴）
├── pk-runtime.js            # PK Tab：默认模式 / 反击 / 仇人 / 行会 / 抢怪
├── task-catalog.json        # 任务静态定义（picker 选项从游戏内同步）
├── item-catalog.json        # 道具多选目录（使用/丢弃/装备池）
├── afk-catalog.json         # 挂机地图、传送点等本地目录
├── 106u_game_auth.py        # 106u 登录代理（默认 :8765）
├── jquery-3.4.1.min.js      # game.html 依赖
├── platform.js              # 游戏平台 API 脚本
├── qufu1.min.js             # 区服选择 / Egret 入口
├── js/                      # Egret 引擎与游戏运行时
└── legacy/                  # 归档：旧控制台、协议参考、配置表副本（见 legacy/README.md）
```

### 模块拆分现状

| 模块 | 位置 | 状态 |
|------|------|------|
| 任务 UI + Runner | `tasks.js` | ✅ 已外置 |
| 通用活动调度 | `activity-runtime.js` | ✅ 已外置 |
| 挂机高级策略 | `farm-tactics.js` | ✅ 已外置 |
| 自动灵魂殿堂 | `soul-hall.js` | ✅ 已外置 |
| PK 配置与执行 | `pk-runtime.js` | ✅ 已外置 |
| 任务游戏内执行 | `task-handlers.js` + `task-handlers-wolong.js` | ✅ 已外置（iframe） |
| 主界面样式 | `layout-preview.css` | ✅ 已外置 |
| 主调度器 / Boss / 魔影 / 群英汇 / 方案 / 弹窗 | `platform/parts/*.js` → `platform-main.js` | ✅ 已分片（15 个 part，同一 IIFE） |
| 进一步解耦为独立 Module | `boss-hunt` / `moying` 等 | 🚧 可选后续（见 §13） |

> 修改主逻辑：编辑 `platform/parts/`，运行 `powershell -File platform/build.ps1`，详见 `platform/README.md`。

### 页面关系

```
layout-preview.html（父页面）
├── 左侧：配置 Tab（全局/物品/挂机/Boss/活动/任务/PK）
├── 右侧：game.html iframe
└── 106u 登录 → 注入 js_gameVars → 加载 game.html
```

（旧版单体控制台已归档到 `legacy/index.html` 与 `legacy/index-root-monolith.html`，勿再维护；根目录不再保留 `index.html`。）

---

## 1. 架构概览

```
layout-preview.html（父页面）
├── 调度器 scheduler（Boss / 活动 / 任务 / 挂机）
│   ├── onRuntimeForScheduler   # 主状态机 tick
│   ├── Boss 猎杀队列 / 拾取 / 随机石
│   ├── 魔影来袭 / 群英汇 / 皇陵叛乱（专用，未进 activity-runtime.js）
│   └── 背包辅助（使用/回收/熔炼/丢弃）
├── tasks.js（任务 Tab UI + 队列 runner）
├── activity-runtime.js（通用活动，魔影/群英汇除外）
├── 106u_game_auth.py（登录代理，layout-preview 左侧调用）
└── game.html（iframe 游戏）
    ├── __gameBridge（命令分发）
    ├── task-handlers.js（任务在游戏内的执行逻辑）
    └── js/（Egret 运行时，由 game.html 动态加载）
```

协议对照用：根目录 `main10.25144.1.min.js`（兼运行时加载，勿移入 legacy）；配置表副本：`legacy/config/`。

**通信方式**：父页面 `postMessage({ type: 'gameCommand', action, payload })` → `game.html` 的 `__gameBridge`；游戏事件反向 `postMessage`（`bossEvent` / `activityEvent` / `qunyingAnswered` / `gameReady` 等）。

| 命令 | 作用 |
|------|------|
| `runTask` | 启动某个任务的 `start` |
| `getTaskStatus` | 轮询某个任务的 `poll` |
| `getTaskCatalog` | 同步动态选项（个人 BOSS 列表等） |
| `getRuntimeState` | 获取地图、副本、背包等运行时快照 |
| `goMap` / `confirmEnterMap` | 传送 / 进图 |
| `getShoulingBossInfo` / `requestShoulingBoss` | 首领 Boss 列表与刷新 |
| `getDailyActivities` / `joinDailyActivity` | 日常活动列表与参加 |
| `applyAutoUseIfNeeded` 等 | 背包自动使用/回收/熔炼 |

**关键文件**

| 文件 | 职责 |
|------|------|
| `layout-preview.html` | 主界面 HTML 壳、引用 `platform-main.js` |
| `tasks.js` | 任务面板、队列、`shouldRunBeforeBoss` |
| `task-handlers.js` | 任务 handler 核心与公共 helpers（iframe） |
| `task-handlers-wolong.js` | 卧龙山庄任务 handler（独立注册） |
| `activity-runtime.js` | 通用活动进图/停留/退出（魔影、群英汇、皇陵叛乱由 platform-main 专用处理） |
| `farm-tactics.js` | 挂机高级策略（换图、归属、走位等） |
| `soul-hall.js` | 自动灵魂殿堂（背包自动检出稀有材达阈值→注入图鉴→回挂机） |
| `platform-main.js` | 调度器、`onRuntimeForScheduler`、Boss/魔影/群英汇（源码在 `platform/parts/`） |
| `task-catalog.json` | 任务定义（静态结构 + 空 picker） |
| `item-catalog.json` | 道具多选数据源 |
| `afk-catalog.json` | 挂机地图本地目录（游戏内目录的补充） |
| `game.html` | 游戏加载 + bridge 分发 + socket 钩子 |
| `106u_game_auth.py` | 106u 账号登录、选区、返回 `js_gameVars`；挂机方案按平台+账号落盘 |

**配置持久化**（平台 `106u` + 账号 + 方案名称）：

| 层级 | 说明 |
|------|------|
| 真源 | `python 106u_game_auth.py` 提供 `GET/PUT /api/user-config`，写入 `user_data/106u/{账号}.json` |
| 本地缓存 | 登录后按账号写入 `localStorage`（`afk_user_cfg_v2__106u__{账号}`）；未登录退回 legacy `afk_profiles_v1` |
| 同步时机 | 登录/恢复会话时拉取；改方案自动保存时防抖上传；换电脑登录同一账号即可同步 |
| 不同步 | Tab 偏好、日志设置、密码、`js_gameVars` 仍仅本机/会话 |

首次登录若云端为空，会自动上传本机已有方案（含旧版 `afk_profiles_v1`）。

---

## 2. 调度优先级（勾选「任务优先」时）

总体顺序：

```
任务（勾选任务优先） > 活动 > Boss 猎杀 > 挂机
```

**不可打断**（必须做完当前阶段，再执行更高优先级）：

| 阶段 | phase 示例 | 说明 |
|------|------------|------|
| Boss 战 | `GOING_BOSS` / `HUNTING_BOSS` / `LOOTING_BOSS` | 含拾取；魔影清查也走 Boss phase |
| 活动进行中 | `GOING_QUNYING` / `QUNYING` / `GOING_PANLUAN` / `PANLUAN` / `GOING_ACTIVITY` / `IN_ACTIVITY` | 群英汇、魔影、皇陵叛乱、通用活动 |

**典型场景**

| 场景 | 行为 |
|------|------|
| 挂机中 + 任务优先 | 直接切入任务队列 |
| 打 Boss 中 + 任务优先 | 打完当前 Boss（含拾取）→ 回挂机 → 执行任务 |
| 活动中 + 任务优先 | 先完成当前活动 → 再执行任务 |
| Boss 打完 | `resumeFarmAfterHunt` 若任务待办，**不**接活动、**不**跳下一只 Boss |
| 活动时段开启 | 若任务待办，记入 `pendingActivityKind`，任务完成后再去 |

**相关函数**（`layout-preview.html`）

- `shouldDeferLowerPriorityForTasks(p)` → `TaskModule.shouldRunBeforeBoss(p)`
- `onRuntimeForScheduler` 内顺序：Boss → 活动进行中 → 任务 → 启动活动 → 回收 → 挂机

---

## 3. 任务 Runner 生命周期

```
启动调度器
  └─ 若任务优先且有 pending → GOING_TASK → beginNextTask()
       └─ sendCmd('runTask') → handler.start()
            └─ 返回 { done:false, waitMs } → DOING_TASK
                 └─ 定时 sendCmd('getTaskStatus') → handler.poll()
                      ├─ done:true → finishCurrentTask → 下一项
                      ├─ restart:true → 同一 handler 再 start
                      └─ done:false → 继续 poll
```

**handler 返回值约定**（`task-handlers.js`）

| 字段 | 含义 |
|------|------|
| `success: true/false` | 是否执行成功 |
| `done: true` | 本任务项结束 |
| `restart: true` | 同一任务内进入下一子步骤（如 BOSS 队列下一只） |
| `waitMs` | 下次 poll 前等待毫秒数 |
| `statusText` | 状态栏文案 |
| `state` | 持久化到 `runner.taskState`，跨 start/poll 传递 |
| `reason` | 完成/跳过原因（写入日志） |

**跳过 vs 失败**

- `skip('原因')` → `done:true`，记为完成并继续队列（如无次数）
- `fail('原因')` → `success:false`，连续 3 次失败会 skip 整项

---

## 4. 副本 / BOSS 协议速查

> 协议均通过 `net.DuplicateModel.ins()` 调用，对应游戏内 `PersonalBossPop` 等 UI 的点击行为。**不要凭编号猜测，应对照根目录 `main10.25144.1.min.js` 中同名 UI 的 onClick。**

### DuplicateModel 常用

| 方法 | 游戏内对应 | 正确用途 |
|------|------------|----------|
| `send2(dupId)` | 个人 BOSS「前往」、通用进副本 | **进地图打怪** |
| `send3()` | 退出副本 | 离开当前副本 |
| `send44(dupId)` | 选中 BOSS 列表项 | 同步 BOSS 详情/次数（进图前建议先发） |
| `send49(dupId, beishu)` | 材料副本 NPC 进本（AlertDialog173） | 进图；`beishu` 为进本参数，**不是**结算领取 |
| `send54(isDouble)` | 试炼结算 UI730「领取/双倍奖励」 | **材料/灵气打完后的领取**：`false` 单倍，`true` 双倍 |
| `send68(dupId)` | 个人 BOSS「快速挑战」 | **消耗道具秒挑战，不进图** |

### 其他 Model

| 方法 | 用途 |
|------|------|
| `PlayModel.send9(mapType)` | 枯骨/试炼等 ARPG 地图进图 |
| `PlayModel.send3(mapId)` | 部分 mapPlay 进图 |
| `ExpeditionModel.send2(false)` | 凌霄征途开始 |
| `Logic.deliverToFindNpc(npcId)` | 卧龙山庄寻路 NPC |
| `gd.bag.useCangBaoTu()` | 使用藏宝图挖宝 |

### 判断是否在副本内

```javascript
// task-handlers.js getRuntime()
r.inDuplicate = !!(gd.arpgInst && gd.arpgInst.cfgId);
r.duplicateId = gd.arpgInst.cfgId || 0;
```

**不要**在 `send2` 发出后立即设 `enteredDup=true` 并在下一帧 poll 里判定「已打完」——进图有延迟，会假完成。

---

## 5. 个人 BOSS（重点踩坑）

### 游戏内两种操作

| UI | 协议 | 说明 |
|----|------|------|
| **前往** | `send44` + `send2` | 正常进图击杀 |
| **快速挑战** | `send68` | 花道具直接结算，需额外解锁条件 |

### 错误用法（已修复，勿再犯）

```javascript
// ❌ 错误：用 send68 当进图
net.DuplicateModel.ins().send68(dupId);
st.enteredDup = true;

// poll 里：
if (st.enteredDup && !rt.inDuplicate) {
    // 进图失败也会立刻判定「打完」→ 3 秒假完成
}
```

### 正确进图

```javascript
net.DuplicateModel.ins().send44(dupId);
net.DuplicateModel.ins().send2(dupId);
st.enterSent = true;
st.wasInDup = false;
// poll：见怪物 → 战斗 → 击杀检测 → send3 退出 → restart 下一只
```

### 打完自动退出

击杀判定（任一满足，且曾见过怪物）：

1. `gd.arpgInst.dupstate === 2`（协议 71005；**个人 BOSS 通常不会变 2**）
2. 视野内怪物清空并保持约 1s（`emIns._monsterDic`）

退出判定（**不要只看 `inDuplicate`**）：

- `send3` 后角色可能已回挂机图（如 map=154），但 `gd.arpgInst.cfgId` 仍残留 → `inDup=true`
- 以 **`当前 mapId !== bossMapId`** 为准判定已离本，必要时本地 `cfgId=0` 清残留
- 记录进图时的 `bossMapId`（如 5236）用于对比

流程：击杀 → **保持自动战斗 + AutoPick 拾取约 10s** → `uim.hide(789)` → `send3()` 退出 → 切下一个 BOSS。

```javascript
// ✅ poll 中不可仅因 inDuplicate 一直等待
// 必须在 dupstate===2 或怪清后主动 send3
```

### 队列过滤

个人 BOSS 必须同时满足才入队：

1. `Logic.checkCondition(d.condition)` 为 true（**无 `[未解锁]`**）
2. `gd.boss.dupCountData[dupId] > 0`（有剩余次数）
3. 用户在 picker 中勾选了该项（若 picker 非空）

### 「开服天数不足 N 天」

- 来自副本配置的 `condition` 字段（如开服 ≥ 135 天）
- `send68`（快速挑战）和 `send2`（进图）都会校验，不满足则弹 toast、不进图
- 选择器里标 `[未解锁]` 的 BOSS 不要勾选
- 失败原因可用 `Logic.getDiscontentCondition(condition)` 读出

### 列表数据来源

对齐游戏 `PersonalBossPop.setBossArrData`：

- `duplicateType == 43`
- 优先 `gd.boss.commontoparr[43]`，其余排除 `commontopdic[43]`
- 次数：`gd.boss.dupCountData[dupId]`（**剩余次数**，不是已用次数）

---

## 5.1 会员工资（member_salary）

- 数据：`gd.player.TQData[5|6|7]`（青铜/白银/黄金），`isGot === 0` 表示今日未领
- 领取：`net.VipModel.ins().send2(cardId)`（对齐 NPC 会员对话按钮）
- 开放条件：`Logic.checkCondition(cm.global[36801].value)`（与游戏红点一致）
- 已开通但已领 → 跳过；未开通 → 跳过

---

## 6. 各任务 handler 协议对照

| handler | 进图/触发方式 | poll 完成条件 |
|---------|---------------|---------------|
| `member_salary` | `VipModel.send2(cardId)`（5/6/7） | `TQData.isGot` 变为已领，或超时确认 |
| `personal_boss` | `send44` + `send2` | `wasInDup` 后离开副本 |
| `material_dungeon` | 进本 `send49(dupId,1)`；结算 UI730 按双倍策略 `send54(true/false)` | 领取后出本，次数跑完 |
| `spirit_dungeon` | 进本 `send2(70001)`；结算同样 `send54` | 领取后出本 |
| `daily_elite` | 随机 Boss 悬赏：`send6(3)` + 接`send8` / 前往`gotask` / 领`send2` | 今日完成次数用尽且无进行中；勿假进本 |
| `yongchuang_tianguan` | 勇闯天关：`TianguanModel.send2` 刷新；`send3` 挑战当前层；结算 UI788 后 `DuplicateModel.send3` 退出；`send5(false)` 领挂机奖 | 次数用尽 / 已切剑阁 / 达时限 |
| `bone_boss` / `trial_boss` | `PlayModel.send9(mapType)` | 超时或地图切换 |
| `yanhuo_tumo` / `zuma_mishi` | `uim.show(519, index)` | 进过副本或超时 |
| `lingxiao` | `uim.show(738)` + `ExpeditionModel.send2` | 超时 |
| `dig_treasure` | `gd.bag.useCangBaoTu()` | 次数达标或耗尽 |
| `wolong_relic` | 进图后按剩余次数展开，只采高级天书(6000839)；视野内实体优先寻路，否则 5 固定点顺序巡访采集 | 日次用尽 / 采满展开次数 / 天书未刷新 |
| `wolong_*`（首领/魔神等） | `Logic.deliverToFindNpc` | 寻路到目标地图（战斗闭环仍待补） |
| `exp_task` | **除魔**日常（ChuMo）：`send6(2)`；已接→`gotask`；Finish→`send2`；未接→`send8`；无除魔才回退主线 | 除魔次数用尽 / 无进度约3分钟 / 最长约30分钟 |

---

### 经验任务（exp_task）说明

对应游戏里的 **除魔**（`ChuMoNewTaskView` / `TaskType.ChuMo=2`），不是主线。已接任务应直接 `gotask` 续做。

1. 启动：`TaskModel.send6(2)` 刷新；从 `ChuMoTask` / `dailyTaskDic[2]` / `ingTaskid` 取任务
2. 已接（state=2）：`isAutoGoTask` + `gotask` + 自动战斗
3. 可交（state=3）：寻路后 `send2(id,1)`
4. 未接（state=1）：`send8(id)`；交完若还有次数再拉下一条
5. 无除魔数据约 12s 后才回退主线；**不要**因 `currentMainTask` 为空秒结束

### 勇闯天关（yongchuang_tianguan）说明

对应游戏 **勇闯天关**（`TianGuanPop` UI528 / `net.TianguanModel`），数据在 `gd.boss.tianGuanData`。

1. 启动：`send2()` 刷新；若 `idleChestTime>0` 则 `send5(false)` 领挂机奖
2. `tianGuanState===true`：已通关切剑阁 → 本项结束
3. `leftCount<=0`：无次数 → 结束
4. `send3()` 挑战**当前** `group/storey`（无需选层）
5. 副本内开自动战斗；出现结算 UI788 后关闭并 `DuplicateModel.send3` 退出
6. 出本后刷新次数，有剩余则继续挑战，直到次数用尽或超时（约 40 分钟）

依赖：「任务优先」+ 勾选本项 + 启动调度。

### 精英挑战（daily_elite）说明

对应 **随机 Boss 悬赏**（`BossTaskPop` / `TaskType.RandomBoss=3`），不是历练副本假进本。

1. `send6(3)` 拉 `bossTaskList`；已接/可交优先续做
2. `leftAcceptCount` 实为剩余完成次数：为 0 时若仍有已接/可交，继续做完再结束
3. 接 `send8` / 领 `send2` / 前往 `gotask`；列表空可 `send10(1)` 刷新

依赖：「任务优先」+ 勾选本项 + 启动调度。

---

## 7. 动态选项（picker）同步

个人 BOSS、枯骨 BOSS 等选项**不能**只依赖 `task-catalog.json` 里的空 `options`。

1. 进入游戏后，`getTaskCatalog` 调用 `TaskHandlers.getTaskCatalog()`
2. `getPersonalBossOptions()` 读 `cm.duplicate` + `gd.boss.dupCountData`
3. 打开 picker 前 `refreshCatalogFromGame()` 强制同步
4. 列表为空时提示「请先进入游戏」

**副作用注意**：`getPersonalBossOptions` 末尾会对第一个 BOSS 调 `send44`，仅用于刷新服务端次数，不要在 poll 里重复调用。

---

## 8. 页面初始化顺序

```
TaskModule.init() → ActivityModule.init()
loadProfiles()          ← 必须先有方案数据
initFeatureTabs()       ← 若 saved tab=task，会 renderTaskPanel → getActive()
fillEditor(getActive())
TaskModule.loadCatalog()  ← 异步，完成后再次 renderTaskPanel
```

**踩坑**：`initFeatureTabs()` 若在 `loadProfiles()` 之前执行，且上次停留在任务页，会 `ensureBag(undefined)` 报错。

`ensureBag(p)` 已对 `!p` 做防护，但顺序仍应保持 `loadProfiles` 在前。

---

## 9. 新增任务 checklist

1. **`task-catalog.json`**：增加 item（`id`、`handler`、`kind`、picker 等）
2. **`task-handlers.js` / `task-handlers-wolong.js`**：实现 `handlers.xxx = { start, poll }`（卧龙相关写在 wolong 独立文件）
3. **对照游戏 UI**：在根目录 `main10.25144.1.min.js` 搜索相关 Pop/Model，确认协议
4. **poll 模式**：
   - 进副本类：等 `inDuplicate` 真为 true 再标记「已进入」
   - 出副本才算完成
   - 进图失败要有超时 + 重试 + 明确 skip 原因
5. **条件/次数**：用 `Logic.checkCondition` + 游戏内计数字段过滤
6. **调度**：任务只通过 `TaskModule.onRuntimeFarmGate` 在 `FARMING` 切入，不打断 Boss/活动

---

## 10. 常见踩坑汇总

| 现象 | 原因 | 处理 |
|------|------|------|
| 个人 BOSS 3 秒「完成」未进图 | 用了 `send68` + poll 误判 | 改用 `send2`，用 `wasInDup` 判断 |
| 个人 BOSS 打完傻站着 | 未检测击杀、未 `send3` 退出 | 检测 `dupstate===2` 或怪清后 `send3` |
| 提示开服天数不足 | 选了未解锁 BOSS | 只勾选无 `[未解锁]` 的项 |
| 任务页报错 `p.bag` | 初始化顺序错误 | `loadProfiles` 在 `initFeatureTabs` 前 |
| 任务不执行 | 未勾选「任务优先」或 `sessionDone` 已标记 | 重启调度器或清 `sessionDone` |
| 打 Boss 时任务插队 | 设计如此不可打断 | Boss 打完才任务 |
| 活动中任务不跑 | 设计如此不可打断 | 活动结束后 `resumeFarmAfterHunt` 会优先任务 |
| `uim.show(101/671/680)` 无效 | 非本游戏 UI id | 查 min.js 中真实 UI 编号 |
| picker 列表空 | 未进游戏 | 登录进区后点「刷新」 |

---

## 11. 调试建议

1. **运行日志**：个人 BOSS 仅输出里程碑（队列 / 进图 / 击杀 / 回城 / 异常）；战斗与拾取倒计时见状态栏
2. **异常排查**：warn 行附带简短快照 `map= alive= inDup=`
3. **对照游戏**：手动点一次目标功能，在 min.js 里搜按钮 `onClick` 看发了什么协议
4. **runtime 快照**：`getRuntimeState` 返回的 `inDuplicate`、`mapId`、`dropCount`
5. **任务状态**：`runner.taskState[taskKey]` 存 handler 的 `state` 对象
6. **条件文案**：`Logic.getDiscontentCondition(cond)` / `Logic.getConditionListShow(cond)`

---

## 12. 本地启动

```bash
# 1. 登录服务（layout-preview 左侧 106u 登录依赖）
cd html
python 106u_game_auth.py
# 默认 http://127.0.0.1:8765

# 2. 用浏览器直接打开（file:// 或本地静态服务均可）
layout-preview.html
```

**流程**：启动登录服务 → 打开 `layout-preview.html` → 左侧登录选区 → 进入游戏 → 配置方案 → 点「启动」调度器。

> 若提示「登录服务未启动」，确认 `106u_game_auth.py` 在运行且端口 8765 可访问。

---

## 13. 代码组织与后续工作

### 已完成（2026-08-23）

| 项 | 说明 |
|----|------|
| `layout-preview.css` | 样式从 HTML 外置 |
| `layout-preview.html` | 精简为 ~630 行（结构 + script 引用） |
| `platform/parts/*.js` | 主逻辑按 15 个职责分片 |
| `platform-main.js` | `platform/build.ps1` 合并构建产物 |
| `farm-tactics.js` | 挂机高级策略（此前已外置） |
| `soul-hall.js` | 自动灵魂殿堂（材料达阈值→进殿堂注入） |

### 开发流程

```powershell
cd html
npm run build          # 改 platform/parts 后必跑
npm run check          # 校验全部主 JS
# 或一步到位
npm run validate
```

等价于 `powershell -File platform/build.ps1`（已内置分片校验 + 语法检查 + **版本戳**）。

### 版本与缓存戳

| 文件 | 作用 |
|------|------|
| `version.json` | 语义版本号 + 构建时间 + git 短 hash + 缓存戳 `stamp` |
| `scripts/stamp-version.js` | 刷新 stamp，给 HTML 中 JS/CSS 加 `?v=`，更新顶栏版本展示 |

**何时产生新版本戳**

| 场景 | 动作 | 触发方式 |
|------|------|----------|
| 改 `platform/parts` 并构建 | build 时间戳 + stamp | `npm run build` / pre-commit |
| 改根目录 JS（tasks / activity-runtime 等） | 刷新 stamp | pre-commit 或 `npm run stamp` |
| 改 `layout-preview.html` / `game.html` / CSS | 刷新 stamp | pre-commit 或 `npm run stamp` |
| 发布里程碑 | **语义版本** patch/minor/major 递增 | `npm run version:bump patch` |

**顶栏展示**：`layout-preview.html` 品牌旁显示 `v0.1.0 · 202608241012 · abc1234`（版本 · 构建时间 · git）。

**提交前（推荐）**：`git config core.hooksPath .githooks` — 改动 parts 或 JS/HTML 资源时自动 validate / stamp。详见 `platform/README.md` §工程化流程。

**Agent 自动校验（Cursor）**：已配置 `.cursor/hooks.json` — Agent 写入 `platform/parts/` 后会自动 `npm run validate`，失败会注入上下文并触发继续修复。详见 `.cursor/README.md`。

### 可选后续（进一步解耦）

调度核心（`07`–`11`）仍共享同一 IIFE 闭包内的 hunt/phase 状态。若需像 `TaskModule` 一样独立加载，可逐步改为 `init(api)` + 共享 `PlatformApp` 上下文：

| 优先级 | 目标 | 说明 |
|--------|------|------|
| 1 | `auth-module.js` | 106u 登录，几乎无调度依赖 |
| 2 | `boss-hunt-module.js` | 猎杀队列、拾取（与 scheduler 耦合最深） |
| 3 | `moying-module.js` / `qunying-module.js` | 与 `ActivityModule` 对齐 |

详见 `platform/README.md`。

---

*最后更新：2026-08-23 — 完成 layout-preview 模块化拆分（CSS + platform/parts）；保留个人 BOSS、调度优先级等开发笔记。*
