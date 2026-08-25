        resetMoyingSession();
        resetQunyingSession();
        qunyingRoundCompleted = false;
        if (window.ActivityModule) ActivityModule.resetAll();
        if (window.FarmTacticsModule && FarmTacticsModule.resetRuntime) FarmTacticsModule.resetRuntime();
        if (window.PkModule && PkModule.resetRuntime) PkModule.resetRuntime();
        pendingActivityKind = null;
        pendingBossAfterRecycle = null;
        lastRuntimeSnapshot = null;
        dailyBurstActive = false;
        lootUntil = 0;
        lootStartedAt = 0;
        hideLootTimerBar();
        sendCmd('ensureFarmPickup', { enabled: false });
        sendCmd('endLootMode');
        sendCmd('stopFarm');
        var stopP = getActive();
        if (stopP) ensureBag(stopP);
        var stopBag = stopP && stopP.bag;
        sendCmd('setBagAutoFlags', {
            smelt: !!(stopBag && stopBag.smeltWhenStopped && stopBag.smeltWhenStopped.enabled &&
                stopBag.autoSmelt && stopBag.autoSmelt.enabled),
            recycle: !!(stopBag && stopBag.recycleWhenStopped && stopBag.recycleWhenStopped.enabled &&
                stopBag.autoRecycle && stopBag.autoRecycle.enabled)
        });
        if (window.PkModule && PkModule.syncToGame) PkModule.syncToGame(stopP, true, false);
        if (window.TaskModule) TaskModule.resetRunner();
        setPhase('IDLE');
        setStatus('云游平台：已停止');
        log('已停止挂机');
    };

    window.manualGoAndFarm = function () {
        saveProfile();
        var p = getActive();
        if (!p.farm.mapId) { log('请先选择地图'); return; }
        log('进图+开打');
        sendCmd('startFarm', {
            mapId: p.farm.mapId,
            enterType: 'auto',
            deliverId: p.farm.deliverId,
            autoFight: 1,
            guajiType: p.farm.guajiType,
            autoPick: p.farm.autoPick !== false
        });
    };

    window.manualStopFight = function () {
        sendCmd('stopFarm');
        log('已关闭自动战斗');
    };

    window.manualBagAssist = function () {
        saveProfile();
        var p = getActive();
        lastBagAssistTs = 0;
        lastAutoSmeltTs = 0;
        lastAutoUseTs = 0;
        lastAutoRecycleTs = 0;
        lastAutoDiscardTs = 0;
        lastAutoStoreTs = 0;
        lastAutoBuyTs = 0;
        lastDailyChoresTs = 0;
        lastUseTs = 0;
        log('手动执行背包助手');
        if (!p.bag) return;
        if (p.bag.autoSmelt && p.bag.autoSmelt.enabled) {
            sendCmd('applyAutoSmeltIfNeeded', { autoSmelt: p.bag.autoSmelt });
        }
        if (p.bag.autoRecycle && p.bag.autoRecycle.enabled) {
            sendCmd('applyAutoRecycleIfNeeded', { autoRecycle: p.bag.autoRecycle });
        }
        if (p.bag.autoUse && p.bag.autoUse.enabled) {
            var usePayload = { autoUse: JSON.parse(JSON.stringify(p.bag.autoUse)) };
            if (!usePayload.autoUse.itemIds || !usePayload.autoUse.itemIds.length) {
                usePayload.autoUse.itemIds = selectedUseIds.length ? selectedUseIds.slice() : [1001, 4645];
            }
            sendCmd('applyAutoUseIfNeeded', usePayload);
        }
        if (p.bag.autoDiscard && p.bag.autoDiscard.enabled) {
            sendCmd('applyAutoDiscardIfNeeded', { autoDiscard: p.bag.autoDiscard });
        }
        if (p.bag.autoStoreEquip && p.bag.autoStoreEquip.enabled) {
            sendCmd('applyAutoStoreIfNeeded', { kind: 'equip', autoStore: p.bag.autoStoreEquip });
        }
        if (p.bag.autoStoreMaterial && p.bag.autoStoreMaterial.enabled) {
            sendCmd('applyAutoStoreIfNeeded', { kind: 'material', autoStore: p.bag.autoStoreMaterial });
        }
        if (p.bag.autoBuy && p.bag.autoBuy.enabled) {
            var buyItems = normalizeAutoBuyRules(p.bag.autoBuy);
            if (buyItems.length) {
                sendCmd('applyAutoBuyIfNeeded', { autoBuy: { enabled: true, items: buyItems } });
            }
        }
        sendCmd('applyDailyChoresIfNeeded', {
            bag: {
                autoSignIn: p.bag.autoSignIn,
                autoUnionDonate: p.bag.autoUnionDonate,
                autoOfflineReward: p.bag.autoOfflineReward,
                autoVipReward: p.bag.autoVipReward,
                autoMailBaodian: p.bag.autoMailBaodian,
                autoExchangeXuemai: p.bag.autoExchangeXuemai
            }
        });
    };

    window.addEventListener('message', function (ev) {
        var msg = ev.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'gameReady') {
            setStatus('云游平台：游戏已就绪');
            log('游戏就绪');
            refreshCatalog();
            sendCmd('getRuntimeState');
            sendCmd('getBuyCatalog');
            setTimeout(function () { refreshBossCatalog(); }, 1200);
            setTimeout(function () { refreshActivityCatalog(); }, 1600);
            if (window.PkModule && PkModule.syncToGame) {
                setTimeout(function () { PkModule.syncToGame(getActive(), true); }, 1800);
            }
            return;
        }
        if (msg.type === 'handshake_ack') {
            setStatus('云游平台：桥接可用');
            return;
        }
        if (msg.type === 'bossEvent') {
            onBossEvent(msg.payload || {});
            return;
        }
        if (msg.type === 'activityEvent') {
            onActivityEvent(msg.payload || {});
            return;
        }
        if (msg.type === 'dayReset') {
            var dr = msg.payload || {};
            if (typeof onServerDayReset === 'function') {
                onServerDayReset({
                    trigger: dr.source || 'heartbeat',
                    dayKey: dr.dayKey || '',
                    server: dr
                });
            }
            return;
        }
        if (msg.type === 'pkEvent') {
            var pk = msg.payload || {};
            var tag = pk.action === 'counter' ? '反击' :
                (pk.action === 'enemy' ? '砍仇人' :
                    (pk.action === 'guild' ? '击杀行会' :
                        (pk.action === 'steal' ? '抢怪' : (pk.action || 'PK'))));
            log('PK ' + tag + ': ' + (pk.name || pk.uid || '') +
                (pk.uid ? (' ·' + pk.uid) : '') +
                (pk.unionName ? (' ·' + pk.unionName) : ''));
            return;
        }
        if (msg.type === 'qunyingAnswered') {
            onQunyingAnsweredEvent(msg.payload || {});
            return;
        }
        if (msg.type === 'socketMsg') {
            // 协议原始包不再写入运行日志（108004/73016 等过于密集）
            return;
        }
        if (msg.type === 'socketHooked') {
            // 钩子安装只记一次，避免重复刷
            if (msg.layer === 'ShoulingBoss' && !window.__loggedShoulingHook) {
                window.__loggedShoulingHook = true;
                log('首领刷新钩子已安装');
            }
            if (msg.layer === 'ActivityWatch' && !window.__loggedActHook) {
                window.__loggedActHook = true;
                log('日常活动监视已安装');
            }
            if (msg.layer === 'DayReset' && !window.__loggedDayResetHook) {
                window.__loggedDayResetHook = true;
                log('服日切钩子已安装');
            }
            if (msg.layer === 'QunyingTurbo' && !window.__loggedQunyingTurbo) {
                window.__loggedQunyingTurbo = true;
                log('群英汇极速答题钩子已安装');
            }
            return;
        }

        if (msg.type === 'gameResponse') {
            var a = msg.action;
            var p = msg.payload || {};
            if (a === 'goMap') {
                // deliver 实际落地地图可能≠配置 mapId（如火龙教主 5274→5272）
                if (p.success && huntTarget &&
                    (phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS')) {
                    if (p.usedSecondHop) {
                        log('中间图二次进入: deliver=' + p.deliverId +
                            (p.mapId ? (' →图' + p.mapId) : '') +
                            (p.hubNpcId ? (' ·NPC' + p.hubNpcId) : ''));
                    }
                    var landed = parseInt(p.mapId, 10);
                    // hub 首次落地未知（返回 0）或仅中转，勿把中间图写成抵达图
                    if (landed && !(p.hubNpcId && !p.usedSecondHop)) {
                        if (Number(huntTarget.arriveMapId || 0) !== landed &&
                            Number(huntTarget.mapId) !== landed) {
                            huntTarget.arriveMapId = landed;
                            log('进图落地校正: 配置图' + huntTarget.mapId + ' → 实际' + landed +
                                (p.deliverId ? (' deliver=' + p.deliverId) : ''), 'verbose');
                        } else if (!huntTarget.arriveMapId) {
                            huntTarget.arriveMapId = landed;
                        }
                    }
                }
                return;
            }
            if (a === 'getRuntimeState' && p.success) {
                onRuntimeForScheduler(p.data);
                if (window.TaskModule && !window.__taskCatalogSynced && p.data && p.data.mapId) {
                    window.__taskCatalogSynced = true;
                    TaskModule.refreshCatalogFromGame();
                }
                return;
            }
            if (a === 'getTaskCatalog' && p.success && p.pickers && window.TaskModule) {
                TaskModule.mergeDynamicCatalog(p);
                TaskModule.renderTaskPanel();
                return;
            }
            if (a === 'runTask' || a === 'getTaskStatus') {
                if (window.TaskModule) TaskModule.onTaskCmdResult(p);
                return;
            }
            if (a === 'getMapCatalog' && p.success && p.data) {
                catalog = p.data;
                renderMapSelect();
                updateMapPickedLabel();
                log('地图目录已更新 maps=' + (catalog.maps || []).length);
                return;
            }
            if (a === 'applyAutoSmeltIfNeeded') {
                if (p.success && p.result && p.result.count > 0) {
                    log('自动熔炼: ' + p.result.count + '件 ·空格' + (p.brief && p.brief.emptySlots), 'verbose');
                } else if (!p.success && p.reason) {
                    log('自动熔炼失败: ' + p.reason);
                }
                return;
            }
            if (a === 'applyAutoUseIfNeeded') {
                if (p.success) {
                    var useAct = p.result || {};
                    if (useAct.used && useAct.used.length) {
                        log('自动使用: ' + useAct.used.map(function (u) { return u.itemId; }).join(','), 'verbose');
                    } else if (useAct.reason === 'empty_itemIds') {
                        if (!window.__loggedBagUseEmpty) {
                            window.__loggedBagUseEmpty = true;
                            log('自动使用未配置道具ID，请在背包助手里选择道具');
                        }
                    } else if (useAct.skipped && useAct.skipped.length && !(useAct.used && useAct.used.length)) {
                        if (!window.__loggedBagUseSkip || Date.now() - window.__loggedBagUseSkip > 30000) {
                            window.__loggedBagUseSkip = Date.now();
                            log('自动使用跳过(包内无此物): ' + useAct.skipped.map(function (s) {
                                return s.itemId;
                            }).join(','));
                        }
                    }
                } else if (p.reason) {
                    log('自动使用失败: ' + p.reason);
                }
                return;
            }
            if (a === 'applyAutoRecycleIfNeeded') {
                if (p.success) {
                    if (p.needNpcTeleport && phase === 'FARMING') {
                        startNpcRecycle(getActive(), '空格不足需传送');
                    } else if (p.result && p.result.count > 0) {
                        log('自动回收: ' + p.result.count + '件' +
                            (p.result.viaNpc ? '（NPC）' : '') +
                            ' ·空格' + (p.brief && p.brief.emptySlots), 'verbose');
                    }
                } else if (p.reason) {
                    log('自动回收失败: ' + p.reason);
                }
                return;
            }
            if (a === 'applyAutoDiscardIfNeeded') {
                if (p.success && p.result && p.result.discarded && p.result.discarded.length) {
                    log('自动丢弃: ' + p.result.discarded.length + ' 次', 'verbose');
                }
                return;
            }
            if (a === 'applyAutoStoreIfNeeded') {
                if (p.success && p.stored && p.stored.length) {
                    log('自动存仓(' + (p.kind || '') + '): ' + p.stored.length + '件 ·空格' + p.emptySlots, 'verbose');
                }
                return;
            }
            if (a === 'applyAutoBuyIfNeeded') {
                if (p.success && p.bought && p.bought.length) {
                    log('自动购买: ' + p.bought.map(function (x) {
                        var cat = buyCatalogByItemId(x.itemId);
                        var nm = cat && cat.name || x.itemId;
                        return nm + '×' + x.count + '(→' + (x.target != null ? x.target : '?') + ')';
                    }).join('、'));
                } else if (!p.success && p.reason) {
                    log('自动购买失败: ' + p.reason);
                }
                return;
            }
            if (a === 'getBuyCatalog' && p.success && p.items && p.items.length) {
                buyCatalog.items = p.items;
                log('运行时商城目录已更新: ' + p.items.length + ' 项');
                return;
            }
            if (a === 'applyDailyChoresIfNeeded') {
                if (p.success && p.actions && p.actions.length) {
                    var done = p.actions.filter(function (act) {
                        var r = act.result || {};
                        if (r.skipped === true) return false;
                        return (r.signed && r.signed.length) ||
                            (r.cumulative && r.cumulative.length) ||
                            (r.claimed && r.claimed.length) ||
                            (r.count > 0 && act.type === 'offlineReward') ||
                            (r.count > 0 && act.type === 'mailBaodian') ||
                            (r.bought > 0 && act.type === 'exchangeXuemai') ||
                            r.method;
                    });
                    if (done.length) {
                        log('日常福利: ' + done.map(function (x) {
                            if (x.type === 'exchangeXuemai' && x.result) {
                                return x.type + '×' + (x.result.bought || 0);
                            }
                            return x.type;
                        }).join(','), 'verbose');
                    }
                } else if (!p.success && p.reason) {
                    log('日常福利失败: ' + p.reason);
                }
                return;
            }
            if (a === 'applyBagAssist') {
                if (p.success) {
                    var acts = (p.actions || []).filter(function (x) {
                        var r = x.result || {};
                        return (r.discarded && r.discarded.length);
                    });
                    if (acts.length) {
                        log('背包助手: ' + JSON.stringify(acts).slice(0, 280), 'verbose');
                    }
                } else if (p.reason) log('背包助手失败: ' + p.reason);
                return;
            }
            if (a === 'getBagBrief' && p.success && p.data) {
                log('背包: 空格=' + p.data.emptySlots + ' 可回收=' + p.data.recycleCandidate + ' 可熔炼=' + p.data.smeltCandidate);
                return;
            }
            if (a === 'getBossInfo' && p.success) {
                var list = p.data || [];
                var alive = list.filter(function (b) { return b.dieState === 0; }).length;
                var dead = list.filter(function (b) { return b.dieState === 1; }).length;
                log('ARPG Boss: 共' + list.length + ' 存活' + alive + ' 死亡' + dead);
                // 圣域等扩展关注：仅同步存活，边沿入队交给 73016 推送
                if (typeof getEnabledExtraWatches === 'function') {
                    var arpgWatchMaps = {};
                    getEnabledExtraWatches().forEach(function (w) {
                        if (w && w.arpg) arpgWatchMaps[parseInt(w.mapId, 10)] = 1;
                    });
                    list.forEach(function (b) {
                        var mid = parseInt(b.mapId, 10);
                        if (!mid || !arpgWatchMaps[mid]) return;
                        var isAlive = Number(b.dieState) === 0 ? 1 : 0;
                        setBossAliveAndEnqueue(mid, isAlive, 'ARPG轮询同步', null, { allowEnqueue: false });
                    });
                }
                return;
            }
            if (a === 'getExtraMapAlive' && p.success) {
                var rows = p.data || [];
                var byMap = {};
                var assumedN = 0;
                rows.forEach(function (row) {
                    if (!row || row.mapId == null || row.aliveKnown === false) return;
                    byMap[parseInt(row.mapId, 10)] = row;
                    if (row.source === 'assume' || row.assumed) assumedN++;
                });
                if (typeof getEnabledExtraWatches === 'function') {
                    getEnabledExtraWatches().forEach(function (w) {
                        if (!w) return;
                        var row = byMap[parseInt(w.mapId, 10)];
                        if (!row) return;
                        // 假定存活仅同步状态；入队交给对账（受冷却约束）
                        setBossAliveAndEnqueue(w.mapId, row.isAlive,
                            row.source === 'assume' ? '扩展假定存活' : '扩展地图同步',
                            w.type, { allowEnqueue: false });
                    });
                }
                if (assumedN && !window.__extraAssumeLogged) {
                    window.__extraAssumeLogged = true;
                    log('扩展Boss无服务端存活字典，已按存活假定（勾选即可入队）');
                }
                if (typeof enqueueMissingAliveWatches === 'function') {
                    enqueueMissingAliveWatches('扩展地图对账');
                }
                return;
            }
            if (a === 'getShoulingBossInfo' && p.success) {
                var sl = p.data || [];
                bossCatalog = sl;
                mergeSpawnCoordsFromCatalog();
                sl.forEach(function (b) {
                    (b.locations || []).forEach(function (loc) {
                        // 轮询只同步状态，不边沿入队（mapMonsterTime 同图污染；以 108004 刷新推送入队）
                        if (loc.aliveKnown === false) return;
                        setBossAliveAndEnqueue(loc.mapId, loc.isAlive, '轮询同步', b.type, { allowEnqueue: false });
                    });
                });
                // 边沿丢失时：仅补入 108004 已确认存活的关注目标
                enqueueMissingAliveWatches(window.__logNextShoulingCatalog ? '手动同步对账' : '轮询对账');
                updateBossWatchUI();
                if ($('bossModal').classList.contains('show')) renderModalBossList();
                // 轮询很频繁，不打全量列表日志；仅手动刷新时提示
                if (window.__logNextShoulingCatalog) {
                    window.__logNextShoulingCatalog = false;
                    log('首领列表已更新: 共' + sl.length +
                        (huntQueue.length ? ' ·队列' + huntQueue.length : ''));
                }
                return;
            }
            if (a === 'getDailyActivities' && p.success) {
                activityCatalog = p.data || [];
                activityCatalog.forEach(function (it) {
                    actStateMap[it.id] = it.state;
                });
                // enrich watch names from catalog
                selectedActWatch.forEach(function (w) {
                    for (var i = 0; i < activityCatalog.length; i++) {
                        if (activityCatalog[i].id === w.id) {
                            w.name = activityCatalog[i].name || w.name;
                            w.timeText = activityCatalog[i].timeText || w.timeText;
                            w.link = activityCatalog[i].link || w.link;
                            w.level = activityCatalog[i].level || w.level;
                            break;
                        }
                    }
                });
                updateActivityWatchUI();
                if ($('activityModal') && $('activityModal').classList.contains('show')) {
                    renderModalActList();
                    renderModalActTags();
                }
                log('日常活动: ' + activityCatalog.length + ' 个');
                if (isSchedulerActive() && $('actAutoGo') && $('actAutoGo').checked) {
                    if (tryJoinOpenActivityNow('上线检测')) {
                        log('上线检测：发现进行中的活动，立刻参加');
                    }
                }
                return;
            }
            if (a === 'goDailyActivity' || a === 'joinDailyActivity') {
                if (p.success) {
                    log('已前往活动: ' + (p.name || p.id) + (p.method ? (' ·' + p.method) : '') +
                        (p.mapId ? (' ·图' + p.mapId) : ''));
                    if (p.mapId && window.ActivityModule && ActivityModule.setSessionTargetMap) {
                        ActivityModule.setSessionTargetMap(p.mapId);
                    }
                } else if (p.reason) log('前往活动失败: ' + p.reason);
                return;
            }
            if (a === 'useItemsByRule') {
                if (phase === 'HUNTING_BOSS' || phase === 'GOING_BOSS') {
                    var used = (p.used && p.used.length) || 0;
                    var skipped = p.skipped || [];
                    if (!used && skipped.length) {
                        var noBag = skipped.every(function (s) { return s.reason === 'not_in_bag'; });
                        if (noBag) {
