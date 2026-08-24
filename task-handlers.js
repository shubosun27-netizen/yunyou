/**
 * 任务 Tab 游戏内执行器（在 game.html iframe 内加载）
 * 依赖：gd / net / uim / Logic / cm / window.__gameBridge
 */
(function (global) {
    'use strict';

    var TICKET_GLOBAL_ID = 31401;
    var PERSONAL_BOSS_LOOT_MS = 10000;

    function ok(obj) {
        var r = { success: true };
        if (obj) for (var k in obj) if (obj.hasOwnProperty(k)) r[k] = obj[k];
        return r;
    }
    function fail(reason, st) {
        var r = { success: false, reason: reason || '失败' };
        if (st) r.state = st;
        return r;
    }
    function skip(reason, st) {
        var r = ok({ done: true, reason: reason || '跳过' });
        if (st) r.state = st;
        return r;
    }

    var TASK_LOG_MAX = 16;

    function taskLog(st, msg, level) {
        if (!st) return;
        if (!st._logs) st._logs = [];
        var now = Date.now();
        var last = st._logs[st._logs.length - 1];
        if (last && last.msg === String(msg) && now - last.t < 600) return;
        st._logs.push({ t: now, msg: String(msg), level: level || 'info' });
        if (st._logs.length > TASK_LOG_MAX) st._logs.length = TASK_LOG_MAX;
    }

    function finalizeTaskResult(result) {
        if (!result || !result.state || !result.state._logs || !result.state._logs.length) return result;
        result.logs = result.state._logs.slice();
        result.state._logs = [];
        return result;
    }

    /** 个人 BOSS 精简日志（仅里程碑；轮询细节走状态栏） */
    function pbShortLabel(label) {
        return String(label || '').replace(/（[^）]*）/g, '').trim() || '?';
    }

    function pbOrdinal(st) {
        var n = st && st.queue ? st.queue.length : 0;
        var i = st ? (st.idx + 1) : 1;
        return i + '/' + (n || '?');
    }

    function pbLog(st, msg, level) {
        taskLog(st, '[个人BOSS] ' + msg, level || 'info');
    }

    function pbSnapBrief(rt, st) {
        rt = rt || getRuntime();
        var ms = getMonsterStats(getDuplicateTargetMonsterId(st && st.curDup));
        return 'map=' + rt.mapId + ' alive=' + ms.alive + ' inDup=' + rt.inDuplicate;
    }

    function bridge() { return global.__gameBridge || {}; }

    function getRuntime() {
        var r = {
            mapId: 0,
            inDuplicate: false,
            duplicateId: 0,
            dupState: 0,
            playerHp: 0,
            playerHpMax: 0
        };
        try {
            if (global.gd && gd.map) r.mapId = gd.map.curMapId || gd.map.config && gd.map.config.id || 0;
            if (global.gd && gd.arpgInst) {
                r.inDuplicate = !!(gd.arpgInst.cfgId);
                r.duplicateId = gd.arpgInst.cfgId || 0;
                r.dupState = gd.arpgInst.dupstate || 0;
            }
            if (global.gd && gd.player) {
                r.playerHp = gd.player.hp || 0;
                r.playerHpMax = gd.player.hpMax || 0;
            }
        } catch (e) { r.error = e.message; }
        return r;
    }

    function getMonsterStats(targetMonsterId) {
        var stats = { alive: 0, targetAlive: 0 };
        try {
            if (!global.emIns || !emIns._monsterDic) return stats;
            for (var k in emIns._monsterDic) {
                var m = emIns._monsterDic[k];
                if (!m) continue;
                var fo = m.fighterObject || {};
                var mo = m.monsterObject || {};
                var cfg = mo.config || fo.config || {};
                if (fo.isDead || (fo.hp != null && fo.hp <= 0)) continue;
                stats.alive++;
                if (targetMonsterId && Number(cfg.id) === Number(targetMonsterId)) stats.targetAlive++;
            }
        } catch (e) {}
        return stats;
    }

    function getDuplicateTargetMonsterId(dupId) {
        try {
            var dc = cm.duplicate[dupId] || cm.duplicate[String(dupId)];
            return dc && dc.monsterId ? Number(dc.monsterId) : 0;
        } catch (e) {}
        return 0;
    }

    function getDuplicateMapId(dupId) {
        try {
            var dc = cm.duplicate[dupId] || cm.duplicate[String(dupId)];
            return dc && dc.mapId ? Number(dc.mapId) : 0;
        } catch (e) {}
        return 0;
    }

    /** send3 后角色可能已回城但 gd.arpgInst.cfgId 仍残留，用地图变化判断已离开 */
    function hasLeftPersonalBossDup(rt, st) {
        if (!st) return !rt.inDuplicate;
        var bossMap = st.bossMapId || getDuplicateMapId(st.curDup);
        if (bossMap && rt.mapId && Number(rt.mapId) !== bossMap) return true;
        return !rt.inDuplicate;
    }

    function clearStaleDupState(st, reason) {
        try {
            if (global.gd && gd.arpgInst) {
                if (gd.arpgInst.cfgId) {
                    taskLog(st, '[个人BOSS] 本地清理残留 cfgId=' + gd.arpgInst.cfgId +
                        (reason ? (' · ' + reason) : ''), 'warn');
                }
                gd.arpgInst.cfgId = 0;
                gd.arpgInst.dupstate = 0;
            }
        } catch (e) {}
    }

    function ensurePersonalBossLootMode() {
        try {
            if (global.gd && gd.arpgInst && gd.arpgInst.setAutoFight) {
                gd.arpgInst.setAutoFight(1);
            }
            if (global.gd && gd.player) gd.player.AutoPick = true;
            if (global.window) window.__farmPickupForce = true;
        } catch (e) {}
    }

    function retryExitPersonalBoss(st) {
        try { if (global.uim && uim.hide) uim.hide(789); } catch (e0) {}
        try {
            if (global.gd && gd.arpgInst && gd.arpgInst.setAutoFight) gd.arpgInst.setAutoFight(3);
        } catch (e1) {}
        try {
            if (global.net && net.DuplicateModel && net.DuplicateModel.ins) {
                net.DuplicateModel.ins().send3();
            }
        } catch (e2) {}
        st.exitAt = Date.now();
    }

    function finishPersonalBossExit(st, rt) {
        if (rt.inDuplicate) clearStaleDupState(st, 'map=' + rt.mapId);
        st.exitingDup = false;
        st.wasInDup = false;
        st.enterSent = false;
        st.retries = 0;
        st.bossMapId = 0;
        st.fought = (st.fought || 0) + 1;
        st.idx++;
        taskLog(st, '[个人BOSS] ← 完成 ' + st.fought + '/' + (st.queue ? st.queue.length : '?') +
            ' @map' + rt.mapId, 'info');
    }

    /** 个人 BOSS 是否已击杀（对齐 dupstate=2 / 71005、视野怪死亡） */
    function isPersonalBossKillDone(dupId, st) {
        try {
            if (global.gd && gd.arpgInst && gd.arpgInst.dupstate === 2) {
                st._killReason = 'dupstate=2(71005)';
                return true;
            }
        } catch (e) {}
        if (!st || !st.fightStarted) return false;
        var mid = getDuplicateTargetMonsterId(dupId);
        var ms = getMonsterStats(mid);
        if (ms.alive > 0) {
            st.sawMonsters = true;
            if (mid && ms.targetAlive > 0) st.sawTargetBoss = true;
            st.clearSince = 0;
            st._killReason = '';
            return false;
        }
        if (!st.sawMonsters && !st.sawTargetBoss) return false;
        if (!st.clearSince) {
            st.clearSince = Date.now();
            st._killReason = 'monsters_cleared';
        }
        return Date.now() - st.clearSince >= 1000;
    }

    function exitPersonalBossDuplicate(st) {
        retryExitPersonalBoss(st);
        st.exitingDup = true;
        st.fightStarted = false;
        st.sawTargetBoss = false;
        st.sawMonsters = false;
        st.clearSince = 0;
        st.lootWaitStarted = false;
    }

    function exitDuplicate() {
        try {
            if (global.net && net.DuplicateModel && net.DuplicateModel.ins) {
                net.DuplicateModel.ins().send3();
                return ok({ exited: true });
            }
        } catch (e) { return fail(e.message); }
        return fail('DuplicateModel 不可用');
    }

    function showUi(id, data) {
        try {
            if (global.uim && uim.show) {
                if (data !== undefined && global.UIData) uim.show(id, new UIData(data));
                else uim.show(id);
                return true;
            }
        } catch (e) {}
        return false;
    }

    function checkCondition(cond) {
        try {
            if (global.Logic && Logic.checkCondition) return Logic.checkCondition(cond);
        } catch (e) {}
        return true;
    }

    function monsterName(mid) {
        try {
            var m = cm.getMonsterConfig(mid);
            return m && m.name ? m.name : '';
        } catch (e) { return ''; }
    }

    function pickedIds(cfg) {
        return (cfg && cfg.picked && cfg.picked.length) ? cfg.picked.slice() : [];
    }

    function resolveDoubleBeishu(mode) {
        return resolveWantDouble(mode) ? 2 : 1;
    }

    /** 双倍领取策略 → 是否双倍（结算 send54 / 进本 beishu） */
    function resolveWantDouble(mode, dupId) {
        mode = mode || 'if_ticket';
        if (mode === 'never') return false;
        if (mode === 'always') return true;
        // if_ticket：全局双倍券(31401)，或该副本 doubleReward 消耗道具
        var ticketId = 0;
        try {
            var g = cm.global[TICKET_GLOBAL_ID];
            if (g && g.value) ticketId = parseInt(String(g.value).split('#')[0], 10);
        } catch (e) {}
        try {
            if (ticketId && global.gd && gd.bag && gd.bag.getCount(ticketId, true) > 0) return true;
        } catch (e2) {}
        if (dupId) {
            try {
                var d = cm.duplicate[dupId] || cm.duplicate[String(dupId)];
                if (d && d.doubleReward) {
                    var itemId = parseInt(String(d.doubleReward).split('#')[0], 10);
                    if (itemId && gd.bag && gd.bag.getCount(itemId, true) > 0) return true;
                }
            } catch (e3) {}
        }
        return false;
    }

    /** 试炼结算弹窗 FightResultShiLianPop = UI730（协议 71053） */
    function shilianResultOpen() {
        try {
            var v = global.uim && uim.getUI && uim.getUI(730);
            if (!v) return false;
            // show 后 visible 多为 true；部分皮肤用 parent 控制显示
            if (v.visible === false) return false;
            if (v.stage || v.parent) return true;
            return v.visible !== false;
        } catch (e) {}
        return false;
    }

    /**
     * 结算领取：对齐 FightResultShiLianPop.onTouch
     * - 「领取奖励」→ send54(false)
     * - 「双倍奖励」→ send54(true)
     * - 首领挑战 cls73 → send3
     * 注意：进本 send49 的 beishu 与结算领取是两套逻辑；用户选的「双倍领取」对应本函数。
     */
    function claimShilianReward(st, wantDouble) {
        try {
            var cfgId = 0;
            try { cfgId = (global.gd && gd.arpgInst && gd.arpgInst.cfgId) || 0; } catch (e0) {}
            var mapCls = 0;
            try {
                var dup = cm.duplicate[cfgId] || cm.duplicate[String(cfgId)];
                if (dup && dup.mapId && cm.map[dup.mapId]) mapCls = Number(cm.map[dup.mapId].cls) || 0;
            } catch (e1) {}
            if (mapCls === 73) {
                net.DuplicateModel.ins().send3();
                taskLog(st, '试炼结算 cls73 退出 send3');
                return true;
            }
            net.DuplicateModel.ins().send54(!!wantDouble);
            taskLog(st, '试炼结算领取' + (wantDouble ? '双倍' : '单倍') + ' send54(' + !!wantDouble + ')');
            return true;
        } catch (e) {
            taskLog(st, '试炼结算领取失败：' + e.message, 'warn');
            return false;
        }
    }

    /** 通用副本结算 FightResultPop = UI789（协议 71050 等） */
    function fightResultPopOpen() {
        try {
            var v = global.uim && uim.getUI && uim.getUI(789);
            if (!v) return false;
            if (v.visible === false) return false;
            if (v.stage || v.parent) return true;
            return v.visible !== false;
        } catch (e) {}
        return false;
    }

    function hideShilianResultUi() {
        try { if (global.uim && uim.hide) uim.hide(730); } catch (e0) {}
        try { if (global.uim && uim.hide) uim.hide(789); } catch (e1) {}
    }

    function shilianDupMapId(st) {
        if (st && st.bossMapId) return Number(st.bossMapId);
        if (st && st.curDup) return getDuplicateMapId(st.curDup);
        return 0;
    }

    /** send54 只领奖励不出本；用副本地图 id 判断是否仍在内 */
    function hasLeftShilianDup(rt, st) {
        var bossMap = shilianDupMapId(st);
        if (bossMap && rt.mapId && Number(rt.mapId) !== bossMap) return true;
        return !rt.inDuplicate;
    }

    function isInsideShilianDup(rt, st) {
        var bossMap = shilianDupMapId(st);
        if (bossMap && rt.mapId && Number(rt.mapId) === bossMap) return true;
        return !!rt.inDuplicate;
    }

    /** 试炼/材料副本领完奖后退出：关结算窗 + 停挂机 + send3 */
    function exitShilianDuplicate(st, reason) {
        hideShilianResultUi();
        try {
            if (global.gd && gd.arpgInst && gd.arpgInst.setAutoFight) gd.arpgInst.setAutoFight(3);
        } catch (e1) {}
        try {
            if (global.net && net.DuplicateModel && net.DuplicateModel.ins) {
                net.DuplicateModel.ins().send3();
            }
        } catch (e2) {}
        st.exitingDup = true;
        st.exitAt = Date.now();
        taskLog(st, (reason || '试炼退出') + ' send3 ·map=' + (getRuntime().mapId || '?'));
    }

    function finishShilianRound(st, wantDouble, label) {
        taskLog(st, (label || '试炼') + '本局完成 ·' +
            ((st.idx || 0) + 1) + '/' + (st.queue ? st.queue.length : '?') +
            (wantDouble ? ' ·双倍领' : ' ·单倍领') +
            (st.claimSent ? '' : '（未见到结算窗）'));
        st.enteredDup = false;
        st.claimed = false;
        st.claimSent = false;
        st.enterSent = false;
        st.fightStartedAt = 0;
        st.exitingDup = false;
        st.exitAt = 0;
        st.idx = (st.idx || 0) + 1;
    }

    function dupEnded(state) {
        var rt = getRuntime();
        if (!state.enteredDup) return false;
        return !rt.inDuplicate;
    }

    function getPersonalBossOptions() {
        var opts = [];
        if (!global.cm || !cm.duplicate) return opts;
        var dupBossArr = [];
        var tops = [];
        try {
            if (global.gd && gd.boss && gd.boss.commontoparr && gd.boss.commontoparr[43]) {
                tops = gd.boss.commontoparr[43];
            }
        } catch (e) {}
        if (tops && tops.length) {
            for (var ti = 0; ti < tops.length; ti++) {
                var tr = cm.duplicate[tops[ti]];
                if (tr) dupBossArr.push(tr);
            }
        }
        var allDup = cm.duplicate;
        for (var k in allDup) {
            if (!allDup.hasOwnProperty(k)) continue;
            var d = allDup[k];
            if (!d || d.duplicateType != 43) continue;
            try {
                if (global.gd && gd.boss && gd.boss.commontopdic && gd.boss.commontopdic[43] &&
                    gd.boss.commontopdic[43][d.id]) continue;
            } catch (e2) {}
            dupBossArr.push(d);
        }
        var seen = {};
        dupBossArr.forEach(function (d) {
            if (!d || seen[d.id]) return;
            seen[d.id] = 1;
            var cnt = 0;
            try {
                if (global.gd && gd.boss && gd.boss.dupCountData) cnt = gd.boss.dupCountData[d.id] || 0;
            } catch (e3) {}
            var lim = 0;
            try {
                if (d.limitTimes) lim = parseInt(String(d.limitTimes).split('#')[1], 10) || 0;
            } catch (e4) {}
            var label = monsterName(d.monsterId) || d.name || ('个人BOSS#' + d.id);
            if (lim > 0) label += '（' + cnt + '/' + lim + '）';
            else label += '（次数' + cnt + '）';
            var condOk = !d.condition || checkCondition(d.condition);
            if (!condOk) label += ' [未解锁]';
            opts.push({
                id: String(d.id),
                label: label,
                dupId: d.id,
                count: cnt,
                max: lim,
                unlocked: condOk
            });
        });
        try {
            if (opts.length && global.net && net.DuplicateModel && net.DuplicateModel.ins) {
                net.DuplicateModel.ins().send44(opts[0].dupId);
            }
        } catch (e5) {}
        return opts;
    }

    function getMaterialDungeonOptions() {
        var opts = [];
        if (!global.gd || !gd.boss) return opts;
        for (var i = 0; i < 4; i++) {
            var mapId = 28001 + i;
            var cnt = gd.boss.materialbossdic[mapId] || 0;
            var dupId = 0;
            var label = '材料副本' + (i + 1);
            try {
                for (var k in cm.duplicate) {
                    var d = cm.duplicate[k];
                    if (d && d.mapId == mapId) { dupId = d.id; label = monsterName(d.monsterId) || label; break; }
                }
            } catch (e) {}
            opts.push({ id: 'mat_' + mapId, label: label + '（剩' + cnt + '）', mapId: mapId, dupId: dupId, count: cnt });
        }
        return opts;
    }

    function getArpgMapOptions(prefix, mapTypes) {
        var opts = [];
        mapTypes = mapTypes || [];
        mapTypes.forEach(function (mt, idx) {
            var info = gd.boss.arpgMapInfo && gd.boss.arpgMapInfo[mt];
            var cur = info ? (info.curNum || 0) : 0;
            var name = '层' + (idx + 1);
            try {
                for (var k in cm.mapPlay) {
                    var mp = cm.mapPlay[k];
                    if (mp && mp.mapType == mt) { name = mp.name || name; break; }
                }
            } catch (e) {}
            opts.push({ id: prefix + '_' + mt, label: name + '（剩' + cur + '）', mapType: mt, count: cur });
        });
        return opts;
    }

    function getBossTiaoZhanOptions(type, prefix) {
        var opts = [];
        var tz = cm.bossTiaoZhan && cm.bossTiaoZhan[type];
        if (!tz || !tz.showid) return opts;
        var ids = String(tz.showid).split('#').map(function (x) { return parseInt(x, 10); });
        var txts = tz.txt ? String(tz.txt).split('#') : [];
        ids.forEach(function (bid, i) {
            var cnt = 0;
            var max = 0;
            try {
                cnt = gd.boss.getBossDropCount ? (gd.boss.getBossDropCount(bid) || 0) : 0;
                max = gd.boss.getBossMaxCountById ? (gd.boss.getBossMaxCountById(bid) || 0) : 0;
            } catch (e) {}
            opts.push({
                id: prefix + '_' + bid,
                label: (txts[i] || ('首领#' + bid)) + '（' + cnt + '/' + max + '）',
                bossId: bid,
                index: i,
                count: max - cnt
            });
        });
        return opts;
    }

    function getTaskCatalog() {
        var personalOpts = getPersonalBossOptions();
        var pickers = {
            personal_boss_list: { title: '个人BOSS', multi: true, options: personalOpts },
            bone_boss_list: { title: '枯骨BOSS', multi: true, options: getArpgMapOptions('bone', [6, 7, 8]) },
            trial_boss_list: { title: '试炼BOSS', multi: true, options: getArpgMapOptions('trial', [1, 2, 3]) },
            double_reward: {
                title: '双倍领取策略', multi: false,
                options: [
                    { id: 'never', label: '不领双倍' },
                    { id: 'if_ticket', label: '有券才双倍' },
                    { id: 'always', label: '总是双倍' }
                ]
            },
            xiandao_general: { title: '仙岛魔将', multi: true, options: getBossTiaoZhanOptions(800, 'gen') },
            material_dungeon_list: { title: '材料副本', multi: true, options: getMaterialDungeonOptions() }
        };
        return ok({
            pickers: pickers,
            syncedAt: Date.now(),
            runtime: getRuntime(),
            ready: !!(global.cm && cm.duplicate),
            personalBossCount: personalOpts.length
        });
    }

    function stateOf(payload) {
        return (payload && payload.taskState) ? payload.taskState : {};
    }

    function saveState(payload, st) {
        return ok({ state: st });
    }

    /* ---------- handlers ---------- */

    var handlers = {};

    var MEMBER_CARD_NAMES = { 5: '青铜', 6: '白银', 7: '黄金' };

    /** 会员工资：TQData[5/6/7]，isGot===0 可领；协议 VipModel.send2(cardId)（对齐 NpcMemberDialog） */
    function listMemberSalaryCards() {
        var owned = [];
        var pending = [];
        try {
            var tq = gd.player && gd.player.TQData;
            if (!tq) return { owned: owned, pending: pending };
            for (var id = 7; id >= 5; id--) {
                var row = tq[id] || tq[String(id)];
                if (!row) continue;
                var cardId = row.cardId != null ? Number(row.cardId) : id;
                var info = {
                    cardId: cardId,
                    name: MEMBER_CARD_NAMES[cardId] || ('卡' + cardId),
                    isGot: Number(row.isGot),
                    dayNum: row.dayNum
                };
                owned.push(info);
                if (info.isGot === 0) pending.push(info);
            }
        } catch (e) {}
        return { owned: owned, pending: pending };
    }

    function memberSalaryGateOk() {
        try {
            if (global.cm && cm.global && cm.global[36801] && global.Logic && Logic.checkCondition) {
                return !!Logic.checkCondition(cm.global[36801].value);
            }
        } catch (e) {}
        return true;
    }

    function claimMemberSalaryCards(pending) {
        var claimed = [];
        if (!global.net || !net.VipModel || !net.VipModel.ins) {
            throw new Error('VipModel 不可用');
        }
        for (var i = 0; i < pending.length; i++) {
            var c = pending[i];
            net.VipModel.ins().send2(c.cardId);
            claimed.push(c.name + '(' + c.cardId + ')');
        }
        try {
            if (gd.angler && typeof gd.angler.checkcardreward === 'function') {
                gd.angler.checkcardreward(true);
            }
        } catch (e2) {}
        return claimed;
    }

    /** 一次性领取（任务 handler / 日常福利共用） */
    function tryClaimMemberSalaryOnce() {
        if (!global.gd || !gd.player) {
            return { success: false, reason: '角色未就绪' };
        }
        if (!memberSalaryGateOk()) {
            return { success: true, skipped: true, reason: '会员功能未开放' };
        }
        var cards = listMemberSalaryCards();
        if (!cards.owned.length) {
            return { success: true, skipped: true, reason: '未开通会员' };
        }
        if (!cards.pending.length) {
            var names = cards.owned.map(function (c) { return c.name; }).join('、');
            return { success: true, skipped: true, reason: '今日已领取（' + names + '）' };
        }
        try {
            var claimed = claimMemberSalaryCards(cards.pending);
            return { success: true, claimed: claimed, pendingIds: cards.pending.map(function (c) { return c.cardId; }) };
        } catch (e) {
            return { success: false, reason: e.message };
        }
    }

    handlers.member_salary = {
        start: function (p) {
            var st = stateOf(p);
            var r = tryClaimMemberSalaryOnce();
            if (!r.success) {
                taskLog(st, '个人工资失败：' + (r.reason || '未知'), 'warn');
                return fail(r.reason || '领取失败', st);
            }
            if (r.skipped) {
                taskLog(st, '个人工资跳过：' + r.reason, 'info');
                return skip(r.reason, st);
            }
            st.claimed = r.claimed || [];
            st.claimAt = Date.now();
            st.pendingIds = r.pendingIds || [];
            taskLog(st, '个人工资申请领取：' + st.claimed.join('、'));
            return ok({
                done: false,
                waitMs: 4000,
                statusText: '领取会员工资 ' + st.claimed.join('、'),
                state: st
            });
        },
        poll: function (p) {
            var st = stateOf(p);
            var stillPending = [];
            (st.pendingIds || []).forEach(function (id) {
                var row = null;
                try { row = gd.player.TQData[id] || gd.player.TQData[String(id)]; } catch (e) {}
                if (row && Number(row.isGot) === 0) stillPending.push(id);
            });
            if (!stillPending.length) {
                var okReason = '会员工资已领取' + (st.claimed && st.claimed.length ? '：' + st.claimed.join('、') : '');
                taskLog(st, okReason);
                return ok({ done: true, reason: okReason, state: st });
            }
            if (Date.now() - (st.claimAt || p.startedAt || 0) > 8000) {
                var waitReason = '会员工资已申请领取（待确认）' + (st.claimed ? '：' + st.claimed.join('、') : '');
                taskLog(st, waitReason, 'warn');
                return ok({ done: true, reason: waitReason, state: st });
            }
            return ok({ done: false, statusText: '确认会员工资领取中', state: st });
        }
    };

    /** TaskInfo 进度签名：id + state + 目标进度 */
    function taskProgressSig(task) {
        if (!task) return '';
        var parts = [String(task.id || 0), String(task.state || 0)];
        try {
            var goals = task.goalDataList || [];
            for (var i = 0; i < goals.length; i++) {
                var g = goals[i];
                if (!g) continue;
                parts.push((g.goalId || 0) + ':' + (g.curCount || 0));
            }
        } catch (e) {}
        return parts.join('|');
    }

    function ensureAutoFightOn() {
        try {
            if (global.gd && gd.arpgInst && gd.arpgInst.setAutoFight && gd.arpgInst.autoFightType !== 1) {
                gd.arpgInst.setAutoFight(1);
            }
        } catch (e) {}
    }

    function taskAutoFightType() {
        try {
            if (global.gd && gd.arpgInst) return Number(gd.arpgInst.autoFightType) || 0;
        } catch (e) {}
        return 0;
    }

    /** 从任务配置解析目标地图（mapid / mapId 等） */
    function taskTargetMapIds(task) {
        var seen = {};
        function add(v) {
            if (v == null || v === '') return;
            String(v).replace(/\|/g, '#').split('#').forEach(function (s) {
                var n = parseInt(s, 10);
                if (n > 0) seen[n] = 1;
            });
        }
        if (!task) return [];
        try {
            var cfg = global.cm && cm.task && (cm.task[task.id] || cm.task[String(task.id)]);
            if (cfg) {
                add(cfg.mapid); add(cfg.mapId); add(cfg.map);
                add(cfg.sceneId); add(cfg.toMap); add(cfg.enterMap);
            }
            var goals = task.goalDataList || [];
            for (var i = 0; i < goals.length; i++) {
                var g = goals[i];
                if (!g) continue;
                add(g.mapId); add(g.mapid); add(g.map);
            }
        } catch (e) {}
        return Object.keys(seen).map(function (k) { return Number(k); });
    }

    /** true=已在任务图；false=不在；null=配置无地图信息 */
    function isOnTaskMap(task, rt) {
        if (!task || !rt) return null;
        var targets = taskTargetMapIds(task);
        if (!targets.length) return null;
        var cur = Number(rt.mapId) || 0;
        for (var i = 0; i < targets.length; i++) {
            if (targets[i] === cur) return true;
        }
        return false;
    }

    /** 寻路结束（autoFight 2→非2）视为已进图 */
    function trackTaskGoArrived(st, aft) {
        if (!st) return;
        if (st._lastAft === 2 && aft !== 2) st.taskGoArrived = true;
        st._lastAft = aft;
    }

    function resetTaskGoState(st) {
        if (!st) return;
        st.taskGoArrived = false;
        st._lastAft = 0;
    }

    /** 尚未进图且未在寻路中 → 需要 gotask 进图 */
    function needsTaskGo(st, task, rt, aft) {
        if (isOnTaskMap(task, rt) === true || st.taskGoArrived) return false;
        if (aft === 2) return false;
        return true;
    }

    function taskModel() {
        try {
            if (global.net && net.TaskModel && net.TaskModel.ins) return net.TaskModel.ins();
        } catch (e) {}
        return null;
    }

    /** 请求某类日常任务数据：TaskModel.send6(type) */
    function requestTaskType(type) {
        var m = taskModel();
        if (!m || typeof m.send6 !== 'function') return false;
        try { m.send6(type); return true; } catch (e) { return false; }
    }

    /** 开启自动寻路并 gotask（对齐 ChuMoNewTaskView / BossTaskItem） */
    function nudgeTaskGo(st, task, reason, logLevel) {
        if (!task) return false;
        try {
            if (gd.task) {
                gd.task.stopAutoTask = false;
                gd.task.isAutoGoTask = true;
            }
        } catch (e0) {}
        try {
            if (gd.task && typeof gd.task.gotask === 'function') gd.task.gotask(task);
            else if (gd.task && typeof gd.task.sendNotif === 'function') gd.task.sendNotif(608, task);
        } catch (e1) {
            taskLog(st, '寻路失败：' + e1.message, 'warn');
            return false;
        }
        st.lastNudgeAt = Date.now();
        st.nudgeCount = (st.nudgeCount || 0) + 1;
        if (reason) taskLog(st, reason + ' ·#' + task.id + ' s=' + task.state, logLevel || 'verbose');
        return true;
    }

    /** state=2 已接但长期无杀怪进度：刷新数据 + 重发接取 + gotask */
    function recoverAcceptedTask(st, task, tag, now, opts) {
        opts = opts || {};
        if (!task) return false;
        var cooldown = opts.cooldownMs != null ? opts.cooldownMs : 20000;
        if (st.lastGoRecoverAt && now - st.lastGoRecoverAt < cooldown) return false;
        st.lastGoRecoverAt = now;
        st.goRecoverCount = (st.goRecoverCount || 0) + 1;
        var maxRecover = opts.maxRecover != null ? opts.maxRecover : 8;
        if (st.goRecoverCount > maxRecover) return false;
        taskLog(st, tag + '已接无进度，恢复 #' + task.id + ' ·第' + st.goRecoverCount + '次', 'warn');
        requestTaskType(2);
        var m = taskModel();
        if (m && task.id) {
            try { m.send8(task.id); } catch (e0) {}
        }
        resetTaskGoState(st);
        var rt = getRuntime();
        if (isOnTaskMap(task, rt) === true) {
            ensureAutoFightOn();
            taskLog(st, tag + '已在任务图，恢复挂机', 'info');
        } else {
            nudgeTaskGo(st, task, tag + '恢复进图', 'info');
        }
        st.lastProgressAt = now - (opts.extendIdleMs != null ? opts.extendIdleMs : 30000);
        return true;
    }

    /** Finish→send2(id,1) 交；NotAccepted→send8(id) 接 */
    function tryAcceptOrClaim(st, task, tag) {
        if (!task) return false;
        var m = taskModel();
        if (!m) return false;
        tag = tag || '任务';
        try {
            var state = Number(task.state);
            if (state === 3) {
                try { if (gd.task && gd.task.sendNotif) gd.task.sendNotif(205, task); } catch (e0) {}
                m.send2(task.id, 1);
                st.claimAttempts = (st.claimAttempts || 0) + 1;
                taskLog(st, tag + '交任务 send2(' + task.id + ',1)');
                return true;
            }
            if (state === 1) {
                m.send8(task.id);
                st.acceptAttempts = (st.acceptAttempts || 0) + 1;
                taskLog(st, tag + '接任务 send8(' + task.id + ')');
                return true;
            }
        } catch (e) {
            taskLog(st, tag + '交/接失败：' + e.message, 'warn');
        }
        return false;
    }

    function taskLabel(task) {
        if (!task) return '?';
        try {
            if (global.cm && cm.task && cm.task[task.id] && cm.task[task.id].name) {
                return cm.task[task.id].name;
            }
        } catch (e) {}
        return '#' + task.id;
    }

    /**
     * 【经验】经验任务 = 除魔日常（ChuMo，TaskType=2）
     * 游戏：ChuMoNewTaskView — 接取 send8 / 前往 gotask / 领取 send2
     * 已接(Accepted)则直接 gotask 续做；次数用尽且已提交才结束。
     * 无除魔时再回退主线（勿因 currentMainTask 空而秒跳过）。
     */
    function getChuMoTask() {
        try {
            if (!gd.task) return null;
            if (gd.task.ChuMoTask && gd.task.ChuMoTask.id) return gd.task.ChuMoTask;
            if (gd.task.dailyTaskDic && gd.task.dailyTaskDic[2] && gd.task.dailyTaskDic[2].id) {
                return gd.task.dailyTaskDic[2];
            }
            var ing = gd.task.ingTaskid;
            if (ing && Number(ing.type) === 2 && ing.id) return ing;
            // 扫日常字典：有的服只塞了条目、没写死 [2]
            var dic = gd.task.dailyTaskDic;
            if (dic) {
                for (var k in dic) {
                    if (!dic.hasOwnProperty(k)) continue;
                    var t = dic[k];
                    if (t && Number(t.type) === 2 && t.id) return t;
                }
            }
        } catch (e) {}
        return null;
    }
    function getChuMoTimes() {
        try {
            if (gd.task && gd.task.ChuMotimes != null) return Number(gd.task.ChuMotimes);
        } catch (e) {}
        return -1; // 未知：勿当 0
    }
    function getMainTask() {
        try { return (gd.task && gd.task.currentMainTask) || null; } catch (e) { return null; }
    }

    handlers.exp_task = {
        start: function (p) {
            var st = stateOf(p);
            st.startedAt = Date.now();
            st.lastProgressAt = Date.now();
            st.progressCount = 0;
            st.claimAttempts = 0;
            st.acceptAttempts = 0;
            st.finishSince = 0;
            st.acceptSince = 0;
            st.goRecoverCount = 0;
            st.lastGoRecoverAt = 0;
            resetTaskGoState(st);
            st.nudgeMs = 10000;
            st.goStuckMs = 45000;
            st.idleMs = 180000;
            var mins = (p.cfg && p.cfg.minutes != null) ? Number(p.cfg.minutes) : 30;
            if (!(mins > 0)) mins = 30;
            st.maxMs = mins * 60 * 1000;
            st.mode = 'chumo';
            st.dataReady = false;

            // 始终拉一次除魔数据（刷新次数/状态）；已有任务则马上续做
            requestTaskType(2);
            st.lastReqAt = Date.now();
            st.waitingDataAt = Date.now();

            var task = getChuMoTask();
            if (task) {
                st.dataReady = true;
                st.lastSig = taskProgressSig(task);
                st.lastTaskId = task.id;
                taskLog(st, '经验任务开始：除魔 ' + taskLabel(task) + ' s=' + task.state +
                    (getChuMoTimes() >= 0 ? (' 剩' + getChuMoTimes() + '次') : ''));
                if (Number(task.state) === 2) {
                    var rt0 = getRuntime();
                    if (isOnTaskMap(task, rt0) === true) {
                        st.taskGoArrived = true;
                        ensureAutoFightOn();
                        taskLog(st, '除魔继续（已在任务图）', 'info');
                    } else {
                        nudgeTaskGo(st, task, '除魔进图', 'info');
                    }
                } else if (Number(task.state) === 1 || Number(task.state) === 3) {
                    tryAcceptOrClaim(st, task, '除魔');
                }
            } else {
                taskLog(st, '经验任务：请求除魔数据 send6(2)…');
            }

            return ok({
                done: false,
                waitMs: 2500,
                statusText: task ? ('除魔中 ·' + taskLabel(task)) : '经验任务拉数据中',
                state: st
            });
        },
        poll: function (p) {
            var st = stateOf(p);
            var now = Date.now();
            var task = getChuMoTask();

            // 等除魔数据：优先除魔，勿因「无主线」立刻结束；超时后再试主线
            if (st.mode === 'chumo' && !task) {
                if (!st.waitingDataAt) st.waitingDataAt = now;
                if (now - (st.lastReqAt || 0) > 2500) {
                    requestTaskType(2);
                    st.lastReqAt = now;
                }
                if (now - st.waitingDataAt < 12000) {
                    return ok({ done: false, waitMs: 2000, statusText: '经验任务拉除魔数据', state: st });
                }
                if (getMainTask()) {
                    st.mode = 'main';
                    taskLog(st, '经验任务：除魔无数据，改跑主线');
                    task = getMainTask();
                } else {
                    return skip('无除魔任务可做', st);
                }
            }

            if (st.mode === 'main') task = getMainTask();
            if (!task) {
                var doneReason = '经验任务已结束' + (st.progressCount ? (' ·推进' + st.progressCount + '次') : '');
                taskLog(st, doneReason);
                return ok({ done: true, reason: doneReason, state: st });
            }

            // 除魔：今日次数用尽且已提交
            if (st.mode === 'chumo' && getChuMoTimes() === 0 && Number(task.state) === 4) {
                taskLog(st, '除魔今日次数已用完');
                return ok({ done: true, reason: '除魔今日次数已用完', state: st });
            }

            var sig = taskProgressSig(task);
            if (sig !== st.lastSig) {
                if (st.lastTaskId && task.id !== st.lastTaskId) {
                    st.progressCount++;
                    taskLog(st, '经验任务换环：' + taskLabel({ id: st.lastTaskId }) + ' → ' + taskLabel(task));
                }
                st.lastSig = sig;
                st.lastTaskId = task.id;
                st.lastProgressAt = now;
                st.finishSince = 0;
                st.acceptSince = 0;
                st.acceptAttempts = 0;
                st.claimAttempts = 0;
                st.goRecoverCount = 0;
                st.lastGoRecoverAt = 0;
                resetTaskGoState(st);
                st.idleNudged = false;
            }

            var state = Number(task.state);
            var tag = st.mode === 'chumo' ? '除魔' : '主线';
            var times = getChuMoTimes();

            if (state === 3) {
                if (!st.finishSince) st.finishSince = now;
                ensureAutoFightOn();
                if (now - (st.lastNudgeAt || 0) > 5000) nudgeTaskGo(st, task, tag + '交任务寻路');
                if (now - st.finishSince > 8000 && (st.claimAttempts || 0) < 6) {
                    tryAcceptOrClaim(st, task, tag);
                    st.finishSince = now;
                }
                return ok({ done: false, waitMs: 4000, statusText: tag + '交任务 ·' + taskLabel(task), state: st });
            }

            if (state === 1) {
                // 次数已尽则不再接
                if (st.mode === 'chumo' && times === 0) {
                    return ok({ done: true, reason: '除魔今日次数已用完', state: st });
                }
                if ((st.acceptAttempts || 0) < 1 || now - (st.acceptSince || 0) > 6000) {
                    tryAcceptOrClaim(st, task, tag);
                    st.acceptSince = now;
                }
                return ok({ done: false, waitMs: 3000, statusText: tag + '接任务 ·' + taskLabel(task), state: st });
            }

            if (state === 2) {
                try { if (gd.task) gd.task.isAutoGoTask = true; } catch (e2) {}
                var rt = getRuntime();
                var aft = taskAutoFightType();
                trackTaskGoArrived(st, aft);
                if (needsTaskGo(st, task, rt, aft)) {
                    if (now - (st.lastNudgeAt || 0) > (st.nudgeMs || 10000)) {
                        nudgeTaskGo(st, task, tag + '进图', 'info');
                    }
                } else {
                    ensureAutoFightOn();
                }
                if (now - (st.lastProgressAt || now) > (st.goStuckMs || 45000)) {
                    recoverAcceptedTask(st, task, tag, now);
                }
            }

            if (state === 4 && st.mode === 'chumo') {
                if (times > 0) {
                    if (now - (st.lastReqAt || 0) > 3000) {
                        requestTaskType(2);
                        st.lastReqAt = now;
                        taskLog(st, '除魔已交，拉取下一条 ·剩' + times);
                    }
                    return ok({ done: false, waitMs: 3000, statusText: '除魔下一条', state: st });
                }
                if (times === 0) {
                    return ok({ done: true, reason: '除魔完成', state: st });
                }
                // times 未知：再拉一次
                if (now - (st.lastReqAt || 0) > 3000) {
                    requestTaskType(2);
                    st.lastReqAt = now;
                }
                return ok({ done: false, waitMs: 3000, statusText: '除魔确认次数', state: st });
            }

            if (now - (st.startedAt || now) > (st.maxMs || 1800000)) {
                return ok({ done: true, reason: '经验任务到达时限 ·推进' + (st.progressCount || 0) + '次', state: st });
            }
            if (now - (st.lastProgressAt || st.startedAt || now) > (st.idleMs || 180000)) {
                if (!st.idleNudged) {
                    st.idleNudged = true;
                    if (state === 2) {
                        recoverAcceptedTask(st, task, tag, now, { extendIdleMs: 60000 });
                    } else {
                        nudgeTaskGo(st, task, tag + '停滞催促', 'info');
                        tryAcceptOrClaim(st, task, tag);
                    }
                    st.lastProgressAt = now - (st.idleMs || 180000) + 25000;
                    return ok({ done: false, waitMs: 8000, statusText: tag + '催促中', state: st });
                }
                return ok({ done: true, reason: tag + '无进度 ·' + taskLabel(task), state: st });
            }

            return ok({
                done: false,
                waitMs: 5000,
                statusText: tag + '中 ·' + taskLabel(task) + ' s=' + state +
                    (st.mode === 'chumo' && times >= 0 ? (' 剩' + times) : ''),
                state: st
            });
        }
    };

    /**
     * 【日常】精英挑战 = 随机 Boss 悬赏（TaskType.RandomBoss=3，UI BossTaskPop）
     * BossTaskItem：接 send8 / 领 send2 / 前往 gotask；send6 拉列表；send10 刷新
     * leftAcceptCount 实为 leftCompleteCount：有已接/可交时不可因 0 秒完成。
     */
    function getBossTaskList() {
        try {
            if (gd.task && gd.task.bossTaskList && gd.task.bossTaskList.length) {
                return gd.task.bossTaskList;
            }
            // 兜底：日常字典里的进行中 RandomBoss
            if (gd.task && gd.task.dailyTaskDic && gd.task.dailyTaskDic[3]) {
                return [gd.task.dailyTaskDic[3]];
            }
            var ing = gd.task && gd.task.ingTaskid;
            if (ing && Number(ing.type) === 3) return [ing];
        } catch (e) {}
        return [];
    }
    function getEliteLeftCount() {
        try {
            if (gd.task && gd.task.leftAcceptCount != null) return Number(gd.task.leftAcceptCount);
        } catch (e) {}
        return -1;
    }
    function pickEliteTask(list) {
        var i, t, finish = null, accepted = null, notAcc = null;
        for (i = 0; i < list.length; i++) {
            t = list[i];
            if (!t) continue;
            if (Number(t.state) === 3 && !finish) finish = t;
            else if (Number(t.state) === 2 && !accepted) accepted = t;
            else if (Number(t.state) === 1 && !notAcc) notAcc = t;
        }
        return finish || accepted || notAcc || null;
    }
    function pickEliteActive(list) {
        var i, t;
        for (i = 0; i < list.length; i++) {
            t = list[i];
            if (!t) continue;
            if (Number(t.state) === 2 || Number(t.state) === 3) return t;
        }
        return null;
    }

    handlers.daily_elite = {
        start: function (p) {
            var st = stateOf(p);
            st.startedAt = Date.now();
            st.lastProgressAt = Date.now();
            st.progressCount = 0;
            st.claimAttempts = 0;
            st.acceptAttempts = 0;
            st.finishSince = 0;
            st.acceptSince = 0;
            st.nudgeMs = 10000;
            st.idleMs = 240000;
            st.maxMs = 40 * 60 * 1000;
            st.dataReady = false;

            requestTaskType(3);
            st.lastReqAt = Date.now();

            // 已有列表/已接任务：立刻续做，勿干等假完成
            var list = getBossTaskList();
            var task = pickEliteTask(list);
            if (task) {
                st.dataReady = true;
                st.lastSig = taskProgressSig(task);
                st.lastTaskId = task.id;
                taskLog(st, '精英挑战开始：' + taskLabel(task) + ' s=' + task.state +
                    (getEliteLeftCount() >= 0 ? (' 剩' + getEliteLeftCount() + '次') : ''));
                if (Number(task.state) === 2) {
                    nudgeTaskGo(st, task, '精英挑战继续（已接）');
                    ensureAutoFightOn();
                } else if (Number(task.state) === 1 || Number(task.state) === 3) {
                    tryAcceptOrClaim(st, task, '精英挑战');
                }
            } else {
                taskLog(st, '精英挑战：请求任务列表 send6(3)');
            }

            return ok({
                done: false,
                waitMs: 2500,
                statusText: task ? ('精英挑战 ·' + taskLabel(task)) : '精英挑战拉数据',
                state: st
            });
        },
        poll: function (p) {
            var st = stateOf(p);
            var now = Date.now();
            var list = getBossTaskList();
            var left = getEliteLeftCount();
            var active = pickEliteActive(list);

            if (!list.length) {
                if (now - (st.lastReqAt || 0) > 3000) {
                    requestTaskType(3);
                    st.lastReqAt = now;
                }
                if (now - (st.startedAt || now) > 15000) {
                    return skip('精英挑战无任务数据', st);
                }
                return ok({ done: false, waitMs: 2000, statusText: '精英挑战拉数据中', state: st });
            }
            st.dataReady = true;

            // 次数为 0：仅当没有进行中/可交时才算今日完成
            if (left === 0 && !active) {
                taskLog(st, '精英挑战今日次数已用完');
                return ok({ done: true, reason: '精英挑战今日完成', state: st });
            }

            var task = pickEliteTask(list);
            if (!task) {
                if (left === 0) {
                    return ok({ done: true, reason: '精英挑战今日完成', state: st });
                }
                if ((st.refreshAttempts || 0) < 2) {
                    st.refreshAttempts = (st.refreshAttempts || 0) + 1;
                    try {
                        var m = taskModel();
                        if (m && m.send10) m.send10(1);
                        taskLog(st, '精英挑战刷新列表 send10');
                    } catch (e) {}
                    requestTaskType(3);
                    return ok({ done: false, waitMs: 4000, statusText: '精英挑战刷新', state: st });
                }
                return ok({ done: true, reason: '精英挑战无待做项', state: st });
            }

            var sig = taskProgressSig(task) + '|L' + left;
            if (sig !== st.lastSig) {
                if (st.lastTaskId && task.id !== st.lastTaskId) {
                    st.progressCount++;
                    taskLog(st, '精英挑战换环：#' + st.lastTaskId + ' → ' + taskLabel(task));
                }
                st.lastSig = sig;
                st.lastTaskId = task.id;
                st.lastProgressAt = now;
                st.finishSince = 0;
                st.acceptSince = 0;
                st.idleNudged = false;
            }

            var state = Number(task.state);
            if (state === 3) {
                if (!st.finishSince) st.finishSince = now;
                if ((st.claimAttempts || 0) < 1 || now - st.finishSince > 5000) {
                    tryAcceptOrClaim(st, task, '精英挑战');
                    st.finishSince = now;
                }
                return ok({ done: false, waitMs: 3000, statusText: '精英挑战领奖 ·' + taskLabel(task), state: st });
            }
            if (state === 1) {
                if (left === 0) {
                    return ok({ done: true, reason: '精英挑战今日完成', state: st });
                }
                if ((st.acceptAttempts || 0) < 1 || now - (st.acceptSince || 0) > 6000) {
                    tryAcceptOrClaim(st, task, '精英挑战');
                    st.acceptSince = now;
                }
                return ok({ done: false, waitMs: 3000, statusText: '精英挑战接取 ·' + taskLabel(task), state: st });
            }
            if (state === 2) {
                ensureAutoFightOn();
                try { if (gd.task) gd.task.isAutoGoTask = true; } catch (e2) {}
                if (now - (st.lastNudgeAt || 0) > (st.nudgeMs || 10000)) {
                    nudgeTaskGo(st, task, '精英挑战前往');
                }
            }

            if (now - (st.startedAt || now) > (st.maxMs || 2400000)) {
                return ok({ done: true, reason: '精英挑战超时 ·推进' + (st.progressCount || 0), state: st });
            }
            if (now - (st.lastProgressAt || st.startedAt || now) > (st.idleMs || 240000)) {
                if (!st.idleNudged) {
                    st.idleNudged = true;
                    nudgeTaskGo(st, task, '精英挑战催促');
                    tryAcceptOrClaim(st, task, '精英挑战');
                    st.lastProgressAt = now - (st.idleMs || 240000) + 30000;
                    return ok({ done: false, waitMs: 8000, statusText: '精英挑战催促中', state: st });
                }
                return ok({ done: true, reason: '精英挑战无进度 ·' + taskLabel(task), state: st });
            }

            return ok({
                done: false,
                waitMs: 5000,
                statusText: '精英挑战 ·' + taskLabel(task) + ' s=' + state +
                    (left >= 0 ? (' 剩' + left + '次') : ''),
                state: st
            });
        }
    };

    /**
     * 【活动】勇闯天关（UI 528 TianGuanPop / TianguanModel）
     * 刷新 send2；挑战当前层 send3；结算关 788 后 DuplicateModel.send3 退出；
     * 有挂机时长则 send5(false) 领奖。tianGuanState=true 表示已切剑阁，本项结束。
     * 天关地图 map.cls === 80；勿仅凭残留 cfgId 当成在副本（否则会卡在“战斗中”一直挂机）。
     */
    var TG_MAP_CLS = 80;

    function tianguanModel() {
        try {
            if (global.net && net.TianguanModel && net.TianguanModel.ins) return net.TianguanModel.ins();
        } catch (e) {}
        return null;
    }
    function getTianGuanData() {
        try { return (gd.boss && gd.boss.tianGuanData) || null; } catch (e) { return null; }
    }
    function tgMapCls() {
        try {
            if (gd.map && gd.map.config && gd.map.config.cls != null) return Number(gd.map.config.cls);
        } catch (e) {}
        return 0;
    }
    function tgIdleChestMs(data) {
        try {
            if (!data || data.idleChestTime == null) return 0;
            if (typeof data.idleChestTime.toNumber === 'function') return Number(data.idleChestTime.toNumber()) || 0;
            return Number(data.idleChestTime) || 0;
        } catch (e) { return 0; }
    }
    /** 真正在天关图内（cls=80）；退出流程中不算在打 */
    function tgIsInside(rt, st) {
        if (st && st.exiting) return false;
        if (tgMapCls() === TG_MAP_CLS) return true;
        if (st && st.enteredDup && rt && rt.inDuplicate && tgMapCls() === TG_MAP_CLS) return true;
        return false;
    }
    /** 挂机图上残留 cfgId 时清掉；出天关图后即使 enteredDup 也要清，否则会卡死在「退出中」 */
    function tgClearStaleDup(st) {
        try {
            if (tgMapCls() === TG_MAP_CLS) return false;
            if (!global.gd || !gd.arpgInst || !gd.arpgInst.cfgId) return false;
            taskLog(st, '天关：清理残留 cfgId=' + gd.arpgInst.cfgId + '（当前非天关图 cls=' + tgMapCls() + '）', 'warn');
            gd.arpgInst.cfgId = 0;
            gd.arpgInst.dupstate = 0;
            return true;
        } catch (e) { return false; }
    }
    /** 出本后若还有次数，立刻再挑战下一层 */
    function tgContinueOrWait(st, data, reason) {
        st.exiting = false;
        st.enteredDup = false;
        st.enterSent = false;
        st.enterRetries = 0;
        st.runs = (st.runs || 0) + 1;
        st.lastProgressAt = Date.now();
        tgClearStaleDup(st);
        tgRefresh(st);
        taskLog(st, (reason || '勇闯天关本局结束') + ' ·' + tgFloorLabel(data) + ' 已打' + st.runs + '次');

        if (st.runs >= (st.maxRuns || 20)) {
            return ok({ done: true, reason: '勇闯天关达到次数上限 ·' + st.runs, state: st });
        }

        // 刷新后立即读一次；若次数未同步则等下一 poll
        data = getTianGuanData() || data;
        var left = data ? Number(data.leftCount) : -1;
        if (data && data.tianGuanState) {
            if (!st.claimedIdle) tgClaimIdle(st);
            return ok({ done: true, reason: '勇闯天关已通关 ·挑战' + st.runs + '次', state: st });
        }
        if (left === 0) {
            if (!st.claimedIdle) tgClaimIdle(st);
            return ok({ done: true, reason: '勇闯天关完成 ·挑战' + st.runs + '次', state: st });
        }

        if (left > 0 || left < 0) {
            try { if (global.uim && uim.show) uim.show(528); } catch (e0) {}
            taskLog(st, '勇闯天关续关 ' + tgFloorLabel(data) + ' send3 ·剩' +
                (left >= 0 ? left : '?'));
            if (tgEnter(st)) {
                return ok({
                    done: false,
                    waitMs: 4000,
                    statusText: '勇闯天关续关 ·' + tgFloorLabel(data),
                    state: st
                });
            }
            taskLog(st, '勇闯天关续关进本失败，稍后重试', 'warn');
        }
        return ok({ done: false, waitMs: 2500, statusText: '勇闯天关准备下一层', state: st });
    }
    function tgRefresh(st) {
        var m = tianguanModel();
        if (!m || typeof m.send2 !== 'function') return false;
        try { m.send2(); st.lastRefreshAt = Date.now(); return true; } catch (e) {
            taskLog(st, '天关刷新失败：' + e.message, 'warn');
            return false;
        }
    }
    function tgEnter(st) {
        var m = tianguanModel();
        if (!m || typeof m.send3 !== 'function') return false;
        try {
            // 对齐面板：先刷数据再挑战
            if (typeof m.send2 === 'function') m.send2();
            m.send3();
            st.enterSent = true;
            st.enterSentAt = Date.now();
            st.enteredDup = false;
            st.fightStartedAt = 0;
            return true;
        } catch (e) {
            taskLog(st, '天关进本失败：' + e.message, 'warn');
            return false;
        }
    }
    function tgClaimIdle(st) {
        var data = getTianGuanData();
        if (tgIdleChestMs(data) <= 0) return false;
        var m = tianguanModel();
        if (!m || typeof m.send5 !== 'function') return false;
        try {
            m.send5(false);
            taskLog(st, '天关领取挂机奖励 send5');
            st.claimedIdle = true;
            return true;
        } catch (e) {
            taskLog(st, '天关挂机领奖失败：' + e.message, 'warn');
            return false;
        }
    }
    function tgCloseResultUi() {
        try { if (global.uim && uim.hide) uim.hide(788); } catch (e) {}
        try {
            var v = global.uim && uim.getUI && uim.getUI(788);
            if (v && v.visible && v.closeUI) v.closeUI();
        } catch (e2) {}
    }
    function tgResultUiOpen() {
        try {
            var v = global.uim && uim.getUI && uim.getUI(788);
            if (v && v.visible !== false) return true;
        } catch (e) {}
        return false;
    }
    function tgFloorLabel(data) {
        if (!data) return '?';
        return '第' + (data.group || '?') + '关-' + (data.storey || '?') + '层';
    }
    function tgCanChallenge(data) {
        if (!data) return false;
        if (data.tianGuanState) return false;
        return Number(data.leftCount) > 0;
    }

    handlers.yongchuang_tianguan = {
        start: function (p) {
            var st = stateOf(p);
            st.startedAt = Date.now();
            st.lastProgressAt = Date.now();
            st.runs = 0;
            st.enterSent = false;
            st.enteredDup = false;
            st.exiting = false;
            st.claimedIdle = false;
            st.enterRetries = 0;
            st.maxMs = 40 * 60 * 1000;
            st.maxRuns = 20;
            st.phase = 'init';
            st.lastPollLogAt = 0;
            st.exitStartedAt = 0;

            tgClearStaleDup(st);
            tgRefresh(st);
            tgClaimIdle(st);

            var data = getTianGuanData();
            if (data) {
                st.initLeft = Number(data.leftCount);
                if (!(st.initLeft > 0)) st.initLeft = 0;
                if (st.initLeft > 0) st.maxRuns = st.initLeft + 3;
                taskLog(st, '勇闯天关开始：' + tgFloorLabel(data) +
                    ' 剩' + (data.leftCount != null ? data.leftCount : '?') + '次' +
                    (data.tianGuanState ? '（已切剑阁）' : '') +
                    ' mapCls=' + tgMapCls());
            } else {
                taskLog(st, '勇闯天关：请求数据 send2…');
            }

            // 有次数则立刻 send3，不等下一轮 poll（避免被挂机调度拖住）
            if (tgCanChallenge(data) && !tgIsInside(getRuntime(), st)) {
                try {
                    if (global.uim && uim.show) uim.show(528);
                } catch (e0) {}
                taskLog(st, '勇闯天关挑战 ' + tgFloorLabel(data) + ' send3 ·剩' + data.leftCount);
                if (!tgEnter(st)) {
                    taskLog(st, '勇闯天关首次进本失败，将在 poll 重试', 'warn');
                }
            }

            return ok({
                done: false,
                waitMs: 2000,
                statusText: data ? ('勇闯天关进本 ·' + tgFloorLabel(data)) : '勇闯天关拉数据',
                state: st
            });
        },
        poll: function (p) {
            var st = stateOf(p);
            var now = Date.now();
            var rt = getRuntime();
            var data = getTianGuanData();
            tgClearStaleDup(st);
            rt = getRuntime(); // 清残留后再读

            // 等数据
            if (!data) {
                if (now - (st.lastRefreshAt || 0) > 2500) tgRefresh(st);
                if (now - (st.startedAt || now) > 12000) {
                    return skip('勇闯天关无数据', st);
                }
                return ok({ done: false, waitMs: 2000, statusText: '勇闯天关拉数据中', state: st });
            }

            // 已通关切剑阁
            if (data.tianGuanState) {
                if (!st.claimedIdle) tgClaimIdle(st);
                var doneTg = '勇闯天关已通关' + (st.runs ? (' ·挑战' + st.runs + '次') : '');
                taskLog(st, doneTg);
                return ok({ done: true, reason: doneTg, state: st });
            }

            var left = Number(data.leftCount);
            var inside = tgIsInside(rt, st);

            if (!(left > 0) && !inside && !st.enteredDup && !st.exiting && !st.enterSent) {
                if (!st.claimedIdle) tgClaimIdle(st);
                var doneLeft = st.runs ? ('勇闯天关完成 ·挑战' + st.runs + '次') : '勇闯天关无次数';
                taskLog(st, doneLeft);
                return ok({ done: true, reason: doneLeft, state: st });
            }

            // 退出中：以「已离开天关图 cls!==80」为主信号（不依赖 inDuplicate，残留 cfgId 会卡死）
            if (st.exiting) {
                if (tgMapCls() !== TG_MAP_CLS) {
                    return tgContinueOrWait(st, data, '勇闯天关本局结束');
                }
                if (now - (st.exitAt || 0) > 4000) {
                    exitDuplicate();
                    st.exitAt = now;
                    tgClearStaleDup(st);
                }
                if (now - (st.exitStartedAt || 0) > 12000) {
                    taskLog(st, '勇闯天关退出超时，强制退本', 'warn');
                    exitDuplicate();
                    st.exitAt = now;
                    st.exitStartedAt = now;
                }
                return ok({ done: false, waitMs: 1500, statusText: '勇闯天关退出中', state: st });
            }

            // 真正在天关内：战斗 / 结算
            if (tgMapCls() === TG_MAP_CLS) {
                if (!st.enteredDup) {
                    st.enteredDup = true;
                    st.fightStartedAt = now;
                    taskLog(st, '勇闯天关已进图 ·' + tgFloorLabel(data) +
                        ' map=' + rt.mapId + ' cls=' + tgMapCls());
                }
                st.enterSent = false;
                ensureAutoFightOn();
                if (tgResultUiOpen()) {
                    taskLog(st, '勇闯天关结算，退出副本');
                    tgCloseResultUi();
                    exitDuplicate();
                    st.exiting = true;
                    st.exitAt = now;
                    st.exitStartedAt = now;
                    return ok({ done: false, waitMs: 1500, statusText: '勇闯天关结算退出', state: st });
                }
                var fightAt = st.fightStartedAt || st.enterSentAt || now;
                if (now - fightAt > 8 * 60 * 1000) {
                    taskLog(st, '勇闯天关单局超时，强制退出', 'warn');
                    tgCloseResultUi();
                    exitDuplicate();
                    st.exiting = true;
                    st.exitAt = now;
                    st.exitStartedAt = now;
                }
                return ok({
                    done: false,
                    waitMs: 4000,
                    statusText: '勇闯天关战斗中 ·' + tgFloorLabel(data) +
                        (left >= 0 ? (' 剩' + left) : ''),
                    state: st
                });
            }

            // 曾进本但已出天关图（结算 UI 未拦到、或自动出本）
            if (st.enteredDup) {
                return tgContinueOrWait(st, data, '勇闯天关已出本');
            }

            // 总时限
            if (now - (st.startedAt || now) > (st.maxMs || 2400000)) {
                if (!st.claimedIdle) tgClaimIdle(st);
                return ok({ done: true, reason: '勇闯天关到达时限 ·挑战' + (st.runs || 0) + '次', state: st });
            }

            // 进本
            if (!st.enterSent) {
                if (left <= 0) {
                    if (!st.claimedIdle) tgClaimIdle(st);
                    return ok({ done: true, reason: '勇闯天关无次数', state: st });
                }
                if (now - (st.lastRefreshAt || 0) > 5000) tgRefresh(st);
                taskLog(st, '勇闯天关挑战 ' + tgFloorLabel(data) + ' send3 ·剩' + left +
                    ' cfgId=' + (rt.duplicateId || 0) + ' mapCls=' + tgMapCls());
                if (!tgEnter(st)) {
                    return skip('勇闯天关无法进本', st);
                }
                return ok({
                    done: false,
                    waitMs: 4000,
                    statusText: '勇闯天关进本 ·' + tgFloorLabel(data),
                    state: st
                });
            }

            // 已发进本、尚未进天关图
            if (now - (st.enterSentAt || 0) > 15000) {
                st.enterRetries = (st.enterRetries || 0) + 1;
                if (st.enterRetries >= 3) {
                    return skip('勇闯天关进本失败（已 send3 但未进图）', st);
                }
                taskLog(st, '勇闯天关进本超时，重试 #' + st.enterRetries +
                    ' mapCls=' + tgMapCls() + ' inDup=' + !!rt.inDuplicate, 'warn');
                st.enterSent = false;
                tgRefresh(st);
                return ok({ done: false, waitMs: 3000, statusText: '勇闯天关重试进本', state: st });
            }

            return ok({
                done: false,
                waitMs: 3000,
                statusText: '勇闯天关等待进本 ·' + tgFloorLabel(data),
                state: st
            });
        }
    };

    handlers.personal_boss = {
        start: function (p) {
            var st = stateOf(p);
            var cfg = p.cfg || {};
            if (!st.queue) {
                var opts = getPersonalBossOptions();
                var pick = pickedIds(cfg);
                st.queue = [];
                st.queueMeta = {};
                opts.forEach(function (o) {
                    if (pick.length && pick.indexOf(o.id) < 0 && pick.indexOf(String(o.dupId)) < 0) return;
                    if (!o.unlocked) return;
                    if (!(o.count > 0)) return;
                    st.queue.push(o.dupId);
                    st.queueMeta[o.dupId] = o;
                });
                st.idx = 0;
                st.fought = 0;
                var qLabels = st.queue.map(function (id) {
                    return pbShortLabel(st.queueMeta[id] && st.queueMeta[id].label);
                });
                pbLog(st, '队列 ' + st.queue.length + ' 个：' + qLabels.join('、'));
            }
            if (!st.queue.length) {
                pbLog(st, '无可用次数或均未解锁', 'warn');
                return skip('个人BOSS无可用次数或均未解锁', st);
            }
            if (st.idx >= st.queue.length) {
                return ok({ done: true, reason: st.fought ? '个人BOSS完成' : '个人BOSS均未成功进图', state: st });
            }
            var dupId = st.queue[st.idx];
            var meta = st.queueMeta && st.queueMeta[dupId];
            if (st.enterSent && st.curDup === dupId && Date.now() - (st.enterSentAt || 0) < 60000) {
                var lbl0 = meta ? meta.label : ('#' + dupId);
                taskLog(st, '[个人BOSS] 已在战斗中，跳过重复 start', 'verbose');
                return ok({ done: false, waitMs: 60000, statusText: '个人BOSS ' + lbl0, state: st });
            }
            var dupCfg = null;
            try { dupCfg = cm.duplicate[dupId] || cm.duplicate[String(dupId)]; } catch (e0) {}
            if (dupCfg && dupCfg.condition && !checkCondition(dupCfg.condition)) {
                var why = '未解锁';
                try {
                    if (global.Logic && Logic.getDiscontentCondition) why = Logic.getDiscontentCondition(dupCfg.condition) || why;
                } catch (e1) {}
                st.idx++;
                pbLog(st, '跳过未解锁：' + pbShortLabel(meta && meta.label) + ' · ' + why, 'warn');
                if (st.idx >= st.queue.length) return skip('个人BOSS：' + why, st);
                return ok({ done: false, restart: true, reason: why, state: st });
            }
            try {
                net.DuplicateModel.ins().send44(dupId);
                net.DuplicateModel.ins().send2(dupId);
                st.enterSent = true;
                st.enterSentAt = Date.now();
                st.wasInDup = false;
                st.retries = 0;
                st.curDup = dupId;
                st.bossMapId = dupCfg && dupCfg.mapId ? Number(dupCfg.mapId) : 0;
                st.fightStarted = false;
                st.sawTargetBoss = false;
                st.sawMonsters = false;
                st.clearSince = 0;
                st.exitingDup = false;
                st.lootWaitStarted = false;
            } catch (e) { return fail(e.message, st); }
            var label = meta ? meta.label : (monsterName(dupCfg && dupCfg.monsterId) || ('#' + dupId));
            pbLog(st, '→ ' + pbShortLabel(label) + ' (' + pbOrdinal(st) + ')');
            return ok({ done: false, waitMs: 60000, statusText: '个人BOSS 前往 ' + label, state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            var rt = getRuntime();
            var now = Date.now();
            var meta = st.queueMeta && st.curDup && st.queueMeta[st.curDup];
            var label = meta ? meta.label : ('#' + (st.curDup || '?'));

            if (st.exitingDup) {
                if (hasLeftPersonalBossDup(rt, st)) {
                    finishPersonalBossExit(st, rt);
                    if (st.idx >= st.queue.length) {
                        return ok({ done: true, reason: '个人BOSS完成', state: st });
                    }
                    return ok({ done: false, restart: true, state: st });
                }
                var bossMap = st.bossMapId || getDuplicateMapId(st.curDup);
                if (now - (st.exitAt || 0) > 4000) {
                    if (bossMap && Number(rt.mapId) === bossMap) {
                        pbLog(st, '退出重试 send3 (' + pbSnapBrief(rt, st) + ')', 'warn');
                        retryExitPersonalBoss(st);
                    } else {
                        pbLog(st, '离图超时，强制完成 (' + pbSnapBrief(rt, st) + ')', 'warn');
                        finishPersonalBossExit(st, rt);
                        if (st.idx >= st.queue.length) {
                            return ok({ done: true, reason: '个人BOSS完成', state: st });
                        }
                        return ok({ done: false, restart: true, state: st });
                    }
                }
                return ok({ done: false, statusText: '个人BOSS退出副本 ' + label, state: st });
            }

            if (rt.inDuplicate || (st.wasInDup && (st.bossMapId || getDuplicateMapId(st.curDup)) &&
                Number(rt.mapId) === (st.bossMapId || getDuplicateMapId(st.curDup)))) {
                st.wasInDup = true;
                st.enterSent = false;
                if (!st.fightStarted && (rt.dupState === 1 || getMonsterStats(getDuplicateTargetMonsterId(st.curDup)).alive > 0)) {
                    st.fightStarted = true;
                }
                if (isPersonalBossKillDone(st.curDup, st)) {
                    if (!st.lootWaitStarted) {
                        st.lootWaitStarted = true;
                        st.lootWaitAt = now;
                        ensurePersonalBossLootMode();
                        pbLog(st, '✓ ' + pbShortLabel(label) + ' 已击杀，拾取' + (PERSONAL_BOSS_LOOT_MS / 1000) + 's');
                    }
                    ensurePersonalBossLootMode();
                    var lootLeft = PERSONAL_BOSS_LOOT_MS - (now - st.lootWaitAt);
                    if (lootLeft > 0) {
                        var lootSec = Math.max(1, Math.ceil(lootLeft / 1000));
                        return ok({ done: false, statusText: '个人BOSS拾取 剩' + lootSec + 's ' + label, state: st });
                    }
                    pbLog(st, '← ' + pbShortLabel(label) + ' 拾取结束，回城');
                    exitPersonalBossDuplicate(st);
                    return ok({ done: false, statusText: '个人BOSS已击杀，退出副本', state: st });
                }
                var msFight = getMonsterStats(getDuplicateTargetMonsterId(st.curDup));
                if (msFight.alive > 0) {
                    st.clearSince = 0;
                    st.lootWaitStarted = false;
                }
                try {
                    if (global.gd && gd.arpgInst && gd.arpgInst.setAutoFight && gd.arpgInst.autoFightType !== 1) {
                        gd.arpgInst.setAutoFight(1);
                    }
                } catch (eFight) {}
                return ok({ done: false, statusText: '个人BOSS战斗中 ' + label, state: st });
            }

            if (st.wasInDup && hasLeftPersonalBossDup(rt, st) && !st.exitingDup) {
                pbLog(st, '意外离本 (' + pbSnapBrief(rt, st) + ')', 'warn');
                finishPersonalBossExit(st, rt);
                if (st.idx >= st.queue.length) {
                    return ok({ done: true, reason: '个人BOSS完成', state: st });
                }
                return ok({ done: false, restart: true, state: st });
            }

            if (st.enterSent && !st.wasInDup) {
                var waited = now - (st.enterSentAt || 0);
                if (waited < 12000) {
                    return ok({ done: false, statusText: '个人BOSS进图中 ' + label, state: st });
                }
                if ((st.retries || 0) < 2) {
                    try {
                        net.DuplicateModel.ins().send2(st.curDup);
                        st.retries = (st.retries || 0) + 1;
                        st.enterSentAt = now;
                        pbLog(st, '进图重试 第' + st.retries + '次', 'warn');
                    } catch (e2) {}
                    return ok({ done: false, statusText: '个人BOSS重试进图 ' + label, state: st });
                }
                var skipWhy = '进图失败';
                try {
                    var dc = cm.duplicate[st.curDup];
                    if (dc && dc.condition && global.Logic && Logic.getDiscontentCondition) {
                        skipWhy = Logic.getDiscontentCondition(dc.condition) || skipWhy;
                    }
                } catch (e3) {}
                pbLog(st, '进图失败，跳过：' + skipWhy + ' (' + pbSnapBrief(rt, st) + ')', 'warn');
                st.enterSent = false;
                st.idx++;
                if (st.idx >= st.queue.length) {
                    return st.fought
                        ? ok({ done: true, reason: '个人BOSS完成', state: st })
                        : skip('个人BOSS：' + skipWhy, st);
                }
                return ok({ done: false, restart: true, reason: skipWhy, state: st });
            }

            if (now - (p.startedAt || 0) > 180000) {
                pbLog(st, '总超时，强制退出 (' + pbSnapBrief(rt, st) + ')', 'warn');
                exitDuplicate();
                return ok({ done: true, reason: '个人BOSS超时', state: st });
            }
            return ok({ done: false, statusText: '等待个人BOSS', state: st });
        }
    };

    handlers.yanhuo_tumo = {
        start: function (p) {
            var st = stateOf(p);
            showUi(519, 0);
            return ok({ done: false, waitMs: 40000, statusText: '焰火屠魔', state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            if (getRuntime().inDuplicate) { st.enteredDup = true; return ok({ done: false, statusText: '焰火屠魔副本中', state: st }); }
            if (st.enteredDup || Date.now() - (p.startedAt || 0) > 50000) return ok({ done: true, reason: '焰火屠魔完成', state: st });
            return ok({ done: false, state: st });
        }
    };

    handlers.zuma_mishi = {
        start: function (p) {
            var st = stateOf(p);
            showUi(519, 1);
            return ok({ done: false, waitMs: 40000, statusText: '祖玛密室', state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            if (getRuntime().inDuplicate) { st.enteredDup = true; return ok({ done: false, statusText: '祖玛密室副本中', state: st }); }
            if (st.enteredDup || Date.now() - (p.startedAt || 0) > 50000) return ok({ done: true, reason: '祖玛密室完成', state: st });
            return ok({ done: false, state: st });
        }
    };

    handlers.lingxiao = {
        start: function (p) {
            var st = stateOf(p);
            var left = 0;
            try { left = gd.lxzt && gd.lxzt.lxztInfo ? gd.lxzt.lxztInfo.leftCount : 0; } catch (e) {}
            if (left <= 0) try {
                var tg = gd.boss.tianGuanData;
                if (tg && tg.leftCount > 0) left = tg.leftCount;
            } catch (e2) {}
            if (left <= 0) return skip('凌霄征途无次数');
            showUi(738);
            try {
                if (global.net && net.ExpeditionModel) net.ExpeditionModel.ins().send2(false);
                st.enteredDup = true;
            } catch (e3) {}
            return ok({ done: false, waitMs: 45000, statusText: '凌霄征途', state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            if (getRuntime().inDuplicate) return ok({ done: false, statusText: '凌霄征途中', state: st });
            if (Date.now() - (p.startedAt || 0) > 120000) return ok({ done: true, reason: '凌霄征途完成', state: st });
            return ok({ done: false, state: st });
        }
    };

    function arpgBossHandler(prefix, mapTypes) {
        return {
            start: function (p) {
                var st = stateOf(p);
                var cfg = p.cfg || {};
                if (!st.queue) {
                    var opts = getArpgMapOptions(prefix, mapTypes);
                    var pick = pickedIds(cfg);
                    st.queue = [];
                    opts.forEach(function (o) {
                        if (pick.length && pick.indexOf(o.id) < 0) return;
                        if (o.count > 0) st.queue.push(o.mapType);
                    });
                    st.idx = 0;
                }
                if (!st.queue.length) return skip('无剩余次数');
                if (st.idx >= st.queue.length) return ok({ done: true, reason: '已完成', state: st });
                var mt = st.queue[st.idx];
                try { net.PlayModel.ins().send9(mt); st.enteredDup = true; st.curMapType = mt; }
                catch (e) { return fail(e.message); }
                return ok({ done: false, waitMs: 60000, statusText: 'BOSS地图', state: st });
            },
            poll: function (p) {
                var st = stateOf(p);
                var rt = getRuntime();
                if (rt.inDuplicate || rt.mapId) {
                    if (Date.now() - (p.startedAt || 0) > 45000 && !rt.inDuplicate) {
                        st.idx++;
                        if (st.idx >= st.queue.length) return ok({ done: true, reason: 'BOSS完成', state: st });
                        return ok({ done: false, restart: true, state: st });
                    }
                }
                if (Date.now() - (p.startedAt || 0) > 180000) return ok({ done: true, reason: 'BOSS超时', state: st });
                return ok({ done: false, statusText: 'BOSS进行中', state: st });
            }
        };
    }

    handlers.bone_boss = arpgBossHandler('bone', [6, 7, 8]);
    handlers.trial_boss = arpgBossHandler('trial', [1, 2, 3]);

    handlers.dig_treasure = {
        start: function (p) {
            var cfg = p.cfg || {};
            var st = stateOf(p);
            var target = cfg.dailyCount != null ? cfg.dailyCount : 0;
            if (target <= 0) return skip('每日次数为0');
            st.target = target;
            st.doneCount = st.doneCount || 0;
            var left = 0;
            try { left = gd.cangbaotu.cbtLeftCount || 0; } catch (e) {}
            if (left <= 0) return skip('藏宝图次数已用完');
            st.lastLeft = left;
            try {
                if (gd.bag && gd.bag.useCangBaoTu) gd.bag.useCangBaoTu();
                else if (global.net && net.MapModel) net.MapModel.ins().send41(1, 0);
            } catch (e2) {}
            return ok({ done: false, waitMs: 20000, statusText: '挖宝 ' + st.doneCount + '/' + st.target, state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            var left = 0;
            try { left = gd.cangbaotu.cbtLeftCount || 0; } catch (e) {}
            if (st.lastLeft != null && left < st.lastLeft) {
                st.doneCount = (st.doneCount || 0) + 1;
                st.lastLeft = left;
            }
            if (st.doneCount >= st.target) return ok({ done: true, reason: '挖宝完成', state: st });
            if (left <= 0) return ok({ done: true, reason: '藏宝图次数耗尽', state: st });
            if (Date.now() - (p.startedAt || 0) > 180000) return ok({ done: true, reason: '挖宝超时', state: st });
            if (!getRuntime().inDuplicate && st.doneCount < st.target && Date.now() - (p.startedAt || 0) > 15000) {
                return ok({ done: false, restart: true, state: st });
            }
            return ok({ done: false, statusText: '挖宝中', state: st });
        }
    };

    handlers.material_dungeon = {
        start: function (p) {
            var st = stateOf(p);
            var cfg = p.cfg || {};
            if (!st.queue) {
                var opts = getMaterialDungeonOptions();
                st.queue = [];
                opts.forEach(function (o) {
                    if (o.count > 0 && o.dupId) {
                        st.queue.push({
                            dupId: o.dupId,
                            mapId: o.mapId,
                            count: o.count,
                            label: o.label || ('#' + o.dupId)
                        });
                    }
                });
                st.idx = 0;
            }
            st.mode = cfg.mode || (cfg.picked && cfg.picked[0]) || 'if_ticket';
            if (!st.queue.length) return skip('材料副本无次数', st);
            if (st.idx >= st.queue.length) return ok({ done: true, reason: '材料副本完成', state: st });

            var cur = st.queue[st.idx];
            st.wantDouble = resolveWantDouble(st.mode, cur.dupId);
            st.curDup = cur.dupId;
            st.bossMapId = cur.mapId || getDuplicateMapId(cur.dupId);
            st.enteredDup = false;
            st.claimSent = false;
            st.claimed = false;
            st.fightStartedAt = 0;
            st.exitingDup = false;
            st.exitAt = 0;
            try {
                // 进本固定 send49(dupId,1)；双倍/单倍领取在结算 UI730 用 send54
                net.DuplicateModel.ins().send49(cur.dupId, 1);
                st.enterSent = true;
                st.enterSentAt = Date.now();
                taskLog(st, '材料副本进本 ' + (cur.label || cur.dupId) +
                    ' send49 ·策略=' + st.mode +
                    (st.wantDouble ? ' ·将双倍领' : ' ·将单倍领'));
            } catch (e) { return fail(e.message, st); }
            return ok({ done: false, waitMs: 6000, statusText: '材料副本进本', state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            var rt = getRuntime();
            var now = Date.now();
            var cur = st.queue && st.queue[st.idx];
            var mode = st.mode || 'if_ticket';
            var wantDouble = cur ? resolveWantDouble(mode, cur.dupId) : !!st.wantDouble;
            st.wantDouble = wantDouble;

            // 结算弹窗：按策略双倍/单倍领取（FightResultShiLianPop → send54）
            if (shilianResultOpen()) {
                if (!st.claimSent || (now - (st.claimAt || 0) > 5000)) {
                    claimShilianReward(st, wantDouble);
                    st.claimSent = true;
                    st.claimed = true;
                    st.claimAt = now;
                }
                return ok({ done: false, waitMs: 1500, statusText: '材料副本领取中', state: st });
            }

            // UI789 结算（71050）；对齐 FightResultPop.onTouch → send3
            if (fightResultPopOpen()) {
                if (!st.exitingDup) exitShilianDuplicate(st, '材料副本结算窗789');
                return ok({ done: false, waitMs: 1500, statusText: '材料副本结算退出', state: st });
            }

            // 领取后退出副本（send54 不会自动出本）
            if (st.exitingDup) {
                if (hasLeftShilianDup(rt, st)) {
                    finishShilianRound(st, wantDouble, '材料副本');
                    if (st.idx >= st.queue.length) {
                        return ok({ done: true, reason: '材料副本完成', state: st });
                    }
                    return ok({ done: false, restart: true, waitMs: 2000, state: st });
                }
                if (now - (st.exitAt || 0) > 4000) {
                    taskLog(st, '材料副本退出重试 send3', 'warn');
                    exitShilianDuplicate(st, '材料副本退出重试');
                }
                return ok({ done: false, waitMs: 1500, statusText: '材料副本退出中', state: st });
            }

            if (isInsideShilianDup(rt, st)) {
                if (!st.enteredDup) {
                    st.enteredDup = true;
                    st.fightStartedAt = now;
                    taskLog(st, '材料副本已进图 ·' + (cur && cur.label ? cur.label : st.curDup) +
                        ' map=' + rt.mapId);
                }
                // 已领取但仍在本内：停挂机并 send3 出本
                if (st.claimSent && now - (st.claimAt || 0) > 2500) {
                    exitShilianDuplicate(st, '材料副本已领取');
                    return ok({ done: false, waitMs: 1500, statusText: '材料副本领取后退出', state: st });
                }
                ensureAutoFightOn();
                // 兜底：进本较久仍检测不到 UI730 时，直接按策略 send54
                if (!st.claimSent && st.fightStartedAt && now - st.fightStartedAt > 90000) {
                    taskLog(st, '材料副本未见结算窗，兜底领取 send54', 'warn');
                    claimShilianReward(st, wantDouble);
                    st.claimSent = true;
                    st.claimed = true;
                    st.claimAt = now;
                    return ok({ done: false, waitMs: 2000, statusText: '材料副本兜底领取', state: st });
                }
                return ok({ done: false, waitMs: 3000, statusText: '材料副本战斗中', state: st });
            }

            // 已出本：完成本局，继续下一个
            if (st.enteredDup || st.claimed) {
                finishShilianRound(st, wantDouble, '材料副本');
                if (st.idx >= st.queue.length) {
                    return ok({ done: true, reason: '材料副本完成', state: st });
                }
                return ok({ done: false, restart: true, waitMs: 2000, state: st });
            }

            if (st.enterSent && now - (st.enterSentAt || 0) > 25000) {
                taskLog(st, '材料副本进本超时，跳过当前', 'warn');
                st.enterSent = false;
                st.idx = (st.idx || 0) + 1;
                if (st.idx >= st.queue.length) {
                    return ok({ done: true, reason: '材料副本完成', state: st });
                }
                return ok({ done: false, restart: true, state: st });
            }

            if (now - (p.startedAt || 0) > 180000) {
                return ok({ done: true, reason: '材料副本超时', state: st });
            }
            return ok({ done: false, waitMs: 3000, statusText: '材料副本等待进本', state: st });
        }
    };

    handlers.spirit_dungeon = {
        start: function (p) {
            var st = stateOf(p);
            var cfg = p.cfg || {};
            var num = 0;
            try { num = gd.boss.tanwandupNum || 0; } catch (e) {}
            if (num <= 0) return skip('灵气副本无次数', st);
            st.mode = cfg.mode || (cfg.picked && cfg.picked[0]) || 'if_ticket';
            st.wantDouble = resolveWantDouble(st.mode, 70001);
            st.curDup = 70001;
            st.bossMapId = getDuplicateMapId(70001);
            st.enteredDup = false;
            st.claimSent = false;
            st.claimed = false;
            st.fightStartedAt = 0;
            st.exitingDup = false;
            st.exitAt = 0;
            try {
                // 进本 send2；领取同样走 UI730 send54
                net.DuplicateModel.ins().send2(70001);
                st.enterSent = true;
                st.enterSentAt = Date.now();
                taskLog(st, '灵气副本进本 send2 ·策略=' + st.mode +
                    (st.wantDouble ? ' ·将双倍领' : ' ·将单倍领'));
            } catch (e2) { return fail(e2.message, st); }
            return ok({ done: false, waitMs: 6000, statusText: '灵气副本进本', state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            var rt = getRuntime();
            var now = Date.now();
            var wantDouble = resolveWantDouble(st.mode || 'if_ticket', 70001);
            st.wantDouble = wantDouble;

            if (shilianResultOpen()) {
                if (!st.claimSent || (now - (st.claimAt || 0) > 5000)) {
                    claimShilianReward(st, wantDouble);
                    st.claimSent = true;
                    st.claimed = true;
                    st.claimAt = now;
                }
                return ok({ done: false, waitMs: 1500, statusText: '灵气副本领取中', state: st });
            }

            if (fightResultPopOpen()) {
                if (!st.exitingDup) exitShilianDuplicate(st, '灵气副本结算窗789');
                return ok({ done: false, waitMs: 1500, statusText: '灵气副本结算退出', state: st });
            }

            if (st.exitingDup) {
                if (hasLeftShilianDup(rt, st)) {
                    taskLog(st, '灵气副本完成' + (wantDouble ? ' ·双倍领' : ' ·单倍领') +
                        (st.claimSent ? '' : '（未见到结算窗）'));
                    return ok({ done: true, reason: '灵气副本完成', state: st });
                }
                if (now - (st.exitAt || 0) > 4000) {
                    taskLog(st, '灵气副本退出重试 send3', 'warn');
                    exitShilianDuplicate(st, '灵气副本退出重试');
                }
                return ok({ done: false, waitMs: 1500, statusText: '灵气副本退出中', state: st });
            }

            if (isInsideShilianDup(rt, st)) {
                if (!st.enteredDup) {
                    st.enteredDup = true;
                    st.fightStartedAt = now;
                }
                if (st.claimSent && now - (st.claimAt || 0) > 2500) {
                    exitShilianDuplicate(st, '灵气副本已领取');
                    return ok({ done: false, waitMs: 1500, statusText: '灵气副本领取后退出', state: st });
                }
                ensureAutoFightOn();
                if (!st.claimSent && st.fightStartedAt && now - st.fightStartedAt > 90000) {
                    taskLog(st, '灵气副本未见结算窗，兜底领取 send54', 'warn');
                    claimShilianReward(st, wantDouble);
                    st.claimSent = true;
                    st.claimed = true;
                    st.claimAt = now;
                }
                return ok({ done: false, waitMs: 3000, statusText: '灵气副本战斗中', state: st });
            }

            if (st.enteredDup || st.claimed || (st.enterSent && now - (st.enterSentAt || 0) > 90000)) {
                taskLog(st, '灵气副本完成' + (wantDouble ? ' ·双倍领' : ' ·单倍领') +
                    (st.claimSent ? '' : '（未见到结算窗）'));
                return ok({ done: true, reason: '灵气副本完成', state: st });
            }

            if (now - (p.startedAt || 0) > 120000) {
                return ok({ done: true, reason: '灵气副本超时', state: st });
            }
            return ok({ done: false, waitMs: 3000, statusText: '灵气副本等待进本', state: st });
        }
    };

    function dispatch(handler, payload, phase) {
        var h = handlers[handler];
        if (!h) return fail('未知任务: ' + handler);
        try {
            var result;
            if (phase === 'poll' && h.poll) result = h.poll(payload);
            else if (h.start) result = h.start(payload);
            else result = fail('handler 无 start');
            return finalizeTaskResult(result);
        } catch (err) {
            return fail(err.message);
        }
    }

    function canRunTask(payload) {
        var h = handlers[payload.handler];
        if (!h) return fail('未知任务');
        if (h.canRun) {
            try {
                var r = h.canRun(payload);
                if (r === false) return ok({ canRun: false, reason: '不可执行' });
            } catch (e) {}
        }
        return ok({ canRun: true });
    }

    function runTask(payload) {
        payload = payload || {};
        return dispatch(payload.handler, payload, 'start');
    }

    function getTaskStatus(payload) {
        payload = payload || {};
        return dispatch(payload.handler, payload, 'poll');
    }

    function registerHandlers(map) {
        if (!map) return;
        for (var k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) handlers[k] = map[k];
        }
    }

    global.TaskHandlers = {
        getRuntime: getRuntime,
        getTaskCatalog: getTaskCatalog,
        canRunTask: canRunTask,
        runTask: runTask,
        getTaskStatus: getTaskStatus,
        tryClaimMemberSalaryOnce: tryClaimMemberSalaryOnce,
        exitDuplicate: exitDuplicate,
        handlers: handlers,
        registerHandlers: registerHandlers,
        helpers: {
            ok: ok,
            fail: fail,
            skip: skip,
            stateOf: stateOf,
            getRuntime: getRuntime,
            taskLog: taskLog,
            showUi: showUi,
            getBossTiaoZhanOptions: getBossTiaoZhanOptions,
            pickedIds: pickedIds
        }
    };
})(typeof window !== 'undefined' ? window : this);
