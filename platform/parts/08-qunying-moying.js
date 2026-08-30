        }
        return false;
    }

    function beginQunyingSession(activityId) {
        if (!isSchedulerActive()) return;
        if (phase === 'GOING_QUNYING' || phase === 'QUNYING') return;
        if (qunyingRoundCompleted) return;
        var snap = lastRuntimeSnapshot;
        if (snap && snap.qunying && snap.qunying.ended) {
            markQunyingRoundDone();
            log('群英汇：本轮答题已结束，跳过重复进入');
            return;
        }
        if (!shouldRunQunyingNow(snap)) return;
        qunyingSessionActive = true;
        qunyingLastAnsweredCfgId = 0;
        qunyingLastAnswerTs = 0;
        qunyingFoodEquipped = false;
        qunyingStartedAt = Date.now();
        qunyingTeleportAttempts = 0;
        setPhase('GOING_QUNYING');
        setStatus('云游平台：群英汇 → 行会领地', 'running');
        log('群英汇：前往行会领地答题' + (activityId ? ' ·活动' + activityId : ''));
        sendCmd('setAutoFight', { type: 3 });
        qunyingPendingGoUntil = Date.now() + 3000;
        enterQunyingFastMode();
        requestQunyingTeleport('会话开始');
    }

    function finishQunyingSession(reason) {
        if (reason && (reason.indexOf('答题已结束') >= 0 ||
            reason.indexOf('活动时段已结束') >= 0 ||
            reason.indexOf('活动结束') >= 0)) {
            markQunyingRoundDone();
        }
        log('群英汇结束' + (reason ? ' ·' + reason : ''));
        leaveQunyingFastMode();
        resetQunyingSession();
        sendCmd('setAutoFight', { type: 3 });
        resumeFarmAfterHunt();
    }

    function onRuntimeQunying(d, p) {
        var qy = d.qunying || {};
        var now = Date.now();
        var cur = d.map && d.map.mapId;
        var qyActive = isAnyQunyingActivityOpen() || qunyingSessionActive || (qy.open && !qy.ended);

        if (!qyActive) {
            finishQunyingSession('活动未开启');
            return;
        }
        if (qy.ended) {
            markQunyingRoundDone();
            finishQunyingSession('答题已结束');
            return;
        }
        if (!isAnyQunyingActivityOpen() && !qy.open && now - qunyingStartedAt > 120000) {
            finishQunyingSession('活动时段已结束');
            return;
        }

        if (Number(cur) !== QUNYING_MAP_ID) {
            if (now < qunyingPendingGoUntil) return;
            if (qy.haveUnion === false) {
                log('群英汇：未加入行会，无法进入领地');
                finishQunyingSession('未加入行会');
                return;
            }
            setPhase('GOING_QUNYING');
            qunyingPendingGoUntil = now + 3000;
            requestQunyingTeleport('当前图' + (cur != null ? cur : '?'));
            return;
        }
        qunyingTeleportAttempts = 0;

        setPhase('QUNYING');
        if (!qunyingFoodEquipped) {
            sendCmd('openQunyingPanel');
            sendCmd('equipQunyingFood', { itemIds: QUNYING_FOOD_ITEMS });
            qunyingFoodEquipped = true;
        }
        // 答题由 game 内 updateDaTiInfo 钩子 + 50ms 轮询即时完成，此处不再二次提交
    }

    function beginMoyingSession(activityId) {
        if (!isSchedulerActive()) return;
        if (huntKind === 'moying' && huntTarget) return;
        if (moyingRoundCompleted) {
            log('魔影来袭：本轮已清查完毕，活动时段内不再重复进入');
            return;
        }
        if (!shouldRunMoyingHuntNow()) return;
        moyingSessionActive = true;
        moyingMapQueue = shuffleArray(MOYING_MAP_POOL.map(function (m) { return m.mapId; }));
        moyingClearedMaps = {};
        var moyingRandMax = getMoyingRandomMax(getActive());
        log('魔影来袭：开始清查（' + MOYING_MAP_POOL.length + ' 张地图，每张击杀 ' +
            MOYING_KILLS_PER_MAP + ' 只魔影巨人，随机上限 ' + moyingRandMax + ' 次）' +
            (activityId ? ' ·活动' + activityId : ''));
        setStatus('云游平台：魔影来袭清查中', 'running');
        beginNextMoyingMap();
    }

    function beginNextMoyingMap() {
        while (moyingMapQueue.length) {
            var mapId = moyingMapQueue.shift();
            if (moyingClearedMaps[mapId] || moyingClearedMaps[String(mapId)]) continue;
            var map = findMoyingMap(mapId);
            if (!map) continue;
            beginMoyingMapSearch(map);
            return;
        }
        finishMoyingSession('全部地图已清查完毕');
    }

    function beginMoyingMapSearch(map) {
        huntKind = 'moying';
        huntTarget = {
            kind: 'moying',
            key: 'moying_' + map.mapId,
            mapId: map.mapId,
            mapName: map.mapName,
            deliverId: map.deliverId,
            deliver: map.deliverId,
            bossName: MOYING_BOSS_NAME,
            bossId: 0,
            type: 0
        };
        huntStartedAt = Date.now();
        huntArrivedAt = 0;
        huntSawBoss = false;
        huntPendingMonster = false;
        huntRandomUsed = 0;
        lastRandomTs = 0;
        lastRandomNoItem = false;
        huntBossMissingSince = 0;
        moyingBoughtForMap = false;
        moyingKillsOnMap = 0;
        resetHuntSpawnState();
        huntUseRandomFallback = true;
        sendCmd('endLootMode');
        setPhase('GOING_BOSS');
        setStatus('云游平台：魔影来袭 → ' + map.mapName, 'running');
        log('魔影来袭：前往 ' + map.mapName + ' (deliver ' + map.deliverId + ')');
        sendCmd('setAutoFight', { type: 3 });
        pendingGoBossUntil = 0;
        sendCmd('goMap', {
            type: 'deliver',
            mapId: map.mapId,
            deliverId: map.deliverId
        });
        pendingGoBossUntil = Date.now() + 5000;
    }

    function markMoyingMapCleared(mapId, reason) {
        if (!mapId) return;
        moyingClearedMaps[mapId] = true;
        moyingClearedMaps[String(mapId)] = true;
        log('魔影：' + (findMoyingMap(mapId) ? findMoyingMap(mapId).mapName : mapId) +
            ' 视为清查完毕' + (reason ? ' ·' + reason : ''));
    }

    function finishMoyingSession(reason) {
        log('魔影来袭结束' + (reason ? ' ·' + reason : ''));
        markMoyingRoundDone();
        resetMoyingSession();
        huntTarget = null;
        sendCmd('endLootMode');
        sendCmd('setAutoFight', { type: 3 });
        resumeFarmAfterHunt();
    }

    function finishMoyingHunt(reason) {
        var w = huntTarget;
        var mapId = w ? w.mapId : 0;
        log('魔影地图结束: ' + (w ? (w.mapName || w.mapId) : '-') + (reason ? ' ·' + reason : ''));
        var cleared = reason && (
            reason.indexOf('随机') >= 0 || reason.indexOf('未发现') >= 0 ||
            reason.indexOf('清查完毕') >= 0 || reason.indexOf('单图超时') >= 0 ||
            reason.indexOf('进图失败') >= 0 || reason.indexOf('已击杀') >= 0 ||
            reason.indexOf('魔影巨人已清') >= 0
        );
        if (cleared && mapId) markMoyingMapCleared(mapId, reason);

        huntKind = null;
        huntTarget = null;
        huntArrivedAt = 0;
        huntSawBoss = false;
        huntRandomUsed = 0;
        lootUntil = 0;
        lootStartedAt = 0;
        lootEmptyTicks = 0;
        lootPendingDrop = false;
        huntBossMissingSince = 0;
        resetHuntSpawnState();
        hideLootTimerBar();
        sendCmd('endLootMode');
        sendCmd('setAutoFight', { type: 3 });

        if (!isAnyMoyingActivityOpen()) {
            finishMoyingSession('活动时段已结束');
            return;
        }
        if (moyingMapQueue.length) {
            beginNextMoyingMap();
            return;
        }
        var hasUncleared = MOYING_MAP_POOL.some(function (m) {
            return !moyingClearedMaps[m.mapId] && !moyingClearedMaps[String(m.mapId)];
        });
        if (hasUncleared) {
            moyingMapQueue = shuffleArray(MOYING_MAP_POOL.filter(function (m) {
                return !moyingClearedMaps[m.mapId] && !moyingClearedMaps[String(m.mapId)];
            }).map(function (m) { return m.mapId; }));
            beginNextMoyingMap();
            return;
        }
        finishMoyingSession('全部地图已清查完毕');
    }

    /** 魔影：击杀一只魔影巨人后继续本图随机，满 MOYING_KILLS_PER_MAP 只则切图 */
    function resumeMoyingSearchAfterKill(reason) {
        var w = huntTarget;
        var p = getActive();
        moyingKillsOnMap = (moyingKillsOnMap || 0) + 1;
        if (moyingKillsOnMap >= MOYING_KILLS_PER_MAP) {
            log('魔影：' + (w ? w.mapName : '?') + ' 已击杀 ' + moyingKillsOnMap +
                ' 只魔影巨人，切换下一张图' + (reason ? ' ·' + reason : ''));
            finishMoyingHunt('本图已击杀' + moyingKillsOnMap + '只魔影巨人');
            return;
        }
        var max = getRandomSearchMax(p);
        var left = Math.max(0, max - huntRandomUsed);
        log('魔影：' + (w ? w.mapName : '?') + ' 击杀后继续随机清查' +
            '（' + moyingKillsOnMap + '/' + MOYING_KILLS_PER_MAP + '）' +
            (reason ? ' ·' + reason : '') + '（已用' + huntRandomUsed + '/' + max +
            (left ? '，剩余' + left + '次' : '') + '）');
        huntSawBoss = false;
        huntBossMissingSince = 0;
        huntBossLastSeenAt = 0;
        huntBossLockedAt = 0;
        huntBossLastHp = -1;
        huntBossHpProgressAt = 0;
        lastHuntHpCheckTs = 0;
        huntPendingMonster = false;
        huntPendingMonsterSince = 0;
        lootUntil = 0;
        lootStartedAt = 0;
        lootEmptyTicks = 0;
        lootPendingDrop = false;
        hideLootTimerBar();
        sendCmd('endLootMode');
        sendCmd('setAutoFight', { type: 3 });
        if (huntRandomUsed >= max) {
            finishMoyingHunt('随机' + max + '次清查完毕');
            return;
        }
        setPhase('HUNTING_BOSS');
        setStatus('云游平台：魔影继续随机清查 @ ' + (w ? w.mapName : '') +
            ' ·' + huntRandomUsed + '/' + max, 'running');
    }

    function isMoyingKillFinishReason(reason) {
        return !!(reason && (
            reason.indexOf('击杀') >= 0 || reason.indexOf('拾取') >= 0 ||
            reason.indexOf('死亡') >= 0 || reason.indexOf('消失') >= 0
        ));
    }

    function buyRandomStoneForMoying(p) {
        var now = Date.now();
        if (now < randomBuyPendingUntil) return true;
        if (now - lastRandomBuyTs < 2800) return true;
        lastRandomBuyTs = now;
        randomBuyPendingUntil = now + 4500;
        var count = MOYING_BUY_COUNT;
        log('魔影：进图前购买随机石 x' + count);
        setStatus('云游平台：魔影来袭购买随机石 x' + count + '…', 'running');
        sendCmd('buyRandomStone', { count: count, itemId: 404 });
        return true;
    }

    function getMoyingRandomMax(p) {
        p = p || getActive();
        var v = p && p.activity ? p.activity.moyingRandomMax : null;
        if (v == null || isNaN(Number(v))) return MOYING_RANDOM_DEFAULT;
        var n = parseInt(v, 10);
        // 1 多为误配（与 Boss 随机上限字段混淆等），按默认 20 处理
        if (n === 1) return MOYING_RANDOM_DEFAULT;
        return Math.max(1, Math.min(999, n));
    }

    function getRandomSearchMax(p) {
        p = p || getActive();
        if (huntKind === 'moying') return getMoyingRandomMax(p);
        return (p && p.boss && p.boss.randomMax) || 50;
    }

    function onRuntimeMoyingHunt(d, p) {
        if (!huntTarget) {
            finishMoyingHunt('状态丢失');
            return;
        }
        var now = Date.now();
        if (now - huntStartedAt > MOYING_MAP_TIMEOUT_SEC * 1000) {
            finishMoyingHunt('单图超时');
            return;
        }
        if (!isAnyMoyingActivityOpen()) {
            if (huntSawBoss) return;
            finishMoyingHunt('活动时段已结束');
            return;
        }

        var cur = d.map && d.map.mapId;
        var targetMap = parseInt(huntTarget.mapId, 10);

        if (cur != targetMap) {
            if (now < pendingGoBossUntil) return;
            setPhase('GOING_BOSS');
            pendingGoBossUntil = now + 5000;
            var goRetry = (huntGoRetryCount[huntTarget.key] || 0) + 1;
            huntGoRetryCount[huntTarget.key] = goRetry;
            log('魔影：再次进图 ' + targetMap + ' ·第' + goRetry + '次');
            if (goRetry >= 8) {
                markMoyingMapCleared(targetMap, '进图失败');
                finishMoyingHunt('进图失败');
                return;
            }
            sendCmd('goMap', {
                type: 'deliver',
                mapId: targetMap,
                deliverId: huntTarget.deliverId || huntTarget.deliver || 0
            });
            return;
        }

        if (!huntArrivedAt) {
            huntArrivedAt = now;
            huntRandomUsed = 0;
            huntUseRandomFallback = true;
            if (huntTarget && huntTarget.key) huntGoRetryCount[huntTarget.key] = 0;
            log('魔影：已抵达 ' + (huntTarget.mapName || targetMap) + '，开始随机清查');
        }

        if (!moyingBoughtForMap) {
            moyingBoughtForMap = true;
            buyRandomStoneForMoying(p);
        }

        if (huntSawBoss) {
            if (d.autoFightType !== 1) {
                sendCmd('setGuajiType', { type: 1 });
                sendCmd('setAutoFight', { type: 1 });
            }
            setPhase('HUNTING_BOSS');
            setStatus('云游平台：猎杀魔影巨人 @ ' + (huntTarget.mapName || targetMap), 'running');
            return;
        }

        if (d.autoFightType === 1) sendCmd('setAutoFight', { type: 3 });
        setPhase('HUNTING_BOSS');
        maybeUseRandomStone(p);
    }

    function resetPanluanSession() {
        panluanSessionActive = false;
        panluanStartedAt = 0;
        panluanJoinedAt = 0;
        panluanMapIndex = 0;
        panluanPendingGoUntil = 0;
        panluanJoinAttempts = 0;
        panluanPrepFarm = false;
        panluanWentSpawn = false;
        panluanPendingMonster = false;
        panluanPendingMonsterSince = 0;
        panluanLastSelectUid = null;
        panluanLastSelectTs = 0;
        panluanLastSpawnGoTs = 0;
    }

    function markPanluanRoundDone() {
        panluanRoundCompleted = true;
        panluanSessionActive = false;
        if (pendingActivityKind === 'panluan') pendingActivityKind = null;
    }

    function isPanluanMapId(mapId) {
        mapId = Number(mapId);
        for (var i = 0; i < PANLUAN_MAP_POOL.length; i++) {
            if (Number(PANLUAN_MAP_POOL[i].mapId) === mapId) return true;
        }
        return false;
    }

    function syncPanluanMapIndex(mapId) {
        mapId = Number(mapId);
        for (var i = 0; i < PANLUAN_MAP_POOL.length; i++) {
            if (Number(PANLUAN_MAP_POOL[i].mapId) === mapId) {
                panluanMapIndex = i;
                return i;
            }
        }
        return -1;
    }

    function needsPanluanPrep(d, p) {
        d = d || lastRuntimeSnapshot;
        p = p || getActive();
        if (!d) return false;
        if (isPanluanMapId(d.map && d.map.mapId)) return false;
        if (d.inDuplicate) return true;
        var farm = p && p.farm ? Number(p.farm.mapId) : 0;
        var cur = d.map && d.map.mapId != null ? Number(d.map.mapId) : 0;
        if (!farm || !cur) return false;
        if (cur === farm) return false;
        return true;
    }

    function isPanluanPriorityMonster(m) {
        if (!m || m.isDead) return false;
        var name = String(m.name || '');
        if (name.indexOf('[皇陵]') >= 0 || name.indexOf('[精]') >= 0) return true;
        var t = Number(m.monsterType);
        // type 4 = Boss；活动刷点多为叛乱首领/精英
        if (t === 4) return true;
        return false;
    }

    function requestPanluanEnter(reason) {
        panluanPrepFarm = false;
        panluanPendingGoUntil = Date.now() + PANLUAN_JOIN_WAIT_MS;
        panluanJoinAttempts++;
        panluanWentSpawn = false;
        setPhase('GOING_PANLUAN');
        setStatus('云游平台：皇陵叛乱 → 封魔谷', 'running');
        sendCmd('setAutoFight', { type: 3 });

        // 偶数次：直传活动入口 86；奇数次失败后走皇陵守卫中转再进
        var useHub = panluanJoinAttempts >= 2 && (panluanJoinAttempts % 2 === 0);
        if (useHub) {
            log('皇陵叛乱：经皇陵守卫中转进封魔谷' +
                (reason ? ' ·' + reason : '') + ' ·第' + panluanJoinAttempts + '次');
            sendCmd('goMap', {
                type: 'deliver',
                deliverId: PANLUAN_HUB_DELIVER_ID,
                mapId: PANLUAN_ENTRY_MAP_ID,
                hop: 'hub'
            });
            // 中转落地后再点「送我前往」
            setTimeout(function () {
                if (phase !== 'GOING_PANLUAN') return;
                sendCmd('goMap', {
                    type: 'deliver',
                    mapId: PANLUAN_ENTRY_MAP_ID,
                    deliverId: PANLUAN_ENTRY_DELIVER_ID
                });
                sendCmd('confirmEnterMap', { mapId: PANLUAN_ENTRY_MAP_ID });
            }, 2500);
        } else {
            log('皇陵叛乱：前往封魔谷（deliver ' + PANLUAN_ENTRY_DELIVER_ID + '）' +
                (reason ? ' ·' + reason : '') + ' ·第' + panluanJoinAttempts + '次');
            sendCmd('goMap', {
                type: 'deliver',
                mapId: PANLUAN_ENTRY_MAP_ID,
                deliverId: PANLUAN_ENTRY_DELIVER_ID
            });
            sendCmd('confirmEnterMap', { mapId: PANLUAN_ENTRY_MAP_ID });
        }
    }

    function beginPanluanSession(activityId) {
        if (!isSchedulerActive()) return;
        if (phase === 'GOING_PANLUAN' || phase === 'PANLUAN') return;
        if (panluanRoundCompleted) {
            log('皇陵叛乱：本轮已完成，活动时段内不再重复进入');
            return;
        }
        if (!shouldRunPanluanNow()) return;
        panluanSessionActive = true;
        panluanStartedAt = Date.now();
        panluanJoinedAt = 0;
        panluanMapIndex = 0;
        panluanJoinAttempts = 0;
        panluanWentSpawn = false;
        panluanPendingMonster = false;
        panluanLastSelectUid = null;
        panluanLastSelectTs = 0;
        log('皇陵叛乱：开始' + (activityId ? ' ·活动' + activityId : '') +
            '（封魔谷刷点 ' + PANLUAN_SPAWN_X + ',' + PANLUAN_SPAWN_Y + '，优先叛乱首领/精英）');

        var d = lastRuntimeSnapshot;
        var p = getActive();
        if (d && isPanluanMapId(d.map && d.map.mapId)) {
            syncPanluanMapIndex(d.map.mapId);
            panluanJoinedAt = Date.now();
            setPhase('PANLUAN');
            setStatus('云游平台：皇陵叛乱清怪中 ·' +
                ((PANLUAN_MAP_POOL[panluanMapIndex] || {}).mapName || d.map.mapId), 'running');
            sendCmd('setAutoFight', { type: 1 });
            if (Number(d.map.mapId) === PANLUAN_ENTRY_MAP_ID) {
                sendCmd('gotoStagePoint', {
                    x: PANLUAN_SPAWN_X,
                    y: PANLUAN_SPAWN_Y,
                    mapId: PANLUAN_ENTRY_MAP_ID
                });
            }
            return;
        }
        if (needsPanluanPrep(d, p)) {
            panluanPrepFarm = true;
            panluanPendingGoUntil = Date.now() + PANLUAN_PREP_MS;
            setPhase('GOING_PANLUAN');
            setStatus('云游平台：皇陵叛乱前回挂机', 'running');
            sendCmd('setAutoFight', { type: 3 });
            if (d && d.inDuplicate) sendCmd('exitDuplicate', {});
            returnToFarmMap(p, '皇陵叛乱前回挂机');
            setPhase('GOING_PANLUAN');
            return;
        }
        requestPanluanEnter('会话开始');
    }

    function finishPanluanSession(reason) {
        if (reason && (String(reason).indexOf('活动结束') >= 0 ||
            String(reason).indexOf('时段结束') >= 0 ||
            String(reason).indexOf('停留超时') >= 0 ||
            String(reason).indexOf('进入失败') >= 0)) {
            markPanluanRoundDone();
        }
        log('皇陵叛乱结束' + (reason ? ' ·' + reason : ''));
        resetPanluanSession();
        sendCmd('setAutoFight', { type: 3 });
        resumeFarmAfterHunt();
    }

    function preferPanluanTargetFromList(list) {
        panluanPendingMonster = false;
        panluanPendingMonsterSince = 0;
        if (phase !== 'PANLUAN') return;
        list = list || [];
        var prios = [];
        for (var i = 0; i < list.length; i++) {
            if (isPanluanPriorityMonster(list[i])) prios.push(list[i]);
        }
        if (!prios.length) return;
        prios.sort(function (a, b) {
            return (a.distance || 0) - (b.distance || 0);
        });
        var best = prios[0];
        var uid = best.id;
        var now = Date.now();
        var ct = lastRuntimeSnapshot && lastRuntimeSnapshot.combatTarget;
        var already = ct && String(ct.id) === String(uid) && !ct.isDead;
        if (already) return;
        if (!uid) return;
        if (String(panluanLastSelectUid) === String(uid) &&
            now - panluanLastSelectTs < PANLUAN_SELECT_COOLDOWN_MS) return;
        panluanLastSelectUid = uid;
        panluanLastSelectTs = now;
        sendCmd('selectMonster', { uid: uid });
        setStatus('云游平台：皇陵叛乱 ·优先' + (best.name || '首领'), 'running');
        log('皇陵叛乱：切换目标 → ' + (best.name || uid) +
            (best.distance != null ? (' ·距' + best.distance) : ''));
    }

    function onRuntimePanluan(d, p) {
        var now = Date.now();
        var cur = d && d.map ? Number(d.map.mapId) : 0;
        var alive = d && d.aliveMonsterCount != null ? Number(d.aliveMonsterCount) : -1;
        var px = d && d.player ? (d.player.gridX != null ? d.player.gridX : d.player.x) : null;
        var py = d && d.player ? (d.player.gridY != null ? d.player.gridY : d.player.y) : null;

        if (!isAnyPanluanActivityOpen() && now - panluanStartedAt > 90000) {
            finishPanluanSession('活动时段结束');
            return;
        }
        if (now - panluanStartedAt > PANLUAN_MAX_STAY_MS) {
            finishPanluanSession('停留超时');
            return;
        }

        if (phase === 'GOING_PANLUAN') {
            if (panluanPrepFarm) {
                if (d && d.inDuplicate) {
                    sendCmd('exitDuplicate', {});
                    return;
                }
                var farm = p && p.farm ? Number(p.farm.mapId) : 0;
                if ((farm && cur === farm) || now > panluanPendingGoUntil) {
                    panluanPrepFarm = false;
                    requestPanluanEnter(farm && cur === farm ? '已回挂机' : '回挂机超时');
                }
                return;
            }
            if (isPanluanMapId(cur)) {
                syncPanluanMapIndex(cur);
                panluanJoinedAt = now;
                panluanWentSpawn = false;
                setPhase('PANLUAN');
                setStatus('云游平台：皇陵叛乱清怪中 ·' +
                    ((PANLUAN_MAP_POOL[panluanMapIndex] || {}).mapName || cur), 'running');
                log('皇陵叛乱：已进入 ' +
                    ((PANLUAN_MAP_POOL[panluanMapIndex] || {}).mapName || cur) +
                    '，前往刷点并挂机');
                sendCmd('setAutoFight', { type: 1 });
                if (p && p.farm && p.farm.guajiType != null) {
                    sendCmd('setGuajiType', { type: p.farm.guajiType || 0 });
                }
                if (p && p.farm && p.farm.autoPick !== false) {
                    sendCmd('ensureFarmPickup', { enabled: true });
                }
                if (cur === PANLUAN_ENTRY_MAP_ID) {
                    sendCmd('gotoStagePoint', {
                        x: PANLUAN_SPAWN_X,
                        y: PANLUAN_SPAWN_Y,
                        mapId: PANLUAN_ENTRY_MAP_ID
                    });
                }
                return;
            }
            if (now > panluanPendingGoUntil) {
                if (panluanJoinAttempts >= 5) {
                    finishPanluanSession('进入失败');
                    return;
                }
                requestPanluanEnter('进入超时重试');
            }
            return;
        }

        if (phase === 'PANLUAN') {
            if (!isPanluanMapId(cur)) {
                if (isAnyPanluanActivityOpen()) {
                    requestPanluanEnter('离开活动图');
                    return;
                }
                finishPanluanSession('活动结束');
                return;
            }
            syncPanluanMapIndex(cur);

            if (!isAnyPanluanActivityOpen()) {
                finishPanluanSession('活动结束');
                return;
            }

            if (d && d.autoFightType !== 1) {
                sendCmd('setAutoFight', { type: 1 });
            }

            // 封魔谷：确保靠近叛乱刷点（228,209），避免大图空刷
            if (cur === PANLUAN_ENTRY_MAP_ID && !panluanWentSpawn) {
                var atSpawn = false;
                if (px != null && py != null) {
                    var dx = Math.abs(Number(px) - PANLUAN_SPAWN_X);
                    var dy = Math.abs(Number(py) - PANLUAN_SPAWN_Y);
                    atSpawn = Math.max(dx, dy) <= PANLUAN_SPAWN_ARRIVE;
                }
                if (atSpawn) {
                    panluanWentSpawn = true;
                    log('皇陵叛乱：已到刷点附近，系统挂机清怪');
                } else if (now - (panluanJoinedAt || panluanStartedAt) > 2000 &&
                    now - panluanLastSpawnGoTs > 4000) {
                    panluanLastSpawnGoTs = now;
                    sendCmd('gotoStagePoint', {
                        x: PANLUAN_SPAWN_X,
                        y: PANLUAN_SPAWN_Y,
                        mapId: PANLUAN_ENTRY_MAP_ID
                    });
                    // gotoStagePoint 会打断 autofight，需恢复
                    sendCmd('setAutoFight', { type: 1 });
                }
            }

            var ct = d.combatTarget;
            var onPrio = ct && isPanluanPriorityMonster(ct);
            setStatus('云游平台：皇陵叛乱清怪中 ·' +
                ((PANLUAN_MAP_POOL[panluanMapIndex] || {}).mapName || cur) +
                (alive >= 0 ? (' / 怪' + alive) : '') +
                (onPrio ? (' ·' + (ct.name || '首领')) : ''), 'running');

            // 视野有怪但不在优先目标上时，拉列表切换到叛乱首领/精英
            if (!onPrio && alive > 0) {
                if (panluanPendingMonster && panluanPendingMonsterSince &&
                    now - panluanPendingMonsterSince > 2500) {
                    panluanPendingMonster = false;
                    panluanPendingMonsterSince = 0;
                }
                if (!panluanPendingMonster) {
                    panluanPendingMonster = true;
                    panluanPendingMonsterSince = now;
                    sendCmd('getMonsterList');
                }
            }
        }
    }

    function resetHanghuiSession() {
        hanghuiSessionActive = false;
        hanghuiStartedAt = 0;
        hanghuiJoinedAt = 0;
        hanghuiPendingGoUntil = 0;
        hanghuiJoinAttempts = 0;
        hanghuiPrepFarm = false;
        hanghuiSawBoss = false;
        hanghuiClearSince = 0;
        hanghuiLastSelectUid = null;
        hanghuiLastSelectTs = 0;
        hanghuiPendingMonster = false;
        hanghuiPendingMonsterSince = 0;
        hanghuiActivityId = 0;
    }

    function markHanghuiRoundDone() {
        hanghuiRoundCompleted = true;
        hanghuiSessionActive = false;
        if (pendingActivityKind === 'hanghui') pendingActivityKind = null;
    }

    function isHanghuiMapId(mapId) {
        return Number(mapId) === HANGHUI_MAP_ID;
    }

    function isHanghuiTransitMapId(mapId) {
        mapId = Number(mapId);
        for (var i = 0; i < HANGHUI_TRANSIT_MAP_IDS.length; i++) {
            if (Number(HANGHUI_TRANSIT_MAP_IDS[i]) === mapId) return true;
        }
        return false;
    }

    function isHanghuiInstance(d) {
        if (!d) return false;
        if (isHanghuiMapId(d.map && d.map.mapId)) return true;
        if (d.inDuplicate && Number(d.duplicateId) === HANGHUI_DUP_ID) return true;
        return false;
    }

    function isHanghuiSpecialMonster(m) {
        if (!m || m.isDead) return false;
        var cid = Number(m.configId) || 0;
        for (var i = 0; i < HANGHUI_SPECIAL_IDS.length; i++) {
            if (Number(HANGHUI_SPECIAL_IDS[i]) === cid) return true;
        }
        var name = m.name || '';
        return name.indexOf(HANGHUI_SPECIAL_NAME) >= 0;
    }

    function isHanghuiBossMonster(m) {
        if (!m || m.isDead) return false;
        var cid = Number(m.configId) || 0;
        if (cid === HANGHUI_BOSS_ID) return true;
        var name = m.name || '';
        return name.indexOf('巨型魔猪') >= 0 || name.indexOf('行会首领') >= 0;
    }

    function pickOpenHanghuiActivityId(preferred) {
        preferred = Number(preferred) || 0;
        if (preferred && actStateMap[preferred] === 1) return preferred;
        for (var i = 0; i < HANGHUI_ACTIVITY_IDS.length; i++) {
            var id = HANGHUI_ACTIVITY_IDS[i];
            if (actStateMap[id] === 1) return id;
        }
        return preferred || HANGHUI_ACTIVITY_IDS[0];
    }

    function needsHanghuiPrep(d, p) {
        d = d || lastRuntimeSnapshot;
        p = p || getActive();
        if (!d) return false;
        if (isHanghuiInstance(d)) return false;
        if (d.inDuplicate) return true;
        var farm = p && p.farm ? Number(p.farm.mapId) : 0;
        var cur = d.map && d.map.mapId != null ? Number(d.map.mapId) : 0;
        if (!farm || !cur) return false;
        if (cur === farm) return false;
        if (isHanghuiTransitMapId(cur)) return false;
        return true;
    }

    function requestHanghuiEnter(reason) {
        hanghuiPrepFarm = false;
        hanghuiActivityId = pickOpenHanghuiActivityId(hanghuiActivityId);
        hanghuiPendingGoUntil = Date.now() + HANGHUI_JOIN_WAIT_MS;
        hanghuiJoinAttempts++;
        setPhase('GOING_HANGHUI');
        setStatus('云游平台：行会首领 → 进图', 'running');
        log('行会首领：请求进入副本 ' + HANGHUI_DUP_ID + '（活动' + hanghuiActivityId + '）' +
            (reason ? ' ·' + reason : '') + ' ·第' + hanghuiJoinAttempts + '次');
        sendCmd('setAutoFight', { type: 3 });
        sendCmd('joinDailyActivity', { id: hanghuiActivityId, reason: reason || '' });
        // 中转图确认进图
        sendCmd('confirmEnterMap', { mapId: HANGHUI_MAP_ID });
    }

    function beginHanghuiSession(activityId) {
        if (!isSchedulerActive()) return;
        if (phase === 'GOING_HANGHUI' || phase === 'HANGHUI') return;
        if (hanghuiRoundCompleted) {
            log('行会首领：本轮已完成，活动时段内不再重复进入');
            return;
        }
        if (!shouldRunHanghuiNow()) return;
        hanghuiSessionActive = true;
        hanghuiStartedAt = Date.now();
        hanghuiJoinedAt = 0;
        hanghuiJoinAttempts = 0;
        hanghuiSawBoss = false;
        hanghuiClearSince = 0;
        hanghuiLastSelectUid = null;
        hanghuiLastSelectTs = 0;
        hanghuiPendingMonster = false;
        hanghuiActivityId = pickOpenHanghuiActivityId(activityId);
        log('行会首领：开始' + (hanghuiActivityId ? ' ·活动' + hanghuiActivityId : '') +
            '（进图后系统挂机；优先击杀' + HANGHUI_SPECIAL_NAME + '）');
        var d = lastRuntimeSnapshot;
        var p = getActive();
        if (needsHanghuiPrep(d, p)) {
            hanghuiPrepFarm = true;
            hanghuiPendingGoUntil = Date.now() + HANGHUI_PREP_MS;
            setPhase('GOING_HANGHUI');
            setStatus('云游平台：行会首领前回挂机', 'running');
            sendCmd('setAutoFight', { type: 3 });
            if (d && d.inDuplicate) sendCmd('exitDuplicate', {});
            returnToFarmMap(p, '行会首领前回挂机');
            setPhase('GOING_HANGHUI');
            return;
        }
        requestHanghuiEnter('会话开始');
    }

    function finishHanghuiSession(reason) {
        if (reason && (String(reason).indexOf('活动结束') >= 0 ||
            String(reason).indexOf('时段结束') >= 0 ||
            String(reason).indexOf('Boss已击杀') >= 0 ||
            String(reason).indexOf('离开副本') >= 0 ||
            String(reason).indexOf('停留超时') >= 0 ||
            String(reason).indexOf('进入失败') >= 0)) {
            markHanghuiRoundDone();
        }
        log('行会首领结束' + (reason ? ' ·' + reason : ''));
        resetHanghuiSession();
        sendCmd('setAutoFight', { type: 3 });
        var d = lastRuntimeSnapshot;
        if (d && d.inDuplicate && Number(d.duplicateId) === HANGHUI_DUP_ID) {
            sendCmd('exitDuplicate', {});
        }
        resumeFarmAfterHunt();
    }

    function preferHanghuiSpecialFromList(list) {
        hanghuiPendingMonster = false;
        hanghuiPendingMonsterSince = 0;
        if (phase !== 'HANGHUI') return;
        list = list || [];
        var specials = [];
        var bossAlive = false;
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (isHanghuiSpecialMonster(m)) specials.push(m);
            if (isHanghuiBossMonster(m)) {
                bossAlive = true;
                hanghuiSawBoss = true;
            }
        }
        if (specials.length) {
            hanghuiClearSince = 0;
            specials.sort(function (a, b) {
                return (a.distance || 0) - (b.distance || 0);
            });
            var best = specials[0];
            var uid = best.id;
            var now = Date.now();
            var ct = lastRuntimeSnapshot && lastRuntimeSnapshot.combatTarget;
            var already = ct && String(ct.id) === String(uid) && !ct.isDead;
            if (!already && uid &&
                (String(hanghuiLastSelectUid) !== String(uid) ||
                    now - hanghuiLastSelectTs >= HANGHUI_SELECT_COOLDOWN_MS)) {
                hanghuiLastSelectUid = uid;
                hanghuiLastSelectTs = now;
                sendCmd('selectMonster', { uid: uid });
                setStatus('云游平台：行会首领 ·优先' + HANGHUI_SPECIAL_NAME +
                    ' x' + specials.length, 'running');
                log('行会首领：切换攻击目标 → ' + (best.name || HANGHUI_SPECIAL_NAME) +
                    (best.distance != null ? (' ·距' + best.distance) : ''));
            }
            return;
        }
        // 无小怪：留给系统挂机打 Boss；Boss 消失且曾见过 → 清场结束
        if (hanghuiSawBoss && !bossAlive) {
            if (!hanghuiClearSince) hanghuiClearSince = Date.now();
            if (Date.now() - hanghuiClearSince >= HANGHUI_CLEAR_MS) {
                finishHanghuiSession('Boss已击杀');
            }
        } else {
            hanghuiClearSince = 0;
        }
    }

    function onRuntimeHanghui(d, p) {
        var now = Date.now();
        var cur = d && d.map ? Number(d.map.mapId) : 0;
        var inInst = isHanghuiInstance(d);

        if (!isAnyHanghuiActivityOpen() && now - hanghuiStartedAt > 90000) {
            finishHanghuiSession('活动时段结束');
            return;
        }
        if (now - hanghuiStartedAt > HANGHUI_MAX_STAY_MS) {
            finishHanghuiSession('停留超时');
            return;
        }

        if (phase === 'GOING_HANGHUI') {
            if (hanghuiPrepFarm) {
                if (d && d.inDuplicate) {
                    sendCmd('exitDuplicate', {});
                    return;
                }
                var farm = p && p.farm ? Number(p.farm.mapId) : 0;
                if ((farm && cur === farm) || now > hanghuiPendingGoUntil) {
                    hanghuiPrepFarm = false;
                    requestHanghuiEnter(farm && cur === farm ? '已回挂机' : '回挂机超时');
                }
                return;
            }
            if (inInst) {
                hanghuiJoinedAt = now;
                hanghuiClearSince = 0;
                hanghuiSawBoss = false;
                setPhase('HANGHUI');
                setStatus('云游平台：行会首领挂机中', 'running');
                log('行会首领：已进入地图 ' + HANGHUI_MAP_ID + '，系统挂机；出现' +
                    HANGHUI_SPECIAL_NAME + '时优先切换目标');
                // 进图后交给游戏自动挂机，平台只做目标切换
                sendCmd('setAutoFight', { type: 1 });
                if (p && p.farm && p.farm.guajiType != null) {
                    sendCmd('setGuajiType', { type: p.farm.guajiType || 0 });
                }
                if (p && p.farm && p.farm.autoPick !== false) {
                    sendCmd('ensureFarmPickup', { enabled: true });
                }
                return;
            }
            if (isHanghuiTransitMapId(cur)) {
                setStatus('云游平台：行会首领 ·中转图' + cur, 'running');
                if (now > hanghuiPendingGoUntil - 6000) {
                    sendCmd('confirmEnterMap', { mapId: HANGHUI_MAP_ID });
                    sendCmd('joinDailyActivity', { id: hanghuiActivityId || pickOpenHanghuiActivityId() });
                    hanghuiPendingGoUntil = now + HANGHUI_JOIN_WAIT_MS;
                }
                return;
            }
            if (now > hanghuiPendingGoUntil) {
                if (hanghuiJoinAttempts >= 4) {
                    finishHanghuiSession('进入失败');
                    return;
                }
                requestHanghuiEnter('进入超时重试');
            }
            return;
        }

        if (phase === 'HANGHUI') {
            if (!inInst) {
                if (isHanghuiTransitMapId(cur) && isAnyHanghuiActivityOpen()) {
                    setPhase('GOING_HANGHUI');
                    hanghuiPendingGoUntil = now + HANGHUI_JOIN_WAIT_MS;
                    sendCmd('confirmEnterMap', { mapId: HANGHUI_MAP_ID });
                    sendCmd('joinDailyActivity', { id: hanghuiActivityId || pickOpenHanghuiActivityId() });
                    return;
                }
                if (isAnyHanghuiActivityOpen() && now - (hanghuiJoinedAt || hanghuiStartedAt) < 5000) {
                    return;
                }
                finishHanghuiSession(isAnyHanghuiActivityOpen() ? '离开副本' : '活动结束');
                return;
            }
            if (!isAnyHanghuiActivityOpen()) {
                finishHanghuiSession('活动结束');
                return;
            }
            // 保持系统挂机；不主动改打法，仅确保 autofight 开着
            if (d && d.autoFightType !== 1) {
                sendCmd('setAutoFight', { type: 1 });
            }
            var ct = d.combatTarget;
            var onSpecial = ct && isHanghuiSpecialMonster(ct);
            setStatus('云游平台：行会首领挂机中' +
                (onSpecial ? (' ·打' + HANGHUI_SPECIAL_NAME) :
                    (ct && ct.name ? (' ·' + ct.name) : '')), 'running');

            // 已在打小怪则不必频繁拉列表；否则轮询以便切换目标
            if (!onSpecial) {
                if (hanghuiPendingMonster && hanghuiPendingMonsterSince &&
                    now - hanghuiPendingMonsterSince > 2500) {
                    hanghuiPendingMonster = false;
                    hanghuiPendingMonsterSince = 0;
                }
                if (!hanghuiPendingMonster) {
                    hanghuiPendingMonster = true;
                    hanghuiPendingMonsterSince = now;
                    sendCmd('getMonsterList');
                }
            }
            if (ct && isHanghuiBossMonster(ct)) hanghuiSawBoss = true;
        }
    }
