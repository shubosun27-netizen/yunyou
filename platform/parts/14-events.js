                            if (tryBuyRandomStone(getActive())) {
                                lastRandomNoItem = false;
                                // 回退一次计数，购买后会再随机，避免空耗上限
                                if (huntRandomUsed > 0) huntRandomUsed--;
                            } else {
                                lastRandomNoItem = true;
                                if (huntKind === 'moying') {
                                    log('魔影：无随机石且购买失败，继续尝试');
                                } else {
                                    finishHunt('无随机道具');
                                }
                            }
                        } else if (!window.__loggedRandomSkip) {
                            window.__loggedRandomSkip = true;
                            log('随机未使用: ' + JSON.stringify(skipped).slice(0, 200));
                        }
                    } else if (used) {
                        lastRandomNoItem = false;
                        window.__loggedRandomSkip = false;
                    }
                }
                return;
            }
            if (a === 'buyRandomStone') {
                randomBuyPendingUntil = 0;
                if (p.success) {
                    log('已购买随机石 x' + (p.count || '?') +
                        (p.cost != null ? (' ·花费' + p.cost) : '') +
                        (p.moneyName ? (' ' + p.moneyName) : (p.moneyType != null ? (' 货币' + p.moneyType) : '')));
                    lastRandomNoItem = false;
                    lastRandomTs = 0; // 允许马上再随机
                } else {
                    log('购买随机石失败: ' + (p.reason || 'unknown') +
                        (p.money != null ? (' ·余额' + p.money) : ''));
                    if (phase === 'HUNTING_BOSS' || phase === 'GOING_BOSS') {
                        if (huntKind !== 'moying') {
                            finishHunt('无随机道具且购买失败');
                        } else {
                            log('魔影：购买随机石失败，使用背包存量继续');
                        }
                    }
                }
                return;
            }
            if (a === 'getMonsterList') {
                huntPendingMonster = false;
                huntPendingMonsterSince = 0;
                if (p.success) onMonsterListForHunt(p.data || []);
                return;
            }
            if (a === 'getDropList' && p.success) {
                lootPendingDrop = false;
                if (phase === 'LOOTING_BOSS') {
                    var drops = p.data || [];
                    if (!drops.length) {
                        lootEmptyTicks++;
                        // 给掉落生成一点时间；连续多次空视野则提前结束
                        if (lootEmptyTicks >= 3 && Date.now() - lootStartedAt > 2500) {
                            finishHunt('拾取完成(无掉落)');
                        }
                    } else {
                        lootEmptyTicks = 0;
                    }
                }
                return;
            }
            if (a === 'runRecycleOnce') {
                if (p.needNpcTeleport && phase === 'FARMING') {
                    startNpcRecycle(getActive(), '手动回收需传送');
                } else if (!p.success && p.reason) {
                    log('回收失败: ' + p.reason);
                } else if (p.success && p.count > 0) {
                    log('回收: ' + p.count + '件' + (p.viaNpc ? '（NPC）' : ''));
                }
                return;
            }
            if (a === 'goQunyingGuild') {
                if (!p.success && p.reason) {
                    log('群英汇进领地失败: ' + p.reason + (p.method ? (' ·' + p.method) : ''));
                }
                return;
            }
            if (a === 'getNearbyPlayers') {
                if (!p.success) {
                    log('附近玩家失败: ' + (p.reason || 'unknown'));
                    return;
                }
                var pls = p.players || [];
                if (!pls.length) {
                    log('附近玩家: 无（当前PK模式 ' + (p.fightModel != null ? p.fightModel : '?') + '）');
                    return;
                }
                log('附近玩家 ' + pls.length + ' 人 ·PK模式 ' + (p.fightModel != null ? p.fightModel : '?') + '：' +
                    pls.slice(0, 12).map(function (r) {
                        return (r.name || '?') +
                            (r.uid ? '(' + r.uid + ')' : '') +
                            (r.unionName ? '[' + r.unionName + ']' : '');
                    }).join('、') + (pls.length > 12 ? '…' : ''));
                return;
            }
            // 例行指令回执不写日志（setAutoFight/goMap/拾取等太密）
            if (a === 'pickupNearest' || a === 'requestShoulingBoss' ||
                a === 'goMap' || a === 'gotoStagePoint' || a === 'getBossSpawnPoint' ||
                a === 'startFarm' || a === 'stopFarm' || a === 'setAutoFight' ||
                a === 'setGuajiType' || a === 'beginLootMode' || a === 'maintainLootMode' || a === 'endLootMode' ||
                a === 'suppressForceFight' || a === 'ensureFarmPickup' ||
                a === 'setBagAutoFlags' || a === 'runSmeltOnce' || a === 'applyAutoSmeltIfNeeded' ||
                a === 'applyAutoUseIfNeeded' || a === 'applyAutoRecycleIfNeeded' ||
                a === 'applyFarmTactics' || a === 'autoTeamTick' ||
                a === 'goSoulHall' || a === 'leaveSoulHall' || a === 'getSoulHallBagCount' ||
                a === 'applyPkConfig' || a === 'setFightModel' || a === 'applyPkTick' ||
                a === 'teleportToRecycleNpc' || a === 'openRecycleUi' || a === 'hasPortableRecycle' ||
                a === 'confirmEnterMap' || a === 'selectMonster' || a === 'getPlayerInfo') {
                if (a === 'applyFarmTactics' && p && p.success && p.steps && p.steps.length) {
                    for (var si = 0; si < p.steps.length; si++) {
                        var st = p.steps[si];
                        if (!st) continue;
                        if (st.kite !== undefined && !st.kiteNudge) {
                            log('低血走位 ' + (st.kite ? '开' : '关') +
                                ' ·HP ' + (st.hpPct != null ? st.hpPct : '?') + '%' +
                                (st.threshold != null
                                    ? (st.kite ? (' <' + st.threshold + '%') : (' ≥' + st.threshold + '%'))
                                    : '') +
                                (st.note ? (' ·' + st.note) : ''));
                        } else if (st.kiteNudge) {
                            log('低血后退 →(' + (st.to ? st.to.join(',') : '?') + ')' +
                                ' ·HP ' + (st.hpPct != null ? st.hpPct : '?') + '%' +
                                (st.via ? (' ·' + st.via) : ''), 'verbose');
                        }
                    }
                }
                if (!p.success && p.reason) log(a + ' 失败: ' + p.reason);
                return;
            }
            if (!p.success && p.reason) log(a + ' 失败: ' + p.reason);
        }
    });

    var bossEventHistory = [];

    function onActivityEvent(ev) {
        if (!ev || ev.id == null) return;
        if ($('actWatchOnly').checked) {
            var watched = selectedActWatch.some(function (w) { return w.id == ev.id; });
            if (!watched) return;
        }
        actStateMap[ev.id] = ev.state;
        updateActivityWatchUI();

        if (ev.event === 'reset') {
            if ($('actNotifyEn') && $('actNotifyEn').checked) {
                log('活动重置: ' + (ev.name || ev.id), 'verbose');
            }
            if (typeof onServerDayReset === 'function') {
                var resetKey = typeof resolveDayKey === 'function' ? resolveDayKey({}) : '';
                if (resetKey) {
                    onServerDayReset({ trigger: 'activityReset', dayKey: resetKey });
                }
            }
            return;
        }

        var notifyUi = !!($('actNotifyEn') && $('actNotifyEn').checked);
        if (notifyUi) {
            actEventHistory.unshift(ev);
            if (actEventHistory.length > 40) actEventHistory.length = 40;
            renderActivityEvents();
        }

        var name = ev.name || ('活动' + ev.id);
        var tag = ev.event === 'start' ? '开启' : (ev.event === 'end' ? '结束' : ev.event);
        if (notifyUi) {
            log('活动' + tag + ': ' + name + (ev.timeText ? ' ·' + ev.timeText : '') +
                (ev.source ? ' ·' + ev.source : ''));
        }

        if (ev.event === 'start') {
            setStatus('活动开启：' + name, 'running');
            if ($('actNotifyBrowser').checked) maybeBrowserNotify('活动开启', name);
            if ($('actAutoGo').checked && isSchedulerActive()) {
                // 活动 > 任务 > Boss > 挂机：开启即参加；仅打怪/拾取/回收中排队
                if (isMoyingActivityEv(ev) && isMoyingInWatchList()) {
                    moyingRoundCompleted = false;
                    moyingSessionActive = true;
                    requestActivityJoin('moying', '魔影来袭开启');
                } else if (isQunyingActivityEv(ev) && isQunyingInWatchList()) {
                    qunyingRoundCompleted = false;
                    qunyingSessionActive = true;
                    requestActivityJoin('qunying', '群英汇开启');
                } else if (isPanluanActivityEv(ev) && isPanluanInWatchList()) {
                    panluanRoundCompleted = false;
                    panluanSessionActive = true;
                    requestActivityJoin('panluan', '皇陵叛乱开启');
                } else if (!isMoyingActivityEv(ev) && !isQunyingActivityEv(ev) && !isPanluanActivityEv(ev)) {
                    if (window.ActivityModule) ActivityModule.onActivityStart(ev);
                    if (window.ActivityModule && ActivityModule.isSpecializedId(ev.id)) {
                        return;
                    }
                    requestActivityJoin(ev.id, (name || ev.id) + '开启');
                }
            }
        } else if (ev.event === 'end') {
            setStatus('活动结束：' + name);
            if ($('actNotifyBrowser').checked) maybeBrowserNotify('活动结束', name);
            if (isMoyingActivityEv(ev)) {
                markMoyingRoundDone();
                moyingSessionActive = false;
                if (huntKind !== 'moying' && pendingActivityKind === 'moying') {
                    pendingActivityKind = null;
                }
                log('魔影来袭时段结束' + (huntKind === 'moying' ? '，当前地图完成后退出' : ''));
            }
            if (isQunyingActivityEv(ev)) {
                markQunyingRoundDone();
                qunyingSessionActive = false;
                if (phase === 'GOING_QUNYING' || phase === 'QUNYING') {
                    finishQunyingSession('活动结束');
                } else if (pendingActivityKind === 'qunying') {
                    pendingActivityKind = null;
                }
                log('群英汇时段结束');
            }
            if (isPanluanActivityEv(ev)) {
                if (!isAnyPanluanActivityOpen()) {
                    markPanluanRoundDone();
                    panluanSessionActive = false;
                    if (phase === 'GOING_PANLUAN' || phase === 'PANLUAN') {
                        finishPanluanSession('活动结束');
                    } else if (pendingActivityKind === 'panluan') {
                        pendingActivityKind = null;
                    }
                    log('皇陵叛乱时段结束');
                }
            }
            if (window.ActivityModule) ActivityModule.onActivityEnd(ev);
            if (pendingActivityKind === ev.id) pendingActivityKind = null;
        }
    }

    function renderActivityEvents() {
        var el = $('actEventList');
        if (!el) return;
        if (!actEventHistory.length) {
            el.innerHTML = '<div class="hint">暂无通知</div>';
            return;
        }
        el.innerHTML = actEventHistory.map(function (ev) {
            var cls = ev.event === 'start' ? 'tag-refresh' : (ev.event === 'end' ? 'tag-dead' : 'tag-local');
            var label = ev.event === 'start' ? '开启' : (ev.event === 'end' ? '结束' : ev.event);
            var t = new Date(ev.ts || Date.now()).toLocaleTimeString();
            return '<div class="boss-event-item"><span class="' + cls + '">[' + label + ']</span> ' +
                (ev.name || ev.id) + ' <span class="meta">(' + ev.id + ') · ' + t + '</span></div>';
        }).join('');
    }

    window.clearActivityEvents = function () {
        actEventHistory = [];
        renderActivityEvents();
    };
