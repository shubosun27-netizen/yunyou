    /* --- 地下皇陵 / 恶魔广场 --- */
    var bossExtraCatalog = { groups: [] };
    var selectedHuanglingKeys = [];
    var selectedEmoKeys = [];
    var extraBossModalGroupId = '';
    var extraBossModalDraft = [];

    function loadBossExtraCatalog() {
        return fetch('boss-extra-catalog.json?t=' + Date.now())
            .then(function (r) { return r.json(); })
            .then(function (j) {
                bossExtraCatalog = j || { groups: [] };
                updateExtraBossSummaries();
                return bossExtraCatalog;
            })
            .catch(function (e) {
                log('加载 boss-extra-catalog 失败: ' + (e && e.message ? e.message : e));
                bossExtraCatalog = { groups: [] };
            });
    }

    function findExtraBossGroup(groupId) {
        var groups = (bossExtraCatalog && bossExtraCatalog.groups) || [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].id === groupId) return groups[i];
        }
        return null;
    }

    function findExtraBossItem(key) {
        var groups = (bossExtraCatalog && bossExtraCatalog.groups) || [];
        for (var i = 0; i < groups.length; i++) {
            var items = groups[i].items || [];
            for (var j = 0; j < items.length; j++) {
                if (items[j].key === key) {
                    return Object.assign({
                        groupId: groups[i].id,
                        category: groups[i].id,
                        eliteType: groups[i].eliteType
                    }, items[j]);
                }
            }
        }
        return null;
    }

    function getSelectedExtraKeys(groupId) {
        return groupId === 'huangling' ? selectedHuanglingKeys : selectedEmoKeys;
    }

    function setSelectedExtraKeys(groupId, keys) {
        if (groupId === 'huangling') selectedHuanglingKeys = keys.slice();
        else selectedEmoKeys = keys.slice();
    }

    function isExtraBossGroupEnabled(groupId) {
        var el = $(groupId === 'huangling' ? 'bossHuanglingEn' : 'bossEmoEn');
        return !!(el && el.checked);
    }

    function updateExtraBossSummaries() {
        function summarize(groupId, keys, summaryId) {
            var el = $(summaryId);
            if (!el) return;
            if (!keys.length) {
                el.textContent = '未勾选具体 Boss';
                return;
            }
            var names = [];
            keys.forEach(function (k) {
                var it = findExtraBossItem(k);
                if (it) names.push(it.bossName || it.label);
            });
            el.textContent = '已选 ' + keys.length + ' 个' +
                (names.length ? ('：' + names.slice(0, 2).join('、') + (names.length > 2 ? '…' : '')) : '');
        }
        summarize('huangling', selectedHuanglingKeys, 'bossHuanglingSummary');
        summarize('emo', selectedEmoKeys, 'bossEmoSummary');
    }

    function extraItemToWatch(it) {
        if (!it) return null;
        var eliteType = it.eliteType != null ? Number(it.eliteType) : 0;
        return {
            key: it.key,
            category: it.category || it.groupId || 'extra',
            // 皇陵=稀有首领 type1=1 → type=1；恶魔广场/圣域无首领 type，按地图记存活
            type: eliteType > 0 ? eliteType : null,
            bossId: it.bossId,
            bossName: it.bossName,
            mapId: it.mapId,
            mapName: it.mapName,
            deliver: it.deliver || 0,
            spawnX: it.spawnX || 0,
            spawnY: it.spawnY || 0,
            arpg: !!it.arpg
        };
    }

    /** 当前启用且已勾选的皇陵/恶魔广场关注项 */
    function getEnabledExtraWatches() {
        var out = [];
        [['huangling', selectedHuanglingKeys], ['emo', selectedEmoKeys]].forEach(function (pair) {
            var gid = pair[0];
            if (!isExtraBossGroupEnabled(gid)) return;
            (pair[1] || []).forEach(function (key) {
                var it = findExtraBossItem(key);
                if (!it) return;
                it = Object.assign({}, it, { groupId: gid, category: gid });
                var w = extraItemToWatch(it);
                if (w) out.push(w);
            });
        });
        return out;
    }

    function hasExtraBossInterest() {
        return getEnabledExtraWatches().length > 0;
    }

    function findExtraWatchByMap(mapId) {
        mapId = parseInt(mapId, 10);
        var list = getEnabledExtraWatches();
        for (var i = 0; i < list.length; i++) {
            if (parseInt(list[i].mapId, 10) === mapId) return list[i];
        }
        return null;
    }

    function findExtraWatchByKey(key) {
        var list = getEnabledExtraWatches();
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) return list[i];
        }
        return null;
    }

    function getExtraPollMapIds() {
        var ids = [];
        var seen = {};
        getEnabledExtraWatches().forEach(function (w) {
            var mid = parseInt(w.mapId, 10);
            if (!mid || seen[mid]) return;
            seen[mid] = 1;
            ids.push(mid);
        });
        return ids;
    }

    /**
     * 皇陵/恶魔广场地图变为存活时入队。
     * 皇陵同图多 Boss：入队所有已勾选且同 mapId 的项。
     */
    function enqueueExtraBossByMap(mapId, reason) {
        mapId = parseInt(mapId, 10);
        if (!mapId) return;
        var list = getEnabledExtraWatches().filter(function (w) {
            return parseInt(w.mapId, 10) === mapId;
        });
        list.forEach(function (w) {
            enqueueHunt(w, reason || '扩展Boss刷新');
        });
    }

    window.openExtraBossModal = function (groupId) {
        var g = findExtraBossGroup(groupId);
        if (!g) {
            log('扩展 Boss 目录未加载，请刷新页面');
            loadBossExtraCatalog().then(function () {
                if (findExtraBossGroup(groupId)) openExtraBossModal(groupId);
            });
            return;
        }
        extraBossModalGroupId = groupId;
        extraBossModalDraft = getSelectedExtraKeys(groupId).slice();
        var title = $('extraBossModalTitle');
        if (title) title.textContent = g.name + (g.sub ? (' · ' + g.sub) : '');
        var filter = $('extraBossFilter');
        if (filter) filter.value = '';
        renderExtraBossModalList();
        $('extraBossModal').classList.add('show');
    };

    window.closeExtraBossModal = function () {
        $('extraBossModal').classList.remove('show');
        extraBossModalGroupId = '';
        extraBossModalDraft = [];
    };

    window.toggleExtraBossSelectAll = function (on) {
        var g = findExtraBossGroup(extraBossModalGroupId);
        if (!g) return;
        var q = (($('extraBossFilter') && $('extraBossFilter').value) || '').trim().toLowerCase();
        var words = q ? q.split(/\s+/).filter(Boolean) : [];
        var items = (g.items || []).filter(function (it) {
            if (!words.length) return true;
            var hay = String(it.label || it.bossName || '').toLowerCase();
            return words.every(function (w) { return hay.indexOf(w) >= 0; });
        });
        if (on) {
            items.forEach(function (it) {
                if (extraBossModalDraft.indexOf(it.key) < 0) extraBossModalDraft.push(it.key);
            });
        } else {
            var drop = {};
            items.forEach(function (it) { drop[it.key] = 1; });
            extraBossModalDraft = extraBossModalDraft.filter(function (k) { return !drop[k]; });
        }
        renderExtraBossModalList();
    };

    window.toggleExtraBossDraft = function (key, on) {
        var idx = extraBossModalDraft.indexOf(key);
        if (on && idx < 0) extraBossModalDraft.push(key);
        if (!on && idx >= 0) extraBossModalDraft.splice(idx, 1);
        renderExtraBossModalList();
    };

    window.renderExtraBossModalList = function () {
        var g = findExtraBossGroup(extraBossModalGroupId);
        var listEl = $('extraBossModalList');
        if (!g || !listEl) return;
        var q = (($('extraBossFilter') && $('extraBossFilter').value) || '').trim().toLowerCase();
        var words = q ? q.split(/\s+/).filter(Boolean) : [];
        var items = (g.items || []).filter(function (it) {
            if (!words.length) return true;
            var hay = String(it.label || it.bossName || '').toLowerCase();
            return words.every(function (w) { return hay.indexOf(w) >= 0; });
        });
        var allOn = items.length > 0 && items.every(function (it) {
            return extraBossModalDraft.indexOf(it.key) >= 0;
        });
        var selAll = $('extraBossSelectAll');
        if (selAll) selAll.checked = allOn;
        if (!items.length) {
            listEl.innerHTML = '<div class="hint" style="padding:6px;">无匹配</div>';
            return;
        }
        listEl.innerHTML = items.map(function (it) {
            var checked = extraBossModalDraft.indexOf(it.key) >= 0 ? ' checked' : '';
            return '<label class="ms-opt"><input type="checkbox"' + checked +
                ' onchange="toggleExtraBossDraft(\'' + it.key + '\', this.checked)">' +
                '<span>' + (it.label || it.bossName) + '</span></label>';
        }).join('');
    };

    window.confirmExtraBossModal = function () {
        if (!extraBossModalGroupId) return;
        var gid = extraBossModalGroupId;
        setSelectedExtraKeys(gid, extraBossModalDraft);
        updateExtraBossSummaries();
        closeExtraBossModal();
        autoSaveProfile();
        var n = getSelectedExtraKeys(gid).length;
        log((gid === 'huangling' ? '地下皇陵' : '恶魔广场') +
            '：已选择 ' + n + ' 个 Boss');
    };
