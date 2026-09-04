/**
 * 自动灵魂殿堂：挂机稳态下背包自动检出 Boss 图鉴稀有材，合计达阈值 → 进殿堂注入 → 回挂机。
 * 侧程相位：GOING_SOUL_HALL / SOUL_HALL（仿 NPC 回收）。
 * 材料 ID 由游戏 cm.tujian 自动识别，无需配置。
 */
(function (global) {
    'use strict';

    var api = {};
    var SOUL_MAP_ID = 5499;
    var TRIP_TIMEOUT_MS = 25000;
    var COUNT_POLL_MS = 5000;

    var lastTripTs = 0;
    var lastCountPollTs = 0;
    var lastGateLogTs = 0;
    var tripStartedAt = 0;
    var injectAt = 0;
    var injectSent = false;
    var leftFarmMapId = 0;
    var pendingGoUntil = 0;
    var leaveSent = false;

    function defaultSoulHall() {
        return {
            enabled: false,
            minCount: 10,
            cooldownSec: 120
        };
    }

    function mergeDefaults(cfg) {
        if (!cfg) return defaultSoulHall();
        var d = defaultSoulHall();
        Object.keys(d).forEach(function (k) {
            if (cfg[k] === undefined) cfg[k] = d[k];
        });
        // 兼容旧方案字段：忽略 itemIds
        delete cfg.itemIds;
        cfg.minCount = parseInt(cfg.minCount, 10) || 0;
        cfg.cooldownSec = parseInt(cfg.cooldownSec, 10);
        if (isNaN(cfg.cooldownSec) || cfg.cooldownSec < 0) cfg.cooldownSec = 120;
        return cfg;
    }

    function getCfg(p) {
        if (!p || !p.farm) return null;
        if (!p.farm.soulHall) p.farm.soulHall = defaultSoulHall();
        return mergeDefaults(p.farm.soulHall);
    }

    function ensureFarm(p) {
        if (!p) return p;
        if (!p.farm) p.farm = { mapId: 0, deliverId: 0, guajiType: 0, autoPick: true, autoFight: 1 };
        if (!p.farm.soulHall) p.farm.soulHall = defaultSoulHall();
        else mergeDefaults(p.farm.soulHall);
        return p;
    }

    function isSoulHallPhase(phase) {
        return phase === 'GOING_SOUL_HALL' || phase === 'SOUL_HALL';
    }

    function canStart(ctx) {
        if (!ctx || ctx.phase !== 'FARMING') return false;
        if (ctx.isInBossPhases && ctx.isInBossPhases()) return false;
        if (ctx.isInActivityPhases && ctx.isInActivityPhases()) return false;
        if (ctx.phase === 'GOING_TASK' || ctx.phase === 'DOING_TASK') return false;
        if (ctx.phase === 'GOING_RECYCLE' || ctx.phase === 'RECYCLING') return false;
        if (isSoulHallPhase(ctx.phase)) return false;
        return true;
    }

    function startTrip(p, reason, ctx) {
        p = p || (api.getActive && api.getActive());
        var cfg = getCfg(p);
        if (!cfg || !cfg.enabled) return false;
        var now = Date.now();
        lastTripTs = now;
        tripStartedAt = now;
        injectAt = 0;
        injectSent = false;
        leaveSent = false;
        leftFarmMapId = (p.farm && p.farm.mapId) || 0;
        pendingGoUntil = now + 2500;
        if (ctx.setPhase) ctx.setPhase('GOING_SOUL_HALL');
        if (ctx.setStatus) ctx.setStatus('云游平台：前往灵魂殿堂…', 'running');
        if (ctx.log) ctx.log('灵魂殿堂：启动' + (reason ? ' ·' + reason : ''));
        if (ctx.sendCmd) {
            ctx.sendCmd('setAutoFight', { type: 3 });
            ctx.sendCmd('goSoulHall', {});
        }
        return true;
    }

    /** 由 getSoulHallBagCount 回包触发（自动扫描背包） */
    function onBagCountResult(result, p, ctx) {
        if (!result || !result.success) return false;
        if (!canStart(ctx)) return false;
        p = p || (api.getActive && api.getActive());
        var cfg = getCfg(p);
        if (!cfg || !cfg.enabled) return false;
        var now = Date.now();
        if (now - lastTripTs < (cfg.cooldownSec || 120) * 1000) return false;
        var count = result.total != null ? Number(result.total) : 0;
        var minCount = cfg.minCount || 0;
        if (minCount <= 0 || count < minCount) return false;
        if (result.gateBlocked) {
            if (now - lastGateLogTs > 60000) {
                lastGateLogTs = now;
                if (ctx.log) ctx.log('灵魂殿堂：未满足开放条件 ·' + (result.gateReason || '等级/开服'));
            }
            lastTripTs = now;
            return false;
        }
        var kinds = result.kindCount != null ? result.kindCount : Object.keys(result.byId || {}).length;
        return startTrip(p, '背包检出' + kinds + '种·合计' + count + '≥' + minCount, ctx);
    }

    /** FARMING 稳态轮询：自动检查背包稀有材 */
    function maybePoll(d, p, ctx) {
        if (!canStart(ctx)) return;
        p = p || (api.getActive && api.getActive());
        var cfg = getCfg(p);
        if (!cfg || !cfg.enabled || !cfg.minCount) return;
        var now = Date.now();
        if (now - lastTripTs < (cfg.cooldownSec || 120) * 1000) return;
        if (now - lastCountPollTs < COUNT_POLL_MS) return;
        lastCountPollTs = now;
        if (ctx.sendCmd) {
            ctx.sendCmd('getSoulHallBagCount', {
                auto: true,
                checkGate: true
            });
        }
    }

    function finishTrip(p, reason, ctx) {
        lastTripTs = Date.now();
        tripStartedAt = 0;
        injectAt = 0;
        injectSent = false;
        leaveSent = false;
        if (ctx.log) ctx.log('灵魂殿堂：结束' + (reason ? ' ·' + reason : ''));
        if (ctx.finishAndContinue) {
            ctx.finishAndContinue(p);
            return;
        }
        if (ctx.returnToFarmMap) ctx.returnToFarmMap(p, '灵魂殿堂后回挂机');
    }

    function onRuntime(d, p, ctx) {
        if (!ctx || !isSoulHallPhase(ctx.phase)) return false;
        p = p || (api.getActive && api.getActive());
        var now = Date.now();
        var cur = d && d.map && d.map.mapId;
        var mapOk = Number(cur) === SOUL_MAP_ID;

        if (ctx.phase === 'GOING_SOUL_HALL') {
            var leftFarm = leftFarmMapId && cur && Number(cur) !== Number(leftFarmMapId);
            // 1) 还在挂机图且在等待窗口内 → 继续等
            if (now < pendingGoUntil && !mapOk && !leftFarm) {
                if (ctx.setStatus) ctx.setStatus('云游平台：前往灵魂殿堂…', 'running');
                return true;
            }
            // 2) 已到达灵魂殿堂 → 切换阶段
            if (mapOk) {
                if (ctx.setPhase) ctx.setPhase('SOUL_HALL');
                injectAt = now;
                injectSent = false;
                leaveSent = false;
                if (ctx.setStatus) ctx.setStatus('云游平台：灵魂殿堂注入中…', 'running');
                if (ctx.log) ctx.log('灵魂殿堂：已抵达 map=' + cur + '，开始注入');
                return true;
            }
            // 3) 已离开挂机图但还没到目标图 → 可能在 hub 中转，等游戏自动二次进图
            if (leftFarm && !mapOk && now - tripStartedAt < TRIP_TIMEOUT_MS) {
                if (ctx.setStatus) ctx.setStatus('云游平台：进入灵魂殿堂…', 'running');
                return true;
            }
            // 4) 还在挂机图，且等待窗口过了 → 重试 goSoulHall（每 4 秒一次）
            if (!mapOk && !leftFarm && now - tripStartedAt >= 4000 && now - tripStartedAt < TRIP_TIMEOUT_MS) {
                if (now >= pendingGoUntil) {
                    pendingGoUntil = now + 4000;
                    if (ctx.sendCmd) ctx.sendCmd('goSoulHall', {});
                    if (ctx.log) ctx.log('灵魂殿堂：重试前往…', 'verbose');
                }
                if (ctx.setStatus) ctx.setStatus('云游平台：前往灵魂殿堂…', 'running');
                return true;
            }
            // 5) 超时 → 放弃
            if (now - tripStartedAt > TRIP_TIMEOUT_MS) {
                if (ctx.log) ctx.log('灵魂殿堂：进图超时，回挂机');
                finishTrip(p, '进图超时', ctx);
                return true;
            }
            return true;
        }

        if (ctx.phase === 'SOUL_HALL') {
            if (ctx.setStatus) ctx.setStatus('云游平台：灵魂殿堂注入中…', 'running');
            if (!mapOk && injectSent) {
                finishTrip(p, '已离开殿堂', ctx);
                return true;
            }
            if (!injectSent) {
                injectSent = true;
                injectAt = now;
                if (ctx.sendCmd) {
                    ctx.sendCmd('injectSoulMaterials', {
                        auto: true,
                        maxPerTick: 40
                    });
                }
                return true;
            }
            if (!leaveSent && injectAt && now - injectAt >= 1200) {
                leaveSent = true;
                if (ctx.sendCmd) ctx.sendCmd('leaveSoulHall', {});
                return true;
            }
            if (leaveSent && injectAt && now - injectAt >= 2200) {
                finishTrip(p, '注入完成', ctx);
                return true;
            }
            if (now - tripStartedAt > TRIP_TIMEOUT_MS) {
                if (ctx.log) ctx.log('灵魂殿堂：超时，强制回挂机');
                if (ctx.sendCmd) ctx.sendCmd('leaveSoulHall', {});
                finishTrip(p, '超时', ctx);
                return true;
            }
            return true;
        }
        return false;
    }

    function resetRuntime() {
        lastCountPollTs = 0;
        tripStartedAt = 0;
        injectAt = 0;
        injectSent = false;
        leaveSent = false;
        leftFarmMapId = 0;
        pendingGoUntil = 0;
    }

    function makeCtx(extra) {
        var ctx = {
            phase: api.getPhase ? api.getPhase() : '',
            log: api.log,
            sendCmd: api.sendCmd,
            setPhase: api.setPhase,
            setStatus: api.setStatus,
            returnToFarmMap: api.returnToFarmMap,
            finishAndContinue: api.finishAndContinue,
            isInBossPhases: api.isInBossPhases,
            isInActivityPhases: api.isInActivityPhases,
            getActive: api.getActive
        };
        if (extra) {
            Object.keys(extra).forEach(function (k) { ctx[k] = extra[k]; });
        }
        return ctx;
    }

    global.SoulHallModule = {
        SOUL_MAP_ID: SOUL_MAP_ID,
        init: function (deps) {
            api = deps || {};
        },
        defaultSoulHall: defaultSoulHall,
        mergeDefaults: mergeDefaults,
        ensureFarm: ensureFarm,
        isSoulHallPhase: isSoulHallPhase,
        maybePoll: function (d, p) {
            maybePoll(d, p, makeCtx());
        },
        onBagCountResult: function (result, p) {
            return onBagCountResult(result, p, makeCtx());
        },
        onRuntime: function (d, p) {
            return onRuntime(d, p, makeCtx());
        },
        finishAndContinue: function (p) {
            finishTrip(p, '外部结束', makeCtx());
        },
        resetRuntime: resetRuntime
    };
})(window);