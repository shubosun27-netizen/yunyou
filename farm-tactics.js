/**
 * 挂机 Tab 高级策略：换图、BOSS 归属、走位、精英过滤、组队等。
 * 由 layout-preview 调度器调用：低血走位全相位；换图/过滤仅 FARMING；归属仅 HUNTING_BOSS。
 */
(function (global) {
    'use strict';

    var api = {};
    var mapEnterLog = [];
    var farmActiveMapId = 0;
    var lastApplyTs = 0;
    var lastTeamTs = 0;
    var lastKiteTs = 0;
    var lastKiteClearTs = 0;
    var lastFarmPhaseMapId = null;
    var lastWasFarming = false;

    function defaultTactics() {
        return {
            mapRepeatCount: 0,
            mapRepeatWindowMin: 5,
            altMapIds: [],
            bossOwnerEnabled: false,
            bossOwnerHpPct: 0,
            bossOwnerWhitelist: [],
            lowHpKiteEnabled: false,
            lowHpKitePct: 0,
            eliteOnly: false,
            skipEvilChest: true,
            autoCollectCorpse: false,
            autoTeamEnabled: false,
            autoTeamMembers: [],
            autoTeamMode: 'leader'
        };
    }

    function mergeDefaults(t) {
        if (!t) return defaultTactics();
        var d = defaultTactics();
        Object.keys(d).forEach(function (k) {
            if (t[k] === undefined) t[k] = d[k];
        });
        if (!Array.isArray(t.altMapIds)) t.altMapIds = parseNameList(t.altMapIds);
        if (!Array.isArray(t.bossOwnerWhitelist)) t.bossOwnerWhitelist = parseNameList(t.bossOwnerWhitelist);
        if (!Array.isArray(t.autoTeamMembers)) t.autoTeamMembers = parseNameList(t.autoTeamMembers);
        return t;
    }

    function parseNameList(text) {
        if (!text) return [];
        if (Array.isArray(text)) return text.slice();
        return String(text).split(/[,，、;\s]+/).map(function (s) {
            return s.trim();
        }).filter(Boolean);
    }

    function toNum(v) {
        if (v == null || v === '') return NaN;
        if (typeof v === 'number') return v;
        if (typeof v === 'object') {
            try {
                if (typeof v.toNumber === 'function') return v.toNumber();
                if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
                    var n = Number(v.toString());
                    if (!isNaN(n)) return n;
                }
            } catch (e) {}
        }
        var n2 = Number(v);
        return isNaN(n2) ? NaN : n2;
    }

    function hpPct(d) {
        var p = d && d.player;
        if (!p) return 100;
        var max = toNum(p.hpMax);
        var hp = toNum(p.hp);
        if (!(max > 0) || isNaN(hp)) return 100;
        return (hp / max) * 100;
    }

    function getTactics(p) {
        if (!p || !p.farm) return null;
        return mergeDefaults(p.farm.tactics);
    }

    function getFarmMapPool(p) {
        var primary = parseInt(p.farm.mapId, 10) || 0;
        var t = getTactics(p);
        var alts = (t && t.altMapIds) ? t.altMapIds.slice() : [];
        var pool = [];
        if (primary) pool.push(primary);
        alts.forEach(function (id) {
            id = parseInt(id, 10);
            if (id && pool.indexOf(id) < 0) pool.push(id);
        });
        return pool;
    }

    function getFarmTargetMapId(p) {
        var primary = parseInt(p.farm && p.farm.mapId, 10) || 0;
        if (farmActiveMapId && farmActiveMapId !== primary) {
            var pool = getFarmMapPool(p);
            if (pool.indexOf(farmActiveMapId) >= 0) return farmActiveMapId;
        }
        return primary;
    }

    function normalizeId(v) {
        if (v == null || v === '') return '';
        if (typeof v === 'object' && v.toString &&
            v.toString !== Object.prototype.toString) {
            return String(v.toString());
        }
        return String(v);
    }

    function isWhitelisted(name, uid, list) {
        if (!list || !list.length) return false;
        var n = (name || '').trim();
        var u = uid != null ? String(uid) : '';
        for (var i = 0; i < list.length; i++) {
            var w = String(list[i]).trim();
            if (!w) continue;
            if (n && (n === w || n.indexOf(w) >= 0)) return true;
            if (u && u === w) return true;
        }
        return false;
    }

    function isNoOwnerUid(uid) {
        var u = normalizeId(uid);
        if (!u) return true;
        if (u === '0' || u === '0_0') return true;
        // Long#toString 零值常见形态
        if (/^0(_0)+$/.test(u)) return true;
        return false;
    }

    function isBossOwnerMine(combat, player, whitelist) {
        if (!combat) return true;
        var ownerName = (combat.ownerName || '').trim();
        if (isNoOwnerUid(combat.ownerUid) && !ownerName) return true;
        if (combat.ownerIsMine === true) return true;
        if (combat.ownerIsMine === false) {
            if (isNoOwnerUid(combat.ownerUid) && !ownerName) return true;
            if (isWhitelisted(combat.ownerName, combat.ownerUid, whitelist)) return true;
            return false;
        }
        var myUid = normalizeId(player && player.uid);
        var myName = ((player && player.name) || '').trim();
        var ownerUid = normalizeId(combat.ownerUid);
        if (!ownerUid || ownerUid === '0' || isNoOwnerUid(combat.ownerUid)) return true;
        if (myUid && ownerUid && myUid === ownerUid) return true;
        if (myName && ownerName && myName === ownerName) return true;
        if (isWhitelisted(ownerName, ownerUid, whitelist)) return true;
        return false;
    }

    /** 发现 Boss 时预检：已受伤且非归属则勿锁定开打 */
    function shouldSkipBossAtLock(monster, player, tactics) {
        return shouldAbandonBoss(monster, mergeDefaults(tactics), player);
    }

    function shouldAbandonBoss(combat, tactics, player) {
        if (!tactics || !tactics.bossOwnerEnabled) return false;
        if (!combat || !combat.hpMax) return false;
        var pct = (combat.hp / combat.hpMax) * 100;
        var thr = Number(tactics.bossOwnerHpPct) || 0;
        if (thr <= 0) return false;
        if (pct >= thr) return false;
        return !isBossOwnerMine(combat, player, tactics.bossOwnerWhitelist);
    }

    function pruneMapEnterLog(windowMin) {
        var cut = Date.now() - (windowMin || 5) * 60 * 1000;
        mapEnterLog = mapEnterLog.filter(function (e) { return e.ts >= cut; });
    }

    function countRecentEnters(mapId, windowMin) {
        pruneMapEnterLog(windowMin);
        var n = 0;
        mapEnterLog.forEach(function (e) {
            if (e.mapId === mapId) n++;
        });
        return n;
    }

    function recordMapEnter(mapId) {
        mapId = parseInt(mapId, 10);
        if (!mapId) return;
        mapEnterLog.push({ mapId: mapId, ts: Date.now() });
        pruneMapEnterLog(5);
    }

    function pickNextFarmMap(p, currentMapId) {
        var pool = getFarmMapPool(p);
        if (pool.length <= 1) return 0;
        var idx = pool.indexOf(parseInt(currentMapId, 10));
        if (idx < 0) idx = 0;
        return pool[(idx + 1) % pool.length];
    }

    function maybeSwitchFarmMap(d, p, ctx) {
        var t = getTactics(p);
        if (!t || !t.mapRepeatCount || t.mapRepeatCount <= 0) return false;
        var cur = d.map && parseInt(d.map.mapId, 10);
        if (!cur) return false;
        var windowMin = t.mapRepeatWindowMin || 5;
        var cnt = countRecentEnters(cur, windowMin);
        if (cnt < t.mapRepeatCount) return false;
        var next = pickNextFarmMap(p, cur);
        if (!next || next === cur) {
            if (ctx.log) ctx.log('换图：仅一张挂机图或未配置备选，无法切换');
            mapEnterLog = [];
            return false;
        }
        farmActiveMapId = next;
        mapEnterLog = [];
        if (ctx.log) {
            ctx.log('5分钟内连续进入地图' + cur + '达' + cnt + '次，切换挂机图 → ' + next +
                (ctx.mapNameById ? ('(' + (ctx.mapNameById(next) || '') + ')') : ''));
        }
        ctx.setPhase('GOING_FARM');
        ctx.pendingGoFarmUntil(Date.now() + 5000);
        ctx.sendCmd('goMap', {
            type: 'auto',
            mapId: next,
            deliverId: p.farm.deliverId || 0
        });
        return true;
    }

    function trackFarmMapEnter(d, p, ctx) {
        var cur = d.map && parseInt(d.map.mapId, 10);
        var target = getFarmTargetMapId(p);
        if (!cur || cur !== target) {
            lastFarmPhaseMapId = null;
            return;
        }
        if (lastFarmPhaseMapId !== cur) {
            recordMapEnter(cur);
            lastFarmPhaseMapId = cur;
            if (ctx.log && mapEnterLog.length > 1) {
                ctx.log('进图记录：' + cur + ' ·5分钟内第' + countRecentEnters(cur, 5) + '次', 'verbose');
            }
        }
    }

    function nowNeedClearKite() {
        var now = Date.now();
        if (now - lastKiteClearTs < 5000) return false;
        lastKiteClearTs = now;
        return true;
    }

    function tickLowHpKite(d, p, ctx) {
        if (!d || !p || !ctx || !ctx.sendCmd) return;
        var t = getTactics(p);
        if (!t) return;
        var kiteEnabled = !!(t.lowHpKiteEnabled || Number(t.lowHpKitePct) > 0);
        if (!kiteEnabled) {
            // 功能关着：偶尔清一次残留（避免停功能后仍开着1199）
            if (nowNeedClearKite()) {
                lastKiteTs = Date.now();
                ctx.sendCmd('applyFarmTactics', {
                    lowHpKite: { enabled: false, threshold: 0 },
                    playerHpPct: hpPct(d)
                });
            }
            return;
        }
        var now = Date.now();
        // 全相位实时：约 0.5s 轮询一次血量开/关
        if (now - lastKiteTs < 500) return;
        lastKiteTs = now;
        ctx.sendCmd('applyFarmTactics', {
            lowHpKite: {
                enabled: true,
                threshold: Number(t.lowHpKitePct) || 0
            },
            playerHpPct: hpPct(d)
        });
    }

    function onRuntime(d, p, ctx) {
        if (!d || !p || !p.farm || !p.farm.mapId) return false;
        var t = getTactics(p);
        if (!t) return false;
        var now = Date.now();
        var phase = ctx.phase;

        // 低血走位：任意调度相位都实时开/关（不限 FARMING）
        tickLowHpKite(d, p, ctx);

        if (phase === 'FARMING') {
            trackFarmMapEnter(d, p, ctx);
            if (maybeSwitchFarmMap(d, p, ctx)) return true;

            // 挂机图内其它策略（采集/精英/宝箱），不含走位（已由 tickLowHpKite 处理）
            if (now - lastApplyTs > 2000) {
                lastApplyTs = now;
                ctx.sendCmd('applyFarmTactics', {
                    autoCollect: !!t.autoCollectCorpse,
                    eliteOnly: !!t.eliteOnly,
                    skipEvilChest: t.skipEvilChest !== false
                });
            }

            if (t.autoTeamEnabled && t.autoTeamMembers.length && now - lastTeamTs > 30000) {
                lastTeamTs = now;
                ctx.sendCmd('autoTeamTick', {
                    members: t.autoTeamMembers,
                    mode: t.autoTeamMode || 'leader'
                });
            }
        }

        if (phase === 'HUNTING_BOSS' && ctx.huntSawBoss && t.bossOwnerEnabled && d.combatTarget) {
            if (shouldAbandonBoss(d.combatTarget, t, d.player)) {
                var ct = d.combatTarget;
                var reason = 'BOSS非归属(hp<' + t.bossOwnerHpPct + '%·' +
                    (ct.ownerName || '他人') +
                    (ct.ownerIsMine === false && ct.ownerUid ?
                        ('·uid=' + ct.ownerUid + '≠' + normalizeId(d.player && d.player.uid)) : '') +
                    ')';
                if (ctx.abandonHunt) ctx.abandonHunt(reason);
                return true;
            }
        }

        lastWasFarming = phase === 'FARMING';
        return false;
    }

    function resetRuntime() {
        mapEnterLog = [];
        farmActiveMapId = 0;
        lastApplyTs = 0;
        lastTeamTs = 0;
        lastKiteTs = 0;
        lastKiteClearTs = 0;
        lastFarmPhaseMapId = null;
        lastWasFarming = false;
    }

    global.FarmTacticsModule = {
        init: function (deps) {
            api = deps || {};
        },
        defaultTactics: defaultTactics,
        mergeDefaults: mergeDefaults,
        parseNameList: parseNameList,
        ensureFarm: function (p) {
            if (!p) return p;
            if (!p.farm) p.farm = { mapId: 0, deliverId: 0, guajiType: 0, autoPick: true, autoFight: 1 };
            if (!p.farm.tactics) p.farm.tactics = defaultTactics();
            else mergeDefaults(p.farm.tactics);
            return p;
        },
        getFarmTargetMapId: getFarmTargetMapId,
        shouldSkipBossAtLock: shouldSkipBossAtLock,
        tickLowHpKite: function (d, p, ctx) {
            tickLowHpKite(d, p, ctx || {});
        },
        onRuntime: onRuntime,
        resetRuntime: resetRuntime
    };
})(window);
