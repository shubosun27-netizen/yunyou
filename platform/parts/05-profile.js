
    function mapNameById(id) {
        id = parseInt(id, 10);
        var list = allCatalogMaps();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id == id) return list[i].name;
        }
        return '';
    }

    function updateMapPickedLabel() {
        var mid = parseInt($('pfMapId').value, 10) || 0;
        var did = parseInt($('pfDeliverId').value, 10) || 0;
        var name = mapNameById(mid);
        if (!mid) {
            $('mapPickedLabel').textContent = '尚未选择地图';
            return;
        }
        $('mapPickedLabel').textContent = '当前挂机：' + (name || '地图') + '（' + mid + '）' +
            (did ? ' · 传送 ' + did : ' · 将自动匹配传送');
        updateFarmBagSumMeta();
    }

    function loadProfiles() {
        var account = (authState && authState.username) || UserConfigStore.account || '';
        UserConfigStore.bootstrap(account);
    }

    function saveProfiles() {
        UserConfigStore.persistLocal();
        UserConfigStore.scheduleRemoteSave();
    }

    var suppressAutoSave = false;
    var autoSaveTimer = null;
    var lastAutoSaveTipAt = 0;

    function markAutoSaved() {
        var tip = $('pfAutoSaveHint');
        if (!tip) return;
        var now = Date.now();
        if (UserConfigStore.remoteEnabled) {
            tip.textContent = '正在同步到云端…';
            tip.style.color = '#2563eb';
        } else {
            tip.textContent = '已缓存本地（登录后写回云端）';
            tip.style.color = '#ca8a04';
        }
        if (now - lastAutoSaveTipAt < 800) return;
        lastAutoSaveTipAt = now;
        clearTimeout(markAutoSaved._t);
        markAutoSaved._t = setTimeout(function () {
            if (UserConfigStore.remoteEnabled && !UserConfigStore.lastSyncError) {
                tip.textContent = '更改后自动保存到云端';
                tip.style.color = '';
            } else if (!UserConfigStore.remoteEnabled) {
                tip.textContent = '未登录：仅本地缓存';
                tip.style.color = '';
            }
        }, 1600);
    }

    /** 静默写入当前方案（功能变更时调用） */
    function autoSaveProfile() {
        if (suppressAutoSave) return;
        readEditor();
        saveProfiles();
        renderProfileList();
        updateMapPickedLabel();
        markAutoSaved();
        if (window.PkModule && PkModule.syncToGame) PkModule.syncToGame(getActive());
    }

    function scheduleAutoSave() {
        if (suppressAutoSave) return;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(autoSaveProfile, 280);
    }

    function flushAutoSave() {
        if (suppressAutoSave) return;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
        autoSaveProfile();
    }

    function getActive() {
        return ensureBag(profiles.find(function (p) { return p.id === activeId; }) || profiles[0]);
    }

    function renderProfileList() {
        var html = '';
        profiles.forEach(function (p) {
            ensureBag(p);
            var mn = mapNameById(p.farm && p.farm.mapId) || ('地图' + (p.farm && p.farm.mapId));
            html += '<div class="profile-item' + (p.id === activeId ? ' active' : '') +
                '" data-id="' + p.id + '">' + (p.name || p.id) +
                ' <span style="color:#94a3b8;font-size:11px;">' + mn + '</span></div>';
        });
        $('profileList').innerHTML = html;
        Array.prototype.forEach.call(document.querySelectorAll('.profile-item'), function (el) {
            el.onclick = function () {
                flushAutoSave();
                activeId = el.getAttribute('data-id');
                saveProfiles();
                fillEditor(getActive());
                renderProfileList();
            };
        });
    }


    function syncSchemeNameLabel() {
        var el = $('schemeNameLabel');
        if (!el) return;
        var n = ($('pfName') && $('pfName').value || '').trim();
        el.textContent = n || '未命名';
    }
    window.syncSchemeNameLabel = syncSchemeNameLabel;

    function fillEditor(p) {
        if (!p) return;
        suppressAutoSave = true;
        ensureBag(p);
        $('pfName').value = p.name || '';
        syncSchemeNameLabel();
        $('pfMapId').value = (p.farm && p.farm.mapId) || '';
        $('pfEnterType').value = 'auto';
        $('pfDeliverId').value = (p.farm && p.farm.deliverId) || '';
        $('pfGuajiType').value = String((p.farm && p.farm.guajiType) != null ? p.farm.guajiType : 0);
        $('pfAutoPick').checked = !p.farm || p.farm.autoPick !== false;
        var ft = (p.farm && p.farm.tactics) || (window.FarmTacticsModule ? FarmTacticsModule.defaultTactics() : {});
        if (window.FarmTacticsModule) ft = FarmTacticsModule.mergeDefaults(ft);
        $('pfMapRepeatCount').value = ft.mapRepeatCount != null ? ft.mapRepeatCount : 0;
        $('pfMapRepeatWindowMin').value = ft.mapRepeatWindowMin != null ? ft.mapRepeatWindowMin : 5;
        $('pfAltMapIds').value = (ft.altMapIds || []).join(',');
        $('pfBossOwnerEn').checked = !!ft.bossOwnerEnabled;
        $('pfBossOwnerHpPct').value = ft.bossOwnerHpPct != null ? ft.bossOwnerHpPct : 0;
        $('pfBossOwnerWl').value = (ft.bossOwnerWhitelist || []).join(',');
        $('pfLowHpKiteEn').checked = !!ft.lowHpKiteEnabled;
        $('pfLowHpKitePct').value = ft.lowHpKitePct != null ? ft.lowHpKitePct : 0;
        $('pfEliteOnly').checked = !!ft.eliteOnly;
        $('pfSkipEvilChest').checked = ft.skipEvilChest !== false;
        $('pfAutoCollect').checked = !!ft.autoCollectCorpse;
        $('pfAutoTeamEn').checked = !!ft.autoTeamEnabled;
        $('pfAutoTeamMode').value = ft.autoTeamMode || 'leader';
        $('pfAutoTeamMembers').value = (ft.autoTeamMembers || []).join(',');
        var sh = (p.farm && p.farm.soulHall) || (window.SoulHallModule ? SoulHallModule.defaultSoulHall() : {});
        if (window.SoulHallModule) sh = SoulHallModule.mergeDefaults(sh);
        $('pfSoulHallEn').checked = !!sh.enabled;
        $('pfSoulHallMin').value = sh.minCount != null ? sh.minCount : 10;
        $('pfSoulHallCd').value = sh.cooldownSec != null ? sh.cooldownSec : 120;

        var b = p.bag;
        $('bagUseEn').checked = !!(b.autoUse && b.autoUse.enabled);
        selectedUseIds = parseIdList(b.autoUse && b.autoUse.itemIds).slice();
        if (!selectedUseIds.length) selectedUseIds = [1001, 4645];
        $('bagUseInterval').value = (b.autoUse && b.autoUse.intervalMs != null) ? b.autoUse.intervalMs : 3000;

        $('bagRecycleEn').checked = !!(b.autoRecycle && b.autoRecycle.enabled);
        $('bagRecycleSlots').value = (b.autoRecycle && b.autoRecycle.emptySlotsBelow != null) ? b.autoRecycle.emptySlotsBelow : 7;

        $('bagSmeltEn').checked = !!(b.autoSmelt && b.autoSmelt.enabled);
        $('bagSmeltSlots').value = (b.autoSmelt && b.autoSmelt.emptySlotsBelow != null) ? b.autoSmelt.emptySlotsBelow : 10;

        $('bagDiscardEn').checked = !!(b.autoDiscard && b.autoDiscard.enabled);
        selectedDiscardIds = parseIdList(b.autoDiscard && b.autoDiscard.itemIds).slice();

        $('bagStoreEquipEn').checked = !!(b.autoStoreEquip && b.autoStoreEquip.enabled);
        $('bagStoreEquipSlots').value = (b.autoStoreEquip && b.autoStoreEquip.emptySlotsBelow != null)
            ? b.autoStoreEquip.emptySlotsBelow : 7;
        $('bagStoreMatEn').checked = !!(b.autoStoreMaterial && b.autoStoreMaterial.enabled);
        $('bagStoreMatSlots').value = (b.autoStoreMaterial && b.autoStoreMaterial.emptySlotsBelow != null)
            ? b.autoStoreMaterial.emptySlotsBelow : 7;
        $('bagBuyEn').checked = !!(b.autoBuy && b.autoBuy.enabled);
        loadSelectedBuyRulesFromProfile(b.autoBuy);
        $('bagSignInEn').checked = !b.autoSignIn || b.autoSignIn.enabled !== false;
        $('bagUnionDonateEn').checked = !!(b.autoUnionDonate && b.autoUnionDonate.enabled);
        $('bagOfflineRewardEn').checked = !b.autoOfflineReward || b.autoOfflineReward.enabled !== false;
        $('bagVipRewardEn').checked = !!(b.autoVipReward && b.autoVipReward.enabled);
        $('bagMailBaodianEn').checked = !!(b.autoMailBaodian && b.autoMailBaodian.enabled);
        $('bagXuemaiEn').checked = !!(b.autoExchangeXuemai && b.autoExchangeXuemai.enabled);
        $('bagXuemaiCost').value = (b.autoExchangeXuemai && b.autoExchangeXuemai.cost) || 'chuanqi';
        var aa = b.autoAuction || {};
        $('bagAuctionEn').checked = !!aa.enabled;
        $('bagAuctionCqbEn').checked = !!aa.cqb;
        $('bagAuctionYbEn').checked = !!aa.yb;
        $('bagAuctionUnionEn').checked = !!aa.union;
        selectedAuctionIds = parseIdList(aa.itemIds).slice();
        $('bagSmeltWhenStoppedEn').checked = !b.smeltWhenStopped || b.smeltWhenStopped.enabled !== false;
        $('bagRecycleWhenStoppedEn').checked = !b.recycleWhenStopped || b.recycleWhenStopped.enabled !== false;

        var bo = p.boss || defaultBoss();
        $('bossHuntEn').checked = !!bo.enabled;
        $('bossPollSec').value = bo.pollSec != null ? bo.pollSec : 20;
        $('bossOccupySec').value = bo.occupySec != null ? bo.occupySec : 25;
        $('bossHuntSec').value = bo.huntSec != null ? bo.huntSec : 180;
        $('bossLootSec').value = bo.lootSec != null ? bo.lootSec : 10;
        $('bossSkipFarm').checked = bo.skipFarmIfQueued !== false;
        $('bossRandomMax').value = bo.randomMax != null ? bo.randomMax : 50;
        selectedRandomIds = parseIdList(bo.randomItemIds || '404,8151');
        if (!selectedRandomIds.length) selectedRandomIds = [404, 8151];
        var intervalMs = bo.randomIntervalMs != null ? Number(bo.randomIntervalMs) : 1500;
        $('bossRandomIntervalSec').value = (Math.round((intervalMs / 1000) * 10) / 10) || 1.5;
        $('bossRandomBuyEn').checked = !!bo.randomBuyEnabled;
        $('bossRandomBuyCount').value = bo.randomBuyCount != null ? bo.randomBuyCount : 50;
        $('bossNotifyEn').checked = bo.notify !== false;
        $('bossNotifyBrowser').checked = !!bo.browserNotify;
        if ($('bossHuanglingEn')) $('bossHuanglingEn').checked = !!bo.huanglingEnabled;
        if ($('bossEmoEn')) $('bossEmoEn').checked = !!bo.emoEnabled;
        selectedHuanglingKeys = Array.isArray(bo.huanglingKeys) ? bo.huanglingKeys.slice() : [];
        selectedEmoKeys = Array.isArray(bo.emoKeys) ? bo.emoKeys.slice() : [];
        updateExtraBossSummaries();
        selectedBossWatch = (bo.watchList || []).map(function (w) {
            var isHub = !!(w.isHub || w.hubNpcId);
            var entry = isHub ? (w.entryMapId || 0) : (w.entryMapId || w.arriveMapId || w.mapId);
            var spawn = w.spawnMapId || w.mapId;
            return {
                key: w.key || bossWatchKey(w.type, w.mapId),
                category: w.category || 'shouling',
                type: w.type,
                bossId: w.bossId,
                bossName: w.bossName,
                mapId: w.mapId,
                entryMapId: entry,
                spawnMapId: spawn,
                arriveMapId: entry || spawn,
                mapName: w.mapName,
                deliver: w.deliver || 0,
                spawnDeliverId: w.spawnDeliverId || 0,
                hubNpcId: w.hubNpcId || 0,
                isHub: isHub,
                portalX: w.portalX || 0,
                portalY: w.portalY || 0,
                portalName: w.portalName || '',
                spawnX: w.spawnX || 0,
                spawnY: w.spawnY || 0
            };
        });

        var ac = p.activity || defaultActivity();
        $('actNotifyEn').checked = ac.notify !== false;
        $('actNotifyBrowser').checked = !!ac.browserNotify;
        $('actWatchOnly').checked = ac.watchOnly !== false;
        $('actAutoGo').checked = !!ac.autoGo;
        $('actMoyingRandomMax').value = (function () {
            var v = ac.moyingRandomMax != null ? ac.moyingRandomMax : MOYING_RANDOM_DEFAULT;
            if (Number(v) === 1) v = MOYING_RANDOM_DEFAULT;
            return v;
        })();
        selectedActWatch = (ac.watchList || []).map(function (w) {
            return {
                id: parseInt(w.id, 10),
                name: w.name || ('活动' + w.id),
                timeText: w.timeText || '',
                link: w.link || '',
                level: w.level || 0
            };
        }).filter(function (w) { return w.id; });

        updateItemSummaries();
        updateBossWatchUI();
        updateActivityWatchUI();
        updateMapPickedLabel();
        if (window.TaskModule && TaskModule.fillFromProfile) TaskModule.fillFromProfile(p);
        if (window.PkModule && PkModule.fillEditor) PkModule.fillEditor(p);
        suppressAutoSave = false;
    }

    function readEditor() {
        var p = getActive();
        if (!p) return null;
        var wanted = $('pfName').value.trim() || '未命名方案';
        if (UserConfigStore.isNameTaken(wanted, p.id)) {
            var base = wanted;
            var n = 2;
            while (UserConfigStore.isNameTaken(base + ' (' + n + ')', p.id)) n++;
            wanted = base + ' (' + n + ')';
            if ($('pfName')) $('pfName').value = wanted;
            syncSchemeNameLabel();
        }
        p.name = wanted;
        p.farm = p.farm || {};
        p.farm.mapId = parseInt($('pfMapId').value, 10) || 0;
        p.farm.enterType = 'auto';
        p.farm.deliverId = parseInt($('pfDeliverId').value, 10) || 0;
        p.farm.guajiType = parseInt($('pfGuajiType').value, 10) || 0;
        p.farm.autoFight = 1;
        p.farm.autoPick = $('pfAutoPick').checked;
        var parseList = window.FarmTacticsModule ? FarmTacticsModule.parseNameList : parseIdList;
        p.farm.tactics = {
            mapRepeatCount: parseInt($('pfMapRepeatCount').value, 10) || 0,
            mapRepeatWindowMin: parseInt($('pfMapRepeatWindowMin').value, 10) || 5,
            altMapIds: parseList($('pfAltMapIds').value),
            bossOwnerEnabled: $('pfBossOwnerEn').checked,
            bossOwnerHpPct: parseInt($('pfBossOwnerHpPct').value, 10) || 0,
            bossOwnerWhitelist: parseList($('pfBossOwnerWl').value),
            lowHpKiteEnabled: $('pfLowHpKiteEn').checked,
            lowHpKitePct: parseInt($('pfLowHpKitePct').value, 10) || 0,
            eliteOnly: $('pfEliteOnly').checked,
            skipEvilChest: $('pfSkipEvilChest').checked,
            autoCollectCorpse: $('pfAutoCollect').checked,
            autoTeamEnabled: $('pfAutoTeamEn').checked,
            autoTeamMembers: parseList($('pfAutoTeamMembers').value),
            autoTeamMode: $('pfAutoTeamMode').value || 'leader'
        };
        if (window.FarmTacticsModule) FarmTacticsModule.mergeDefaults(p.farm.tactics);
        p.farm.soulHall = {
            enabled: !!($('pfSoulHallEn') && $('pfSoulHallEn').checked),
            minCount: parseInt($('pfSoulHallMin') && $('pfSoulHallMin').value, 10) || 10,
            cooldownSec: parseInt($('pfSoulHallCd') && $('pfSoulHallCd').value, 10) || 120
        };
        if (window.SoulHallModule) SoulHallModule.mergeDefaults(p.farm.soulHall);
        if (!p.farm.deliverId && p.farm.mapId) {
            var d = resolveDeliverFromCatalog(p.farm.mapId);
            if (d) {
                p.farm.deliverId = d;
                $('pfDeliverId').value = d;
            }
        }

        p.bag = {
            autoUse: {
                enabled: $('bagUseEn').checked,
                itemIds: selectedUseIds.slice(),
                intervalMs: parseInt($('bagUseInterval').value, 10) || 3000
            },
            autoRecycle: {
                enabled: $('bagRecycleEn').checked,
                emptySlotsBelow: parseInt($('bagRecycleSlots').value, 10)
            },
            autoSmelt: {
                enabled: $('bagSmeltEn').checked,
                emptySlotsBelow: parseInt($('bagSmeltSlots').value, 10)
            },
            autoDiscard: {
                enabled: $('bagDiscardEn').checked,
                itemIds: selectedDiscardIds.slice()
            },
            autoStoreEquip: {
                enabled: $('bagStoreEquipEn').checked,
                emptySlotsBelow: parseInt($('bagStoreEquipSlots').value, 10) || 7
            },
            autoStoreMaterial: {
                enabled: $('bagStoreMatEn').checked,
                emptySlotsBelow: parseInt($('bagStoreMatSlots').value, 10) || 7
            },
            autoBuy: {
                enabled: $('bagBuyEn').checked,
                items: selectedBuyRulesToArray()
            },
            autoSignIn: { enabled: $('bagSignInEn').checked },
            autoUnionDonate: { enabled: $('bagUnionDonateEn').checked, preferItem: true },
            autoOfflineReward: { enabled: $('bagOfflineRewardEn').checked, mode: 'free' },
            autoVipReward: { enabled: $('bagVipRewardEn').checked },
            autoMailBaodian: { enabled: $('bagMailBaodianEn').checked },
            autoExchangeXuemai: {
                enabled: $('bagXuemaiEn').checked,
                cost: $('bagXuemaiCost').value || 'chuanqi'
            },
            autoAuction: {
                enabled: $('bagAuctionEn').checked,
                cqb: !!($('bagAuctionCqbEn') && $('bagAuctionCqbEn').checked),
                yb: !!($('bagAuctionYbEn') && $('bagAuctionYbEn').checked),
                union: !!($('bagAuctionUnionEn') && $('bagAuctionUnionEn').checked),
                itemIds: selectedAuctionIds.slice(),
                maxValueMul: 2
            },
            smeltWhenStopped: { enabled: $('bagSmeltWhenStoppedEn').checked },
            recycleWhenStopped: { enabled: $('bagRecycleWhenStoppedEn').checked }
        };
        p.boss = {
            enabled: $('bossHuntEn').checked,
            pollSec: parseInt($('bossPollSec').value, 10) || 20,
            occupySec: parseInt($('bossOccupySec').value, 10) || 25,
            huntSec: parseInt($('bossHuntSec').value, 10) || 180,
            lootSec: (function () {
                var v = parseInt($('bossLootSec').value, 10);
                return isNaN(v) ? 10 : Math.max(0, v);
            })(),
            skipFarmIfQueued: $('bossSkipFarm').checked,
            randomMax: parseInt($('bossRandomMax').value, 10) || 50,
            randomItemIds: (selectedRandomIds.length ? selectedRandomIds : [404, 8151]).join(','),
            randomIntervalMs: (function () {
                var sec = parseFloat($('bossRandomIntervalSec').value);
                if (isNaN(sec) || sec < 0.5) sec = 1.5;
                return Math.round(sec * 1000);
            })(),
            randomBuyEnabled: !!($('bossRandomBuyEn') && $('bossRandomBuyEn').checked),
            randomBuyCount: (function () {
                var n = parseInt($('bossRandomBuyCount').value, 10);
                if (isNaN(n) || n < 1) n = 50;
                return Math.min(999, n);
            })(),
            notify: $('bossNotifyEn').checked,
            browserNotify: $('bossNotifyBrowser').checked,
            huanglingEnabled: !!($('bossHuanglingEn') && $('bossHuanglingEn').checked),
            huanglingKeys: (typeof selectedHuanglingKeys !== 'undefined' ? selectedHuanglingKeys : []).slice(),
            emoEnabled: !!($('bossEmoEn') && $('bossEmoEn').checked),
            emoKeys: (typeof selectedEmoKeys !== 'undefined' ? selectedEmoKeys : []).slice(),
            watchList: selectedBossWatch.map(function (w) {
                var isHub = !!(w.isHub || w.hubNpcId);
                var entry = isHub ? (w.entryMapId || 0) : (w.entryMapId || w.arriveMapId || w.mapId);
                var spawn = w.spawnMapId || w.mapId;
                return {
                    key: w.key,
                    category: 'shouling',
                    type: w.type,
                    bossId: w.bossId,
                    bossName: w.bossName,
                    mapId: w.mapId,
                    entryMapId: entry,
                    spawnMapId: spawn,
                    arriveMapId: entry || spawn,
                    mapName: w.mapName,
                    deliver: w.deliver || 0,
                    spawnDeliverId: w.spawnDeliverId || 0,
                    hubNpcId: w.hubNpcId || 0,
                    isHub: isHub,
                    portalX: w.portalX || 0,
                    portalY: w.portalY || 0,
                    portalName: w.portalName || '',
                    spawnX: w.spawnX || 0,
                    spawnY: w.spawnY || 0
                };
            })
        };
        p.activity = {
            notify: $('actNotifyEn').checked,
            browserNotify: $('actNotifyBrowser').checked,
            watchOnly: $('actWatchOnly').checked,
            autoGo: $('actAutoGo').checked,
            moyingRandomMax: (function () {
                var n = parseInt($('actMoyingRandomMax').value, 10);
                if (isNaN(n) || n < 1) n = MOYING_RANDOM_DEFAULT;
                return Math.min(999, n);
            })(),
            watchList: selectedActWatch.map(function (w) {
                return {
                    id: w.id,
                    name: w.name,
                    timeText: w.timeText || '',
                    link: w.link || '',
                    level: w.level || 0
                };
            })
        };
        if (window.TaskModule && TaskModule.readFromEditor) TaskModule.readFromEditor(p);
        if (window.PkModule && PkModule.readFromEditor) PkModule.readFromEditor(p);
        if (!p.bossJobs) p.bossJobs = [];
        updateFarmBagSumMeta();
        updateBossWatchUI();
        updateActivityWatchUI();
        return p;
    }

    function resolveDeliverFromCatalog(mapId) {
        mapId = parseInt(mapId, 10);
        var best = null;
        (catalog.delivers || []).forEach(function (d) {
            if (!d || d.toMapId != mapId) return;
            if (!best) best = d;
            else if (best.cost && !d.cost) best = d;
        });
        if (best) return best.id;
        var list = allCatalogMaps();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id == mapId && list[i].deliver) return list[i].deliver;
        }
        return 0;
    }

    window.newProfile = function () {
        flushAutoSave();
        var p = defaultProfile();
        var base = p.name || '新挂机方案';
        var name = base;
        var n = 2;
        while (UserConfigStore.isNameTaken(name)) {
            name = base + ' (' + n + ')';
            n++;
        }
        p.name = name;
        profiles.push(p);
        activeId = p.id;
        saveProfiles();
        fillEditor(p);
        renderProfileList();
        log('已新建方案: ' + p.name);
    };

    window.saveProfile = function () {
        flushAutoSave();
        var cur = getActive();
        var nm = (cur.name || '').trim();
        if (UserConfigStore.isNameTaken(nm, cur.id)) {
            log('方案名称已存在，请改名后再保存');
            return;
        }
        log('方案已保存: ' + cur.name);
    };

    window.deleteProfile = function () {
        if (profiles.length <= 1) { log('至少保留一个方案'); return; }
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
        var id = activeId;
        profiles = profiles.filter(function (p) { return p.id !== id; });
        activeId = profiles[0].id;
        saveProfiles();
        fillEditor(getActive());
        renderProfileList();
        log('已删除方案');
    };
