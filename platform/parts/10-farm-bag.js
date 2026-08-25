    function abandonHunt(reason) {
        finishHunt(reason || '放弃');
    }

    function getFarmTargetMapId(p) {
        if (window.FarmTacticsModule && FarmTacticsModule.getFarmTargetMapId) {
            return FarmTacticsModule.getFarmTargetMapId(p);
        }
        return p && p.farm ? p.farm.mapId : 0;
    }

    function farmTacticsCtx(extra) {
        var ctx = {
            phase: phase,
            log: log,
            sendCmd: sendCmd,
            setPhase: setPhase,
            pendingGoFarmUntil: function (ts) { pendingGoFarmUntil = ts; },
            mapNameById: mapNameById,
            huntSawBoss: huntSawBoss,
            abandonHunt: abandonHunt
        };
        if (extra) {
            Object.keys(extra).forEach(function (k) { ctx[k] = extra[k]; });
        }
        return ctx;
    }

    function runFarmTacticsRuntime(d, p, extra) {
        if (!window.FarmTacticsModule || !FarmTacticsModule.onRuntime) return false;
        return !!FarmTacticsModule.onRuntime(d, p, farmTacticsCtx(extra));
    }

    function pickNextAliveWatch(excludeKey) {
        // 仅用于诊断/兼容；调度不再用它直接 beginHunt
        for (var i = 0; i < selectedBossWatch.length; i++) {
            var w = selectedBossWatch[i];
            if (excludeKey && w.key === excludeKey) continue;
            if (huntFailCooldown[w.key] && Date.now() < huntFailCooldown[w.key]) continue;
            var alive = getWatchAliveStatus(w);
            if (Number(alive) > 0) return w;
        }
        return null;
    }

    function maybeUseRandomStone(p) {
        if (!huntTarget || huntSawBoss || !huntArrivedAt) return;
        if (phase !== 'HUNTING_BOSS' && phase !== 'GOING_BOSS') return;
        if (!huntUseRandomFallback) return;
        var max = getRandomSearchMax(p);
        if (huntRandomUsed >= max) {
            if (huntKind === 'moying') {
                finishMoyingHunt('随机' + max + '次未发现魔影巨人');
            } else {
                abandonHunt('随机' + max + '次未找到');
            }
            return;
        }
        var interval = (p.boss && p.boss.randomIntervalMs) || 1500;
        var now = Date.now();
        if (now - lastRandomTs < interval) return;
        if (now - huntArrivedAt < 800) return;
        // 购买回包未到：先别连点使用，避免空耗次数
        if (now < randomBuyPendingUntil) return;
        lastRandomTs = now;
        if (huntKind === 'moying') sendCmd('setAutoFight', { type: 3 });
        var ids = parseIdList((p.boss && p.boss.randomItemIds) || '404,8151');
        if (!ids.length) ids = [404, 8151];
        huntRandomUsed++;
        sendCmd('useItemsByRule', { itemIds: ids, maxPerTick: 1 });
        if (huntRandomUsed === 1 || huntRandomUsed % 10 === 0 || huntRandomUsed >= max) {
            log('随机寻怪 ' + huntRandomUsed + '/' + max);
        }
        setStatus('云游平台：随机寻怪 ' + huntRandomUsed + '/' + max + ' · ' +
            (huntTarget.bossName || ''), 'running');
    }

    /** 背包无随机石时，按配置用商城购买（绑定传奇币，与游戏 autoBuySuiji 同源） */
    function tryBuyRandomStone(p) {
        p = p || getActive();
        if (huntKind === 'moying') {
            return buyRandomStoneForMoying(p);
        }
        if (!p || !p.boss || !p.boss.randomBuyEnabled) return false;
        if (phase !== 'HUNTING_BOSS' && phase !== 'GOING_BOSS') return false;
        var now = Date.now();
        if (now < randomBuyPendingUntil) return true;
        if (now - lastRandomBuyTs < 2800) return true;
        lastRandomBuyTs = now;
        randomBuyPendingUntil = now + 4500;
        var count = p.boss.randomBuyCount != null ? Number(p.boss.randomBuyCount) : 50;
        if (isNaN(count) || count < 1) count = 50;
        if (count > 999) count = 999;
        log('背包无随机石，购买 x' + count + '（传奇币商城）');
        setStatus('云游平台：购买随机石 x' + count + '…', 'running');
        sendCmd('buyRandomStone', { count: count, itemId: 404 });
        return true;
    }

    function resumeFarmAfterHunt() {
        huntTarget = null;
        huntKind = null;
        var p = getActive();
        // 活动 > 任务 > Boss：Boss 结束后优先接活动
        if (tryJoinOpenActivityNow('Boss结束')) return;
        if (tryStartPendingActivity()) return;
        if (shouldDeferLowerPriorityForTasks(p)) {
            returnToFarmMap(p, 'Boss结束→任务');
            return;
        }
        var skipFarm = !!(p && p.boss && p.boss.skipFarmIfQueued !== false);
        if (skipFarm && huntQueue.length) {
            setPhase('FARMING');
            setStatus('云游平台：队列还有 ' + huntQueue.length + '，直接下一只 Boss', 'running');
            log('跳过回挂机，直接接下一个 Boss（队列' + huntQueue.length + '）');
            tryStartNextHunt();
            if (huntTarget) return;
        }
        returnToFarmMap(p, '返回挂机');
    }

    /** 回挂机地图（Boss 结束 / NPC 回收后共用） */
    function returnToFarmMap(p, reason) {
        p = p || getActive();
        if (!p || !p.farm || !p.farm.mapId) {
            setPhase('IDLE');
            setStatus('云游平台：无挂机地图');
            return;
        }
        setPhase('GOING_FARM');
        var farmMap = getFarmTargetMapId(p);
        setStatus('云游平台：返回挂机 ' + (mapNameById(farmMap) || farmMap) +
            (huntQueue.length ? '（队列还剩' + huntQueue.length + '）' : ''), 'running');
        log((reason || '返回挂机') + ' → ' + farmMap +
            (huntQueue.length ? '，队列待打 ' + huntQueue.length : ''));
        pendingGoFarmUntil = Date.now() + 5000;
        sendCmd('goMap', {
            type: 'auto',
            mapId: farmMap,
            deliverId: p.farm.deliverId || 0
        });
    }

    function bagAssistIntervalMs(p) {
        var interval = 3000;
        if (p && p.bag && p.bag.autoUse && p.bag.autoUse.intervalMs) {
            interval = Math.max(1000, p.bag.autoUse.intervalMs);
        }
        return interval;
    }

    function needBagSlotAction(p, d, cfgKey, defaultThr) {
        if (!p || !p.bag || !p.bag[cfgKey] || !p.bag[cfgKey].enabled) return false;
        var empty = d && d.emptySlots;
        if (empty == null || empty < 0) return false;
        var thr = p.bag[cfgKey].emptySlotsBelow != null ? Number(p.bag[cfgKey].emptySlotsBelow) : defaultThr;
        return empty <= thr;
    }

    /**
     * 无会员：FARMING 稳态或打 Boss 前触发传送回收。
     */
    function startNpcRecycle(p, reason, opts) {
        opts = opts || {};
        p = p || getActive();
        if (!opts.beforeBoss && phase !== 'FARMING') return false;
        if (!p || !p.bag || !p.bag.autoRecycle || !p.bag.autoRecycle.enabled) return false;
        var now = Date.now();
        if (!opts.beforeBoss && now - lastNpcRecycleTs < 45000) return false;
        if (opts.beforeBoss && opts.watch) pendingBossAfterRecycle = opts.watch;
        recycleLeftMapId = (p.farm && p.farm.mapId) || 0;
        recycleStartedAt = now;
        recycleActionAt = 0;
        recycleRetried = false;
        pendingGoRecycleUntil = now + 2500;
        lastNpcRecycleTs = now;
        setPhase('GOING_RECYCLE');
        setStatus('云游平台：传送回收炉…', 'running');
        log((opts.beforeBoss ? '打 Boss 前传送回收' : '无会员随身回收不可用，传送回收') +
            (reason ? ' ·' + reason : ''));
        sendCmd('setAutoFight', { type: 3 });
        sendCmd('teleportToRecycleNpc', {});
        return true;
    }

    function finishNpcRecycleAndContinue(p) {
        if (tryJoinOpenActivityNow('回收后')) return true;
        if (tryStartPendingActivity()) return true;
        if (shouldDeferLowerPriorityForTasks(p)) {
            log('回收完成，返回挂机执行任务');
            returnToFarmMap(p, '回收后→任务');
            return true;
        }
        if (pendingActivityKind && (shouldRunMoyingHuntNow() || shouldRunQunyingNow() || shouldRunPanluanNow() ||
            (window.ActivityModule && ActivityModule.anyGenericShouldRun()))) {
            var kind = pendingActivityKind;
            pendingActivityKind = null;
            log('回收完成，前往' + (kind === 'qunying' ? '群英汇' : (kind === 'moying' ? '魔影来袭' : (kind === 'panluan' ? '皇陵叛乱' : '活动'))));
            if (kind === 'qunying') beginQunyingSession();
            else if (kind === 'moying') beginMoyingSession();
            else if (kind === 'panluan') beginPanluanSession();
            else if (window.ActivityModule) ActivityModule.beginById(kind, '回收后');
            return true;
        }
        if (pendingBossAfterRecycle) {
            var w = pendingBossAfterRecycle;
            pendingBossAfterRecycle = null;
            log('回收完成，前往 Boss → ' + (w.bossName || w.mapId));
            beginHunt(w);
            return true;
        }
        log('回收完成，立即返回挂机');
        returnToFarmMap(p, '回收后回挂机');
        return true;
    }

    function onRuntimeNpcRecycle(d, p) {
        var now = Date.now();
        var cur = d.map && d.map.mapId;

        if (phase === 'GOING_RECYCLE') {
            var leftFarm = recycleLeftMapId && cur && Number(cur) !== Number(recycleLeftMapId);
            var waited = now - recycleStartedAt;
            if (now < pendingGoRecycleUntil && !leftFarm) {
                setStatus('云游平台：前往回收炉…', 'running');
                return;
            }
            // 已离挂机图，或同图 NPC 传送等了约 2.5s+ → 执行回收
            if (leftFarm || waited >= 2500) {
                setPhase('RECYCLING');
                recycleActionAt = now;
                setStatus('云游平台：回收中…', 'running');
                log('抵达回收点，执行回收' + (leftFarm ? '（已换图）' : '（同图/超时）'));
                sendCmd('openRecycleUi', {});
                sendCmd('runRecycleOnce', { forceNpc: true });
                return;
            }
            return;
        }

        if (phase === 'RECYCLING') {
            setStatus('云游平台：回收中…', 'running');
            // 首次后隔 800ms 再发一次，防止 UI/寻路未就绪
            if (!recycleRetried && recycleActionAt && now - recycleActionAt >= 800) {
                recycleRetried = true;
                sendCmd('runRecycleOnce', { forceNpc: true });
            }
            // 回收完成：稍等协议落地后立刻回挂机
            if (recycleActionAt && now - recycleActionAt >= 1800) {
                finishNpcRecycleAndContinue(p);
                return;
            }
            // 总超时兜底
            if (now - recycleStartedAt > 22000) {
                log('回收超时' + (pendingBossAfterRecycle ? '，仍尝试前往 Boss' : '，强制回挂机'));
                finishNpcRecycleAndContinue(p);
            }
        }
    }

    function maybePollBossStatus(p) {
        if (!p || !p.boss || !p.boss.enabled) return;
        var hasWatch = selectedBossWatch.length > 0 ||
            (typeof hasExtraBossInterest === 'function' && hasExtraBossInterest());
        if (!hasWatch) return;
        if (shouldDeferToActivity() || huntKind === 'moying' || pendingActivityKind ||
            (window.ActivityModule && ActivityModule.hasSession())) return;
        var now = Date.now();
        var interval = Math.max(5, p.boss.pollSec || 20) * 1000;
        if (now - lastBossPollTs < interval) return;
        lastBossPollTs = now;
        sendCmd('requestShoulingBoss', {});
        setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 500);
        // 恶魔广场/圣域：拉存活；无协议数据时假定存活（否则勾了永不入队）
        if (typeof syncExtraBossAlive === 'function') {
            syncExtraBossAlive({ assume: true, requestArpg: true });
        }
    }

    function tickScheduler() {
        if (!isSchedulerActive()) return;
        sendCmd('getRuntimeState');
        // 进图后持续轮询视野怪：未锁定前搜寻 Boss，锁定后检测击杀
        if ((phase === 'HUNTING_BOSS' || phase === 'GOING_BOSS') && huntTarget && huntArrivedAt) {
            if (huntPendingMonster && huntPendingMonsterSince && Date.now() - huntPendingMonsterSince > 2500) {
                huntPendingMonster = false;
                huntPendingMonsterSince = 0;
            }
            if (!huntPendingMonster) {
                huntPendingMonster = true;
                huntPendingMonsterSince = Date.now();
                sendCmd('getMonsterList');
            }
        }
        // 拾取阶段：只轮询掉落用于提前结束，不再逐个 keyPickup
        if (phase === 'LOOTING_BOSS') {
            if (!lootPendingDrop) {
                lootPendingDrop = true;
                sendCmd('getDropList');
            }
        }
    }

    function maybeAutoSmelt(p, d) {
        if (!p || !p.bag) return;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return;
        if (!needBagSlotAction(p, d, 'autoSmelt', 10)) return;
        var now = Date.now();
        if (now - lastAutoSmeltTs < bagAssistIntervalMs(p)) return;
        lastAutoSmeltTs = now;
        sendCmd('applyAutoSmeltIfNeeded', { autoSmelt: p.bag.autoSmelt });
    }

    function maybeAutoUse(p) {
        if (!p || !p.bag) return;
        var use = p.bag.autoUse;
        if (!use || !use.enabled) return;
        var now = Date.now();
        if (now - lastAutoUseTs < bagAssistIntervalMs(p)) return;
        lastAutoUseTs = now;
        var payload = { autoUse: JSON.parse(JSON.stringify(use)) };
        if (!payload.autoUse.itemIds || !payload.autoUse.itemIds.length) {
            payload.autoUse.itemIds = selectedUseIds.length ? selectedUseIds.slice() : [1001, 4645];
        }
        sendCmd('applyAutoUseIfNeeded', payload);
    }

    function maybeAutoRecycle(p, d) {
        if (!p || !p.bag) return;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return;
        if (!needBagSlotAction(p, d, 'autoRecycle', 7)) return;
        // 无会员：挂机稳态才走随身检测；打 Boss 前由 tryStartNextHunt 专门传送回收
        if (d.hasPortableRecycle === false && phase !== 'FARMING') return;
        var now = Date.now();
        if (now - lastAutoRecycleTs < bagAssistIntervalMs(p)) return;
        lastAutoRecycleTs = now;
        sendCmd('applyAutoRecycleIfNeeded', { autoRecycle: p.bag.autoRecycle });
    }

    function maybeAutoDiscard(p) {
        if (!p || !p.bag) return;
        var disc = p.bag.autoDiscard;
        if (!disc || !disc.enabled || !disc.itemIds || !disc.itemIds.length) return;
        var now = Date.now();
        if (now - lastAutoDiscardTs < bagAssistIntervalMs(p)) return;
        lastAutoDiscardTs = now;
        sendCmd('applyAutoDiscardIfNeeded', { autoDiscard: disc });
    }

    function maybeAutoStore(p, d) {
        if (!p || !p.bag) return;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return;
        var now = Date.now();
        if (now - lastAutoStoreTs < bagAssistIntervalMs(p)) return;
        if (needBagSlotAction(p, d, 'autoStoreEquip', 7)) {
            lastAutoStoreTs = now;
            sendCmd('applyAutoStoreIfNeeded', { kind: 'equip', autoStore: p.bag.autoStoreEquip });
            return;
        }
        if (needBagSlotAction(p, d, 'autoStoreMaterial', 7)) {
            lastAutoStoreTs = now;
            sendCmd('applyAutoStoreIfNeeded', { kind: 'material', autoStore: p.bag.autoStoreMaterial });
        }
    }

    function maybeAutoBuy(p) {
        if (!p || !p.bag) return;
        var buy = p.bag.autoBuy;
        if (!buy || !buy.enabled) return;
        var items = normalizeAutoBuyRules(buy);
        if (!items.length) return;
        var now = Date.now();
        var buyIv = Math.max(bagAssistIntervalMs(p), 10000);
        if (now - lastAutoBuyTs < buyIv) return;
        lastAutoBuyTs = now;
        sendCmd('applyAutoBuyIfNeeded', { autoBuy: { enabled: true, items: items } });
    }

    function maybeDailyChores(p, force) {
        if (!p || !p.bag) return;
        var b = p.bag;
        var any = (b.autoSignIn && b.autoSignIn.enabled) ||
            (b.autoUnionDonate && b.autoUnionDonate.enabled) ||
            (b.autoOfflineReward && b.autoOfflineReward.enabled) ||
            (b.autoVipReward && b.autoVipReward.enabled) ||
            (b.autoMailBaodian && b.autoMailBaodian.enabled) ||
            (b.autoExchangeXuemai && b.autoExchangeXuemai.enabled);
        if (!any) return;
        var now = Date.now();
        if (!force && now - lastDailyChoresTs < 60000) return;
        lastDailyChoresTs = now;
        sendCmd('applyDailyChoresIfNeeded', {
            bag: {
                autoSignIn: b.autoSignIn,
                autoUnionDonate: b.autoUnionDonate,
                autoOfflineReward: b.autoOfflineReward,
                autoVipReward: b.autoVipReward,
                autoMailBaodian: b.autoMailBaodian,
                autoExchangeXuemai: b.autoExchangeXuemai
            },
            force: !!force
        });
    }

    /** 日切等场景：忽略 60s 节流立刻领福利 */
    function forceDailyChores(p) {
        p = p || getActive();
        lastDailyChoresTs = 0;
        maybeDailyChores(p, true);
    }
