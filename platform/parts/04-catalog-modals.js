    function uid() {
        return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function parseIdList(str) {
        if (!str) return [];
        if (Array.isArray(str)) return str.map(Number).filter(Boolean);
        return String(str).split(/[,，\s]+/).map(function (s) { return parseInt(s, 10); }).filter(Boolean);
    }

    function itemLabel(id) {
        var it = itemCatalog.byId[id];
        if (it) return it.name + ' (' + id + ')';
        if (KNOWN_ITEM_NAMES[id]) return KNOWN_ITEM_NAMES[id] + ' (' + id + ')';
        return '道具 ' + id;
    }

    function itemNameOnly(id) {
        var it = itemCatalog.byId[id];
        if (it && it.name) return it.name;
        if (KNOWN_ITEM_NAMES[id]) return KNOWN_ITEM_NAMES[id];
        return '道具' + id;
    }

    function buildItemIndex() {
        itemCatalog.byId = {};
        (itemCatalog.use || []).concat(itemCatalog.discard || []).concat(itemCatalog.equip || []).forEach(function (it) {
            if (it && it.id) itemCatalog.byId[it.id] = it;
        });
    }

    function buyCatalogByItemId(itemId) {
        itemId = parseInt(itemId, 10);
        var list = buyCatalog.items || [];
        for (var i = 0; i < list.length; i++) {
            if (parseInt(list[i].itemId, 10) === itemId) return list[i];
        }
        return null;
    }

    function buyCapFromCatalog(cat, r) {
        var limitMax = (r && r.limitMax != null) ? Number(r.limitMax) :
            (cat && cat.limitMax != null ? cat.limitMax : null);
        var daily = (r && r.dailyLimit != null) ? Number(r.dailyLimit) :
            (cat && cat.dailyLimit != null ? cat.dailyLimit : null);
        var cap = limitMax || daily || (cat && cat.defaultTargetCount != null ? cat.defaultTargetCount : 1);
        if (!cap || cap < 1) cap = 1;
        return { cap: cap, dailyLimit: daily, limitMax: limitMax || daily };
    }

    function normalizeAutoBuyRules(buy) {
        buy = buy || {};
        if (buy.items && buy.items.length) {
            var out = [];
            buy.items.forEach(function (r) {
                if (!r || !r.itemId) return;
                var cat = buyCatalogByItemId(r.itemId);
                var caps = buyCapFromCatalog(cat, r);
                out.push({
                    itemId: parseInt(r.itemId, 10),
                    storeId: r.storeId != null ? parseInt(r.storeId, 10) :
                        (cat && cat.storeId ? parseInt(cat.storeId, 10) : 0),
                    targetCount: caps.cap,
                    dailyLimit: caps.dailyLimit,
                    limitMax: caps.limitMax,
                    name: r.name || (cat && cat.name) || ('道具' + r.itemId)
                });
            });
            return out;
        }
        var ids = parseIdList(buy.itemIds);
        if (!ids.length) return [];
        return ids.map(function (itemId) {
            var cat = buyCatalogByItemId(itemId);
            var caps = buyCapFromCatalog(cat, null);
            return {
                itemId: itemId,
                storeId: cat && cat.storeId ? parseInt(cat.storeId, 10) : 0,
                targetCount: caps.cap,
                dailyLimit: caps.dailyLimit,
                limitMax: caps.limitMax,
                name: cat && cat.name || ('道具' + itemId)
            };
        });
    }

    function selectedBuyRulesToArray() {
        var out = [];
        for (var k in selectedBuyRules) {
            if (selectedBuyRules[k]) out.push(selectedBuyRules[k]);
        }
        out.sort(function (a, b) { return a.itemId - b.itemId; });
        return out;
    }

    function loadSelectedBuyRulesFromProfile(buy) {
        selectedBuyRules = {};
        normalizeAutoBuyRules(buy || {}).forEach(function (r) {
            selectedBuyRules[r.itemId] = r;
        });
        selectedBuyIds = selectedBuyRulesToArray().map(function (r) { return r.itemId; });
    }

    function updateItemSummaries() {
        $('bagUseSummary').textContent = selectedUseIds.length
            ? ('已选 ' + selectedUseIds.length + ' 个：' + selectedUseIds.slice(0, 3).map(itemNameOnly).join('、') + (selectedUseIds.length > 3 ? '…' : ''))
            : '未选择使用道具';
        $('bagDiscardSummary').textContent = selectedDiscardIds.length
            ? ('已选 ' + selectedDiscardIds.length + ' 个：' + selectedDiscardIds.slice(0, 3).map(itemNameOnly).join('、') + (selectedDiscardIds.length > 3 ? '…' : ''))
            : '未选择丢弃名单';
        var rules = selectedBuyRulesToArray();
        $('bagBuySummary').textContent = rules.length
            ? ('已选 ' + rules.length + ' 项：' + rules.slice(0, 2).map(function (r) {
                return (r.name || r.itemId) + '→' + r.targetCount;
            }).join('、') + (rules.length > 2 ? '…' : ''))
            : '未选择购买道具';
        var as = $('bagAuctionSummary');
        if (as) {
            as.textContent = selectedAuctionIds.length
                ? ('已选 ' + selectedAuctionIds.length + ' 个：' + selectedAuctionIds.slice(0, 3).map(itemNameOnly).join('、') +
                    (selectedAuctionIds.length > 3 ? '…' : ''))
                : '未选择关注道具（行会竞价不依赖名单）';
        }
        var br = $('bossRandomSummary');
        if (br) {
            br.textContent = selectedRandomIds.length
                ? ('已选 ' + selectedRandomIds.length + ' 个：' + selectedRandomIds.slice(0, 3).map(itemNameOnly).join('、') + (selectedRandomIds.length > 3 ? '…' : ''))
                : '未选择随机道具';
        }
    }

    // ---- 自动购买弹窗 ----
    var buyModalDraft = {};

    function renderBuyModalTags() {
        var tagsEl = $('modalBuyTags');
        var rules = [];
        for (var k in buyModalDraft) rules.push(buyModalDraft[k]);
        rules.sort(function (a, b) { return a.itemId - b.itemId; });
        if (!rules.length) {
            tagsEl.innerHTML = '<span style="color:#94a3b8;font-size:12px;">未选择</span>';
            return;
        }
        tagsEl.innerHTML = rules.map(function (r) {
            return '<span class="ms-tag">' + (r.name || r.itemId) +
                ' →' + r.targetCount +
                '<button type="button" onclick="toggleBuyItem(' + r.itemId + ',false)">×</button></span>';
        }).join('');
    }

    window.toggleBuyItem = function (itemId, forceOn) {
        itemId = parseInt(itemId, 10);
        var on = forceOn === true ? true : forceOn === false ? false : !buyModalDraft[itemId];
        if (on) {
            var cat = buyCatalogByItemId(itemId);
            if (!cat || cat.available === false) return;
            var caps = buyCapFromCatalog(cat, null);
            buyModalDraft[itemId] = {
                itemId: itemId,
                storeId: cat.storeId || 0,
                name: cat.name,
                dailyLimit: caps.dailyLimit,
                limitMax: caps.limitMax,
                targetCount: caps.cap
            };
        } else {
            delete buyModalDraft[itemId];
        }
        renderBuyModalTags();
        renderBuyModalList();
    };

    window.renderBuyModalList = function () {
        var q = (($('modalBuyFilter').value) || '').trim().toLowerCase();
        var words = q ? q.split(/\s+/).filter(Boolean) : [];
        var list = (buyCatalog.items || []).slice();
        list = list.filter(function (it) {
            if (it.available === false) return false;
            if (!words.length) return true;
            var hay = (it.name + ' ' + it.itemId + ' ' + (it.currency || '') + ' ' + (it.label || '')).toLowerCase();
            for (var i = 0; i < words.length; i++) {
                if (hay.indexOf(words[i]) < 0) return false;
            }
            return true;
        });
        list.sort(function (a, b) {
            var sa = buyModalDraft[a.itemId] ? 0 : 1;
            var sb = buyModalDraft[b.itemId] ? 0 : 1;
            if (sa !== sb) return sa - sb;
            if (a.moneyType === 41 && b.moneyType !== 41) return -1;
            if (b.moneyType === 41 && a.moneyType !== 41) return 1;
            return String(a.name).localeCompare(String(b.name), 'zh');
        });
        var listEl = $('modalBuyList');
        if (!list.length) {
            listEl.innerHTML = '<div class="hint" style="padding:6px;">无匹配可购道具</div>';
            return;
        }
        listEl.innerHTML = list.map(function (it) {
            var rule = buyModalDraft[it.itemId];
            var checked = rule ? ' checked' : '';
            var daily = it.dailyLimit != null ? ('每日' + it.dailyLimit + '个') :
                (it.limitMax != null ? ('限购' + it.limitMax + '个') : '无限购');
            var price = it.price != null ? (it.price + (it.currency || '')) : '';
            var capInfo = buyCapFromCatalog(it, null);
            return '<label class="buy-opt">' +
                '<input type="checkbox"' + checked + ' onchange="toggleBuyItem(' + it.itemId + ', this.checked)">' +
                '<div><div class="buy-name">' + it.name + '</div>' +
                '<div class="buy-meta">[' + daily + '] · ' + price +
                (rule ? ' · 买到' + capInfo.cap + '个' : '') + '</div></div>' +
                '</label>';
        }).join('');
    };

    window.openBuyModal = function () {
        buyModalDraft = {};
        selectedBuyRulesToArray().forEach(function (r) {
            buyModalDraft[r.itemId] = JSON.parse(JSON.stringify(r));
        });
        $('modalBuyFilter').value = '';
        renderBuyModalTags();
        renderBuyModalList();
        $('buyModal').classList.add('show');
    };

    window.closeBuyModal = function () {
        $('buyModal').classList.remove('show');
    };

    window.confirmBuyModal = function () {
        selectedBuyRules = JSON.parse(JSON.stringify(buyModalDraft));
        selectedBuyIds = selectedBuyRulesToArray().map(function (r) { return r.itemId; });
        updateItemSummaries();
        closeBuyModal();
        autoSaveProfile();
    };

    // ---- 道具弹窗（多选）----
    var itemModalKind = 'use';
    var itemModalDraft = [];

    function renderModalItemTags() {
        var tagsEl = $('modalItemTags');
        if (!itemModalDraft.length) {
            tagsEl.innerHTML = '<span style="color:#94a3b8;font-size:12px;">未选择</span>';
            return;
        }
        tagsEl.innerHTML = itemModalDraft.map(function (id) {
            return '<span class="ms-tag">' + itemNameOnly(id) +
                '<button type="button" title="移除" onclick="toggleModalItem(' + id + ',false)">×</button></span>';
        }).join('');
    }

    window.toggleModalItem = function (id, forceOn) {
        id = parseInt(id, 10);
        var idx = itemModalDraft.indexOf(id);
        var on = forceOn === true ? true : forceOn === false ? false : idx < 0;
        if (on && idx < 0) itemModalDraft.push(id);
        if (!on && idx >= 0) itemModalDraft.splice(idx, 1);
        renderModalItemTags();
        renderModalItemList();
    };

    window.renderModalItemList = function () {
        var source = itemModalKind === 'discard' ? (itemCatalog.discard || [])
            : itemModalKind === 'buy' || itemModalKind === 'auction'
                ? (itemCatalog.use || []).concat(itemCatalog.discard || []).concat(itemCatalog.equip || [])
            : (itemCatalog.use || []);
        // 随机道具：保证常用项出现在列表前部
        if (itemModalKind === 'random') {
            var extra = [
                { id: 404, name: KNOWN_ITEM_NAMES[404] || '随机石', cat: '随机', kind: 'use' },
                { id: 8151, name: KNOWN_ITEM_NAMES[8151] || '随机卷', cat: '随机', kind: 'use' }
            ];
            var seen = {};
            source = extra.concat(source).filter(function (it) {
                if (!it || !it.id || seen[it.id]) return false;
                seen[it.id] = 1;
                return true;
            });
        }
        var q = (($('modalItemFilter').value) || '').trim().toLowerCase();
        var matched = source.filter(function (it) {
            if (!q) return true;
            return (it.name + ' ' + it.id + ' ' + (it.cat || '')).toLowerCase().indexOf(q) >= 0;
        });
        // 全量目录很大：无关键词时优先已选，再截一段，靠搜索找目标
        if (!q) {
            var selSet = {};
            itemModalDraft.forEach(function (id) { selSet[id] = 1; });
            var head = matched.filter(function (it) { return selSet[it.id]; });
            var rest = matched.filter(function (it) { return !selSet[it.id]; }).slice(0, 120);
            matched = head.concat(rest);
        } else {
            matched = matched.slice(0, 200);
        }
        var listEl = $('modalItemList');
        if (!matched.length) {
            listEl.innerHTML = '<div class="hint" style="padding:6px;">无匹配道具，请换个关键词</div>';
            return;
        }
        listEl.innerHTML = matched.map(function (it) {
            var checked = itemModalDraft.indexOf(it.id) >= 0 ? ' checked' : '';
            return '<label class="ms-opt"><input type="checkbox"' + checked +
                ' onchange="toggleModalItem(' + it.id + ', this.checked)">' +
                '<span>' + it.name + '</span>' +
                '<span class="meta">' + (it.cat || (it.kind === 'equip' ? '装备' : '道具')) + '</span></label>';
        }).join('');
    };

    window.openItemModal = function (kind) {
        if (kind === 'buy') {
            openBuyModal();
            return;
        }
        if (kind === 'discard') itemModalKind = 'discard';
        else if (kind === 'random') itemModalKind = 'random';
        else if (kind === 'auction') itemModalKind = 'auction';
        else itemModalKind = 'use';
        itemModalDraft = (itemModalKind === 'use' ? selectedUseIds
            : itemModalKind === 'discard' ? selectedDiscardIds
            : itemModalKind === 'auction' ? selectedAuctionIds
            : selectedRandomIds).slice();
        $('itemModalTitle').textContent = itemModalKind === 'use' ? '选择自动使用道具'
            : itemModalKind === 'discard' ? '选择自动丢弃名单'
            : itemModalKind === 'auction' ? '选择拍卖关注道具'
            : '选择随机寻怪道具';
        $('modalItemFilter').value = '';
        renderModalItemTags();
        renderModalItemList();
        $('itemModal').classList.add('show');
    };

    window.closeItemModal = function () {
        $('itemModal').classList.remove('show');
    };

    window.confirmItemModal = function () {
        if (itemModalKind === 'use') selectedUseIds = itemModalDraft.slice();
        else if (itemModalKind === 'discard') selectedDiscardIds = itemModalDraft.slice();
        else if (itemModalKind === 'auction') selectedAuctionIds = itemModalDraft.slice();
        else selectedRandomIds = itemModalDraft.length ? itemModalDraft.slice() : [404, 8151];
        updateItemSummaries();
        closeItemModal();
        autoSaveProfile();
    };

    // ---- 地图弹窗（单选）----
    var mapModalDraftId = 0;
    var mapModalDraftDeliver = 0;

    window.openMapModal = function () {
        mapModalDraftId = parseInt($('pfMapId').value, 10) || 0;
        mapModalDraftDeliver = parseInt($('pfDeliverId').value, 10) || 0;
        $('mapFilter').value = '';
        renderMapModalList();
        $('mapModal').classList.add('show');
    };

    window.closeMapModal = function () {
        $('mapModal').classList.remove('show');
    };

    window.renderMapModalList = function () {
        var q = ($('mapFilter').value || '').trim().toLowerCase();
        var list = allCatalogMaps().filter(function (m) {
            if (!q) return true;
            return (m.name + m.id).toLowerCase().indexOf(q) >= 0;
        }).slice(0, 200);
        var el = $('modalMapList');
        if (!list.length) {
            el.innerHTML = '<div class="hint" style="padding:6px;">无匹配地图</div>';
            return;
        }
        el.innerHTML = list.map(function (m) {
            var active = m.id == mapModalDraftId ? ' active' : '';
            return '<div class="map-opt' + active + '" data-id="' + m.id + '" data-deliver="' + (m.deliver || 0) +
                '" onclick="pickMapDraft(' + m.id + ',' + (m.deliver || 0) + ')">' + m.label + '</div>';
        }).join('');
    };

    window.pickMapDraft = function (id, deliver) {
        mapModalDraftId = parseInt(id, 10);
        mapModalDraftDeliver = parseInt(deliver, 10) || resolveDeliverFromCatalog(id) || 0;
        renderMapModalList();
    };

    window.confirmMapModal = function () {
        if (!mapModalDraftId) { log('请先点选一张地图'); return; }
        $('pfMapId').value = mapModalDraftId;
        $('pfEnterType').value = 'auto';
        $('pfDeliverId').value = mapModalDraftDeliver || '';
        updateMapPickedLabel();
        closeMapModal();
        log('已选地图 ' + (mapNameById(mapModalDraftId) || mapModalDraftId));
        autoSaveProfile();
    };

    window.renderMapSelect = function () {
        // 兼容旧调用：仅刷新摘要
        updateMapPickedLabel();
    };

    function defaultBoss() {
        return {
            enabled: false,
            pollSec: 20,
            occupySec: 25,
            huntSec: 180,
            lootSec: 10,
            skipFarmIfQueued: true,
            randomMax: 50,
            randomItemIds: '404,8151',
            randomIntervalMs: 1500,
            randomBuyEnabled: false,
            randomBuyCount: 50,
            notify: true,
            browserNotify: false,
            watchList: [],
            huanglingEnabled: false,
            huanglingKeys: [],
            emoEnabled: false,
            emoKeys: []
        };
    }

    function defaultActivity() {
        return {
            notify: true,
            browserNotify: false,
            watchOnly: true,
            autoGo: false,
            moyingRandomMax: MOYING_RANDOM_DEFAULT,
            watchList: []
        };
    }

    function defaultBag() {
        return {
            autoUse: { enabled: true, itemIds: [1001, 4645], intervalMs: 3000 },
            autoRecycle: { enabled: true, emptySlotsBelow: 7 },
            autoSmelt: { enabled: true, emptySlotsBelow: 10 },
            autoDiscard: { enabled: false, itemIds: [] },
            autoStoreEquip: { enabled: false, emptySlotsBelow: 7 },
            autoStoreMaterial: { enabled: false, emptySlotsBelow: 7 },
            autoBuy: { enabled: false, items: [] },
            autoSignIn: { enabled: true },
            autoUnionDonate: { enabled: false, preferItem: true },
            autoOfflineReward: { enabled: true, mode: 'free' },
            autoVipReward: { enabled: false },
            autoMailBaodian: { enabled: false },
            autoExchangeXuemai: { enabled: false, cost: 'chuanqi' },
            autoAuction: {
                enabled: false,
                cqb: false,
                yb: false,
                union: false,
                itemIds: [],
                maxValueMul: 2
            },
            smeltWhenStopped: { enabled: true },
            recycleWhenStopped: { enabled: true }
        };
    }

    function defaultProfile() {
        return {
            id: uid(),
            name: '新挂机方案',
            farm: {
                mapId: 154,
                enterType: 'auto',
                deliverId: 0,
                autoFight: 1,
                guajiType: 0,
                autoPick: true,
                tactics: window.FarmTacticsModule ? FarmTacticsModule.defaultTactics() : {}
            },
            bag: defaultBag(),
            boss: defaultBoss(),
            activity: defaultActivity(),
            tasks: (window.TaskModule && TaskModule.defaultTasks) ? TaskModule.defaultTasks() : { taskPriority: false, groupOpen: { wolong: true }, items: {} },
            pk: window.PkModule ? PkModule.defaultPk() : {},
            bossJobs: []
        };
    }

    function ensureBag(p) {
        if (!p) return null;
        if (!p.bag) p.bag = defaultBag();
        if (!p.bag.autoUse) p.bag.autoUse = defaultBag().autoUse;
        if (!p.bag.autoRecycle) p.bag.autoRecycle = defaultBag().autoRecycle;
        if (!p.bag.autoSmelt) p.bag.autoSmelt = defaultBag().autoSmelt;
        if (!p.bag.autoDiscard) p.bag.autoDiscard = defaultBag().autoDiscard;
        var db = defaultBag();
        if (!p.bag.autoStoreEquip) p.bag.autoStoreEquip = db.autoStoreEquip;
        if (!p.bag.autoStoreMaterial) p.bag.autoStoreMaterial = db.autoStoreMaterial;
        if (!p.bag.autoBuy) p.bag.autoBuy = db.autoBuy;
        if (p.bag.autoBuy && (p.bag.autoBuy.items || p.bag.autoBuy.itemIds)) {
            p.bag.autoBuy.items = normalizeAutoBuyRules(p.bag.autoBuy);
        }
        if (!p.bag.autoSignIn) p.bag.autoSignIn = db.autoSignIn;
        if (!p.bag.autoUnionDonate) p.bag.autoUnionDonate = db.autoUnionDonate;
        if (!p.bag.autoOfflineReward) p.bag.autoOfflineReward = db.autoOfflineReward;
        if (!p.bag.autoVipReward) p.bag.autoVipReward = db.autoVipReward;
        if (!p.bag.autoMailBaodian) p.bag.autoMailBaodian = db.autoMailBaodian;
        if (!p.bag.autoExchangeXuemai) p.bag.autoExchangeXuemai = db.autoExchangeXuemai;
        if (!p.bag.autoAuction) p.bag.autoAuction = db.autoAuction;
        if (!p.bag.smeltWhenStopped) p.bag.smeltWhenStopped = db.smeltWhenStopped;
        if (!p.bag.recycleWhenStopped) p.bag.recycleWhenStopped = db.recycleWhenStopped;
        if (!p.boss) p.boss = defaultBoss();
        if (!Array.isArray(p.boss.watchList)) p.boss.watchList = [];
        if (p.boss.pollSec == null) p.boss.pollSec = 20;
        if (p.boss.occupySec == null) p.boss.occupySec = 25;
        if (p.boss.huntSec == null) p.boss.huntSec = 180;
        if (p.boss.lootSec == null) p.boss.lootSec = 10;
        if (p.boss.skipFarmIfQueued == null) p.boss.skipFarmIfQueued = true;
        if (p.boss.randomMax == null) p.boss.randomMax = 50;
        if (!p.boss.randomItemIds) p.boss.randomItemIds = '404,8151';
        if (p.boss.randomIntervalMs == null) p.boss.randomIntervalMs = 1500;
        if (p.boss.randomBuyEnabled == null) p.boss.randomBuyEnabled = false;
        if (p.boss.randomBuyCount == null) p.boss.randomBuyCount = 50;
        if (!p.activity) p.activity = defaultActivity();
        if (!Array.isArray(p.activity.watchList)) p.activity.watchList = [];
        if (p.activity.notify == null) p.activity.notify = true;
        if (p.activity.watchOnly == null) p.activity.watchOnly = true;
        if (p.activity.moyingRandomMax == null) p.activity.moyingRandomMax = MOYING_RANDOM_DEFAULT;
        if (p.activity.moyingRandomMax === 1) p.activity.moyingRandomMax = MOYING_RANDOM_DEFAULT;
        if (window.TaskModule && TaskModule.mergeProfileDefaults) TaskModule.mergeProfileDefaults(p);
        if (window.FarmTacticsModule && FarmTacticsModule.ensureFarm) FarmTacticsModule.ensureFarm(p);
        if (window.PkModule && PkModule.ensurePk) PkModule.ensurePk(p);
        return p;
    }

    function bossWatchKey(type, mapId) {
        return 'sl_' + type + '_' + mapId;
    }

    function flattenBossCatalog(list) {
        var out = [];
        (list || []).forEach(function (b) {
            // 关注弹窗只展示首领(type1=2)；稀有精英(type1=1)走「地下皇陵」配置
            if (b.category && b.category !== 'shouling') return;
            (b.locations || []).forEach(function (loc) {
                out.push({
                    key: bossWatchKey(b.type, loc.mapId),
                    category: 'shouling',
                    type: b.type,
                    bossId: b.bossId,
                    bossName: b.bossName,
                    mapId: loc.mapId,
                    arriveMapId: loc.arriveMapId || loc.mapId,
                    mapName: loc.mapName || ('地图' + loc.mapId),
                    deliver: loc.deliver || 0,
                    spawnX: loc.spawnX || 0,
                    spawnY: loc.spawnY || 0,
                    isAlive: loc.isAlive || 0,
                    refreshed: !!loc.refreshed,
                    liveCount: b.liveCount,
                    totalCount: b.totalCount
                });
            });
        });
        return out;
    }

    function updateBossWatchUI() {
        var n = selectedBossWatch.length;
        $('bossWatchSummary').textContent = n
            ? ('已关注 ' + n + ' 个地点：' + selectedBossWatch.slice(0, 2).map(function (w) {
                return (w.bossName || '') + '@' + (w.mapName || w.mapId);
            }).join('、') + (n > 2 ? '…' : ''))
            : '尚未关注 Boss';
        $('bossSumMeta').textContent = ($('bossHuntEn').checked ? '猎杀开 · ' : '') +
            (n ? ('关注' + n) : '未关注');

        var el = $('bossWatchList');
        if (!n) {
            el.innerHTML = '<div class="hint" style="padding:8px;">从全量首领列表勾选关注目标</div>';
            return;
        }
        el.innerHTML = selectedBossWatch.map(function (w, idx) {
            var alive = getWatchAliveStatus(w);
            var dotCls = alive == null ? '' : (Number(alive) > 0 ? 'on' : 'off');
            return '<div class="boss-watch-item" data-key="' + w.key + '">' +
                '<span class="boss-status-dot ' + dotCls + '"></span>' +
                '<span class="bw-name">' + (w.bossName || 'Boss') + ' · ' + (w.mapName || w.mapId) +
                ' <span style="color:#94a3b8">type=' + w.type + '</span></span>' +
                '<button type="button" title="上移" onclick="moveBossWatch(' + idx + ',-1)">↑</button>' +
                '<button type="button" title="下移" onclick="moveBossWatch(' + idx + ',1)">↓</button>' +
                '<button type="button" title="移除" onclick="removeBossWatch(\'' + w.key + '\')">×</button></div>';
        }).join('');
    }

    window.moveBossWatch = function (idx, dir) {
        var j = idx + dir;
        if (j < 0 || j >= selectedBossWatch.length) return;
        var t = selectedBossWatch[idx];
        selectedBossWatch[idx] = selectedBossWatch[j];
        selectedBossWatch[j] = t;
        updateBossWatchUI();
        autoSaveProfile();
    };

    window.removeBossWatch = function (key) {
        selectedBossWatch = selectedBossWatch.filter(function (w) { return w.key !== key; });
        updateBossWatchUI();
        autoSaveProfile();
    };

    function updateFarmBagSumMeta() {
        var mid = parseInt($('pfMapId').value, 10) || 0;
        $('farmSumMeta').textContent = mid
            ? ((mapNameById(mid) || '地图') + ' ' + mid)
            : '未选地图';
        var parts = [];
        if ($('bagUseEn').checked) parts.push('用药');
        if ($('bagRecycleEn').checked) parts.push('回收');
        if ($('bagSmeltEn').checked) parts.push('熔炼');
        if ($('bagDiscardEn').checked) parts.push('丢弃');
        if ($('bagStoreEquipEn') && $('bagStoreEquipEn').checked) parts.push('存装');
        if ($('bagStoreMatEn') && $('bagStoreMatEn').checked) parts.push('存材');
        if ($('bagBuyEn') && $('bagBuyEn').checked) parts.push('购买');
        if (($('bagSignInEn') && $('bagSignInEn').checked) ||
            ($('bagOfflineRewardEn') && $('bagOfflineRewardEn').checked) ||
            ($('bagVipRewardEn') && $('bagVipRewardEn').checked) ||
            ($('bagXuemaiEn') && $('bagXuemaiEn').checked) ||
            ($('bagAuctionEn') && $('bagAuctionEn').checked)) parts.push('福利');
        $('bagSumMeta').textContent = parts.length ? parts.join('/') : '未启用';
        if (window.PkModule && PkModule.updateSumMeta) PkModule.updateSumMeta();
    }

    function updateActivityWatchUI() {
        var n = selectedActWatch.length;
        $('actWatchSummary').textContent = n
            ? ('已关注 ' + n + ' 个：' + selectedActWatch.slice(0, 2).map(function (w) {
                return w.name + (w.timeText ? '(' + w.timeText + ')' : '');
            }).join('、') + (n > 2 ? '…' : ''))
            : '尚未关注活动';
        $('actSumMeta').textContent = ($('actNotifyEn').checked ? '通知开 · ' : '') +
            (n ? ('关注' + n) : '未关注');

        var el = $('actWatchList');
        if (!n) {
            el.innerHTML = '<div class="hint" style="padding:8px;">从日常活动日历勾选关注目标</div>';
            return;
        }
        el.innerHTML = selectedActWatch.map(function (w, idx) {
            var st = actStateMap[w.id];
            if (st === undefined) st = actStateMap[String(w.id)];
            var dotCls = st == null ? '' : (Number(st) === 1 ? 'on' : (Number(st) === 2 ? 'off' : ''));
            var stTxt = st === 1 ? '进行中' : (st === 2 ? '已结束' : (st === 0 ? '未开启' : ''));
            return '<div class="boss-watch-item" data-id="' + w.id + '">' +
                '<span class="boss-status-dot ' + dotCls + '"></span>' +
                '<span class="bw-name">' + (w.name || ('活动' + w.id)) +
                (w.timeText ? ' · ' + w.timeText : '') +
                (stTxt ? ' <span style="color:#94a3b8">' + stTxt + '</span>' : '') +
                '</span>' +
                '<button type="button" title="前往" onclick="goWatchedActivity(' + w.id + ')">进</button>' +
                '<button type="button" title="上移" onclick="moveActWatch(' + idx + ',-1)">↑</button>' +
                '<button type="button" title="下移" onclick="moveActWatch(' + idx + ',1)">↓</button>' +
                '<button type="button" title="移除" onclick="removeActWatch(' + w.id + ')">×</button></div>';
        }).join('');
    }

    window.moveActWatch = function (idx, dir) {
        var j = idx + dir;
        if (j < 0 || j >= selectedActWatch.length) return;
        var t = selectedActWatch[idx];
        selectedActWatch[idx] = selectedActWatch[j];
        selectedActWatch[j] = t;
        updateActivityWatchUI();
        autoSaveProfile();
    };

    window.removeActWatch = function (id) {
        id = parseInt(id, 10);
        selectedActWatch = selectedActWatch.filter(function (w) { return w.id !== id; });
        updateActivityWatchUI();
        autoSaveProfile();
    };

    window.goWatchedActivity = function (id) {
        sendCmd('joinDailyActivity', { id: parseInt(id, 10) });
        log('前往活动 id=' + id);
    };

    window.refreshActivityCatalog = function () {
        sendCmd('getDailyActivities');
        log('已请求日常活动列表');
    };

    // ---- 活动关注弹窗 ----
    var actModalDraft = [];

    function renderModalActTags() {
        var tagsEl = $('modalActTags');
        if (!actModalDraft.length) {
            tagsEl.innerHTML = '<span style="color:#94a3b8;font-size:12px;">未选择</span>';
            return;
        }
        tagsEl.innerHTML = actModalDraft.map(function (w) {
            return '<span class="ms-tag">' + (w.name || w.id) +
                '<button type="button" onclick="toggleModalAct(' + w.id + ',false)">×</button></span>';
        }).join('');
    }

    window.toggleModalAct = function (id, forceOn) {
        id = parseInt(id, 10);
        var idx = -1;
        for (var i = 0; i < actModalDraft.length; i++) {
            if (actModalDraft[i].id === id) { idx = i; break; }
        }
        var on = forceOn === true ? true : forceOn === false ? false : idx < 0;
        if (on && idx < 0) {
            var found = null;
            for (var j = 0; j < activityCatalog.length; j++) {
                if (activityCatalog[j].id === id) { found = activityCatalog[j]; break; }
            }
            if (found) {
                actModalDraft.push({
                    id: found.id,
                    name: found.name,
                    timeText: found.timeText || '',
                    link: found.link || '',
                    level: found.level || 0
                });
            } else {
                actModalDraft.push({ id: id, name: '活动' + id, timeText: '', link: '', level: 0 });
            }
        }
        if (!on && idx >= 0) actModalDraft.splice(idx, 1);
        renderModalActTags();
        renderModalActList();
    };

    window.renderModalActList = function () {
        var q = (($('modalActFilter').value) || '').trim().toLowerCase();
        var matched = (activityCatalog || []).filter(function (it) {
            if (!q) return true;
            return (it.name + ' ' + it.id + ' ' + (it.timeText || '')).toLowerCase().indexOf(q) >= 0;
        });
        if (!q) {
            var sel = {};
            actModalDraft.forEach(function (w) { sel[w.id] = 1; });
            var head = matched.filter(function (it) { return sel[it.id]; });
            var rest = matched.filter(function (it) { return !sel[it.id]; }).slice(0, 120);
            matched = head.concat(rest);
        } else {
            matched = matched.slice(0, 200);
        }
        var listEl = $('modalActList');
        if (!matched.length) {
            listEl.innerHTML = '<div class="hint" style="padding:6px;">无匹配活动；可先点「刷新活动列表」</div>';
            return;
        }
        listEl.innerHTML = matched.map(function (it) {
            var checked = actModalDraft.some(function (w) { return w.id === it.id; }) ? ' checked' : '';
            return '<label class="ms-opt"><input type="checkbox"' + checked +
                ' onchange="toggleModalAct(' + it.id + ', this.checked)">' +
                '<span>' + it.name + '</span>' +
                '<span class="meta">' + (it.timeText || '') + ' · ' + (it.stateText || '') + ' · id=' + it.id + '</span></label>';
        }).join('');
    };

    window.openActivityModal = function () {
        if (!activityCatalog.length) sendCmd('getDailyActivities');
        actModalDraft = selectedActWatch.map(function (w) {
            return { id: w.id, name: w.name, timeText: w.timeText || '', link: w.link || '', level: w.level || 0 };
        });
        $('modalActFilter').value = '';
        renderModalActTags();
        renderModalActList();
        $('activityModal').classList.add('show');
    };

    window.closeActivityModal = function () {
        $('activityModal').classList.remove('show');
    };

    window.confirmActivityModal = function () {
        selectedActWatch = actModalDraft.map(function (w) {
            return { id: w.id, name: w.name, timeText: w.timeText || '', link: w.link || '', level: w.level || 0 };
        });
        updateActivityWatchUI();
        closeActivityModal();
        autoSaveProfile();
    };

    // ---- Boss 关注弹窗 ----
    var bossModalDraft = [];

    function renderModalBossTags() {
        var tagsEl = $('modalBossTags');
        if (!bossModalDraft.length) {
            tagsEl.innerHTML = '<span style="color:#94a3b8;font-size:12px;">未选择</span>';
            return;
        }
        tagsEl.innerHTML = bossModalDraft.map(function (w) {
            return '<span class="ms-tag">' + (w.bossName || 'Boss') + '@' + (w.mapName || w.mapId) +
                '<button type="button" onclick="toggleModalBoss(\'' + w.key + '\',false)">×</button></span>';
        }).join('');
    }

    window.toggleModalBoss = function (key, forceOn) {
        var idx = -1;
        for (var i = 0; i < bossModalDraft.length; i++) {
            if (bossModalDraft[i].key === key) { idx = i; break; }
        }
        var on = forceOn === true ? true : forceOn === false ? false : idx < 0;
        if (on && idx < 0) {
            var flat = flattenBossCatalog(bossCatalog);
            var found = flat.find(function (x) { return x.key === key; });
            if (found) bossModalDraft.push(found);
        }
        if (!on && idx >= 0) bossModalDraft.splice(idx, 1);
        renderModalBossTags();
        renderModalBossList();
    };

    window.renderModalBossList = function () {
        var flat = flattenBossCatalog(bossCatalog);
        var q = (($('modalBossFilter').value) || '').trim().toLowerCase();
        var matched = flat.filter(function (it) {
            if (!q) return true;
            return (it.bossName + ' ' + it.mapName + ' ' + it.type + ' ' + it.mapId).toLowerCase().indexOf(q) >= 0;
        });
        if (!q) {
            var sel = {};
            bossModalDraft.forEach(function (w) { sel[w.key] = 1; });
            var head = matched.filter(function (it) { return sel[it.key]; });
            var rest = matched.filter(function (it) { return !sel[it.key]; }).slice(0, 150);
            matched = head.concat(rest);
        } else {
            matched = matched.slice(0, 250);
        }
        var listEl = $('modalBossList');
        if (!bossCatalog.length) {
            listEl.innerHTML = '<div class="hint" style="padding:6px;">列表为空，请先点「刷新全量列表」或进入游戏后同步</div>';
            return;
        }
        if (!matched.length) {
            listEl.innerHTML = '<div class="hint" style="padding:6px;">无匹配</div>';
            return;
        }
        listEl.innerHTML = matched.map(function (it) {
            var checked = bossModalDraft.some(function (w) { return w.key === it.key; }) ? ' checked' : '';
            var st = it.refreshed ? '<span style="color:#059669">已刷新</span>' : '<span style="color:#dc2626">未刷新</span>';
            return '<label class="ms-opt"><input type="checkbox"' + checked +
                ' onchange="toggleModalBoss(\'' + it.key + '\', this.checked)">' +
                '<span>' + (it.bossName || 'Boss') + ' · ' + (it.mapName || it.mapId) + '</span>' +
                '<span class="meta">type=' + it.type + ' · ' + st + '</span></label>';
        }).join('');
    };

    window.openBossModal = function () {
        if (!bossCatalog.length) {
            refreshBossCatalog();
        }
        bossModalDraft = selectedBossWatch.map(function (w) {
            return {
                key: w.key, type: w.type, bossId: w.bossId, bossName: w.bossName,
                mapId: w.mapId, arriveMapId: w.arriveMapId || w.mapId, mapName: w.mapName, deliver: w.deliver, category: 'shouling',
                spawnX: w.spawnX || 0, spawnY: w.spawnY || 0
            };
        });
        $('modalBossFilter').value = '';
        renderModalBossTags();
        renderModalBossList();
        $('bossModal').classList.add('show');
    };

    window.closeBossModal = function () {
        $('bossModal').classList.remove('show');
    };

    window.confirmBossModal = function () {
        selectedBossWatch = bossModalDraft.map(function (w) {
            return {
                key: w.key,
                category: 'shouling',
                type: w.type,
                bossId: w.bossId,
                bossName: w.bossName,
                mapId: w.mapId,
                arriveMapId: w.arriveMapId || w.mapId,
                mapName: w.mapName,
                deliver: w.deliver || 0,
                spawnX: w.spawnX || 0,
                spawnY: w.spawnY || 0
            };
        });
        updateBossWatchUI();
        closeBossModal();
        log('已设置关注 Boss 地点 ' + selectedBossWatch.length + ' 个');
        autoSaveProfile();
    };

    window.syncBossAlive = function () {
        log('同步首领存活状态…');
        window.__logNextShoulingCatalog = true;
        sendCmd('requestShoulingBoss', {});
        setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 700);
        if (typeof syncExtraBossAlive === 'function') {
            setTimeout(function () {
                syncExtraBossAlive({ assume: true, requestArpg: true });
            }, 900);
        }
    };

    window.refreshBossCatalog = function () {
        log('刷新首领全量列表…');
        window.__logNextShoulingCatalog = true;
        sendCmd('requestShoulingBoss', {});
        setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 700);
    };
