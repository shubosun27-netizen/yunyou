
    function onRuntimeLoot(d, p) {
        var now = Date.now();
        var left = Math.max(0, Math.ceil((lootUntil - now) / 1000));
        var totalSec = Math.max(1, Math.ceil((lootUntil - (lootStartedAt || now)) / 1000));
        var drops = d.dropCount != null ? Number(d.dropCount) : -1;
        var petHint = d.autoPet ? ' ·灵宠吸物' : '';
        setStatus('云游平台：系统自动战斗 ·等待拾取' + left + 's' + petHint +
            (drops >= 0 ? (' ·掉落' + drops) : '') +
            (huntTarget ? (' ·' + (huntTarget.bossName || '')) : ''), 'running');
        updateLootTimerBar({
            show: true,
            leftSec: left,
            totalSec: totalSec,
            bossName: huntTarget ? huntTarget.bossName : '',
            drops: drops
        });

        // 仅保证自动战斗开着、挡住超级挂机选怪；不强制 AutoPick / 不改灵宠
        sendCmd('maintainLootMode');

        if (huntTarget) {
            var cur = d.map && d.map.mapId;
            if (cur != null && !isOnHuntTargetMap(cur, huntTarget)) {
                finishHunt('拾取中离开Boss图');
                return;
            }
        }

        // 掉落已空：宽限约 2s 后提前结束（不必撑满 lootSec）
        if (drops === 0 && now - lootStartedAt >= 2000) {
            lootEmptyTicks++;
            if (lootEmptyTicks >= 2) {
                finishHunt('拾取完成(无掉落)');
                return;
            }
        } else if (drops > 0) {
            lootEmptyTicks = 0;
        }

        if (now >= lootUntil) {
            finishHunt('拾取完成');
        }
    }

    function onMonsterListForHunt(list) {
        huntPendingMonster = false;
        huntPendingMonsterSince = 0;
        if (phase !== 'HUNTING_BOSS' && phase !== 'GOING_BOSS') return;
        if (!huntTarget) return;

        if (!huntSawBoss) {
            ensureHuntTargetBossMeta(huntTarget);
            var found = findBossFromMonsterList(list);
            var alives = [];
            if (!found) {
                (list || []).forEach(function (m) {
                    if (isMonsterAliveForHunt(m)) alives.push(m);
                });
            }
            // 魔影随机清查：只打魔影巨人，禁止把视野内单只小怪当 Boss
            if (!found && huntKind !== 'moying' && huntUseRandomFallback && alives.length === 1) {
                found = alives[0];
            }
            if (found) {
                var reason = huntMovingToSpawn ? '寻路途中视野发现' :
                    (huntAtSpawnSince ? '刷新点附近发现' :
                        (huntUseRandomFallback ? ('随机寻怪 ' + huntRandomUsed + ' 次') : '视野发现'));
                lockHuntBoss(found, reason);
            } else {
                logBossScanMiss(list, huntMovingToSpawn ? '寻路' : (huntAtSpawnSince ? '刷新点' : '全图'));
            }
            return;
        }

        // 已锁定：仅 isDead 或视野消失可判定击杀（勿用 hp<=0，游戏 fo.hp 常为 0）
        var deadMatch = null;
        var aliveMatch = null;
        (list || []).forEach(function (m) {
            if (!m || !matchHuntBossIdentity(m)) return;
            if (m.isDead) deadMatch = m;
            else aliveMatch = m;
        });
        if (deadMatch && canConfirmBossKill()) {
            onBossKilledSignal('Boss已死亡(视野)');
            return;
        }
        if (aliveMatch) {
            huntBossMissingSince = 0;
            huntBossLastSeenAt = Date.now();
            var ahp = Number(aliveMatch.hp);
            if (!isNaN(ahp) && ahp >= 0) {
                if (huntBossLastHp < 0 || ahp < huntBossLastHp) {
                    huntBossHpProgressAt = Date.now();
                }
                huntBossLastHp = ahp;
            }
            return;
        }
        if (!huntBossMissingSince) huntBossMissingSince = Date.now();
        if (canConfirmBossKill() && Date.now() - huntBossMissingSince >= 1500) {
            onBossKilledSignal('Boss从视野消失');
        }
    }

    window.startScheduler = function () {
        saveProfile();
        var p = getActive();
        if (!p.farm.mapId) { log('请先选择挂机地图'); return; }
        cancelDayResetRestart();
        huntQueue = [];
        huntTarget = null;
        huntKind = null;
        resetMoyingSession();
        resetQunyingSession();
        resetPanluanSession();
        qunyingRoundCompleted = false;
        panluanRoundCompleted = false;
        if (window.ActivityModule) ActivityModule.resetAll();
        if (window.FarmTacticsModule && FarmTacticsModule.resetRuntime) FarmTacticsModule.resetRuntime();
        pendingActivityKind = null;
        pendingBossAfterRecycle = null;
        lastRuntimeSnapshot = null;
        dailyBurstActive = false;
        bossAliveKnown = {};
        postHuntAliveCooldown = {};
        huntGoRetryCount = {};
        pendingGoFarmUntil = 0;
        pendingGoBossUntil = 0;
        pendingGoRecycleUntil = 0;
        recycleStartedAt = 0;
        recycleActionAt = 0;
        recycleRetried = false;
        recycleLeftMapId = 0;
        lastNpcRecycleTs = 0;
        lootUntil = 0;
        lootStartedAt = 0;
        lootEmptyTicks = 0;
        lootPendingDrop = false;
        moyingRoundCompleted = false;
        // 活动 > 任务 > Boss > 挂机：先去挂机图并拉活动状态；有进行中的活动则立刻参加
        setPhase('GOING_FARM');
        if (window.TaskModule) {
            TaskModule.resetRunner();
            // 任务队列先装好，等活动检测未命中后再由 farm gate / 循环启动
            if (TaskModule.isTaskPriority(getActive()) && TaskModule.hasPendingTasks(getActive())) {
                TaskModule.startRunner(getActive());
                log('任务队列已就绪（活动优先，有活动时先去活动）');
            }
        }
        setStatus('云游平台：调度已启动', 'running');
        log('启动：' + p.name + ' → ' + (mapNameById(p.farm.mapId) || p.farm.mapId) +
            (p.boss && p.boss.enabled ? ' ·Boss猎杀开(击杀后先拾取再回挂机)' : ''));
        lastBagAssistTs = 0;
        lastAutoSmeltTs = 0;
        lastAutoUseTs = 0;
        lastAutoRecycleTs = 0;
        lastAutoDiscardTs = 0;
        lastAutoStoreTs = 0;
        lastAutoBuyTs = 0;
        lastDailyChoresTs = 0;
        lastAuctionAutoTs = 0;
        lastBossPollTs = 0;
        // 启动时清掉可能残留的拾取劫持
        sendCmd('endLootMode');
        sendCmd('setBagAutoFlags', {
            recycle: !!(p.bag.autoRecycle && p.bag.autoRecycle.enabled),
            smelt: !!(p.bag.autoSmelt && p.bag.autoSmelt.enabled)
        });
        syncAuctionAutoConfig(p);
        if (window.PkModule && PkModule.syncToGame) PkModule.syncToGame(p, true);
        // 先回/去挂机图；活动检测在 getDailyActivities 回包与主循环中立刻触发
        pendingGoFarmUntil = Date.now() + 5000;
        sendCmd('goMap', {
            type: 'auto',
            mapId: getFarmTargetMapId(p),
            deliverId: p.farm.deliverId || 0
        });
        sendCmd('getDailyActivities', {});
        if (p.boss && p.boss.enabled) {
            sendCmd('requestShoulingBoss', {});
            setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 800);
        }
        if (schedulerTimer) clearInterval(schedulerTimer);
        schedulerTickMs = SCHEDULER_TICK_MS;
        schedulerTimer = setInterval(tickScheduler, schedulerTickMs);
        tickScheduler();
    };

    window.pauseScheduler = function () {
        setPhase('PAUSED');
        setStatus('云游平台：已暂停');
        log('调度已暂停');
    };

    window.stopScheduler = function () {
        cancelDayResetRestart();
        if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
        leaveQunyingFastMode();
        huntQueue = [];
        huntTarget = null;
        huntKind = null;
