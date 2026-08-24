    /**
     * 服日切（0 点）：回盟重 → 停挂机 → 10 秒后重新启动。
     * 触发通道：heartbeat dayReset / runtime dayKey 变化 / activityEvent reset
     */
    var MENGZHONG_MAP_ID = 154;
    var DAY_RESET_RESTART_MS = 10000;

    function resolveDayKey(opts) {
        opts = opts || {};
        if (opts.dayKey) return String(opts.dayKey);
        if (opts.server && opts.server.dayKey) return String(opts.server.dayKey);
        if (lastRuntimeSnapshot && lastRuntimeSnapshot.server && lastRuntimeSnapshot.server.dayKey) {
            return String(lastRuntimeSnapshot.server.dayKey);
        }
        return '';
    }

    function shouldSkipDayKey(dayKey) {
        if (!dayKey) return false;
        if (dayKey === lastHandledDayKey) return true;
        if (lastHandledDayKey && !isNaN(Number(dayKey)) && !isNaN(Number(lastHandledDayKey)) &&
            Number(dayKey) < Number(lastHandledDayKey)) {
            return true;
        }
        return false;
    }

    /** 主循环兜底：比对 getRuntimeState().server.dayKey */
    function checkServerDayRoll(d) {
        if (!d || !d.server || !d.server.dayKey) return;
        var key = String(d.server.dayKey);
        if (!lastServerDayKey) {
            lastServerDayKey = key;
            lastHandledDayKey = key;
            return;
        }
        if (key !== lastServerDayKey) {
            onServerDayReset({ trigger: 'runtime', dayKey: key, server: d.server });
        }
    }

    /** 日切突发窗口结束条件：任务队列 done，或未开任务优先 */
    function maybeClearDailyBurst(p) {
        if (!dailyBurstActive) return;
        p = p || (typeof readEditor === 'function' ? readEditor() : getActive());
        if (!window.TaskModule || !TaskModule.isTaskPriority(p)) {
            dailyBurstActive = false;
            return;
        }
        var rs = TaskModule.getRunnerState ? TaskModule.getRunnerState() : '';
        if (rs === 'done') {
            dailyBurstActive = false;
            log('[日切] 任务突发窗口结束', 'verbose');
        }
    }

    function resolveMengzhongMapId() {
        try {
            var maps = catalog && catalog.maps;
            if (maps && maps.length) {
                for (var i = 0; i < maps.length; i++) {
                    if (maps[i] && maps[i].name === '盟重' && maps[i].id) {
                        return Number(maps[i].id);
                    }
                }
            }
        } catch (e) {}
        return MENGZHONG_MAP_ID;
    }

    function returnToMengzhong() {
        var d = lastRuntimeSnapshot;
        if (d && d.inDuplicate) {
            try { sendCmd('exitDuplicate', {}); } catch (e1) {}
        }
        var mid = resolveMengzhongMapId();
        var cur = d && d.map && d.map.mapId != null ? Number(d.map.mapId) : 0;
        if (cur !== mid) {
            sendCmd('goMap', { type: 'auto', mapId: mid });
            log('[日切] 回盟重 → ' + (mapNameById(mid) || mid));
        } else {
            log('[日切] 已在盟重');
        }
    }

    /**
     * 唯一日切入：回盟重并停挂机，10 秒后重新启动（启动时会自然重置记录器）。
     */
    function onServerDayReset(opts) {
        opts = opts || {};
        var trigger = opts.trigger || 'unknown';
        var dayKey = resolveDayKey(opts);

        if (!dayKey) {
            log('[日切] 缺少 dayKey，跳过 ·触发=' + trigger, 'verbose');
            return;
        }
        if (shouldSkipDayKey(dayKey)) return;

        // 首次见到该服日：只记账，不重启（避免进游戏首包误触发）
        if (!lastHandledDayKey) {
            lastHandledDayKey = dayKey;
            lastServerDayKey = dayKey;
            return;
        }

        lastHandledDayKey = dayKey;
        lastServerDayKey = dayKey;

        log('[日切] 服日更新 ·触发=' + trigger + ' ·dayKey=' + dayKey);

        if (!isSchedulerActive()) {
            return;
        }

        returnToMengzhong();
        if (typeof window.stopScheduler === 'function') window.stopScheduler();
        setStatus('日切：已停挂机，' + (DAY_RESET_RESTART_MS / 1000) + '秒后重启', 'running');
        log('[日切] 已停止挂机，' + (DAY_RESET_RESTART_MS / 1000) + '秒后自动启动');

        cancelDayResetRestart();
        dayResetRestartTimer = setTimeout(function () {
            dayResetRestartTimer = null;
            if (isSchedulerActive()) return;
            log('[日切] 自动重新启动挂机');
            if (typeof window.startScheduler === 'function') window.startScheduler();
        }, DAY_RESET_RESTART_MS);
    }
