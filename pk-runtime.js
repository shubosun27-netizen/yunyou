/**
 * PK Tab：默认模式、自动反击、砍仇人、指定行会、杀人抢怪。
 * 配置存在方案 p.pk；游戏内执行由 game.html applyPkConfig 完成。
 */
(function (global) {
    'use strict';

    var api = {};
    var lastSyncTs = 0;
    var lastSyncSig = '';

    var PK_MODES = [
        { value: 0, label: '和平' },
        { value: 1, label: '队伍' },
        { value: 2, label: '行会' },
        { value: 3, label: '善恶' },
        { value: 4, label: '全体' },
        { value: 7, label: '同盟' }
    ];

    function $(id) {
        return api.$ ? api.$(id) : document.getElementById(id);
    }

    function defaultPk() {
        return {
            defaultEnabled: true,
            defaultMode: 0,
            counter: {
                enabled: false,
                mode: 4,
                whenStopped: false,
                whitelist: []
            },
            enemy: {
                enabled: false,
                mode: 4,
                names: [],
                ids: []
            },
            guild: {
                enabled: false,
                mode: 2,
                names: [],
                ids: []
            },
            steal: {
                enabled: false,
                type: 'all',
                names: [],
                ids: [],
                guildNames: []
            }
        };
    }

    function parsePkList(text) {
        if (!text) return [];
        if (Array.isArray(text)) {
            return text.map(function (s) { return String(s).trim(); }).filter(Boolean);
        }
        return String(text).split(/[|；;，,\n\r]+/).map(function (s) {
            return s.trim();
        }).filter(Boolean);
    }

    function formatPkList(list) {
        if (!list || !list.length) return '';
        return list.join('|');
    }

    function mergeListField(t, key) {
        if (!Array.isArray(t[key])) t[key] = parsePkList(t[key]);
    }

    function mergeDefaults(pk) {
        var d = defaultPk();
        if (!pk || typeof pk !== 'object') return d;
        if (pk.defaultEnabled == null) pk.defaultEnabled = d.defaultEnabled;
        if (pk.defaultMode == null) pk.defaultMode = d.defaultMode;
        pk.defaultMode = parseInt(pk.defaultMode, 10);
        if (isNaN(pk.defaultMode)) pk.defaultMode = 0;

        pk.counter = pk.counter || {};
        if (pk.counter.enabled == null) pk.counter.enabled = d.counter.enabled;
        if (pk.counter.mode == null) pk.counter.mode = d.counter.mode;
        if (pk.counter.whenStopped == null) pk.counter.whenStopped = d.counter.whenStopped;
        mergeListField(pk.counter, 'whitelist');

        pk.enemy = pk.enemy || {};
        if (pk.enemy.enabled == null) pk.enemy.enabled = d.enemy.enabled;
        if (pk.enemy.mode == null) pk.enemy.mode = d.enemy.mode;
        mergeListField(pk.enemy, 'names');
        mergeListField(pk.enemy, 'ids');

        pk.guild = pk.guild || {};
        if (pk.guild.enabled == null) pk.guild.enabled = d.guild.enabled;
        if (pk.guild.mode == null) pk.guild.mode = d.guild.mode;
        mergeListField(pk.guild, 'names');
        mergeListField(pk.guild, 'ids');

        pk.steal = pk.steal || {};
        if (pk.steal.enabled == null) pk.steal.enabled = d.steal.enabled;
        if (!pk.steal.type) pk.steal.type = d.steal.type;
        mergeListField(pk.steal, 'names');
        mergeListField(pk.steal, 'ids');
        mergeListField(pk.steal, 'guildNames');
        return pk;
    }

    function ensurePk(p) {
        if (!p) return p;
        if (!p.pk) p.pk = defaultPk();
        else mergeDefaults(p.pk);
        return p;
    }

    function setSel(id, val) {
        var el = $(id);
        if (!el) return;
        el.value = String(val);
        if (el.value !== String(val) && el.options && el.options.length) {
            el.selectedIndex = 0;
        }
    }

    function fillEditor(p) {
        var pk = mergeDefaults((p && p.pk) || defaultPk());
        var en = $('pkDefaultEn');
        if (!en) return;
        en.checked = pk.defaultEnabled !== false;
        setSel('pkDefaultMode', pk.defaultMode);

        $('pkCounterEn').checked = !!pk.counter.enabled;
        setSel('pkCounterMode', pk.counter.mode);
        $('pkCounterWhenStopped').checked = !!pk.counter.whenStopped;
        $('pkCounterWl').value = formatPkList(pk.counter.whitelist);

        $('pkEnemyEn').checked = !!pk.enemy.enabled;
        setSel('pkEnemyMode', pk.enemy.mode);
        $('pkEnemyNames').value = formatPkList(pk.enemy.names);
        $('pkEnemyIds').value = formatPkList(pk.enemy.ids);

        $('pkGuildEn').checked = !!pk.guild.enabled;
        setSel('pkGuildMode', pk.guild.mode);
        $('pkGuildNames').value = formatPkList(pk.guild.names);
        $('pkGuildIds').value = formatPkList(pk.guild.ids);

        $('pkStealEn').checked = !!pk.steal.enabled;
        setSel('pkStealType', pk.steal.type || 'all');
        $('pkStealNames').value = formatPkList(pk.steal.names);
        $('pkStealIds').value = formatPkList(pk.steal.ids);
        $('pkStealGuilds').value = formatPkList(pk.steal.guildNames);
        updateSumMeta();
    }

    function readFromEditor(p) {
        if (!p || !$('pkDefaultEn')) return p;
        p.pk = mergeDefaults({
            defaultEnabled: $('pkDefaultEn').checked,
            defaultMode: parseInt($('pkDefaultMode').value, 10) || 0,
            counter: {
                enabled: $('pkCounterEn').checked,
                mode: parseInt($('pkCounterMode').value, 10) || 4,
                whenStopped: $('pkCounterWhenStopped').checked,
                whitelist: parsePkList($('pkCounterWl').value)
            },
            enemy: {
                enabled: $('pkEnemyEn').checked,
                mode: parseInt($('pkEnemyMode').value, 10) || 4,
                names: parsePkList($('pkEnemyNames').value),
                ids: parsePkList($('pkEnemyIds').value)
            },
            guild: {
                enabled: $('pkGuildEn').checked,
                mode: parseInt($('pkGuildMode').value, 10) || 2,
                names: parsePkList($('pkGuildNames').value),
                ids: parsePkList($('pkGuildIds').value)
            },
            steal: {
                enabled: $('pkStealEn').checked,
                type: $('pkStealType').value || 'all',
                names: parsePkList($('pkStealNames').value),
                ids: parsePkList($('pkStealIds').value),
                guildNames: parsePkList($('pkStealGuilds').value)
            }
        });
        updateSumMeta();
        return p;
    }

    function updateSumMeta() {
        var el = $('pkSumMeta');
        if (!el) return;
        var parts = [];
        if ($('pkDefaultEn') && $('pkDefaultEn').checked) {
            var sel = $('pkDefaultMode');
            var lab = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '和平';
            parts.push(lab);
        }
        if ($('pkCounterEn') && $('pkCounterEn').checked) parts.push('反击');
        if ($('pkEnemyEn') && $('pkEnemyEn').checked) parts.push('仇人');
        if ($('pkGuildEn') && $('pkGuildEn').checked) parts.push('行会');
        if ($('pkStealEn') && $('pkStealEn').checked) parts.push('抢怪');
        el.textContent = parts.length ? parts.join('/') : '未启用';
    }

    function buildPayload(p, schedulerActive) {
        ensurePk(p);
        var pk = p.pk;
        return {
            schedulerActive: !!schedulerActive,
            defaultEnabled: pk.defaultEnabled !== false,
            defaultMode: pk.defaultMode,
            counter: {
                enabled: !!pk.counter.enabled,
                mode: pk.counter.mode,
                whenStopped: !!pk.counter.whenStopped,
                whitelist: (pk.counter.whitelist || []).slice()
            },
            enemy: {
                enabled: !!pk.enemy.enabled,
                mode: pk.enemy.mode,
                names: (pk.enemy.names || []).slice(),
                ids: (pk.enemy.ids || []).slice()
            },
            guild: {
                enabled: !!pk.guild.enabled,
                mode: pk.guild.mode,
                names: (pk.guild.names || []).slice(),
                ids: (pk.guild.ids || []).slice()
            },
            steal: {
                enabled: !!pk.steal.enabled,
                type: pk.steal.type || 'all',
                names: (pk.steal.names || []).slice(),
                ids: (pk.steal.ids || []).slice(),
                guildNames: (pk.steal.guildNames || []).slice()
            }
        };
    }

    function payloadSig(payload) {
        try { return JSON.stringify(payload); } catch (e) { return String(Date.now()); }
    }

    function syncToGame(p, force, schedulerActive) {
        if (!p) p = api.getActive ? api.getActive() : null;
        if (!p) return;
        ensurePk(p);
        var active = schedulerActive != null ? !!schedulerActive :
            (api.isSchedulerActive ? !!api.isSchedulerActive() : false);
        var payload = buildPayload(p, active);
        var sig = payloadSig(payload);
        var now = Date.now();
        if (!force && sig === lastSyncSig && now - lastSyncTs < 800) return;
        lastSyncTs = now;
        lastSyncSig = sig;
        if (api.sendCmd) api.sendCmd('applyPkConfig', payload);
    }

    function onRuntime(d, p) {
        if (!p) return false;
        syncToGame(p, false);
        return false;
    }

    function resetRuntime() {
        lastSyncTs = 0;
        lastSyncSig = '';
    }

    global.PkModule = {
        init: function (deps) { api = deps || {}; },
        PK_MODES: PK_MODES,
        defaultPk: defaultPk,
        mergeDefaults: mergeDefaults,
        parsePkList: parsePkList,
        ensurePk: ensurePk,
        fillEditor: fillEditor,
        readFromEditor: readFromEditor,
        updateSumMeta: updateSumMeta,
        syncToGame: syncToGame,
        onRuntime: onRuntime,
        resetRuntime: resetRuntime
    };
})(window);
