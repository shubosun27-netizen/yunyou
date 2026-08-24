/**
 * 卧龙山庄任务执行器（game.html iframe 内加载）
 * 依赖：先加载 task-handlers.js（TaskHandlers.helpers / registerHandlers）
 * 配置：wolong_schedule / wolong_relic / wolong_leader / wolong_invader /
 *       wolong_demon / wolong_island_leader / wolong_island_demon
 */
(function (global) {
    'use strict';

    var TH = global.TaskHandlers;
    if (!TH || !TH.helpers || !TH.registerHandlers) {
        console.warn('[task-handlers-wolong] TaskHandlers 未就绪，跳过注册');
        return;
    }

    var ok = TH.helpers.ok;
    var fail = TH.helpers.fail;
    var skip = TH.helpers.skip;
    var stateOf = TH.helpers.stateOf;
    var getRuntime = TH.helpers.getRuntime;
    var taskLog = TH.helpers.taskLog;
    var showUi = TH.helpers.showUi;
    var getBossTiaoZhanOptions = TH.helpers.getBossTiaoZhanOptions;
    var pickedIds = TH.helpers.pickedIds;

    var handlers = {};

    /* ---------- 公共 ---------- */
    var MAP_ID = 5279;
    var DELIVER_ID = 15279;
    /** typeNumData[401]: 0魔神 / 1首领 / 2高级天书 / 3低级圣物 */
    var TYPE_NUM_KEY = 401;

    function refreshTypeNum() {
        try {
            if (global.net && net.XuanshangModel && net.XuanshangModel.ins) {
                net.XuanshangModel.ins().send3(TYPE_NUM_KEY);
            }
        } catch (e) {}
    }

    function typeAlive(index) {
        try {
            var list = gd.xuanShang && gd.xuanShang.typeNumData && gd.xuanShang.typeNumData[TYPE_NUM_KEY];
            if (!list || !list[index]) return -1;
            return Number(list[index].count) || 0;
        } catch (e) { return -1; }
    }

    function gotoXY(x, y) {
        try {
            if (gd.map && gd.map.gotoStagePoint) {
                gd.map.gotoStagePoint(x, y, MAP_ID, false, false);
                return true;
            }
        } catch (e) {}
        return false;
    }

    function playerXY() {
        try {
            var p = global.emIns && emIns.firstPlayer;
            if (!p) return null;
            var fo = p.fighterObject || {};
            return {
                x: Number(p.x != null ? p.x : fo.gridX) || 0,
                y: Number(p.y != null ? p.y : fo.gridY) || 0
            };
        } catch (e) { return null; }
    }

    function dist(a, b) {
        if (!a || !b) return 9999;
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    function enterMap(st) {
        var okEnter = false;
        try {
            // deliverToFindNpc 失败时返回 false，不一定抛异常
            okEnter = Logic.deliverToFindNpc(DELIVER_ID) !== false;
        } catch (e) {
            okEnter = false;
            try { taskLog(st, '[卧龙] deliver异常: ' + (e && e.message), 'warn'); } catch (e0) {}
        }
        if (!okEnter) {
            try {
                if (global.net && net.DeliverModel && net.DeliverModel.ins) {
                    net.DeliverModel.ins().send1(DELIVER_ID);
                    okEnter = true;
                }
            } catch (e1) {}
        }
        if (!okEnter) {
            try { if (Logic.checkLinkOpen2) Logic.checkLinkOpen2('1#583'); } catch (e2) {}
            showUi(583);
        }
        st.enterAt = Date.now();
        return okEnter;
    }

    function findMonsters(idMap) {
        var list = [];
        try {
            if (!global.emIns || !emIns._monsterDic) return list;
            for (var k in emIns._monsterDic) {
                var m = emIns._monsterDic[k];
                if (!m) continue;
                var fo = m.fighterObject || {};
                var mo = m.monsterObject || {};
                var cfg = mo.config || fo.config || {};
                var mid = Number(cfg.id);
                if (!idMap[mid]) continue;
                if (fo.isDead || (fo.hp != null && fo.hp <= 0)) continue;
                list.push({
                    uid: m.uid || k,
                    id: mid,
                    name: (cfg && cfg.name) || '',
                    x: Number(m.x != null ? m.x : fo.gridX) || 0,
                    y: Number(m.y != null ? m.y : fo.gridY) || 0
                });
            }
        } catch (e) {}
        var me = playerXY();
        if (me) list.sort(function (a, b) { return dist(me, a) - dist(me, b); });
        return list;
    }

    function setAutoFight(on) {
        try {
            if (!gd.arpgInst || !gd.arpgInst.setAutoFight) return;
            var want = on ? 1 : 3;
            if (gd.arpgInst.autoFightType !== want) gd.arpgInst.setAutoFight(want);
        } catch (e) {}
    }

    function tryAttack(mon) {
        if (!mon) return false;
        try {
            if (emIns && emIns.selectEntity) emIns.selectEntity(mon.uid);
            var player = emIns && emIns.firstPlayer;
            if (player && player._entityAI && player._entityAI.attack) {
                var me = playerXY();
                var near = me && dist(me, mon) <= 3;
                player._entityAI.attack(mon.uid, !!near, true);
            }
            setAutoFight(true);
            return true;
        } catch (e) {}
        return false;
    }

    function pulseLog(st, key, msg, level) {
        var now = Date.now();
        if (!st._pulse) st._pulse = {};
        if (st._pulse[key] && now - st._pulse[key] < 3000) return;
        st._pulse[key] = now;
        taskLog(st, msg, level || 'info');
    }

    /* ---------- 时段 ---------- */
    handlers.wolong_schedule = {
        start: function (p) {
            var cfg = p.cfg || {};
            var hour = cfg.hour != null ? cfg.hour : 1;
            if (new Date().getHours() < hour) return skip('未到' + hour + '点');
            return ok({ done: true, reason: '卧龙时段已满足', state: stateOf(p) });
        },
        poll: function (p) { return ok({ done: true, state: stateOf(p) }); }
    };

    /* ---------- 山庄圣物：仅高级天书 ---------- */
    var RELIC_TYPE = 401;
    var ADV_BOOK_ID = 6000839;
    var ADV_BOOK_IDS = { 6000839: 1, 6000841: 1, 6000842: 1, 6000843: 1, 6000840: 1 };
    var ADV_BOOK_POINTS = [
        { x: 63, y: 185, id: 6000839, name: '[土]山庄高级天书' },
        { x: 89, y: 141, id: 6000841, name: '[金]山庄高级天书' },
        { x: 147, y: 90, id: 6000842, name: '[木]山庄高级天书' },
        { x: 219, y: 59, id: 6000843, name: '[水]山庄高级天书' },
        { x: 192, y: 191, id: 6000840, name: '[火]山庄高级天书' }
    ];
    var POINT_ARRIVE = 3;
    var GATHER_DIST = 2;
    var POINT_WAIT_MS = 12000;
    var RELIC_TIMEOUT_MS = 180000;

    function relicUsage() {
        var used = 0, max = 0;
        try { used = Number(gd.boss.getYsValleyCount(RELIC_TYPE)) || 0; } catch (e) {}
        try {
            max = Number(gd.boss.getBossMaxCountById(ADV_BOOK_ID)) || 0;
            if (!max) max = Number(gd.boss.getBossMaxCountById(6000723)) || 0;
        } catch (e2) {}
        return { used: used, max: max, remain: Math.max(0, max - used) };
    }

    function learnBookPoints(st, books) {
        if (!st.points) {
            st.points = ADV_BOOK_POINTS.map(function (p) {
                return { x: p.x, y: p.y, id: p.id, name: p.name, learned: false };
            });
        }
        books.forEach(function (b) {
            var best = -1, bestD = 9999;
            for (var i = 0; i < st.points.length; i++) {
                if (st.points[i].id && b.id && Number(st.points[i].id) === Number(b.id)) {
                    best = i; bestD = 0; break;
                }
                var d = dist(b, st.points[i]);
                if (d < bestD) { bestD = d; best = i; }
            }
            if (best >= 0 && bestD <= 25) {
                st.points[best] = {
                    x: b.x, y: b.y,
                    id: b.id || st.points[best].id,
                    name: st.points[best].name,
                    learned: true
                };
            }
        });
    }

    function pickBookTarget(st, books) {
        var pts = st.points || ADV_BOOK_POINTS;
        var start = st.pointIdx || 0;
        for (var i = start; i < pts.length; i++) {
            for (var j = 0; j < books.length; j++) {
                var byId = pts[i].id && books[j].id && Number(pts[i].id) === Number(books[j].id);
                if (byId || dist(books[j], pts[i]) <= 12) {
                    return { mode: 'entity', pointIdx: i, book: books[j], x: books[j].x, y: books[j].y };
                }
            }
        }
        if (books.length) {
            var b0 = books[0];
            return { mode: 'entity', pointIdx: start, book: b0, x: b0.x, y: b0.y };
        }
        if (start >= pts.length) return null;
        var fb = pts[start];
        return { mode: 'point', pointIdx: start, book: null, x: fb.x, y: fb.y };
    }

    function relicStatus(st, usage) {
        return '高级天书 ' + (st.got || 0) + '/' + (st.need || 0) +
            ' · 点' + ((st.pointIdx || 0) + 1) + '/5 · 日次' + usage.used + '/' + usage.max;
    }

    handlers.wolong_relic = {
        start: function (p) {
            var st = stateOf(p);
            var usage = relicUsage();
            if (usage.max <= 0) return skip('山庄圣物次数未知', st);
            if (usage.remain <= 0) return skip('山庄圣物次数已用完', st);
            st.need = usage.remain;
            st.got = 0;
            st.pointIdx = 0;
            st.baseUsed = usage.used;
            st.roundStartedAt = Date.now();
            st.cycleEmpty = 0;
            st.points = ADV_BOOK_POINTS.map(function (pt) {
                return { x: pt.x, y: pt.y, id: pt.id, name: pt.name, learned: false };
            });
            st.lastGotoKey = '';
            st.pointArriveAt = 0;
            refreshTypeNum();
            enterMap(st);
            taskLog(st, '[山庄圣物] 仅采高级天书，展开 ' + st.need + ' 次 · 5 点顺序巡访', 'info');
            return ok({ done: false, waitMs: 5000, statusText: relicStatus(st, usage), state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            var usage = relicUsage();
            var rt = getRuntime();
            var now = Date.now();

            if (usage.remain <= 0 || (st.got || 0) >= (st.need || 0)) {
                taskLog(st, '[山庄圣物] 完成 ' + (st.got || 0) + '/' + (st.need || 0), 'info');
                return ok({ done: true, reason: '山庄圣物完成', state: st });
            }
            if (Number(rt.mapId) !== MAP_ID) {
                if (!st.enterAt || now - st.enterAt > 8000) enterMap(st);
                return ok({ done: false, waitMs: 3000, statusText: '前往卧龙山庄', state: st });
            }
            if (usage.used > (st.baseUsed || 0)) {
                st.got = (st.got || 0) + (usage.used - st.baseUsed);
                st.baseUsed = usage.used;
                st.pointIdx = 0;
                st.cycleEmpty = 0;
                st.roundStartedAt = now;
                st.pointArriveAt = 0;
                st.lastGotoKey = '';
                taskLog(st, '[山庄圣物] 采集+1 → ' + st.got + '/' + st.need, 'info');
                if (st.got >= st.need || usage.remain <= 0) {
                    return ok({ done: true, reason: '山庄圣物完成', state: st });
                }
            }
            if (now - (st.roundStartedAt || 0) > RELIC_TIMEOUT_MS) {
                taskLog(st, '[山庄圣物] 本轮超时，结束 ' + st.got + '/' + st.need, 'warn');
                return ok({ done: true, reason: '山庄圣物超时', state: st });
            }
            if (!st._lastTypeNumAt || now - st._lastTypeNumAt > 15000) {
                refreshTypeNum();
                st._lastTypeNumAt = now;
            }

            var books = findMonsters(ADV_BOOK_IDS);
            learnBookPoints(st, books);
            var aliveHint = typeAlive(2);
            var target = pickBookTarget(st, books);
            var me = playerXY();

            if (!target) {
                st.cycleEmpty = (st.cycleEmpty || 0) + 1;
                if (st.cycleEmpty >= 2 && aliveHint === 0) {
                    return ok({ done: true, reason: '高级天书未刷新', state: st });
                }
                st.pointIdx = 0;
                st.roundStartedAt = now;
                return ok({ done: false, waitMs: 4000, statusText: relicStatus(st, usage) + ' · 重巡', state: st });
            }

            st.pointIdx = target.pointIdx;
            var dest = { x: target.x, y: target.y };
            var d0 = me ? dist(me, dest) : 9999;
            var gotoKey = target.mode + ':' + target.pointIdx + ':' + dest.x + ',' + dest.y;

            if (target.mode === 'entity' && d0 <= GATHER_DIST) {
                tryAttack(target.book);
                return ok({ done: false, waitMs: 2000, statusText: relicStatus(st, usage) + ' · 采集中', state: st });
            }
            if (d0 <= POINT_ARRIVE) {
                if (!st.pointArriveAt) st.pointArriveAt = now;
                if (target.mode === 'entity') {
                    tryAttack(target.book);
                    gotoXY(dest.x, dest.y);
                } else if (now - st.pointArriveAt >= POINT_WAIT_MS) {
                    st.pointIdx = target.pointIdx + 1;
                    st.pointArriveAt = 0;
                    st.lastGotoKey = '';
                    if (st.pointIdx >= 5) {
                        st.pointIdx = 0;
                        st.cycleEmpty = (st.cycleEmpty || 0) + 1;
                        if (st.cycleEmpty >= 2 && (aliveHint === 0 || !books.length)) {
                            return ok({ done: true, reason: '高级天书未刷新', state: st });
                        }
                    }
                } else if (books.length) {
                    tryAttack(books[0]);
                }
                return ok({ done: false, waitMs: 2000, statusText: relicStatus(st, usage) + ' · 点' + (target.pointIdx + 1), state: st });
            }
            if (st.lastGotoKey !== gotoKey || !st.lastGotoAt || now - st.lastGotoAt > 6000) {
                gotoXY(dest.x, dest.y);
                st.lastGotoKey = gotoKey;
                st.lastGotoAt = now;
                st.pointArriveAt = 0;
            }
            if (target.mode === 'entity' && d0 <= 8) tryAttack(target.book);
            return ok({
                done: false,
                waitMs: 2500,
                statusText: relicStatus(st, usage) + (target.mode === 'entity' ? ' · 追天书' : ' · 赴点' + (target.pointIdx + 1)),
                state: st
            });
        }
    };

    /* ---------- 山庄首领：共享日次 1#8；进图后随机出安全区再挂机寻怪 ---------- */
    var LEADER_IDS = { 6000727: 1, 6000728: 1, 6000729: 1, 6000730: 1 };
    var INVADER_IDS = { 1005: 1, 1006: 1 };
    /** 随机道具：随机石 / 随机卷（与挂机猎杀配置一致） */
    var LEADER_RANDOM_IDS = [404, 8151];
    var LEADER_FIGHT_DIST = 8;
    var LEADER_TARGET_MS = 90000;
    var LEADER_TOTAL_MS = 600000;
    /** 视野内持续不见首领则再随机 */
    var LEADER_NO_TARGET_RANDOM_MS = 10000;
    /** 两次随机最短间隔，避免连点 */
    var LEADER_RANDOM_COOLDOWN_MS = 2500;

    function leaderUsage() {
        var used = 0, max = 0;
        try { used = Number(gd.boss.getBossDropCount(6000727)) || 0; } catch (e) {}
        try { max = Number(gd.boss.getBossMaxCountById(6000727)) || 0; } catch (e2) {}
        if (!max) {
            try { used = Number(gd.boss.getYsValleyCount(402)) || used; } catch (e3) {}
            max = 8; // group 1#8
        }
        return { used: used, max: max, remain: Math.max(0, max - used) };
    }

    function leaderStatus(st, usage) {
        return '山庄首领 ' + (st.killed || 0) + '击 · 日次' + usage.used + '/' + usage.max +
            (st.checkInvader ? ' · 含入侵者' : '');
    }

    function pickCombat(st) {
        var leaders = findMonsters(LEADER_IDS);
        if (leaders.length) return { kind: 'leader', mon: leaders[0] };
        if (st.checkInvader) {
            var invaders = findMonsters(INVADER_IDS);
            if (invaders.length) return { kind: 'invader', mon: invaders[0] };
        }
        return null;
    }

    function bagItemCount(itemId) {
        var n = 0;
        try {
            if (gd.bag && gd.bag.getCount) n = Number(gd.bag.getCount(itemId)) || 0;
        } catch (e) { n = 0; }
        if (n > 0) return n;
        try {
            if (gd.bag && gd.bag.bagDic) {
                for (var k in gd.bag.bagDic) {
                    var it = gd.bag.bagDic[k];
                    if (it && Number(it.itemId) === Number(itemId)) n += Number(it.count) || 1;
                }
            }
        } catch (e2) {}
        return n;
    }

    /** 使用随机石/卷离开安全区或换点搜怪 */
    function useLeaderRandom(st) {
        try {
            if (!gd.bag || !gd.bag.sendReqUseItem) {
                pulseLog(st, 'rand_api', '[山庄首领] 无法使用随机：sendReqUseItem 不可用', 'warn');
                return false;
            }
            for (var i = 0; i < LEADER_RANDOM_IDS.length; i++) {
                var itemId = LEADER_RANDOM_IDS[i];
                if (bagItemCount(itemId) <= 0) continue;
                gd.bag.sendReqUseItem(1, itemId);
                st.lastRandomAt = Date.now();
                st.needFirstRandom = false;
                st.noLeaderSince = Date.now();
                st.randomCount = (st.randomCount || 0) + 1;
                taskLog(st, '[山庄首领] 使用随机道具 #' + itemId +
                    '（第' + st.randomCount + '次）', 'info');
                return true;
            }
            pulseLog(st, 'rand_empty', '[山庄首领] 背包无随机石/卷(404/8151)', 'warn');
            return false;
        } catch (e) {
            pulseLog(st, 'rand_err', '[山庄首领] 随机失败: ' + (e && e.message), 'warn');
            return false;
        }
    }

    function maybeLeaderRandom(st, now, reason) {
        if (st.lastRandomAt && now - st.lastRandomAt < LEADER_RANDOM_COOLDOWN_MS) return false;
        var okRand = useLeaderRandom(st);
        if (okRand) setAutoFight(true);
        else if (reason) pulseLog(st, 'rand_skip', '[山庄首领] ' + reason + ' · 无随机可用，继续原地挂机', 'warn');
        return okRand;
    }

    handlers.wolong_leader = {
        start: function (p) {
            var st = stateOf(p);
            var usage = leaderUsage();
            if (usage.max <= 0) return skip('山庄首领次数未知', st);
            if (usage.remain <= 0) return skip('山庄首领次数已用完', st);

            st.need = usage.remain;
            st.killed = 0;
            st.baseUsed = usage.used;
            st.startedAt = Date.now();
            st.targetSince = 0;
            st.targetUid = '';
            st.lastGotoKey = '';
            st.needFirstRandom = true;
            st.noLeaderSince = 0;
            st.lastRandomAt = 0;
            st.randomCount = 0;
            st.wasOnMap = false;
            st.checkInvader = !!(p.allCfg && p.allCfg.wolong_invader && p.allCfg.wolong_invader.enabled);
            refreshTypeNum();
            var entered = enterMap(st);
            taskLog(st, '[山庄首领] 展开 ' + st.need + ' 次' +
                (st.checkInvader ? '（含击杀卧龙入侵者）' : '') +
                ' · 进图' + (entered ? '已请求' : '改开界面') +
                ' · 策略=先随机再挂机', 'info');
            return ok({ done: false, waitMs: 4000, statusText: leaderStatus(st, usage), state: st });
        },
        poll: function (p) {
            var st = stateOf(p);
            var usage = leaderUsage();
            var rt = getRuntime();
            var now = Date.now();

            if (!st.need || st.need < 0) {
                st.need = usage.remain;
                st.baseUsed = usage.used;
                st.killed = st.killed || 0;
                st.startedAt = st.startedAt || now;
            }

            if (usage.remain <= 0 || (st.killed || 0) >= (st.need || 0)) {
                setAutoFight(false);
                taskLog(st, '[山庄首领] 完成 击杀' + (st.killed || 0) +
                    ' · 日次' + usage.used + '/' + usage.max +
                    ' · 随机' + (st.randomCount || 0) + '次', 'info');
                return ok({ done: true, reason: '山庄首领完成', state: st });
            }
            if (now - (st.startedAt || 0) > LEADER_TOTAL_MS) {
                setAutoFight(false);
                taskLog(st, '[山庄首领] 总超时，结束 击杀' + (st.killed || 0), 'warn');
                return ok({ done: true, reason: '山庄首领超时', state: st });
            }

            // 尚未进图
            if (Number(rt.mapId) !== MAP_ID) {
                setAutoFight(false);
                st.wasOnMap = false;
                st.needFirstRandom = true;
                if (!st.enterAt || now - st.enterAt > 8000) {
                    enterMap(st);
                    pulseLog(st, 'enter', '[山庄首领] 进图中 map=' + rt.mapId + ' → ' + MAP_ID, 'info');
                } else {
                    pulseLog(st, 'waitmap', '[山庄首领] 等待进图 map=' + rt.mapId, 'info');
                }
                return ok({ done: false, waitMs: 3000, statusText: '前往卧龙山庄 map=' + rt.mapId, state: st });
            }

            // 刚进图：标记需要首次随机（离开安全区）
            if (!st.wasOnMap) {
                st.wasOnMap = true;
                st.needFirstRandom = true;
                st.noLeaderSince = now;
                taskLog(st, '[山庄首领] 已进图，准备随机出安全区', 'info');
            }

            if (usage.used > (st.baseUsed || 0)) {
                var gained = usage.used - st.baseUsed;
                st.killed = (st.killed || 0) + gained;
                st.baseUsed = usage.used;
                st.targetSince = 0;
                st.targetUid = '';
                st.noLeaderSince = now;
                taskLog(st, '[山庄首领] 击杀+' + gained + ' → ' + st.killed + '/' + st.need, 'info');
                if (st.killed >= st.need || usage.remain <= 0) {
                    setAutoFight(false);
                    return ok({ done: true, reason: '山庄首领完成', state: st });
                }
            }
            if (!st._lastTypeNumAt || now - st._lastTypeNumAt > 15000) {
                refreshTypeNum();
                st._lastTypeNumAt = now;
            }

            // 进图后先随机一次（出安全区）；失败则进入挂机，约 10 秒后再试随机
            if (st.needFirstRandom) {
                var firstOk = maybeLeaderRandom(st, now, '进图首次随机');
                if (!firstOk) st.needFirstRandom = false;
                setAutoFight(true);
                return ok({
                    done: false,
                    waitMs: 3000,
                    statusText: leaderStatus(st, usage) + (firstOk ? ' · 首次随机' : ' · 无随机·挂机'),
                    state: st
                });
            }

            var hit = pickCombat(st);

            if (hit) {
                st.noLeaderSince = 0;
                var mon = hit.mon;
                var me = playerXY();
                var d1 = me ? dist(me, mon) : 9999;
                if (!st.targetSince || st.targetUid !== mon.uid) {
                    st.targetSince = now;
                    st.targetUid = mon.uid;
                    taskLog(st, '[山庄首领] 发现' + (hit.kind === 'invader' ? '入侵者' : '首领') +
                        ' ' + (mon.name || mon.id) + ' @' + mon.x + ',' + mon.y, 'info');
                }
                // 追同一只太久：随机换点
                if (now - st.targetSince > LEADER_TARGET_MS) {
                    taskLog(st, '[山庄首领] 目标超时，随机换点', 'warn');
                    st.targetSince = 0;
                    st.targetUid = '';
                    maybeLeaderRandom(st, now, '目标超时');
                    setAutoFight(true);
                    return ok({ done: false, waitMs: 3000, statusText: leaderStatus(st, usage) + ' · 超时随机', state: st });
                }
                if (d1 > LEADER_FIGHT_DIST) {
                    var gKey = 'm:' + mon.uid;
                    if (st.lastGotoKey !== gKey || !st.lastGotoAt || now - st.lastGotoAt > 5000) {
                        gotoXY(mon.x, mon.y);
                        st.lastGotoKey = gKey;
                        st.lastGotoAt = now;
                    }
                    tryAttack(mon);
                    pulseLog(st, 'chase', '[山庄首领] 追击 dist=' + d1, 'info');
                    return ok({
                        done: false, waitMs: 2000,
                        statusText: leaderStatus(st, usage) + (hit.kind === 'invader' ? ' · 追入侵者' : ' · 追首领'),
                        state: st
                    });
                }
                tryAttack(mon);
                pulseLog(st, 'fight', '[山庄首领] 战斗中 ' + (mon.name || mon.id), 'info');
                return ok({
                    done: false, waitMs: 2000,
                    statusText: leaderStatus(st, usage) + (hit.kind === 'invader' ? ' · 打入侵者' : ' · 战斗中'),
                    state: st
                });
            }

            // 视野无首领：挂机等待；满约 10 秒再随机
            setAutoFight(true);
            st.targetSince = 0;
            st.targetUid = '';
            if (!st.noLeaderSince) st.noLeaderSince = now;
            var waited = now - st.noLeaderSince;
            if (waited >= LEADER_NO_TARGET_RANDOM_MS) {
                maybeLeaderRandom(st, now, '约' + Math.round(waited / 1000) + '秒未见首领');
                return ok({
                    done: false,
                    waitMs: 3000,
                    statusText: leaderStatus(st, usage) + ' · 再随机',
                    state: st
                });
            }
            pulseLog(st, 'hunt', '[山庄首领] 挂机搜怪 已等' + Math.round(waited / 1000) +
                's/' + Math.round(LEADER_NO_TARGET_RANDOM_MS / 1000) + 's', 'info');
            return ok({
                done: false,
                waitMs: 2000,
                statusText: leaderStatus(st, usage) + ' · 搜怪' + Math.round(waited / 1000) + 's',
                state: st
            });
        }
    };

    handlers.wolong_invader = {
        start: function () { return skip('入侵者已合并至山庄首领'); },
        poll: function (p) { return ok({ done: true, state: stateOf(p) }); }
    };

    /* ---------- 魔神 / 仙岛：进图骨架 ---------- */
    function bossStub(tzType, label, prefix) {
        return {
            start: function (p) {
                var st = stateOf(p);
                var cfg = p.cfg || {};
                var tz = cm.bossTiaoZhan && cm.bossTiaoZhan[tzType];
                if (!tz) return fail('无卧龙配置: ' + tzType);
                if (!st.queue) {
                    var opts = getBossTiaoZhanOptions(tzType, prefix || 'wl');
                    var pick = pickedIds(cfg);
                    st.queue = [];
                    opts.forEach(function (o) {
                        if (pick.length && pick.indexOf(o.id) < 0 && pick.indexOf('gen_' + o.bossId) < 0) return;
                        if (o.count > 0) st.queue.push(o.index);
                    });
                    if (!st.queue.length) opts.forEach(function (o, i) { if (o.count > 0) st.queue.push(i); });
                    st.idx = 0;
                }
                if (!st.queue.length) return skip(label + '无次数');
                if (st.idx >= st.queue.length) return ok({ done: true, reason: label + '完成', state: st });
                var bi = st.queue[st.idx];
                var delivers = String(tz.deliver).split('#').map(function (x) { return parseInt(x, 10); });
                var npcId = delivers[bi] || delivers[0];
                try {
                    Logic.deliverToFindNpc(npcId);
                    st.entered = true;
                } catch (e) { return fail(e.message); }
                return ok({ done: false, waitMs: 60000, statusText: label, state: st });
            },
            poll: function (p) {
                var st = stateOf(p);
                if (Date.now() - (p.startedAt || 0) > 90000) {
                    st.idx++;
                    if (st.idx >= st.queue.length) return ok({ done: true, reason: label + '完成', state: st });
                    return ok({ done: false, restart: true, state: st });
                }
                return ok({ done: false, statusText: label + '前往中', state: st });
            }
        };
    }

    handlers.wolong_demon = bossStub(403, '山庄魔神', 'wl');
    handlers.wolong_island_leader = bossStub(800, '仙岛首领', 'xd');
    handlers.wolong_island_demon = bossStub(800, '仙岛魔神', 'gen');

    TH.registerHandlers(handlers);
})(typeof window !== 'undefined' ? window : this);
