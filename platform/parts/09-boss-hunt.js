    function getHuntArriveMapId(watch) {
        if (!watch) return 0;
        var a = parseInt(watch.arriveMapId, 10);
        if (a) return a;
        // 目录里可能已带 arriveMapId
        if (bossCatalog && bossCatalog.length && watch.type != null) {
            for (var i = 0; i < bossCatalog.length; i++) {
                var b = bossCatalog[i];
                if (Number(b.type) !== Number(watch.type)) continue;
                var locs = b.locations || [];
                for (var j = 0; j < locs.length; j++) {
                    if (parseInt(locs[j].mapId, 10) !== parseInt(watch.mapId, 10)) continue;
                    a = parseInt(locs[j].arriveMapId, 10);
                    if (a) {
                        watch.arriveMapId = a;
                        return a;
                    }
                }
            }
        }
        return parseInt(watch.mapId, 10) || 0;
    }

    /** 是否已到达猎杀目标图（配置 mapId 或 deliver 实际落地 arriveMapId） */
    function isOnHuntTargetMap(curMapId, watch) {
        curMapId = parseInt(curMapId, 10);
        if (!curMapId || !watch) return false;
        var cfgMap = parseInt(watch.mapId, 10);
        if (curMapId === cfgMap) return true;
        var arrive = getHuntArriveMapId(watch);
        return !!(arrive && curMapId === arrive);
    }

    function findWatchByKey(key) {
        for (var i = 0; i < selectedBossWatch.length; i++) {
            if (selectedBossWatch[i].key === key) return selectedBossWatch[i];
        }
        if (typeof findExtraWatchByKey === 'function') {
            var ex = findExtraWatchByKey(key);
            if (ex) return ex;
        }
        return null;
    }

    function gridDist(x1, y1, x2, y2) {
        var dx = (Number(x1) || 0) - (Number(x2) || 0);
        var dy = (Number(y1) || 0) - (Number(y2) || 0);
        return Math.sqrt(dx * dx + dy * dy);
    }

    function resolveHuntSpawnPoint(watch) {
        if (!watch) return null;
        var sx = Number(watch.spawnX) || 0;
        var sy = Number(watch.spawnY) || 0;
        if (sx > 0 && sy > 0) return { x: sx, y: sy };
        for (var i = 0; i < bossCatalog.length; i++) {
            var b = bossCatalog[i];
            if (Number(b.type) !== Number(watch.type)) continue;
            var locs = b.locations || [];
            for (var j = 0; j < locs.length; j++) {
                var loc = locs[j];
                if (parseInt(loc.mapId, 10) !== parseInt(watch.mapId, 10)) continue;
                sx = Number(loc.spawnX) || 0;
                sy = Number(loc.spawnY) || 0;
                if (loc.arriveMapId) watch.arriveMapId = loc.arriveMapId;
                if (sx > 0 && sy > 0) {
                    watch.spawnX = sx;
                    watch.spawnY = sy;
                    return { x: sx, y: sy };
                }
            }
        }
        return null;
    }

    function mergeSpawnCoordsFromCatalog() {
        if (!bossCatalog.length || !selectedBossWatch.length) return;
        var flat = flattenBossCatalog(bossCatalog);
        var byKey = {};
        flat.forEach(function (it) { byKey[it.key] = it; });
        selectedBossWatch.forEach(function (w) {
            var it = byKey[w.key];
            if (!it) return;
            if ((!w.spawnX || !w.spawnY) && it.spawnX && it.spawnY) {
                w.spawnX = it.spawnX;
                w.spawnY = it.spawnY;
            }
            if (!w.arriveMapId && it.arriveMapId) w.arriveMapId = it.arriveMapId;
        });
    }

    function resetHuntSpawnState() {
        huntSpawnX = 0;
        huntSpawnY = 0;
        huntMovingToSpawn = false;
        huntAtSpawnSince = 0;
        huntUseRandomFallback = false;
        lastGotoSpawnTs = 0;
    }

    function setupHuntSpawnPoint(watch) {
        resetHuntSpawnState();
        var pt = resolveHuntSpawnPoint(watch);
        if (!pt) {
            huntUseRandomFallback = true;
            return null;
        }
        huntSpawnX = pt.x;
        huntSpawnY = pt.y;
        return pt;
    }

    function stripMonsterName(name) {
        return String(name || '')
            .replace(/<[^>]+>/g, '')
            .replace(/\[[^\]]*\]/g, '')
            .trim();
    }

    function resolveBossIdByType(type) {
        type = Number(type);
        if (!type) return 0;
        for (var i = 0; i < bossCatalog.length; i++) {
            if (Number(bossCatalog[i].type) === type) return Number(bossCatalog[i].bossId) || 0;
        }
        return 0;
    }

    function ensureHuntTargetBossMeta(watch) {
        if (!watch) return watch;
        if ((!watch.bossId || !watch.bossName) && bossCatalog.length) {
            for (var i = 0; i < bossCatalog.length; i++) {
                var b = bossCatalog[i];
                if (Number(b.type) !== Number(watch.type)) continue;
                if (!watch.bossId) watch.bossId = b.bossId;
                if (!watch.bossName) watch.bossName = b.bossName;
                break;
            }
        }
        return watch;
    }

    function huntPlayerGridPos(player) {
        if (!player) return null;
        var px = player.gridX != null ? Number(player.gridX) : NaN;
        var py = player.gridY != null ? Number(player.gridY) : NaN;
        if ((!isNaN(px) && px > 500) || (!isNaN(py) && py > 500)) {
            px = Math.round(px / 48);
            py = Math.round(py / 48);
        }
        if (isNaN(px) || isNaN(py)) {
            px = Number(player.x);
            py = Number(player.y);
        }
        if (isNaN(px) || isNaN(py)) return null;
        return { x: px, y: py };
    }

    function isNearHuntSpawn(player, radius) {
        if (!huntSpawnX || !huntSpawnY || !player) return false;
        var pos = huntPlayerGridPos(player);
        if (!pos) return false;
        return gridDist(pos.x, pos.y, huntSpawnX, huntSpawnY) <= (radius || HUNT_SPAWN_ARRIVE_RADIUS);
    }

    function runtimeMonsterCandidate(src) {
        if (!src || !src.id) return null;
        return {
            id: src.id,
            name: src.name || '',
            configId: src.configId != null ? src.configId : 0,
            hp: src.hp != null ? src.hp : 1,
            maxHp: src.maxHp != null ? src.maxHp : (src.hpMax != null ? src.hpMax : 0),
            isDead: !!src.isDead
        };
    }

    /** 用 getRuntimeState 快照同步锁定，避免只等 getMonsterList 回调导致到点不打 */
    function tryLockBossFromRuntime(d, reason) {
        if (huntSawBoss || !huntTarget || !d) return false;
        var candidates = [];
        if (d.combatTarget && d.combatTarget.id) candidates.push(d.combatTarget);
        if (d.nearestMonster && d.nearestMonster.id) candidates.push(d.nearestMonster);
        for (var i = 0; i < candidates.length; i++) {
            var m = runtimeMonsterCandidate(candidates[i]);
            if (!m || !matchHuntBossMonster(m)) continue;
            return lockHuntBoss(m, reason || 'runtime视野');
        }
        return false;
    }

    function markHuntSpawnArrived(now, reason) {
        if (huntAtSpawnSince) return;
        huntMovingToSpawn = false;
        huntAtSpawnSince = now || Date.now();
        log((reason || '已到达刷新点') + ' (' + huntSpawnX + ',' + huntSpawnY + ')，搜寻周围 Boss');
    }

    function sendGotoHuntSpawn(mapId) {
        if (!huntSpawnX || !huntSpawnY || huntSawBoss) return;
        lastGotoSpawnTs = Date.now();
        sendCmd('gotoStagePoint', {
            x: huntSpawnX,
            y: huntSpawnY,
            mapId: parseInt(mapId, 10) || 0
        });
    }

    function isMonsterAliveForHunt(m) {
        return !!(m && !m.isDead);
    }

    function canConfirmBossKill(now) {
        if (!huntBossLockedAt) return false;
        return (now || Date.now()) - huntBossLockedAt >= HUNT_MIN_FIGHT_MS;
    }

    function matchHuntBossIdentity(m) {
        if (!m || !huntTarget) return false;
        if (huntKind === 'moying') {
            return !!(m.name && String(m.name).indexOf(MOYING_BOSS_NAME) >= 0);
        }
        var bid = huntTarget.bossId != null ? Number(huntTarget.bossId) : 0;
        if (!bid) bid = resolveBossIdByType(huntTarget.type);
        var name = stripMonsterName(huntTarget.bossName || '');
        var mn = stripMonsterName(m.name || '');
        if (bid && Number(m.configId) === bid) return true;
        if (name && mn && (mn.indexOf(name) >= 0 || name.indexOf(mn) >= 0)) return true;
        return false;
    }

    function findBossFromMonsterList(list) {
        list = list || [];
        var direct = null;
        var nearSpawn = null;
        var nearSpawnDist = 9999;
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (!matchHuntBossMonster(m)) continue;
            if (!direct) direct = m;
            if (huntSpawnX && huntSpawnY) {
                var dist = gridDist(m.x, m.y, huntSpawnX, huntSpawnY);
                if (dist < nearSpawnDist) {
                    nearSpawnDist = dist;
                    nearSpawn = m;
                }
            }
        }
        if (nearSpawn && nearSpawnDist <= HUNT_SPAWN_BOSS_RADIUS) return nearSpawn;
        return direct;
    }

    function logBossScanMiss(list, tag) {
        if (!list || !list.length) {
            if (!window.__lastBossScanEmpty || Date.now() - window.__lastBossScanEmpty > 12000) {
                window.__lastBossScanEmpty = Date.now();
                log('Boss扫描(' + (tag || '-') + '): 视野无怪 · 目标' +
                    (huntTarget ? ((huntTarget.bossName || '') + ' id=' + (huntTarget.bossId || '?')) : '-'));
            }
            return;
        }
        if (!window.__lastBossScanMiss || Date.now() - window.__lastBossScanMiss > 12000) {
            window.__lastBossScanMiss = Date.now();
            var sample = list.slice(0, 3).map(function (m) {
                return (stripMonsterName(m.name) || '?') + '@' + m.x + ',' + m.y +
                    ' cfg=' + m.configId + ' hp=' + m.hp;
            }).join(' | ');
            log('Boss扫描(' + (tag || '-') + '): 未匹配 · 目标' +
                (huntTarget ? ((huntTarget.bossName || '') + ' id=' + (huntTarget.bossId || resolveBossIdByType(huntTarget.type))) : '') +
                ' ·样例 ' + sample);
        }
    }

    function matchHuntBossMonster(m) {
        return matchHuntBossIdentity(m) && isMonsterAliveForHunt(m);
    }

    function lockHuntBoss(found, reason) {
        if (!found || huntSawBoss || !isMonsterAliveForHunt(found)) return false;
        var p = getActive();
        if (window.FarmTacticsModule && FarmTacticsModule.shouldSkipBossAtLock && p) {
            var snap = lastRuntimeSnapshot || {};
            if (FarmTacticsModule.shouldSkipBossAtLock(found, snap.player, p.farm && p.farm.tactics)) {
                var pct = found.hpMax ? Math.round((found.hp / found.hpMax) * 100) : '?';
                finishHunt('BOSS非归属(发现时hp' + pct + '%·' +
                    (found.ownerName || (found.ownerUid ? found.ownerUid : '无归属')) + ')');
                return false;
            }
        }
        huntSawBoss = true;
        huntBossMissingSince = 0;
        huntBossLastSeenAt = Date.now();
        huntBossLockedAt = Date.now();
        huntBossLastHp = found.hp != null && !isNaN(Number(found.hp)) ? Number(found.hp) : -1;
        huntBossHpProgressAt = Date.now();
        lastHuntHpCheckTs = 0;
        huntMovingToSpawn = false;
        log('发现目标 Boss: ' + found.name + ' hp=' + found.hp +
            ' cfg=' + found.configId + (reason ? ' ·' + reason : ''));
        sendCmd('setAutoFight', { type: 3 });
        sendCmd('selectMonster', { uid: found.id });
        sendCmd('setGuajiType', { type: 1 });
        sendCmd('setAutoFight', { type: 1 });
        return true;
    }

    /** 从 runtime 快照取当前猎杀目标血量；匹配不到返回 null */
    function readHuntBossHpFromRuntime(d) {
        if (!d || !huntTarget) return null;
        var candidates = [];
        if (d.combatTarget && d.combatTarget.id) candidates.push(d.combatTarget);
        if (d.nearestMonster && d.nearestMonster.id) candidates.push(d.nearestMonster);
        for (var i = 0; i < candidates.length; i++) {
            var m = runtimeMonsterCandidate(candidates[i]);
            if (!m || !matchHuntBossIdentity(m)) continue;
            if (m.isDead) return 0;
            var hp = Number(m.hp);
            return isNaN(hp) ? null : hp;
        }
        return null;
    }

    /**
     * 锁定后每 HUNT_HP_CHECK_MS 确认一次血量：
     * - 血量下降 → 重置无进度计时
     * - 血量≤0 → 视为击杀
     * - 血量长时间无变化 → 无进度超时放弃
     */
    function checkHuntBossHpProgress(d, p, now) {
        now = now || Date.now();
        if (!huntSawBoss || !huntTarget) return false;
        if (now - lastHuntHpCheckTs < HUNT_HP_CHECK_MS) return false;
        lastHuntHpCheckTs = now;

        var hp = readHuntBossHpFromRuntime(d);
        var stallSec = (p && p.boss && p.boss.huntSec != null) ? Number(p.boss.huntSec) : 180;
        if (isNaN(stallSec) || stallSec < 30) stallSec = 180;

        if (hp == null) {
            // 视野暂时读不到血量：不推进进度时钟，仍用 missing 逻辑；仅日志节流
            setStatus('云游平台：猎杀 ' + (huntTarget.bossName || '') +
                ' ·确认血量中' + (huntBossLastHp >= 0 ? (' ·上次hp=' + huntBossLastHp) : ''), 'running');
            return false;
        }

        if (hp <= 0) {
            onBossKilledSignal('Boss血量归零');
            return true;
        }

        if (huntBossLastHp < 0 || hp < huntBossLastHp) {
            if (huntBossLastHp >= 0 && hp < huntBossLastHp) {
                log('Boss血量确认: ' + huntBossLastHp + ' → ' + hp + ' ·有进度', 'verbose');
            }
            huntBossLastHp = hp;
            huntBossHpProgressAt = now;
        } else if (hp > huntBossLastHp) {
            // 读数回升（切目标/滞后）：同步但不算无进度
            huntBossLastHp = hp;
            huntBossHpProgressAt = now;
        }

        var noProgressMs = now - (huntBossHpProgressAt || huntBossLockedAt || now);
        setStatus('云游平台：猎杀 ' + (huntTarget.bossName || '') +
            ' ·hp=' + hp +
            (noProgressMs > 15000 ? (' ·无变化' + Math.round(noProgressMs / 1000) + 's') : ''), 'running');

        if (noProgressMs >= stallSec * 1000) {
            abandonHunt('无进度超时(血量' + stallSec + 's未下降)');
            return true;
        }
        return false;
    }

    function getHuntTargetLocationAlive() {
        return getWatchAliveStatus(huntTarget);
    }

    /** 猎杀途中轮询目标 Boss 存活（进图后、锁定前） */
    function maybePollHuntBossStatus(now) {
        if (!huntTarget || huntSawBoss) return;
        if (phase !== 'GOING_BOSS' && phase !== 'HUNTING_BOSS') return;
        now = now || Date.now();
        if (now - lastHuntPrelockPollTs < HUNT_PRELOCK_POLL_MS) return;
        lastHuntPrelockPollTs = now;
        if (huntTarget.type != null && huntTarget.type !== '') {
            sendCmd('requestShoulingBoss', { type: huntTarget.type });
            setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 350);
        } else if (huntTarget.mapId) {
            sendCmd('getExtraMapAlive', { mapIds: [huntTarget.mapId] });
            if (huntTarget.arpg) sendCmd('getBossInfo');
        }
    }

    /** 目标已被他人击杀/未刷新时提前结束猎杀 */
    function checkHuntTargetStillAlive(reason) {
        if (huntSawBoss || !huntTarget) return true;
        var alive = getHuntTargetLocationAlive();
        if (alive != null && alive <= 0) {
            finishHunt(reason || '目标已被击杀(未刷新)');
            return false;
        }
        return true;
    }

    function ensureHuntSpawnProgress(now, d) {
        now = now || Date.now();
        if (huntSawBoss || huntUseRandomFallback || !huntArrivedAt) return;
        // 未到刷新点：寻路过久才启用随机兜底（不计入进图后的搜寻计时）
        if (huntAtSpawnSince || !lastGotoSpawnTs || !huntSpawnX || !huntSpawnY) return;
        if (now - lastGotoSpawnTs < HUNT_PATH_MAX_MS) return;
        var near = d && isNearHuntSpawn(d.player, HUNT_SPAWN_ARRIVE_RADIUS + 8);
        if (near) return;
        huntUseRandomFallback = true;
        huntMovingToSpawn = false;
        log('寻路过久未抵达刷新点(' + huntSpawnX + ',' + huntSpawnY + ')，启用随机寻怪兜底');
    }

    function onRuntimeBossFight(d, p, targetMap, now) {
        if (d.autoFightType !== 1) {
            sendCmd('setGuajiType', { type: 1 });
            sendCmd('setAutoFight', { type: 1 });
        }
        setPhase('HUNTING_BOSS');
        setStatus('云游平台：猎杀 ' + (huntTarget.bossName || '') + ' @ ' +
            (huntTarget.mapName || targetMap) +
            (huntBossLastHp >= 0 ? (' ·hp=' + huntBossLastHp) : '') +
            (huntUseRandomFallback ? (' ·随机' + huntRandomUsed) : ''), 'running');

        // 每 10s 确认血量；无下降超过配置秒数才放弃（取代从进图起算的硬超时）
        if (checkHuntBossHpProgress(d, p, now)) return;

        if (now - lastHuntStatusPollTs > 3000) {
            lastHuntStatusPollTs = now;
            if (huntTarget.type != null && huntTarget.type !== '') {
                sendCmd('requestShoulingBoss', { type: huntTarget.type });
                setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 350);
            } else if (huntTarget.mapId) {
                sendCmd('getExtraMapAlive', { mapIds: [huntTarget.mapId] });
                if (huntTarget.arpg) sendCmd('getBossInfo');
            }
        }

        var alive3 = getBossAlive(targetMap, huntTarget ? huntTarget.type : null);
        // 刚锁定时 108004 可能仍显示存活；且须至少打过一段时间才信服务端未刷新
        if (alive3 != null && Number(alive3) <= 0 && huntBossLockedAt &&
            now - huntBossLockedAt > 8000) {
            onBossKilledSignal('击杀完成');
        }
        if (runFarmTacticsRuntime(d, p)) return;
    }

    function findWatchByMap(mapId, type) {
        mapId = parseInt(mapId, 10);
        var candidates = [];
        for (var i = 0; i < selectedBossWatch.length; i++) {
            if (parseInt(selectedBossWatch[i].mapId, 10) === mapId) candidates.push(selectedBossWatch[i]);
        }
        if (!candidates.length) return null;
        if (type != null && type !== '') {
            for (var j = 0; j < candidates.length; j++) {
                if (Number(candidates[j].type) === Number(type)) return candidates[j];
            }
        }
        return candidates[0];
    }

    /** 只入队，不在回程/猎杀中途强行切目标；仅 FARMING 时启动下一只 */
    function enqueueHunt(watch, reason) {
        if (!watch || !watch.key) return;
        var p = getActive();
        if (!p || !p.boss || !p.boss.enabled) return;
        if (huntFailCooldown[watch.key] && Date.now() < huntFailCooldown[watch.key]) return;
        if (huntTarget && huntTarget.key === watch.key) return;
        if (huntQueue.indexOf(watch.key) >= 0) return;
        huntQueue.push(watch.key);
        log('入队猎杀: ' + (watch.bossName || '') + '@' + (watch.mapName || watch.mapId) +
            (reason ? ' ·' + reason : '') + '（队列' + huntQueue.length + '）');
        tryStartNextHunt();
    }

    /**
     * 边沿触发：仅当 未刷新/未知 → 已刷新 时入队。
     * 持续已刷新不会反复入队，避免挂机↔Boss 来回抢。
     * @param {object} [opts]
     * @param {boolean} [opts.allowEnqueue=true] 轮询仅同步状态时传 false
     */
    function setBossAliveAndEnqueue(mapId, isAlive, reason, type, opts) {
        mapId = parseInt(mapId, 10);
        if (!mapId) return;
        opts = opts || {};
        var allowEnqueue = opts.allowEnqueue !== false;
        var key = bossAliveKey(mapId, type);
        var prev = bossAliveMap[key];
        var known = !!bossAliveKnown[key];
        var newAlive = Number(isAlive) || 0;
        setBossAlive(mapId, type, newAlive);

        if (newAlive <= 0) {
            // 未刷新时保留 postHuntAliveCooldown，防止同秒轮询假存活立刻再入队
            return;
        }

        if (!allowEnqueue) return;

        var nowAlive = newAlive > 0;
        var wasDeadOrUnknown = !known || prev == null || Number(prev) <= 0;
        var edge = nowAlive && wasDeadOrUnknown;
        if (!edge) return;
        var w = findWatchByMap(mapId, type);
        if (w) {
            if (!(postHuntAliveCooldown[w.key] && Date.now() < postHuntAliveCooldown[w.key]) &&
                !(huntFailCooldown[w.key] && Date.now() < huntFailCooldown[w.key])) {
                var catAlive = getWatchAliveFromCatalog(w);
                if (catAlive == null || catAlive > 0) {
                    enqueueHunt(w, reason || '状态变已刷新');
                }
            }
        }
        // 皇陵同图多 Boss / 恶魔广场：按地图补入已勾选扩展项
        if (typeof enqueueExtraBossByMap === 'function') {
            enqueueExtraBossByMap(mapId, reason || '状态变已刷新');
        }
    }

    /**
     * 对账补入队：已关注且当前存活，但不在队列/猎杀中 → 补入。
     * 用于边沿丢失、或「接收推送」曾挡住入队后的修复；打完后有短冷却防连打。
     */
    function enqueueMissingAliveWatches(reason) {
        var p = getActive();
        if (!p || !p.boss || !p.boss.enabled) return;
        var watches = selectedBossWatch.slice();
        if (typeof getEnabledExtraWatches === 'function') {
            watches = watches.concat(getEnabledExtraWatches());
        }
        if (!watches.length) return;
        var now = Date.now();
        var added = 0;
        var seenKey = {};
        for (var i = 0; i < watches.length; i++) {
            var w = watches[i];
            if (!w || !w.key || seenKey[w.key]) continue;
            seenKey[w.key] = 1;
            var alive = getWatchAliveStatus(w);
            if (alive == null || Number(alive) <= 0) continue;
            // catalog 未收到该 type 的 108004 时 aliveKnown=false，勿对账入队
            var fromCat = null;
            if (w.type != null && bossCatalog && bossCatalog.length) {
                for (var ci = 0; ci < bossCatalog.length; ci++) {
                    if (Number(bossCatalog[ci].type) !== Number(w.type)) continue;
                    var locs = bossCatalog[ci].locations || [];
                    for (var lj = 0; lj < locs.length; lj++) {
                        if (parseInt(locs[lj].mapId, 10) === parseInt(w.mapId, 10)) {
                            fromCat = locs[lj];
                            break;
                        }
                    }
                    break;
                }
            }
            if (fromCat && fromCat.aliveKnown === false) continue;
            if (huntTarget && huntTarget.key === w.key) continue;
            if (huntQueue.indexOf(w.key) >= 0) continue;
            if (postHuntAliveCooldown[w.key] && now < postHuntAliveCooldown[w.key]) continue;
            if (huntFailCooldown[w.key] && now < huntFailCooldown[w.key]) continue;
            enqueueHunt(w, reason || '存活对账入队');
            added++;
        }
        if (added) log('存活对账补入队 ' + added + ' 个' + (reason ? ' ·' + reason : ''));
    }

    function matchWatchListAlive(reason) {
        // 已废弃：请用 setBossAliveAndEnqueue 边沿入队，避免「持续已刷新」反复入队
    }

    /** 策略：只在挂机稳态 FARMING 时出发下一只；无会员且空格不足时先传送回收 */
    function tryStartNextHunt(d) {
        d = d || lastRuntimeSnapshot;
        if (phase !== 'FARMING') return;
        if (huntTarget) return;
        var p = getActive();
        if (window.TaskModule && TaskModule.shouldRunBeforeBoss(p)) {
            if (TaskModule.onRuntimeFarmGate(d, p)) return;
        }
        if (pendingBossAfterRecycle) return;
        if (shouldDeferLowerPriorityForTasks(p)) return;
        if (shouldDeferToActivity()) return;
        if (pendingActivityKind) return;
        if (!p || !p.boss || !p.boss.enabled) {
            huntQueue = [];
            return;
        }
        while (huntQueue.length) {
            var key = huntQueue.shift();
            var w = findWatchByKey(key);
            if (!w) continue;
            if (huntFailCooldown[w.key] && Date.now() < huntFailCooldown[w.key]) continue;
            var alive = getWatchAliveStatus(w);
            if (alive != null && Number(alive) <= 0) {
                log('跳过已未刷新: ' + (w.bossName || '') + '@' + (w.mapName || w.mapId));
                continue;
            }
            if (d && d.hasPortableRecycle === false && needBagSlotAction(p, d, 'autoRecycle', 7)) {
                huntQueue.unshift(key);
                startNpcRecycle(p, '打 Boss 前清包', { beforeBoss: true, watch: w });
                return;
            }
            beginHunt(w);
            return;
        }
    }

    function beginHunt(watch) {
        huntKind = 'boss';
        watch = ensureHuntTargetBossMeta(watch);
        var aliveCheck = getWatchAliveStatus(watch);
        if (aliveCheck != null && aliveCheck <= 0) {
            log('跳过猎杀: ' + (watch.bossName || '') + '@' + (watch.mapName || watch.mapId) +
                ' ·出发时目标已未刷新');
            huntQueue = huntQueue.filter(function (k) { return k !== watch.key; });
            tryStartNextHunt();
            return;
        }
        huntTarget = watch;
        huntStartedAt = Date.now();
        huntArrivedAt = 0;
        huntSawBoss = false;
        huntPendingMonster = false;
        huntRandomUsed = 0;
        lastRandomTs = 0;
        lastRandomNoItem = false;
        huntBossMissingSince = 0;
        huntBossLastSeenAt = 0;
        huntBossLockedAt = 0;
        huntBossLastHp = -1;
        huntBossHpProgressAt = 0;
        lastHuntHpCheckTs = 0;
        lastHuntStatusPollTs = 0;
        resetHuntSpawnState();
        if (watch && watch.key) huntGoRetryCount[watch.key] = 0;
        lastRandomBuyTs = 0;
        randomBuyPendingUntil = 0;
        // 清掉上次拾取劫持，避免 setAutoFight(1) 被拦成 3、打不到 Boss
        sendCmd('endLootMode');
        // 队列中去掉自己，避免重复
        huntQueue = huntQueue.filter(function (k) { return k !== watch.key; });
        // 补齐 deliver 实际落地地图（火龙教主等 mapId≠toMapId）
        getHuntArriveMapId(watch);
        resolveHuntSpawnPoint(watch);
        setPhase('GOING_BOSS');
        setStatus('云游平台：前往 Boss ' + (watch.bossName || '') + ' @ ' + (watch.mapName || watch.mapId), 'running');
        var arriveHint = watch.arriveMapId && Number(watch.arriveMapId) !== Number(watch.mapId)
            ? (' 落地图' + watch.arriveMapId)
            : '';
        log('停挂机，前往 Boss → ' + (watch.bossName || '') + ' 地图' + watch.mapId +
            arriveHint +
            (watch.deliver ? ' deliver=' + watch.deliver : ''));
        sendCmd('setAutoFight', { type: 3 });
        pendingGoBossUntil = 0;
        // 有首领 deliver 时强制 deliver，避免 mapPlay 同图抢进法导致进不去
        sendCmd('goMap', {
            type: watch.deliver ? 'deliver' : 'auto',
            mapId: watch.mapId,
            deliverId: watch.deliver || 0
        });
        pendingGoBossUntil = Date.now() + 5000;
        if (watch.type != null && watch.type !== '') {
            sendCmd('requestShoulingBoss', { type: watch.type });
        }
    }

    /**
     * 统一出口：杀完/放弃/超时/未刷新 都走这里。
     * 有队列且开启 skipFarm 时直接下一只；否则先回挂机，到 FARMING 再 tryStartNextHunt。
     */
    function finishHunt(reason) {
        if (huntKind === 'moying') {
            if (isMoyingKillFinishReason(reason)) {
                resumeMoyingSearchAfterKill(reason);
                return;
            }
            finishMoyingHunt(reason);
            return;
        }
        var w = huntTarget;
        log('结束猎杀: ' + (w ? ((w.bossName || '') + '@' + (w.mapName || w.mapId)) : '-') +
            (reason ? ' ·' + reason : ''));
        if (w && reason && (reason.indexOf('随机') >= 0 || reason.indexOf('无随机') >= 0 || reason.indexOf('进图失败') >= 0)) {
            huntFailCooldown[w.key] = Date.now() + 120000;
        }
        // 非归属/被占：Boss 仍存活，加冷却防轮询对账立刻再派
        if (w && reason && reason.indexOf('非归属') >= 0) {
            huntFailCooldown[w.key] = Date.now() + 120000;
            postHuntAliveCooldown[w.key] = Date.now() + 120000;
        }
        if (w && reason && (
            reason.indexOf('击杀') >= 0 || reason.indexOf('拾取') >= 0 ||
            reason.indexOf('未刷新') >= 0 || reason.indexOf('占有') >= 0 ||
            reason.indexOf('已被击杀') >= 0
        ) && reason.indexOf('出发时') < 0 && reason.indexOf('跳过猎杀') < 0) {
            postHuntAliveCooldown[w.key] = Date.now() + 90000;
            setBossAlive(w.mapId, w.type, 0);
        }
        if (w) {
            huntQueue = huntQueue.filter(function (k) { return k !== w.key; });
        }
        huntTarget = null;
        huntArrivedAt = 0;
        huntSawBoss = false;
        huntRandomUsed = 0;
        lootUntil = 0;
        lootStartedAt = 0;
        lootEmptyTicks = 0;
        lootPendingDrop = false;
        huntBossMissingSince = 0;
        huntBossLastSeenAt = 0;
        huntBossLockedAt = 0;
        huntBossLastHp = -1;
        huntBossHpProgressAt = 0;
        lastHuntHpCheckTs = 0;
        lastHuntPrelockPollTs = 0;
        resetHuntSpawnState();
        hideLootTimerBar();
        sendCmd('endLootMode');
        sendCmd('setAutoFight', { type: 3 });
        resumeFarmAfterHunt();
    }

    /** 真正打到 Boss 后：开游戏内自动挂机拾取，再回挂机/接下一个 */
    function beginLootAfterKill(reason) {
        if (phase === 'LOOTING_BOSS') return;
        var p = getActive();
        var lootSec = (p && p.boss && p.boss.lootSec != null) ? Number(p.boss.lootSec) : 10;
        if (isNaN(lootSec) || lootSec < 0) lootSec = 10;
        if (lootSec === 0) {
            if (huntKind === 'moying') {
                resumeMoyingSearchAfterKill(reason || '击杀完成(跳过拾取)');
            } else {
                finishHunt(reason || '击杀完成(跳过拾取)');
            }
            return;
        }
        lootStartedAt = Date.now();
        lootUntil = lootStartedAt + lootSec * 1000;
        lootEmptyTicks = 0;
        lastPickupTs = 0;
        lootPendingDrop = false;
        huntBossMissingSince = 0;
        setPhase('LOOTING_BOSS');
        log((reason || '击杀完成') + '，开启系统自动战斗' +
            (lootSec > 0 ? (' ·等待拾取最多' + lootSec + 's') : ''));
        setStatus('云游平台：系统自动战斗 ·等待拾取' + lootSec + 's', 'running');
        updateLootTimerBar({
            show: true,
            leftSec: lootSec,
            totalSec: lootSec,
            bossName: huntTarget ? huntTarget.bossName : ''
        });
        sendCmd('beginLootMode');
    }

    function onBossKilledSignal(reasonDead) {
        if (phase === 'LOOTING_BOSS') return;
        if (phase !== 'GOING_BOSS' && phase !== 'HUNTING_BOSS') return;
        if (!huntTarget) return;
        if (huntSawBoss) {
            if (!canConfirmBossKill()) return;
            beginLootAfterKill(reasonDead || '击杀完成');
        } else {
            if (!huntArrivedAt && huntStartedAt && Date.now() - huntStartedAt < 3000) {
                finishHunt(reasonDead || '出发时目标已失效(推送)');
                return;
            }
            finishHunt(reasonDead || '目标变为未刷新');
        }
    }
