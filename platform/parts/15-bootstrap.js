
    function onBossEvent(ev) {
        if (!ev) return;

        // 入队/状态更新与「接收刷新推送」解耦：推送开关只控制日志与桌面通知，不影响猎杀调度
        var notifyUi = !!($('bossNotifyEn') && $('bossNotifyEn').checked);

        if (ev.event === 'shoulingCount') {
            return;
        }

        if (ev.category === 'shouling' && ev.mapId != null) {
            var aliveVal = ev.isAlive != null ? ev.isAlive : (ev.event === 'refresh' || ev.event === 'localRefresh' ? 1 : 0);
            if (ev.event === 'dead') aliveVal = 0;
            // 仅真实刷新边沿入队；initial/sync 只同步状态
            var canEnqueue = (ev.event === 'refresh' || ev.event === 'localRefresh') && !ev.initial;
            setBossAliveAndEnqueue(ev.mapId, aliveVal,
                ev.initial ? '首次同步' : (ev.event === 'dead' ? '推送未刷新' : '刷新推送'),
                ev.bossType,
                { allowEnqueue: canEnqueue });
            updateBossWatchUI();
        }

        // ARPG（圣域等）：按地图存活驱动恶魔广场扩展项
        if (ev.category === 'arpg' && ev.mapId != null) {
            var arpgAlive = ev.isAlive != null ? Number(ev.isAlive)
                : (ev.dieState === 0 ? 1 : (ev.event === 'refresh' || ev.event === 'localRefresh' ? 1 : 0));
            if (ev.event === 'dead') arpgAlive = 0;
            var arpgEnqueue = (ev.event === 'refresh' || ev.event === 'localRefresh') && !ev.initial;
            setBossAliveAndEnqueue(ev.mapId, arpgAlive,
                ev.initial ? 'ARPG首次同步' : (ev.event === 'dead' ? 'ARPG已击杀' : 'ARPG刷新'),
                null,
                { allowEnqueue: arpgEnqueue });
        }

        if (!ev.mapId && !ev.mapName) return;

        if (ev.event === 'watch') {
            if (notifyUi) log('Boss关注变更 map=' + ev.mapId + ' state=' + ev.watchState, 'verbose');
            return;
        }
        // sync / initial 全量同步不刷日志
        if (ev.event === 'sync' || ev.initial) return;

        if (notifyUi) {
            bossEventHistory.unshift(ev);
            if (bossEventHistory.length > 40) bossEventHistory.length = 40;
            renderBossEvents();

            var name = ev.category === 'shouling'
                ? ((ev.bossName ? ev.bossName + '·' : '') + (ev.mapName || ('地图' + ev.mapId)))
                : (ev.mapName || ('地图' + ev.mapId));
            var tag = ev.event === 'dead' ? '未刷新' :
                (ev.event === 'localRefresh' ? '本地倒计时刷新' : '已刷新');
            log((ev.category === 'shouling' ? '首领' : 'ARPG') + tag + ': ' + name +
                ' (' + ev.mapId + ')' + (ev.source ? ' ·' + ev.source : ''));

            if (ev.event === 'refresh' || ev.event === 'localRefresh') {
                setStatus((ev.category === 'shouling' ? '首领已刷新：' : 'Boss已刷新：') + name, 'running');
                maybeBrowserNotify(ev.category === 'shouling' ? '首领已刷新' : 'Boss已刷新', name + ' (' + ev.mapId + ')');
            } else if (ev.event === 'dead') {
                setStatus((ev.category === 'shouling' ? '首领未刷新：' : 'Boss已击杀：') + name);
            }
        }

        if (ev.event === 'dead') {
            if (!huntTarget || parseInt(huntTarget.mapId, 10) !== parseInt(ev.mapId, 10)) return;
            if (ev.bossType != null && huntTarget.type != null &&
                Number(ev.bossType) !== Number(huntTarget.type)) return;
            if (phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS') {
                onBossKilledSignal(huntSawBoss ? '击杀完成' : '目标已被击杀(推送)');
            }
        }
    }

    function renderBossEvents() {
        var el = $('bossEventList');
        if (!el) return;
        if (!bossEventHistory.length) {
            el.innerHTML = '<div class="hint">暂无通知</div>';
            return;
        }
        el.innerHTML = bossEventHistory.map(function (ev) {
            var name = ev.category === 'shouling'
                ? ((ev.bossName ? ev.bossName + '·' : '') + (ev.mapName || ('地图' + ev.mapId)))
                : (ev.mapName || ('地图' + ev.mapId));
            var cls = ev.event === 'dead' ? 'tag-dead' :
                (ev.event === 'localRefresh' ? 'tag-local' : 'tag-refresh');
            var label = ev.event === 'dead' ? '未刷新' :
                (ev.event === 'localRefresh' ? '本地刷新' : '已刷新');
            var t = new Date(ev.ts || Date.now()).toLocaleTimeString();
            return '<div class="boss-event-item"><span class="' + cls + '">[' + label + ']</span> ' +
                name + ' <span class="meta">(' + ev.mapId + ') · ' + t +
                (ev.source ? ' · ' + ev.source : '') + '</span></div>';
        }).join('');
    }

    window.clearBossEvents = function () {
        bossEventHistory = [];
        renderBossEvents();
    };

    function maybeBrowserNotify(title, body) {
        if (!$('bossNotifyBrowser').checked) return;
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            try { new Notification(title, { body: body }); } catch (e) {}
            return;
        }
        if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(function (p) {
                if (p === 'granted') {
                    try { new Notification(title, { body: body }); } catch (e) {}
                }
            });
        }
    }

    // 方案字段变更自动保存；勾选桌面通知时申请权限
    var PROFILE_FIELD_IDS = {
        pfName: 1, pfGuajiType: 1, pfAutoPick: 1, pfMapId: 1, pfDeliverId: 1, pfEnterType: 1,
        pfMapRepeatCount: 1, pfMapRepeatWindowMin: 1, pfAltMapIds: 1,
        pfBossOwnerEn: 1, pfBossOwnerHpPct: 1, pfBossOwnerWl: 1,
        pfLowHpKiteEn: 1, pfLowHpKitePct: 1, pfEliteOnly: 1, pfSkipEvilChest: 1, pfAutoCollect: 1,
        pfAutoTeamEn: 1, pfAutoTeamMode: 1, pfAutoTeamMembers: 1,
        pfSoulHallEn: 1, pfSoulHallMin: 1, pfSoulHallCd: 1,
        bagUseEn: 1, bagUseInterval: 1, bagRecycleEn: 1, bagRecycleSlots: 1,
        bagSmeltEn: 1, bagSmeltSlots: 1, bagDiscardEn: 1,
        bagStoreEquipEn: 1, bagStoreEquipSlots: 1, bagStoreMatEn: 1, bagStoreMatSlots: 1,
        bagBuyEn: 1,
        bagSignInEn: 1, bagUnionDonateEn: 1, bagOfflineRewardEn: 1,
        bagVipRewardEn: 1, bagMailBaodianEn: 1,
        bagXuemaiEn: 1, bagXuemaiCost: 1,
        bagAuctionEn: 1, bagAuctionCqbEn: 1, bagAuctionYbEn: 1, bagAuctionUnionEn: 1,
        bagSmeltWhenStoppedEn: 1, bagRecycleWhenStoppedEn: 1,
        bossHuntEn: 1, bossPollSec: 1, bossOccupySec: 1, bossHuntSec: 1, bossLootSec: 1, bossSkipFarm: 1,
        bossRandomMax: 1, bossRandomIntervalSec: 1, bossRandomBuyEn: 1, bossRandomBuyCount: 1,
        bossNotifyEn: 1, bossNotifyBrowser: 1,
        bossHuanglingEn: 1, bossEmoEn: 1, bossShenlongEn: 1, bossWatchEn: 1,
        actNotifyEn: 1, actNotifyBrowser: 1, actWatchOnly: 1, actAutoGo: 1, actMoyingRandomMax: 1,
        pkDefaultEn: 1, pkDefaultMode: 1,
        pkCounterEn: 1, pkCounterMode: 1, pkCounterWhenStopped: 1, pkCounterWl: 1,
        pkEnemyEn: 1, pkEnemyMode: 1, pkEnemyNames: 1, pkEnemyIds: 1,
        pkGuildEn: 1, pkGuildMode: 1, pkGuildNames: 1, pkGuildIds: 1,
        pkStealEn: 1, pkStealType: 1, pkStealNames: 1, pkStealIds: 1, pkStealGuilds: 1
    };

    document.addEventListener('change', function (ev) {
        var t = ev.target;
        if (!t || !t.id) return;
        if ((t.id === 'bossNotifyBrowser' || t.id === 'actNotifyBrowser') && t.checked) {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }
        if (PROFILE_FIELD_IDS[t.id]) autoSaveProfile();
    });

    document.addEventListener('input', function (ev) {
        var t = ev.target;
        if (!t || !t.id || !PROFILE_FIELD_IDS[t.id]) return;
        // 文本/数字输入用防抖，避免每按一键都写盘
        if (t.type === 'checkbox' || t.tagName === 'SELECT') return;
        scheduleAutoSave();
    });

    window.addEventListener('load', function () {
        if (window.TaskModule) {
            TaskModule.init({
                $: $,
                log: log,
                sendCmd: sendCmd,
                getActive: getActive,
                readEditor: readEditor,
                getPhase: function () { return phase; },
                setPhase: setPhase,
                setStatus: setStatus,
                mapNameById: mapNameById,
                isSchedulerActive: isSchedulerActive,
                returnToFarmMap: returnToFarmMap,
                scheduleAutoSave: scheduleAutoSave
            });
            TaskModule.loadCatalog('task-catalog.json');
        }
        if (window.ActivityModule) {
            ActivityModule.init({
                $: $,
                log: log,
                sendCmd: sendCmd,
                getActive: getActive,
                getPhase: function () { return phase; },
                setPhase: setPhase,
                setStatus: setStatus,
                isSchedulerActive: isSchedulerActive,
                isInBossPhases: isInBossPhases,
                returnToFarmMap: returnToFarmMap,
                resumeFarmAfterHunt: resumeFarmAfterHunt,
                shouldRunMoyingHuntNow: shouldRunMoyingHuntNow,
                shouldRunQunyingNow: shouldRunQunyingNow,
                getActivityCatalog: function () { return activityCatalog; },
                getActStateMap: function () { return actStateMap; },
                getSelectedActWatch: function () { return selectedActWatch; },
                getLastRuntimeSnapshot: function () { return lastRuntimeSnapshot; }
            });
        }
        if (window.FarmTacticsModule) {
            FarmTacticsModule.init({
                log: log,
                sendCmd: sendCmd,
                mapNameById: mapNameById
            });
        }
        if (window.SoulHallModule) {
            SoulHallModule.init({
                $: $,
                log: log,
                sendCmd: sendCmd,
                getActive: getActive,
                getPhase: function () { return phase; },
                setPhase: setPhase,
                setStatus: setStatus,
                returnToFarmMap: returnToFarmMap,
                finishAndContinue: finishSoulHallAndContinue,
                isInBossPhases: isInBossPhases,
                isInActivityPhases: isInActivityPhases
            });
        }
        if (window.PkModule) {
            PkModule.init({
                $: $,
                log: log,
                sendCmd: sendCmd,
                getActive: getActive,
                isSchedulerActive: isSchedulerActive,
                getPhase: function () { return phase; }
            });
        }
        bindLogControls();
        gameWindow = $('gameFrame').contentWindow;
        loadProfiles();
        initFeatureTabs();
        fillEditor(getActive());
        renderProfileList();
        setPhase('IDLE');
        setStatus('请先完成左侧登录选区');
        restoreAuthUi();
        if (!authState.sessionId) {
            UserConfigStore.setSyncHint('local');
        }
        fetch(AUTH_API + '/api/health').then(function (r) { return r.json(); }).then(function () {
            if (!authState.sessionId) setAuthStatus('登录服务已就绪，请登录账号（登录后配置可跨设备同步）');
        }).catch(function () {
            setAuthStatus('登录服务未启动：在 html 目录执行 python 106u_game_auth.py', 'error');
        });
        fetch('buy-catalog.json').then(function (r) { return r.json(); }).then(function (data) {
            buyCatalog = data || { items: [] };
            var p = getActive();
            if (p && p.bag && p.bag.autoBuy) loadSelectedBuyRulesFromProfile(p.bag.autoBuy);
            updateItemSummaries();
            log('购买目录: ' + (buyCatalog.items || []).length + ' 项（含每日限购）');
        }).catch(function () {
            log('buy-catalog.json 加载失败，购买列表为空');
        });
        fetch('item-catalog.json').then(function (r) { return r.json(); }).then(function (data) {
            itemCatalog.use = data.use || [];
            itemCatalog.equip = data.equip || [];
            itemCatalog.discard = data.discard || [];
            buildItemIndex();
            updateItemSummaries();
            log('道具目录: 可使用 ' + itemCatalog.use.length + ' / 可丢弃池 ' + itemCatalog.discard.length);
        }).catch(function () {
            log('item-catalog.json 加载失败，多选列表为空');
        });
        fetch('afk-catalog.json').then(function (r) { return r.json(); }).then(function (data) {
            catalog = data;
            renderMapSelect();
            updateMapPickedLabel();
            log('预载地图目录');
        }).catch(function () {
            renderMapSelect();
        });
        if (typeof loadBossExtraCatalog === 'function') {
            loadBossExtraCatalog();
        }
    });