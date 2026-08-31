    function onRuntimeForScheduler(d) {
        if (!isSchedulerActive()) {
            // 未启动时仍跟踪服日，避免启动后误触发「日切」
            lastRuntimeSnapshot = d;
            if (typeof checkServerDayRoll === 'function') checkServerDayRoll(d);
            renderRuntime(d);
            return;
        }
        renderRuntime(d);
        lastRuntimeSnapshot = d;
        if (typeof checkServerDayRoll === 'function') checkServerDayRoll(d);

        var p = readEditor();
        if (!p || !p.farm || !p.farm.mapId) {
            setPhase('ERROR');
            setStatus('请先选择挂机地图', 'error');
            return;
        }

        if (typeof maybeClearDailyBurst === 'function') maybeClearDailyBurst(p);

        if (d.player && d.player.isDead) {
            log('角色死亡，等待复活后继续');
            return;
        }

        // 任意调度相位：低血走位实时开/关（约 0.5s 轮询）
        runLowHpKiteTick(d, p);

        // 任意阶段：用药不停；空格不足则熔炼/回收/存仓/丢弃；定时补货与日常福利
        maybeAutoUse(p);
        maybeAutoSmelt(p, d);
        maybeAutoRecycle(p, d);
        maybeAutoDiscard(p);
        maybeAutoStore(p, d);
        maybeAutoBuy(p);
        maybeDailyChores(p);
        maybeAuctionAuto(p);
        if (window.PkModule && PkModule.onRuntime) PkModule.onRuntime(d, p);

        // 猎杀途中不轮询入队干扰；回挂机途中也不轮询强切
        if (phase === 'FARMING' || phase === 'GOING_FARM') {
            maybePollBossStatus(p);
        }

        // ---- 日切突发：任务临时压过活动 ----
        if (dailyBurstActive && window.TaskModule) {
            if (phase === 'GOING_TASK' || phase === 'DOING_TASK') {
                if (TaskModule.onRuntime(d, p)) return;
            }
            if (phase === 'FARMING' || phase === 'GOING_FARM' ||
                phase === 'GOING_TASK' || phase === 'DOING_TASK') {
                if (TaskModule.onRuntimeFarmGate(d, p)) return;
            }
        }

        // ---- 0. 活动优先（活动 > 任务 > Boss > 挂机）----
        // 开场 / 上线已开 / 时段内：立刻参加；可打断任务与「前往 Boss」
        if (tryJoinOpenActivityNow('调度检测')) return;

        // ---- 1. 活动进行中：不可打断 ----
        if (window.ActivityModule && ActivityModule.isActivePhase(phase)) {
            ActivityModule.onRuntime(d, p);
            return;
        }
        if (phase === 'GOING_QUNYING' || phase === 'QUNYING') {
            onRuntimeQunying(d, p);
            return;
        }
        if (phase === 'GOING_PANLUAN' || phase === 'PANLUAN') {
            onRuntimePanluan(d, p);
            return;
        }
        if (phase === 'GOING_HANGHUI' || phase === 'HANGHUI') {
            onRuntimeHanghui(d, p);
            return;
        }
        // 魔影清查也走 Boss 相位
        if (huntKind === 'moying' && (phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS')) {
            if (phase === 'LOOTING_BOSS') onRuntimeLoot(d, p);
            else onRuntimeBossHunt(d, p);
            return;
        }

        // ---- 2. Boss 打怪/拾取中：不硬切（结束后由 tryJoinOpenActivityNow 接活动）----
        if (phase === 'LOOTING_BOSS') {
            onRuntimeLoot(d, p);
            return;
        }
        if (phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS') {
            onRuntimeBossHunt(d, p);
            return;
        }

        // ---- 3. 任务（低于活动，高于 Boss/挂机）----
        if (phase === 'GOING_TASK' || phase === 'DOING_TASK') {
            if (window.TaskModule && TaskModule.onRuntime(d, p)) return;
        }
        if (shouldDeferLowerPriorityForTasks(p) &&
            !isInActivityPhases() &&
            phase !== 'GOING_RECYCLE' && phase !== 'RECYCLING' &&
            phase !== 'GOING_SOUL_HALL' && phase !== 'SOUL_HALL' &&
            (phase === 'FARMING' || phase === 'GOING_FARM')) {
            if (window.TaskModule && TaskModule.onRuntimeFarmGate(d, p)) return;
        }

        // ---- 无会员传送回收 ----
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') {
            onRuntimeNpcRecycle(d, p);
            return;
        }

        // ---- 灵魂殿堂侧程 ----
        if (phase === 'GOING_SOUL_HALL' || phase === 'SOUL_HALL') {
            if (window.SoulHallModule && SoulHallModule.onRuntime(d, p)) return;
            return;
        }

        // ---- 普通挂机 ----
        var target = getFarmTargetMapId(p);
        var cur = d.map && d.map.mapId;
        var now = Date.now();

        if (cur != target) {
            if (now < pendingGoFarmUntil) return;
            setPhase('GOING_FARM');
            setStatus('云游平台：前往 ' + (mapNameById(target) || target), 'running');
            pendingGoFarmUntil = now + 5000;
            log('进图 → ' + target);
            sendCmd('goMap', {
                type: 'auto',
                mapId: target,
                deliverId: p.farm.deliverId || 0
            });
            return;
        }

        if (d.autoFightType !== 1) {
            sendCmd('setGuajiType', { type: p.farm.guajiType || 0 });
            sendCmd('setAutoFight', { type: 1 });
        }
        // 挂机强制拾取：进图会 checkAutoPicke 关掉 AutoPick；autoPet 还会让角色不捡归属物
        if (p.farm.autoPick !== false) {
            sendCmd('ensureFarmPickup', { enabled: true });
        }
        var wasFarming = phase === 'FARMING';
        setPhase('FARMING');
        setStatus('云游平台：挂机中 @ ' + (mapNameById(cur) || cur) + ' / 怪 ' + d.aliveMonsterCount +
            (d.dropCount ? (' / 掉落' + d.dropCount) : '') +
            (huntQueue.length ? ' ·待打Boss' + huntQueue.length : '') +
            (shouldRunMoyingHuntNow() ? ' ·魔影时段' : '') +
            (shouldRunQunyingNow() ? ' ·群英汇' : '') +
            (window.ActivityModule && ActivityModule.hasSession() ? ' ·活动中' : '') +
            (d.hasPortableRecycle === false ? ' ·无会员回收' : ''), 'running');
        if (runFarmTacticsRuntime(d, p)) return;
        if (window.SoulHallModule && SoulHallModule.maybePoll) SoulHallModule.maybePoll(d, p);
        // 回到挂机稳态后才允许出发下一只 Boss
        if (!wasFarming || huntQueue.length) tryStartNextHunt(d);
    }

    function onRuntimeBossHunt(d, p) {
        if (!huntTarget) {
            resumeFarmAfterHunt();
            return;
        }
        if (huntKind === 'moying') {
            onRuntimeMoyingHunt(d, p);
            return;
        }
        var now = Date.now();
        var huntSec = (p.boss && p.boss.huntSec) || 180;
        var occupySec = (p.boss && p.boss.occupySec) || 25;
        // 未锁定：用「无进度超时」作为搜寻最长等待（从进图算起）
        // 已锁定：改由 checkHuntBossHpProgress 每 10s 看血量，不再硬砍
        if (!huntSawBoss && now - huntStartedAt > huntSec * 1000) {
            abandonHunt('搜寻超时(未锁定)');
            return;
        }

        var cur = d.map && d.map.mapId;
        var targetMap = parseInt(huntTarget.mapId, 10);
        var entryMap = getHuntEntryMapId(huntTarget);
        var spawnMap = getHuntSpawnMapId(huntTarget);
        var needHop = needsHuntSpawnHop(huntTarget);

        // —— 阶段 A：既不在入口也不在刷新图 → 再发首领 deliver ——
        if (!isOnHuntEntryMap(cur, huntTarget) && !isOnHuntSpawnMap(cur, huntTarget)) {
            if (now < pendingGoBossUntil) return;
            setPhase('GOING_BOSS');
            pendingGoBossUntil = now + 5000;
            var goRetry = (huntGoRetryCount[huntTarget.key] || 0) + 1;
            huntGoRetryCount[huntTarget.key] = goRetry;
            log('再次前往 Boss 入口图 ' + (entryMap || targetMap) +
                (needHop ? ('(刷新' + spawnMap + ')') : '') +
                (huntTarget.deliver ? ' deliver=' + huntTarget.deliver : '') +
                ' ·第' + goRetry + '次' +
                (cur != null ? '（当前图' + cur + '）' : ''));
            if (goRetry >= 8) {
                abandonHunt('进图失败(当前' + (cur != null ? cur : '?') +
                    '≠入口' + (entryMap || targetMap) + ')');
                return;
            }
            sendCmd('goMap', {
                type: huntTarget.deliver ? 'deliver' : 'auto',
                mapId: targetMap,
                deliverId: huntTarget.deliver || 0,
                hop: isHubHuntWatch(huntTarget) ? 'hub' : 'auto'
            });
            if (isHubHuntWatch(huntTarget)) {
                huntTarget._hubDeliverSent = true;
                if (!huntTarget._hubFromMap && cur) huntTarget._hubFromMap = cur;
            }
            return;
        }

        // —— 阶段 B：已在入口、尚未进刷新图 → 二次传送（禁止再发首领 deliver）——
        if (needHop && isOnHuntEntryMap(cur, huntTarget) && !isOnHuntSpawnMap(cur, huntTarget)) {
            // Hub：把当前中转图记为入口，供后续判定
            if (isHubHuntWatch(huntTarget) && cur) {
                huntTarget.entryMapId = cur;
                huntTarget.arriveMapId = cur;
                huntTarget._hubLandedMap = cur;
            }
            if (now < pendingGoSpawnUntil) return;
            setPhase('GOING_BOSS');
            pendingGoSpawnUntil = now + 5000;
            var hopRetry = (huntSpawnGoRetryCount[huntTarget.key] || 0) + 1;
            huntSpawnGoRetryCount[huntTarget.key] = hopRetry;
            var spawnDeliver = parseInt(huntTarget.spawnDeliverId, 10) || 0;
            log('入口→刷新图 ' + (entryMap || cur || 'hub') + '→' + spawnMap +
                (spawnDeliver ? (' spawnDeliver=' + spawnDeliver) : '') +
                (isHubHuntWatch(huntTarget) ? ' ·Hub' : '') +
                ' ·第' + hopRetry + '次');
            if (hopRetry >= 8) {
                abandonHunt('入口→刷新图失败(停在' + (entryMap || cur || '?') + '，目标' + spawnMap + ')');
                return;
            }
            if (spawnDeliver) {
                sendCmd('goMap', {
                    type: 'deliver',
                    mapId: spawnMap,
                    deliverId: spawnDeliver,
                    hop: 'enter',
                    fromHubTransit: isHubHuntWatch(huntTarget)
                });
            } else if (huntTarget.portalX && huntTarget.portalY) {
                sendCmd('gotoStagePoint', {
                    x: huntTarget.portalX,
                    y: huntTarget.portalY,
                    mapId: entryMap
                });
                setStatus('云游平台：前往入口传送点 (' + huntTarget.portalX + ',' +
                    huntTarget.portalY + ')' +
                    (huntTarget.portalName ? (' ·' + huntTarget.portalName) : ''), 'running');
            } else {
                sendCmd('goMap', {
                    type: 'auto',
                    mapId: spawnMap,
                    deliverId: 0
                });
            }
            return;
        }

        // —— 阶段 C：已在刷新图 → 寻路/扫怪 ——
        if (!isOnHuntSpawnMap(cur, huntTarget)) {
            return;
        }

        if (!huntArrivedAt) {
            huntArrivedAt = now;
            huntRandomUsed = 0;
            lastHuntPrelockPollTs = 0;
            if (huntTarget && huntTarget.key) {
                huntGoRetryCount[huntTarget.key] = 0;
                huntSpawnGoRetryCount[huntTarget.key] = 0;
            }
            var alive = getWatchAliveStatus(huntTarget);
            if (alive != null && Number(alive) <= 0) {
                finishHunt('抵达时已未刷新(占有/被击杀)');
                return;
            }
            var spawnPt = setupHuntSpawnPoint(huntTarget);
            if (spawnPt) {
                huntMovingToSpawn = true;
                log('已抵达刷新图 ' + spawnMap +
                    (needHop ? ('(经入口' + entryMap + ')') : '') +
                    '，前往刷新点 (' + spawnPt.x + ',' + spawnPt.y + ')，途中扫描 Boss');
                setStatus('云游平台：前往刷新点 (' + spawnPt.x + ',' + spawnPt.y + ')', 'running');
                sendGotoHuntSpawn(spawnMap);
            } else {
                huntUseRandomFallback = true;
                log('已抵达刷新图 ' + spawnMap + '，无刷新坐标，改用随机寻怪');
            }
        }

        maybePollHuntBossStatus(now);
        if (!checkHuntTargetStillAlive('途中检测：目标已被击杀')) return;

        if (huntSawBoss) {
            onRuntimeBossFight(d, p, targetMap, now);
            return;
        }

        ensureHuntSpawnProgress(now, d);
        if (tryLockBossFromRuntime(d, huntMovingToSpawn ? '寻路途中runtime' : '刷新点runtime')) {
            onRuntimeBossFight(d, p, targetMap, now);
            return;
        }

        if (d.autoFightType === 1) sendCmd('setAutoFight', { type: 3 });

        if (!huntUseRandomFallback && huntSpawnX && huntSpawnY) {
            setPhase('HUNTING_BOSS');
            var nearSpawn = isNearHuntSpawn(d.player, HUNT_SPAWN_ARRIVE_RADIUS);
            if (!nearSpawn && d.autoFightType !== 2 && lastGotoSpawnTs &&
                now - lastGotoSpawnTs > 1500 &&
                isNearHuntSpawn(d.player, HUNT_SPAWN_ARRIVE_RADIUS + 8)) {
                nearSpawn = true;
            }
            if (!huntAtSpawnSince) {
                if (!nearSpawn) {
                    huntMovingToSpawn = true;
                    var pathAge = lastGotoSpawnTs ? now - lastGotoSpawnTs : 0;
                    if (pathAge >= HUNT_PATH_RESEND_MS || !lastGotoSpawnTs) {
                        sendGotoHuntSpawn(spawnMap);
                        setStatus('云游平台：寻路至刷新点 (' + huntSpawnX + ',' + huntSpawnY + ')', 'running');
                    } else if (pathAge > 3000) {
                        setStatus('云游平台：寻路中扫描 Boss…', 'running');
                    } else {
                        setStatus('云游平台：寻路至刷新点 (' + huntSpawnX + ',' + huntSpawnY + ')', 'running');
                    }
                } else {
                    markHuntSpawnArrived(now, '已到达刷新点');
                    setStatus('云游平台：刷新点搜寻 ' + (huntTarget.bossName || ''), 'running');
                }
            }

            if (huntMovingToSpawn) return;

            if (huntAtSpawnSince && !huntUseRandomFallback) {
                if (!checkHuntTargetStillAlive('刷新点检测：目标已被击杀')) return;
                setStatus('云游平台：刷新点搜寻 ' + (huntTarget.bossName || '') + ' @ (' +
                    huntSpawnX + ',' + huntSpawnY + ')', 'running');
                if (tryLockBossFromRuntime(d, '刷新点二次扫描')) {
                    onRuntimeBossFight(d, p, targetMap, now);
                    return;
                }
                if (now - huntAtSpawnSince > HUNT_SPAWN_SEARCH_MS) {
                    huntUseRandomFallback = true;
                    log('刷新点周围未发现 Boss，改用随机寻怪（已等待 ' +
                        Math.round(HUNT_SPAWN_SEARCH_MS / 1000) + 's）');
                } else {
                    var waitedSpawn = now - huntAtSpawnSince;
                    if (waitedSpawn > occupySec * 1000) {
                        var aliveOcc = getBossAlive(targetMap, huntTarget ? huntTarget.type : null);
                        if (aliveOcc != null && Number(aliveOcc) <= 0) {
                            finishHunt('占有判定：未刷/已被击杀');
                            return;
                        }
                    }
                    return;
                }
            }
        }

        // 阶段2：随机寻怪兜底
        if (!huntSawBoss) {
            setPhase('HUNTING_BOSS');
            maybeUseRandomStone(p);
            var waited2 = huntAtSpawnSince ? now - huntAtSpawnSince :
                (huntArrivedAt ? now - huntArrivedAt : 0);
            if (waited2 > occupySec * 1000) {
                var alive2 = getBossAlive(targetMap, huntTarget ? huntTarget.type : null);
                if (alive2 != null && Number(alive2) <= 0) {
                    finishHunt('占有判定：未刷/已被击杀');
                    return;
                }
            }
        }
    }
