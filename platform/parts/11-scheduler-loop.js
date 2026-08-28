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
        var arriveMap = getHuntArriveMapId(huntTarget);

        if (!isOnHuntTargetMap(cur, huntTarget)) {
            if (now < pendingGoBossUntil) return;
            setPhase('GOING_BOSS');
            pendingGoBossUntil = now + 5000;
            var goRetry = (huntGoRetryCount[huntTarget.key] || 0) + 1;
            huntGoRetryCount[huntTarget.key] = goRetry;
            log('再次前往 Boss 图 ' + targetMap +
                (arriveMap && arriveMap !== targetMap ? ('(落地' + arriveMap + ')') : '') +
                (huntTarget.deliver ? ' deliver=' + huntTarget.deliver : '') +
                ' ·第' + goRetry + '次' +
                (cur != null ? '（当前图' + cur + '）' : '') +
                (goRetry >= 1 ? ' ·尝试中间图二次进入' : ''));
            // 连续进不去：放弃，避免空转到猎杀超时
            if (goRetry >= 8) {
                abandonHunt('进图失败(当前' + (cur != null ? cur : '?') +
                    '≠' + targetMap + (arriveMap && arriveMap !== targetMap ? ('/' + arriveMap) : '') + ')');
                return;
            }
            // 第1次起：若 deliver 是 toNpcId 中转（行会地宫等），改走 NPC「进入xxx」二次传送
            sendCmd('goMap', {
                type: huntTarget.deliver ? 'deliver' : 'auto',
                mapId: targetMap,
                deliverId: huntTarget.deliver || 0,
                preferEnter: goRetry >= 1,
                hop: goRetry >= 1 ? 'enter' : 'auto'
            });
            return;
        }

        if (!huntArrivedAt) {
            huntArrivedAt = now;
            huntRandomUsed = 0;
            lastHuntPrelockPollTs = 0;
            if (huntTarget && huntTarget.key) huntGoRetryCount[huntTarget.key] = 0;
            var alive = getWatchAliveStatus(huntTarget);
            if (alive != null && Number(alive) <= 0) {
                finishHunt('抵达时已未刷新(占有/被击杀)');
                return;
            }
            var spawnPt = setupHuntSpawnPoint(huntTarget);
            if (spawnPt) {
                huntMovingToSpawn = true;
                log('已抵达 Boss 图 ' + (arriveMap || targetMap) +
                    (arriveMap && arriveMap !== targetMap ? ('(配置' + targetMap + ')') : '') +
                    '，前往刷新点 (' + spawnPt.x + ',' + spawnPt.y + ')，途中扫描 Boss');
                setStatus('云游平台：前往刷新点 (' + spawnPt.x + ',' + spawnPt.y + ')', 'running');
                sendGotoHuntSpawn(arriveMap || cur || targetMap);
            } else {
                huntUseRandomFallback = true;
                log('已抵达 Boss 图 ' + (arriveMap || targetMap) + '，无刷新坐标，改用随机寻怪');
            }
        }

        maybePollHuntBossStatus(now);
        if (!checkHuntTargetStillAlive('途中检测：目标已被击杀')) return;

        // 已锁定 Boss：保持自动战斗并检测击杀
        if (huntSawBoss) {
            onRuntimeBossFight(d, p, targetMap, now);
            return;
        }

        // 同步快照：到点/寻路途中若视野里已有 Boss，立即开打（不等 getMonsterList 回包）
        ensureHuntSpawnProgress(now, d);
        if (tryLockBossFromRuntime(d, huntMovingToSpawn ? '寻路途中runtime' : '刷新点runtime')) {
            onRuntimeBossFight(d, p, targetMap, now);
            return;
        }

        // 寻路/搜寻阶段先关自动打，避免打小怪；锁定后由 onRuntimeBossFight 开启
        if (d.autoFightType === 1) sendCmd('setAutoFight', { type: 3 });

        // 阶段1：有刷新坐标则先寻路过去（途中 getMonsterList 发现 Boss 会立即 lockHuntBoss）
        if (!huntUseRandomFallback && huntSpawnX && huntSpawnY) {
            setPhase('HUNTING_BOSS');
            var nearSpawn = isNearHuntSpawn(d.player, HUNT_SPAWN_ARRIVE_RADIUS);
            // 寻路结束(autoFight≠2)且已在刷新点附近，视为抵达
            if (!nearSpawn && d.autoFightType !== 2 && lastGotoSpawnTs &&
                now - lastGotoSpawnTs > 1500 &&
                isNearHuntSpawn(d.player, HUNT_SPAWN_ARRIVE_RADIUS + 8)) {
                nearSpawn = true;
            }
            if (!huntAtSpawnSince) {
                if (!nearSpawn) {
                    huntMovingToSpawn = true;
                    var pathAge = lastGotoSpawnTs ? now - lastGotoSpawnTs : 0;
                    if (pathAge >= HUNT_PATH_RESEND_MS) {
                        sendGotoHuntSpawn(arriveMap || cur || targetMap);
                        setStatus('云游平台：寻路至刷新点 (' + huntSpawnX + ',' + huntSpawnY + ')', 'running');
                    } else if (pathAge > 3000) {
                        setStatus('云游平台：寻路中扫描 Boss…', 'running');
                    } else if (!lastGotoSpawnTs) {
                        sendGotoHuntSpawn(arriveMap || cur || targetMap);
                        setStatus('云游平台：寻路至刷新点 (' + huntSpawnX + ',' + huntSpawnY + ')', 'running');
                    } else {
                        setStatus('云游平台：寻路至刷新点 (' + huntSpawnX + ',' + huntSpawnY + ')', 'running');
                    }
                } else {
                    markHuntSpawnArrived(now, '已到达刷新点');
                    setStatus('云游平台：刷新点搜寻 ' + (huntTarget.bossName || ''), 'running');
                }
            }

            // 未到刷新点：继续寻路，不计入刷新点搜寻/随机计时
            if (huntMovingToSpawn) return;

            // 已到刷新点，给固定坐标周围一段观察时间后才开始随机兜底
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
