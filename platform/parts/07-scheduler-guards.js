    function isSchedulerActive() {
        return phase === 'FARMING' || phase === 'GOING_FARM' || phase === 'GOING_BOSS' ||
            phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS' ||
            phase === 'GOING_QUNYING' || phase === 'QUNYING' ||
            phase === 'GOING_PANLUAN' || phase === 'PANLUAN' ||
            phase === 'GOING_ACTIVITY_PREP' || phase === 'GOING_ACTIVITY' || phase === 'IN_ACTIVITY' ||
            phase === 'GOING_TASK' || phase === 'DOING_TASK' ||
            phase === 'GOING_RECYCLE' || phase === 'RECYCLING' ||
            phase === 'GOING_SOUL_HALL' || phase === 'SOUL_HALL';
    }

    function isInActivityPhases() {
        return huntKind === 'moying' || phase === 'GOING_QUNYING' || phase === 'QUNYING' ||
            phase === 'GOING_PANLUAN' || phase === 'PANLUAN' ||
            (window.ActivityModule && ActivityModule.isActivePhase(phase));
    }

    function shouldDeferToActivity() {
        return shouldRunMoyingHuntNow() || shouldRunQunyingNow() || shouldRunPanluanNow() ||
            (window.ActivityModule && ActivityModule.anyGenericShouldRun());
    }

    function shouldDeferLowerPriorityForTasks(p) {
        // 任务优先于 Boss/挂机；活动更高，不受此函数阻挡
        return window.TaskModule && TaskModule.shouldRunBeforeBoss(p);
    }

    function isInBossPhases() {
        return phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS';
    }

    /** 活动进行中 / 打 Boss 中途 / 回收中：暂不硬切，结束后立刻接活动 */
    function isActivityJoinBlocked() {
        if (phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS') return true;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return true;
        if (phase === 'GOING_SOUL_HALL' || phase === 'SOUL_HALL') return true;
        if (phase === 'GOING_QUNYING' || phase === 'QUNYING') return true;
        if (phase === 'GOING_PANLUAN' || phase === 'PANLUAN') return true;
        if (huntKind === 'moying' && (phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS')) {
            return true;
        }
        if (window.ActivityModule && ActivityModule.isActivePhase(phase)) return true;
        return false;
    }

    function yieldTasksForActivity(reason) {
        if (phase !== 'GOING_TASK' && phase !== 'DOING_TASK') return;
        if (window.TaskModule && TaskModule.yieldForActivity) {
            TaskModule.yieldForActivity(reason || '活动优先');
        }
        log('活动优先：中断任务' + (reason ? ' ·' + reason : ''));
    }

    /** 仅取消「前往 Boss」；已开打/拾取留给 isActivityJoinBlocked */
    function cancelBossGoForActivity(reason) {
        if (phase !== 'GOING_BOSS' || huntKind === 'moying' || !huntTarget) return false;
        log('活动优先：取消前往 Boss' + (reason ? ' ·' + reason : '') +
            ' ·' + ((huntTarget.bossName || '') + '@' + (huntTarget.mapName || huntTarget.mapId)));
        huntTarget = null;
        huntKind = null;
        huntArrivedAt = 0;
        huntSawBoss = false;
        huntRandomUsed = 0;
        huntBossMissingSince = 0;
        huntBossLastSeenAt = 0;
        resetHuntSpawnState();
        sendCmd('setAutoFight', { type: 3 });
        return true;
    }

    /**
     * 立刻参加当前可跑活动（优先级最高）。
     * 可打断：任务 / 前往 Boss / 挂机；不可硬切：打怪中、拾取、回收、已在活动中。
     */
    function tryJoinOpenActivityNow(reason) {
        if (dailyBurstActive) return false;
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (isActivityJoinBlocked()) return false;

        if (pendingActivityKind) {
            if (tryStartPendingActivity()) return true;
        }

        if (shouldRunMoyingHuntNow() && huntKind !== 'moying') {
            yieldTasksForActivity(reason);
            cancelBossGoForActivity(reason);
            beginMoyingSession();
            return true;
        }
        if (shouldRunQunyingNow() && phase !== 'GOING_QUNYING' && phase !== 'QUNYING') {
            yieldTasksForActivity(reason);
            cancelBossGoForActivity(reason);
            beginQunyingSession();
            return true;
        }
        if (shouldRunPanluanNow() && phase !== 'GOING_PANLUAN' && phase !== 'PANLUAN') {
            yieldTasksForActivity(reason);
            cancelBossGoForActivity(reason);
            beginPanluanSession();
            return true;
        }
        if (window.ActivityModule && !ActivityModule.hasSession()) {
            var gid = ActivityModule.pickNextGeneric();
            if (gid) {
                yieldTasksForActivity(reason);
                cancelBossGoForActivity(reason);
                ActivityModule.beginGeneric(gid, reason || '时段内');
                return true;
            }
        }
        return false;
    }

    /**
     * 活动开启 / 上线检测：立刻参加；若正在打怪/拾取/回收则排队，结束后自动接上。
     * 不再因任务挡路。
     */
    function requestActivityJoin(kind, reason) {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        pendingActivityKind = kind;
        if (isActivityJoinBlocked()) {
            log((reason || '活动') + '：当前忙碌，完成后立刻前往');
            return false;
        }
        if (tryStartPendingActivity()) return true;
        // pending 被条件清掉时，再走通用检测
        return tryJoinOpenActivityNow(reason || '活动优先');
    }

    function isMoyingActivityName(name) {
        return !!name && String(name).indexOf('魔影来袭') >= 0;
    }

    function isMoyingActivityId(id) {
        return MOYING_ACTIVITY_IDS.indexOf(Number(id)) >= 0;
    }

    function isMoyingActivityEv(ev) {
        if (!ev) return false;
        return isMoyingActivityName(ev.name) || isMoyingActivityId(ev.id);
    }

    function isAnyMoyingActivityOpen() {
        for (var i = 0; i < MOYING_ACTIVITY_IDS.length; i++) {
            if (actStateMap[MOYING_ACTIVITY_IDS[i]] === 1) return true;
        }
        return false;
    }

    function isMoyingInWatchList() {
        return selectedActWatch.some(function (w) {
            return isMoyingActivityName(w.name) || isMoyingActivityId(w.id);
        });
    }

    function isQunyingActivityName(name) {
        return !!name && String(name).indexOf('群英汇') >= 0;
    }

    function isQunyingActivityId(id) {
        return QUNYING_ACTIVITY_IDS.indexOf(Number(id)) >= 0;
    }

    function isQunyingActivityEv(ev) {
        if (!ev) return false;
        return isQunyingActivityName(ev.name) || isQunyingActivityId(ev.id);
    }

    function isAnyQunyingActivityOpen() {
        for (var i = 0; i < QUNYING_ACTIVITY_IDS.length; i++) {
            if (actStateMap[QUNYING_ACTIVITY_IDS[i]] === 1) return true;
        }
        return false;
    }

    function isQunyingInWatchList() {
        return selectedActWatch.some(function (w) {
            return isQunyingActivityName(w.name) || isQunyingActivityId(w.id);
        });
    }
    function isPanluanActivityName(name) {
        return !!name && String(name).indexOf('皇陵叛乱') >= 0;
    }

    function isPanluanActivityId(id) {
        return PANLUAN_ACTIVITY_IDS.indexOf(Number(id)) >= 0;
    }

    function isPanluanActivityEv(ev) {
        if (!ev) return false;
        return isPanluanActivityName(ev.name) || isPanluanActivityId(ev.id);
    }

    function isAnyPanluanActivityOpen() {
        for (var i = 0; i < PANLUAN_ACTIVITY_IDS.length; i++) {
            if (actStateMap[PANLUAN_ACTIVITY_IDS[i]] === 1) return true;
        }
        return false;
    }

    function isPanluanInWatchList() {
        return selectedActWatch.some(function (w) {
            return isPanluanActivityName(w.name) || isPanluanActivityId(w.id);
        });
    }

    function shouldRunPanluanNow() {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (!isPanluanInWatchList()) return false;
        if (panluanRoundCompleted) return false;
        return isAnyPanluanActivityOpen();
    }

    function shouldRunQunyingNow(d) {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (!isQunyingInWatchList()) return false;
        if (qunyingRoundCompleted) return false;
        if (!isAnyQunyingActivityOpen()) return false;
        d = d || lastRuntimeSnapshot;
        if (d && d.qunying) {
            if (d.qunying.ended) return false;
            if (!d.qunying.open && !qunyingSessionActive) return false;
        }
        return true;
    }

    function shouldRunMoyingHuntNow() {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (!isMoyingInWatchList()) return false;
        if (moyingRoundCompleted) return false;
        return isAnyMoyingActivityOpen();
    }

    function shuffleArray(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i];
            a[i] = a[j];
            a[j] = t;
        }
        return a;
    }

    function findMoyingMap(mapId) {
        for (var i = 0; i < MOYING_MAP_POOL.length; i++) {
            if (Number(MOYING_MAP_POOL[i].mapId) === Number(mapId)) return MOYING_MAP_POOL[i];
        }
        return null;
    }

    function resetMoyingSession() {
        moyingMapQueue = [];
        moyingClearedMaps = {};
        moyingBoughtForMap = false;
        moyingKillsOnMap = 0;
        moyingSessionActive = false;
        if (huntKind === 'moying') huntKind = null;
    }

    function setSchedulerTickInterval(ms) {
        schedulerTickMs = ms;
        if (!schedulerTimer) return;
        clearInterval(schedulerTimer);
        schedulerTimer = setInterval(tickScheduler, schedulerTickMs);
    }

    function enterQunyingFastMode() {
        setSchedulerTickInterval(QUNYING_TICK_MS);
        sendCmd('setQunyingTurbo', { enabled: true, reset: true });
    }

    function leaveQunyingFastMode() {
        sendCmd('setQunyingTurbo', { enabled: false });
        setSchedulerTickInterval(SCHEDULER_TICK_MS);
    }

    function onQunyingAnsweredEvent(payload) {
        payload = payload || {};
        var cfgId = Number(payload.cfgId) || 0;
        if (cfgId) qunyingLastAnsweredCfgId = cfgId;
        qunyingLastAnswerTs = Date.now();
        var react = payload.reactMs != null ? (' ·' + payload.reactMs + 'ms') : '';
        var src = payload.source === 'updateDaTiInfo' ? '协议' :
            (payload.source === 'poll50' ? '轮询' : (payload.source || ''));
        log('群英汇抢答：第' + (payload.currentNum || '?') + '题 → ' +
            (payload.answer || '') + react + (src ? (' ·' + src) : ''));
        setStatus('云游平台：群英汇抢答 ·第' + (payload.currentNum || '?') + '题' + react, 'running');
    }

    function resetQunyingSession() {
        qunyingSessionActive = false;
        qunyingLastAnsweredCfgId = 0;
        qunyingLastAnswerTs = 0;
        qunyingFoodEquipped = false;
        qunyingStartedAt = 0;
        qunyingPendingGoUntil = 0;
        qunyingTeleportAttempts = 0;
    }

    function markQunyingRoundDone() {
        qunyingRoundCompleted = true;
        qunyingSessionActive = false;
        if (pendingActivityKind === 'qunying') pendingActivityKind = null;
    }

    function markMoyingRoundDone() {
        moyingRoundCompleted = true;
        moyingSessionActive = false;
        if (pendingActivityKind === 'moying') pendingActivityKind = null;
    }

    function requestQunyingTeleport(reason) {
        qunyingTeleportAttempts++;
        var useFallback = qunyingTeleportAttempts >= 2;
        log('群英汇：请求进入行会领地' + (reason ? ' ·' + reason : '') +
            '（第' + qunyingTeleportAttempts + '次' + (useFallback ? '·含deliver兜底' : '·send72') + '）');
        sendCmd('goQunyingGuild', {
            reason: reason || '',
            attempt: qunyingTeleportAttempts,
            useDeliverFallback: useFallback
        });
    }

    function tryStartPendingActivity() {
        if (!pendingActivityKind) return false;
        // 活动优先于任务：不再因任务挡路；打怪/拾取/回收中仍由 isActivityJoinBlocked 延后
        if (isActivityJoinBlocked()) return false;
        var kind = pendingActivityKind;
        if (kind === 'moying' && shouldRunMoyingHuntNow()) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办魔影');
            cancelBossGoForActivity('待办魔影');
            beginMoyingSession();
            return true;
        }
        if (kind === 'qunying' && shouldRunQunyingNow()) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办群英汇');
            cancelBossGoForActivity('待办群英汇');
            beginQunyingSession();
            return true;
        }
        if (kind === 'panluan' && shouldRunPanluanNow()) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办皇陵叛乱');
            cancelBossGoForActivity('待办皇陵叛乱');
            beginPanluanSession();
            return true;
        }
        if (typeof kind === 'number' && window.ActivityModule && ActivityModule.shouldRunGeneric(kind)) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办活动');
            cancelBossGoForActivity('待办活动');
            ActivityModule.beginGeneric(kind, '待办活动');
            return true;
        }
        if (!shouldRunMoyingHuntNow() && !shouldRunQunyingNow() && !shouldRunPanluanNow() &&
            !(window.ActivityModule && ActivityModule.anyGenericShouldRun())) {
            pendingActivityKind = null;
