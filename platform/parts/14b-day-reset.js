    /**
     * 服日切（0 点）集中处理：重置内部记录器，必要时打断当前行为并启动当日任务。
     * 触发通道：heartbeat dayReset / runtime dayKey 变化 / activityEvent reset
     */

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

    /**
     * 硬切当前相位，为当日任务让路（比活动 join 更激进）。
     * 调用前应已设置 dailyBurstActive，避免 resumeFarmAfterHunt 再去接活动。
     */
    function interruptForDailyTasks(reason) {
        reason = reason || '日切';
        try { sendCmd('setAutoFight', { type: 3 }); } catch (e1) {}
        try { sendCmd('endLootMode'); } catch (e2) {}
        hideLootTimerBar();

        if (phase === 'GOING_QUNYING' || phase === 'QUNYING' || qunyingSessionActive) {
            finishQunyingSession(reason);
        }
        if (phase === 'GOING_PANLUAN' || phase === 'PANLUAN' || panluanSessionActive) {
            finishPanluanSession(reason);
        }
        if (window.ActivityModule && ActivityModule.hasSession && ActivityModule.hasSession()) {
            ActivityModule.finishGeneric(reason);
        }
        if (isInBossPhases() || huntKind === 'moying' || huntTarget) {
            finishHunt(reason);
        } else {
            cancelBossGoForActivity(reason);
        }

        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') {
            pendingGoRecycleUntil = 0;
            recycleStartedAt = 0;
            recycleActionAt = 0;
            recycleRetried = false;
            recycleLeftMapId = 0;
            pendingBossAfterRecycle = null;
            log('[日切] 中断回收流程');
        }

        huntQueue = [];
        huntTarget = null;
        huntKind = null;
        pendingActivityKind = null;
        pendingBossAfterRecycle = null;
        huntFailCooldown = {};
        postHuntAliveCooldown = {};
        huntGoRetryCount = {};
        lootUntil = 0;
        lootStartedAt = 0;
        lootEmptyTicks = 0;
        lootPendingDrop = false;
        resetHuntSpawnState();

        if (window.TaskModule && TaskModule.abortCurrent) {
            TaskModule.abortCurrent(reason);
        }
        log('[日切] 已打断当前行为' + (reason ? ' ·' + reason : ''));
    }

    /**
     * 唯一日切入：重置记录器 →（任务优先时）打断并启动任务 → 立即日常福利
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

        if (dayKey) {
            lastHandledDayKey = dayKey;
            lastServerDayKey = dayKey;
        }

        log('[日切] 服日更新 ·触发=' + trigger + (dayKey ? (' ·dayKey=' + dayKey) : ''));

        if (!isSchedulerActive()) {
            return;
        }

        var p = (typeof readEditor === 'function' ? readEditor() : null) || getActive();
        var willRunTasks = !!(window.TaskModule && TaskModule.isTaskPriority(p));

        // ---- 阶段 1：记录器重置 ----
        if (window.TaskModule && TaskModule.onDayReset) {
            TaskModule.onDayReset({ abortCurrent: willRunTasks });
        }
        qunyingRoundCompleted = false;
        moyingRoundCompleted = false;
        panluanRoundCompleted = false;
        lastDailyChoresTs = 0;
        lastBagAssistTs = 0;
        if (window.FarmTacticsModule && FarmTacticsModule.resetRuntime) {
            FarmTacticsModule.resetRuntime();
        }

        if (willRunTasks) {
            dailyBurstActive = true;
            setStatus('日切：重置记录器 / 启动任务队列', 'running');
            // ---- 阶段 2：打断 ----
            interruptForDailyTasks('日切');
            if (window.ActivityModule && ActivityModule.resetAll) {
                ActivityModule.resetAll();
            }
            // ---- 阶段 3：启动当日任务 ----
            TaskModule.startRunner(p);
            if (TaskModule.hasPendingTasks(p)) {
                TaskModule.beginNextTask();
                log('[日切] 已启动任务队列（任务优先）');
            } else {
                dailyBurstActive = false;
                log('[日切] 任务优先已开但无待办项');
            }
        } else {
            dailyBurstActive = false;
            if (window.ActivityModule) {
                if (ActivityModule.resetDoneFlags) {
                    ActivityModule.resetDoneFlags();
                } else if (!ActivityModule.hasSession || !ActivityModule.hasSession()) {
                    if (ActivityModule.resetAll) ActivityModule.resetAll();
                }
            }
            log('[日切] 未开任务优先：仅重置记录器与福利', 'verbose');
        }

        // ---- 阶段 4：日常福利立即触发 ----
        forceDailyChores(p);
        sendCmd('getDailyActivities', {});
    }
