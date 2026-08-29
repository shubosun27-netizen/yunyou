/**
 * 日常活动通用调度（layout-preview 父页面）
 * 魔影/群英汇/皇陵叛乱/行会首领由 layout-preview 专用逻辑处理；其余关注活动走本模块。
 */
(function (global) {
    'use strict';

    var api = {};

    var MOYING_IDS = { 4: 1, 5: 1, 6: 1, 24: 1, 25: 1, 26: 1 };
    var QUNYING_IDS = { 11: 1 };
    var PANLUAN_IDS = { 15: 1, 16: 1, 17: 1, 18: 1 };
    var HANGHUI_IDS = { 9: 1, 10: 1 };
    var NO_LINK_IDS = { 3: 1, 14: 1, 16: 1, 18: 1, 24: 1, 25: 1, 26: 1, 60: 1, 72: 1 };

    var genericDone = {};
    var session = null;
    var prepFarmUntil = 0;
    var joinUntil = 0;
    var joinMapBefore = 0;

    var MIN_STAY_MS = 45000;
    var MAX_STAY_MS = 20 * 60 * 1000;
    var PREP_FARM_MS = 8000;
    var JOIN_WAIT_MS = 12000;

    function log(msg, level) { if (api.log) api.log(msg, level); }
    function sendCmd(a, p) { if (api.sendCmd) api.sendCmd(a, p); }
    function getActive() { return api.getActive ? api.getActive() : null; }
    function setPhase(p) { if (api.setPhase) api.setPhase(p); }
    function setStatus(t, c) { if (api.setStatus) api.setStatus(t, c); }
    function actStateMap() {
        if (api.getActStateMap) return api.getActStateMap();
        return api.actStateMap || {};
    }
    function selectedWatch() {
        if (api.getSelectedActWatch) return api.getSelectedActWatch();
        return api.selectedActWatch || [];
    }
    function lastSnap() {
        if (api.getLastRuntimeSnapshot) return api.getLastRuntimeSnapshot();
        return api.lastRuntimeSnapshot || null;
    }
    function catalog() {
        if (api.getActivityCatalog) return api.getActivityCatalog();
        return api.activityCatalog || [];
    }

    function isSpecializedId(id) {
        id = Number(id);
        return !!MOYING_IDS[id] || !!QUNYING_IDS[id] || !!PANLUAN_IDS[id] || !!HANGHUI_IDS[id];
    }

    function findWatch(id) {
        id = Number(id);
        for (var i = 0; i < selectedWatch().length; i++) {
            if (Number(selectedWatch()[i].id) === id) return selectedWatch()[i];
        }
        return null;
    }

    function findCatalog(id) {
        id = Number(id);
        var list = catalog();
        for (var i = 0; i < list.length; i++) {
            if (Number(list[i].id) === id) return list[i];
        }
        return null;
    }

    function isOpen(id) {
        return actStateMap()[id] === 1 || actStateMap()[String(id)] === 1;
    }

    function hasLink(id) {
        if (NO_LINK_IDS[id] || NO_LINK_IDS[String(id)]) return false;
        var c = findCatalog(id);
        return !!(c && c.link);
    }

    function autoGoEnabled() {
        var el = api.$ ? api.$('actAutoGo') : document.getElementById('actAutoGo');
        return !!(el && el.checked);
    }

    function schedulerActive() {
        return api.isSchedulerActive ? api.isSchedulerActive() : false;
    }

    function inBossPhases() {
        return api.isInBossPhases ? api.isInBossPhases() : false;
    }

    function clearSession() {
        session = null;
        prepFarmUntil = 0;
        joinUntil = 0;
        joinMapBefore = 0;
    }

    function markDone(id, reason) {
        genericDone[id] = true;
        genericDone[String(id)] = true;
        if (reason) log('活动完成：' + (findWatch(id) ? findWatch(id).name : id) + ' ·' + reason);
    }

    function clearDone(id) {
        delete genericDone[id];
        delete genericDone[String(id)];
    }

    function shouldRunGeneric(id, d) {
        id = Number(id);
        if (!autoGoEnabled() || !schedulerActive()) return false;
        if (!findWatch(id)) return false;
        if (isSpecializedId(id)) return false;
        if (genericDone[id] || genericDone[String(id)]) return false;
        if (!isOpen(id)) return false;
        if (!hasLink(id)) return false;
        if (api.shouldRunMoyingHuntNow && api.shouldRunMoyingHuntNow()) return false;
        if (api.shouldRunQunyingNow && api.shouldRunQunyingNow(d)) return false;
        return true;
    }

    function pickNextGeneric(d) {
        d = d || lastSnap();
        var best = null;
        var bestPri = -1;
        for (var i = 0; i < selectedWatch().length; i++) {
            var w = selectedWatch()[i];
            if (!w || w.id == null) continue;
            var id = Number(w.id);
            if (!shouldRunGeneric(id, d)) continue;
            var pri = w.priority != null ? Number(w.priority) : (1000 - id);
            if (pri > bestPri) {
                bestPri = pri;
                best = id;
            }
        }
        return best;
    }

    function anyGenericShouldRun(d) {
        return pickNextGeneric(d) != null;
    }

    function needsFarmPrep(d, p) {
        d = d || lastSnap();
        p = p || getActive();
        if (!d || !p || !p.farm || !p.farm.mapId) return false;
        if (d.inDuplicate) return true;
        var farm = Number(p.farm.mapId);
        var cur = d.map && d.map.mapId != null ? Number(d.map.mapId) : 0;
        if (!cur || cur === farm) return false;
        if (session && session.targetMapId && cur === Number(session.targetMapId)) return false;
        return true;
    }

    function resolveTargetMapId(cat) {
        if (!cat) return 0;
        if (cat.targetMapId) return Number(cat.targetMapId) || 0;
        if (cat.param) {
            var pid = parseInt(String(cat.param).split(/[#&]/)[0], 10) || 0;
            return pid || 0;
        }
        return 0;
    }

    function beginGeneric(activityId, reason) {
        activityId = Number(activityId);
        if (!shouldRunGeneric(activityId)) return false;
        if (session && session.id === activityId) return false;
        var w = findWatch(activityId);
        var cat = findCatalog(activityId);
        session = {
            id: activityId,
            name: (w && w.name) || (cat && cat.name) || ('活动' + activityId),
            link: cat && cat.link,
            startedAt: Date.now(),
            joinedAt: 0,
            targetMapId: resolveTargetMapId(cat),
            joinRetries: 0
        };
        log('活动：开始「' + session.name + '」' + (reason ? ' ·' + reason : '') +
            (session.targetMapId ? (' ·图' + session.targetMapId) : ''));
        sendCmd('setAutoFight', { type: 3 });
        var d = lastSnap();
        var p = getActive();
        if (needsFarmPrep(d, p)) {
            session.prepFarm = true;
            prepFarmUntil = Date.now() + PREP_FARM_MS;
            setPhase('GOING_ACTIVITY_PREP');
            setStatus('云游平台：活动前回挂机 ·' + session.name, 'running');
            if (api.returnToFarmMap) api.returnToFarmMap(p, '活动前回挂机');
            return true;
        }
        return requestJoin('会话开始');
    }

    function requestJoin(reason) {
        if (!session) return false;
        joinMapBefore = (lastSnap() && lastSnap().map) ? Number(lastSnap().map.mapId) : 0;
        joinUntil = Date.now() + JOIN_WAIT_MS;
        setPhase('GOING_ACTIVITY');
        setStatus('云游平台：前往 ·' + session.name, 'running');
        log('活动：请求进入「' + session.name + '」' + (reason ? ' ·' + reason : ''));
        sendCmd('joinDailyActivity', { id: session.id, reason: reason || '' });
        return true;
    }

    function finishGeneric(reason) {
        if (!session) {
            clearSession();
            return;
        }
        var id = session.id;
        var name = session.name;
        markDone(id, reason || '结束');
        log('活动结束：' + name + (reason ? ' ·' + reason : ''));
        clearSession();
        sendCmd('setAutoFight', { type: 3 });
        var d = lastSnap();
        if (d && d.inDuplicate) {
            sendCmd('exitDuplicate', {});
        }
        if (api.resumeFarmAfterHunt) api.resumeFarmAfterHunt();
        else if (api.returnToFarmMap) api.returnToFarmMap(getActive(), '活动后回挂机');
    }

    function onRuntime(d, p) {
        if (!session) return false;
        d = d || lastSnap();
        p = p || getActive();
        var now = Date.now();
        var phase = api.getPhase ? api.getPhase() : '';

        if (!isOpen(session.id)) {
            finishGeneric('活动时段结束');
            return true;
        }

        if (phase === 'GOING_ACTIVITY_PREP' || session.prepFarm) {
            var farm = p && p.farm ? Number(p.farm.mapId) : 0;
            var cur = d && d.map ? Number(d.map.mapId) : 0;
            if (d && d.inDuplicate) {
                sendCmd('exitDuplicate', {});
                return true;
            }
            if (farm && cur === farm) {
                session.prepFarm = false;
                return requestJoin('已回挂机');
            }
            if (now > prepFarmUntil + PREP_FARM_MS) {
                log('活动：回挂机超时，仍尝试进入「' + session.name + '」');
                session.prepFarm = false;
                return requestJoin('回挂机超时');
            }
            return true;
        }

        if (phase === 'GOING_ACTIVITY') {
            var curMap = d && d.map ? Number(d.map.mapId) : 0;
            var joined = false;
            if (d && d.inDuplicate) joined = true;
            if (joinMapBefore && curMap && curMap !== joinMapBefore) joined = true;
            if (session.targetMapId && curMap === session.targetMapId) joined = true;
            if (joined) {
                session.joinedAt = now;
                setPhase('IN_ACTIVITY');
                setStatus('云游平台：活动中 ·' + session.name, 'running');
                sendCmd('setAutoFight', { type: 1 });
                if (p && p.farm && p.farm.guajiType != null) {
                    sendCmd('setGuajiType', { type: p.farm.guajiType || 0 });
                }
                if (p && p.farm && p.farm.autoPick !== false) {
                    sendCmd('ensureFarmPickup', { enabled: true });
                }
                return true;
            }
            if (now > joinUntil) {
                session.joinRetries = (session.joinRetries || 0) + 1;
                if (session.joinRetries > 3) {
                    finishGeneric('进入失败');
                    return true;
                }
                log('活动：进入超时「' + session.name + '」，重试 ' + session.joinRetries + '/3');
                return requestJoin('进入超时重试');
            }
            return true;
        }

        if (phase === 'IN_ACTIVITY') {
            if (d && d.autoFightType !== 1) {
                sendCmd('setAutoFight', { type: 1 });
            }
            var elapsed = now - (session.joinedAt || session.startedAt);
            if (elapsed >= MAX_STAY_MS) {
                finishGeneric('停留超时');
                return true;
            }
            if (!isOpen(session.id) && elapsed >= MIN_STAY_MS) {
                finishGeneric('活动已结束');
                return true;
            }
            return true;
        }

        return false;
    }

    function onActivityStart(ev) {
        if (!ev || ev.id == null) return;
        clearDone(ev.id);
    }

    function onActivityEnd(ev) {
        if (!ev || ev.id == null) return;
        markDone(ev.id, '日历结束');
        if (session && Number(session.id) === Number(ev.id)) {
            finishGeneric('活动结束');
        }
    }

    function beginById(activityId, reason) {
        activityId = Number(activityId);
        if (isSpecializedId(activityId)) return false;
        return beginGeneric(activityId, reason);
    }

    function isActivePhase(phase) {
        return phase === 'GOING_ACTIVITY_PREP' || phase === 'GOING_ACTIVITY' || phase === 'IN_ACTIVITY';
    }

    function resetAll() {
        clearSession();
        genericDone = {};
    }

    /** 仅清空完成标记，不打断进行中的活动会话（日切且未开任务优先时） */
    function resetDoneFlags() {
        genericDone = {};
    }

    function setSessionTargetMap(mapId) {
        mapId = Number(mapId) || 0;
        if (!session || !mapId) return;
        session.targetMapId = mapId;
    }

    global.ActivityModule = {
        init: function (deps) {
            api = deps || {};
        },
        MOYING_IDS: MOYING_IDS,
        QUNYING_IDS: QUNYING_IDS,
        PANLUAN_IDS: PANLUAN_IDS,
        HANGHUI_IDS: HANGHUI_IDS,
        NO_LINK_IDS: NO_LINK_IDS,
        isSpecializedId: isSpecializedId,
        shouldRunGeneric: shouldRunGeneric,
        pickNextGeneric: pickNextGeneric,
        anyGenericShouldRun: anyGenericShouldRun,
        beginGeneric: beginGeneric,
        beginById: beginById,
        onRuntime: onRuntime,
        onActivityStart: onActivityStart,
        onActivityEnd: onActivityEnd,
        finishGeneric: finishGeneric,
        isActivePhase: isActivePhase,
        hasSession: function () { return !!session; },
        setSessionTargetMap: setSessionTargetMap,
        resetAll: resetAll,
        resetDoneFlags: resetDoneFlags,
        markDone: markDone,
        clearDone: clearDone
    };
})(typeof window !== 'undefined' ? window : this);
