/**
 * Platform main logic (built from platform/parts 鈥?edit parts, then run build.ps1)
 */
(function () {

    /* --- 01-state-auth.js --- */
    var STORAGE_KEY = 'afk_profiles_v1';
    var ACTIVE_KEY = 'afk_active_profile_id';
    // 同源相对路径；公网由 nginx 将 /api 反代到鉴权服务
    var AUTH_API = '';
    var AUTH_SESSION_KEY = '106u_auth_session';
    var gameWindow = null;
    var authState = { sessionId: '', username: '', servers: [], jsGameVars: null };

    function setAuthStatus(msg, cls) {
        var el = $('authStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'status-bar' + (cls ? (' ' + cls) : '');
    }

    function saveAuthSession() {
        try {
            sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
                sessionId: authState.sessionId,
                username: authState.username,
                servers: authState.servers
            }));
        } catch (e) {}
    }

    function clearGameFrame() {
        var f = $('gameFrame');
        if (f) f.src = 'about:blank';
        gameWindow = null;
        try { sessionStorage.removeItem('js_gameVars'); } catch (e) {}
    }

    function loadGameWithVars(vars) {
        try {
            sessionStorage.setItem('js_gameVars', JSON.stringify(vars || {}));
        } catch (e) {
            setAuthStatus('无法写入 sessionStorage: ' + e, 'error');
            return;
        }
        var f = $('gameFrame');
        f.src = 'about:blank';
        setTimeout(function () {
            f.src = 'game.html?t=' + Date.now();
            gameWindow = f.contentWindow;
            setStatus('游戏加载中…');
            setAuthStatus('已注入 js_gameVars 并加载 game.html', 'running');
            log('进入游戏: user=' + (vars.username || '') + ' serverid=' + (vars.serverid || vars.sNum || ''));
            setTimeout(function () {
                try {
                    gameWindow = f.contentWindow;
                    gameWindow.postMessage({ type: 'handshake', from: 'parent', payload: {} }, '*');
                } catch (e) {}
            }, 1200);
        }, 50);
    }

    function renderServerList(servers) {
        var wrap = $('serverPickWrap');
        var sel = $('authServerList');
        sel.innerHTML = '';
        (servers || []).forEach(function (s, i) {
            var opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = s.name + '  (server_id=' + s.server_id + ')';
            sel.appendChild(opt);
        });
        wrap.style.display = servers && servers.length ? 'block' : 'none';
        if (!servers || !servers.length) {
            setAuthStatus('登录成功，但没有「我最近玩过的游戏」，请先在官网进过一次区', 'error');
        }
    }

    function renderVarsPreview(vars) {
        var box = $('authVarsPreview');
        if (!vars) { box.style.display = 'none'; return; }
        box.style.display = 'block';
        box.innerHTML =
            '<div><b>username</b>' + (vars.username || '-') + '</div>' +
            '<div><b>serverid</b>' + (vars.serverid || '-') + ' / sNum ' + (vars.sNum || '-') + '</div>' +
            '<div><b>platform</b>' + (vars.platform || '-') + '</div>' +
            '<div><b>token</b>' + String(vars.token || '').slice(0, 48) + (String(vars.token || '').length > 48 ? '…' : '') + '</div>';
    }

    function onConfigSynced(res) {
        UserConfigStore.refreshEditorAfterSync();
        if (res && res.ok) {
            var src = res.source === 'migrated' ? '（已上传本地配置）'
                : (res.source === 'remote' ? '（已拉取云端）'
                    : (res.source === 'default' ? '（已创建默认）' : ''));
            log('配置同步完成' + src + ': ' + (authState.username || '') + ' · ' + profiles.length + ' 个方案');
        } else if (res && res.error) {
            log('配置同步未完成: ' + res.error + '（仍使用本地缓存）');
        }
    }

    window.authLogin = function () {
        var user = ($('authUser').value || '').trim();
        var pass = $('authPass').value || '';
        if (!user || !pass) {
            setAuthStatus('请输入账号和密码', 'error');
            return;
        }
        $('btnAuthLogin').disabled = true;
        setAuthStatus('正在登录 106u…', 'running');
        clearGameFrame();
        renderVarsPreview(null);
        fetch(AUTH_API + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
            $('btnAuthLogin').disabled = false;
            if (!res.j || !res.j.ok) {
                setAuthStatus((res.j && res.j.error) || '登录失败', 'error');
                log('登录失败: ' + JSON.stringify(res.j));
                return;
            }
            authState.sessionId = res.j.session_id;
            authState.username = res.j.username || user;
            authState.servers = res.j.servers || [];
            authState.jsGameVars = null;
            if ($('authUser')) $('authUser').value = authState.username;
            saveAuthSession();
            $('btnAuthLogout').disabled = false;
            renderServerList(authState.servers);
            setAuthStatus('登录成功，共 ' + authState.servers.length + ' 个最近区服，请选择后进入', 'running');
            log('登录成功: ' + authState.username + '，最近区服 ' + authState.servers.length + ' 个');
            UserConfigStore.syncAfterLogin(authState.sessionId, authState.username)
                .then(onConfigSynced);
        }).catch(function (e) {
            $('btnAuthLogin').disabled = false;
            setAuthStatus('无法连接登录服务 /api（请检查 nginx 反代或鉴权服务）', 'error');
            log('登录请求失败: ' + e);
        });
    };

    window.authEnterGame = function () {
        if (!authState.sessionId) {
            setAuthStatus('请先登录', 'error');
            return;
        }
        var idx = parseInt($('authServerList').value, 10);
        var picked = authState.servers[idx];
        if (!picked) {
            setAuthStatus('请选择区服', 'error');
            return;
        }
        $('btnEnterGame').disabled = true;
        setAuthStatus('正在进入「' + picked.name + '」并获取 js_gameVars…', 'running');
        fetch(AUTH_API + '/api/enter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: authState.sessionId,
                server_id: picked.server_id,
                game_id: picked.game_id || '376'
            })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
            $('btnEnterGame').disabled = false;
            if (!res.j || !res.j.ok) {
                var err = (res.j && res.j.error) || '进服失败';
                setAuthStatus(err, 'error');
                log('进服失败: ' + JSON.stringify(res.j));
                if (res.j && res.j.debug) {
                    log('debug: ' + JSON.stringify(res.j.debug).slice(0, 500));
                }
                if (res.j && res.j.debug_file) {
                    log('已保存调试页: ' + res.j.debug_file);
                }
                if (res.j && res.j.login_php_url) {
                    log('login.php: ' + res.j.login_php_url);
                }
                return;
            }
            authState.jsGameVars = res.j.js_gameVars;
            renderVarsPreview(authState.jsGameVars);
            loadGameWithVars(authState.jsGameVars);
        }).catch(function (e) {
            $('btnEnterGame').disabled = false;
            setAuthStatus('进服请求失败: ' + e, 'error');
            log('进服请求失败: ' + e);
        });
    };

    window.authLogout = function () {
        authState = { sessionId: '', username: '', servers: [], jsGameVars: null };
        UserConfigStore.clearAuth();
        try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch (e) {}
        clearGameFrame();
        renderVarsPreview(null);
        $('serverPickWrap').style.display = 'none';
        $('authServerList').innerHTML = '';
        $('btnAuthLogout').disabled = true;
        setAuthStatus('已退出；配置仍保留在本地，重新登录后可云同步');
        setStatus('请先完成左侧登录选区');
        UserConfigStore.setSyncHint('local');
    };

    function restoreAuthUi() {
        try {
            var raw = sessionStorage.getItem(AUTH_SESSION_KEY);
            if (!raw) return;
            var saved = JSON.parse(raw);
            if (!saved || !saved.sessionId) return;
            authState.sessionId = saved.sessionId;
            authState.username = saved.username || '';
            authState.servers = saved.servers || [];
            if (authState.username && $('authUser')) $('authUser').value = authState.username;
            $('btnAuthLogout').disabled = false;
            renderServerList(authState.servers);
            setAuthStatus('已恢复登录会话，请选择区服进入（若失效请重新登录）');
            if (authState.username) {
                // 先用本地缓存渲染，避免异步拉取失败时界面空白
                UserConfigStore.setAuth(authState.sessionId, authState.username);
                UserConfigStore.bootstrap(authState.username);
                UserConfigStore.refreshEditorAfterSync();
                UserConfigStore.syncAfterLogin(authState.sessionId, authState.username)
                    .then(onConfigSynced);
            }
        } catch (e) {}
    }


    /* --- 02-state-core.js --- */
    var catalog = { maps: [], mapPlay: [], delivers: [] };
    var itemCatalog = { use: [], discard: [], equip: [], byId: {} };
    var selectedUseIds = [];
    var selectedDiscardIds = [];
    var selectedBuyIds = []; // 旧版兼容；新 UI 用 selectedBuyRules
    var buyCatalog = { items: [] };
    var selectedBuyRules = {}; // itemId -> rule
    var selectedRandomIds = [404, 8151];
    var KNOWN_ITEM_NAMES = { 404: '随机石', 8151: '随机卷', 1001: '金创药', 4645: '魔法药' };
    var profiles = [];
    var activeId = null;
    var bossCatalog = []; // getShoulingBossInfo 全量
    var selectedBossWatch = []; // [{key,type,bossName,mapId,mapName,deliver,bossId}]
    var bossAliveMap = {}; // type_mapId -> isAlive（同图多 Boss 互不覆盖）
    var selectedActWatch = []; // [{id,name,timeText,link,level}]
    var activityCatalog = []; // from getDailyActivities
    var actStateMap = {}; // id -> state
    var actEventHistory = [];

    var phase = 'IDLE';
    var schedulerTimer = null;
    var SCHEDULER_TICK_MS = 1000;
    var QUNYING_TICK_MS = 150;
    var schedulerTickMs = SCHEDULER_TICK_MS;
    var lastBagAssistTs = 0;
    var lastAutoSmeltTs = 0;
    var lastAutoUseTs = 0;
    var lastAutoRecycleTs = 0;
    var lastAutoDiscardTs = 0;
    var lastAutoStoreTs = 0;
    var lastAutoBuyTs = 0;
    var lastDailyChoresTs = 0;
    var pendingBossAfterRecycle = null;
    var lastRuntimeSnapshot = null;
    /** 服日标识（gd.serv.curZeroTime 字符串）；用于日切检测 */
    var lastServerDayKey = '';
    var lastHandledDayKey = '';
    /** 日切停挂机后延迟重启的定时器 */
    var dayResetRestartTimer = null;
    /** 日切后任务突发窗口：临时压过活动，直到任务队列跑完 */
    var dailyBurstActive = false;

    function cancelDayResetRestart() {
        if (dayResetRestartTimer) {
            clearTimeout(dayResetRestartTimer);
            dayResetRestartTimer = null;
        }
    }
    var lastUseTs = 0;
    var lastBossPollTs = 0;
    var huntQueue = []; // watch keys
    var huntTarget = null; // current watch item
    var huntStartedAt = 0;
    var huntArrivedAt = 0;
    var huntSawBoss = false;
    var huntPendingMonster = false;
    var huntPendingMonsterSince = 0;
    var huntRandomUsed = 0;
    var lastRandomTs = 0;
    var huntFailCooldown = {}; // key -> ts，随机未找到后短暂跳过
    var postHuntAliveCooldown = {}; // key -> ts，刚打完后短时不因「仍显示存活」重复入队
    var huntGoRetryCount = {}; // key -> 连续进图失败次数
    var lastRandomNoItem = false;
    var lastRandomBuyTs = 0;
    var randomBuyPendingUntil = 0;
    var pendingGoFarmUntil = 0;
    var pendingGoBossUntil = 0;
    var pendingGoRecycleUntil = 0;
    var recycleStartedAt = 0;
    var recycleActionAt = 0;
    var recycleRetried = false;
    var recycleLeftMapId = 0;
    var lastNpcRecycleTs = 0;
    var bossAliveKnown = {}; // type_mapId 是否已有过状态（边沿检测）

    function bossAliveKey(mapId, type) {
        mapId = parseInt(mapId, 10);
        if (!mapId) return '';
        if (type != null && type !== '' && !isNaN(Number(type))) {
            return String(Number(type)) + '_' + mapId;
        }
        return String(mapId);
    }

    function getBossAlive(mapId, type) {
        var k = bossAliveKey(mapId, type);
        if (k && bossAliveMap[k] !== undefined) return Number(bossAliveMap[k]);
        var legacy = bossAliveMap[mapId];
        if (legacy === undefined) legacy = bossAliveMap[String(mapId)];
        return legacy != null ? Number(legacy) : null;
    }

    function setBossAlive(mapId, type, isAlive) {
        var k = bossAliveKey(mapId, type);
        if (!k) return;
        bossAliveMap[k] = Number(isAlive) || 0;
        bossAliveKnown[k] = true;
    }

    function getWatchAliveFromCatalog(watch) {
        if (!watch) return null;
        var mapId = parseInt(watch.mapId, 10);
        var type = Number(watch.type);
        if (!bossCatalog || !bossCatalog.length || !type) return null;
        for (var i = 0; i < bossCatalog.length; i++) {
            var b = bossCatalog[i];
            if (Number(b.type) !== type) continue;
            var locs = b.locations || [];
            for (var j = 0; j < locs.length; j++) {
                if (parseInt(locs[j].mapId, 10) === mapId) {
                    if (locs[j].aliveKnown === false) return null;
                    return locs[j].isAlive != null ? Number(locs[j].isAlive) : null;
                }
            }
        }
        return null;
    }

    function getWatchAliveStatus(watch) {
        var fromCat = getWatchAliveFromCatalog(watch);
        if (fromCat != null) return fromCat;
        if (!watch) return null;
        return getBossAlive(watch.mapId, watch.type);
    }

    var lootUntil = 0;
    var lootStartedAt = 0;
    var lootEmptyTicks = 0;
    var lastPickupTs = 0;
    var lootPendingDrop = false;
    var huntBossMissingSince = 0;
    var huntBossLastSeenAt = 0;
    var huntBossLockedAt = 0;
    var huntBossLastHp = -1;
    var huntBossHpProgressAt = 0;
    var lastHuntHpCheckTs = 0;
    var HUNT_MIN_FIGHT_MS = 4000;
    /** 锁定后每隔多久确认一次 Boss 血量 */
    var HUNT_HP_CHECK_MS = 10000;
    var lastHuntStatusPollTs = 0;
    var lastHuntPrelockPollTs = 0;
    var HUNT_PRELOCK_POLL_MS = 5000;
    var huntSpawnX = 0;
    var huntSpawnY = 0;
    var huntMovingToSpawn = false;
    var huntAtSpawnSince = 0;
    var huntUseRandomFallback = false;
    var lastGotoSpawnTs = 0;
    var HUNT_SPAWN_ARRIVE_RADIUS = 10;
    var HUNT_SPAWN_SEARCH_MS = 12000;
    /** 寻路中重发 gotoStagePoint 间隔（未到达刷新点前不计入搜寻/随机计时） */
    var HUNT_PATH_RESEND_MS = 15000;
    /** 寻路过久仍未靠近刷新点时的安全兜底（秒，默认 2 分钟） */
    var HUNT_PATH_MAX_MS = 120000;
    var HUNT_SPAWN_BOSS_RADIUS = 25;

    /** 魔影来袭：四张活动图（deliver 来自 3config） */
    var MOYING_ACTIVITY_IDS = [4, 5, 6];
    var MOYING_BOSS_NAME = '魔影巨人';
    var MOYING_MAP_POOL = [
        { mapId: 5383, mapName: '石墓七层', deliverId: 315383 },
        { mapId: 5150, mapName: '炼狱回廊', deliverId: 315150 },
        { mapId: 5093, mapName: '死亡棺材', deliverId: 315093 },
        { mapId: 5022, mapName: '南部矿区', deliverId: 315022 }
    ];
    var MOYING_RANDOM_DEFAULT = 20;
    var MOYING_KILLS_PER_MAP = 2;
    var MOYING_BUY_COUNT = 50;
    var MOYING_MAP_TIMEOUT_SEC = 600;

    /** 群英汇：行会领地答题 */
    var QUNYING_ACTIVITY_IDS = [11];
    var QUNYING_MAP_ID = 116;
    var QUNYING_DELIVER_ID = 11012;
    var QUNYING_FOOD_ITEMS = [8453, 8452, 8451];

    var huntKind = null; // null | 'boss' | 'moying'
    var moyingMapQueue = [];
    var moyingClearedMaps = {};
    var pendingActivityKind = null; // null | 'moying' | 'qunying' | 'panluan' | activityId(number)
    var moyingBoughtForMap = false;
    var moyingKillsOnMap = 0;
    var moyingSessionActive = false;

    var qunyingSessionActive = false;
    var qunyingLastAnsweredCfgId = 0;
    var qunyingLastAnswerTs = 0;
    var qunyingFoodEquipped = false;
    var qunyingStartedAt = 0;
    var qunyingPendingGoUntil = 0;
    var qunyingTeleportAttempts = 0;
    var qunyingRoundCompleted = false; // 本轮答题已结束，活动时段内不再重试
    var moyingRoundCompleted = false; // 本轮四图清查已结束，活动时段内不再重试

    /** 皇陵叛乱：封魔谷清怪（入口 deliver 86，活动条件 700005|700006） */
    var PANLUAN_ACTIVITY_IDS = [15, 16, 17, 18];
    var PANLUAN_MAP_POOL = [
        { mapId: 5392, mapName: '封魔谷', deliverId: 86 },
        { mapId: 5393, mapName: '封魔殿', deliverId: 15393 },
        { mapId: 5394, mapName: '封魔皇宫', deliverId: 15394 }
    ];
    var PANLUAN_CLEAR_MS = 25000;
    var PANLUAN_MAX_STAY_MS = 65 * 60 * 1000;
    var PANLUAN_JOIN_WAIT_MS = 12000;
    var panluanSessionActive = false;
    var panluanRoundCompleted = false;
    var panluanStartedAt = 0;
    var panluanJoinedAt = 0;
    var panluanMapIndex = 0;
    var panluanPendingGoUntil = 0;
    var panluanClearSince = 0;
    var panluanJoinAttempts = 0;


    /* --- 03-log-ui.js --- */

    function $(id) { return document.getElementById(id); }

    var FEATURE_TAB_KEY = 'yy_cfg_tab';
    var FEATURE_TABS = { global: 1, farm: 1, bag: 1, boss: 1, act: 1, task: 1, pk: 1 };

    window.switchFeatureTab = function (name) {
        if (!FEATURE_TABS[name]) name = 'global';
        var tabs = document.querySelectorAll('#cfgShell .cfg-tab');
        var panes = document.querySelectorAll('#cfgShell .cfg-pane');
        for (var i = 0; i < tabs.length; i++) {
            var on = tabs[i].getAttribute('data-tab') === name;
            tabs[i].classList.toggle('active', on);
            tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        for (var j = 0; j < panes.length; j++) {
            panes[j].classList.toggle('active', panes[j].getAttribute('data-pane') === name);
        }
        try { localStorage.setItem(FEATURE_TAB_KEY, name); } catch (e) {}
        if (name === 'task' && window.TaskModule && TaskModule.renderTaskPanel) {
            TaskModule.renderTaskPanel();
        }
    };
    window.switchCfgTab = window.switchFeatureTab;

    function initFeatureTabs() {
        var saved = 'global';
        try { saved = localStorage.getItem(FEATURE_TAB_KEY) || 'global'; } catch (e) {}
        switchFeatureTab(saved);
    }

    /* —— 运行日志规范 ——
     * showPage   是否写入页面 #runLog（关则仍可 console，避免 DOM 膨胀假死）
     * compact    精简：截断长文、跳过 verbose、更短时间戳
     * maxLines   条数上限，超出删最旧
     * clearMin   定时清理间隔（分钟），0=只按条数；清理时保留末尾 keepOnClear 条
     */
    var LOG_CFG_KEY = 'afk_log_cfg_v1';
    var logCfg = {
        showPage: true,
        compact: true,
        maxLines: 200,
        clearMin: 10,
        keepOnClear: 30,
        maxMsgLen: 160,
        consoleMirror: false
    };
    var _logPending = [];
    var _logFlushScheduled = false;
    var _logClearTimer = null;
    var _logCount = 0;

    function loadLogCfg() {
        try {
            var raw = localStorage.getItem(LOG_CFG_KEY);
            if (!raw) return;
            var o = JSON.parse(raw);
            if (typeof o.showPage === 'boolean') logCfg.showPage = o.showPage;
            if (typeof o.compact === 'boolean') logCfg.compact = o.compact;
            if (o.maxLines > 0) logCfg.maxLines = Math.min(2000, Math.max(50, o.maxLines | 0));
            if (o.clearMin != null) logCfg.clearMin = Math.min(120, Math.max(0, o.clearMin | 0));
        } catch (e) {}
    }

    function saveLogCfg() {
        try {
            localStorage.setItem(LOG_CFG_KEY, JSON.stringify({
                showPage: logCfg.showPage,
                compact: logCfg.compact,
                maxLines: logCfg.maxLines,
                clearMin: logCfg.clearMin
            }));
        } catch (e) {}
    }

    function updateLogMeta() {
        var meta = $('runLogMeta');
        if (!meta) return;
        var tip = logCfg.showPage
            ? (_logCount + ' 条 · 上限 ' + logCfg.maxLines +
                (logCfg.clearMin > 0 ? ' · 每 ' + logCfg.clearMin + ' 分清理' : ' · 仅条数裁剪') +
                (logCfg.compact ? ' · 精简' : ''))
            : '页面显示已关闭（不写 DOM，防假死）';
        meta.textContent = tip;
    }

    function applyLogUi() {
        var el = $('runLog');
        if (!el) return;
        el.classList.toggle('hidden-log', !logCfg.showPage);
        el.classList.toggle('compact', !!logCfg.compact);
        var sp = $('logShowPage'), cp = $('logCompact'), ml = $('logMaxLines'), cm = $('logClearMin');
        if (sp) sp.checked = logCfg.showPage;
        if (cp) cp.checked = logCfg.compact;
        if (ml) ml.value = String(logCfg.maxLines);
        if (cm) cm.value = String(logCfg.clearMin);
        updateLogMeta();
    }

    function trimLogDom(el) {
        if (!el) return;
        var max = logCfg.maxLines | 0;
        if (max < 50) max = 50;
        while (el.childNodes.length > max) {
            el.removeChild(el.firstChild);
            if (_logCount > 0) _logCount--;
        }
    }

    function flushLogs() {
        _logFlushScheduled = false;
        var el = $('runLog');
        if (!el || !logCfg.showPage || !_logPending.length) {
            _logPending = [];
            return;
        }
        var frag = document.createDocumentFragment();
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        var i, item, row, d, ts, text, maxLen;
        for (i = 0; i < _logPending.length; i++) {
            item = _logPending[i];
            d = new Date(item.t);
            ts = logCfg.compact
                ? (pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()))
                : d.toLocaleTimeString();
            text = item.msg;
            maxLen = logCfg.compact ? logCfg.maxMsgLen : 400;
            if (text.length > maxLen) text = text.slice(0, maxLen) + '…';
            row = document.createElement('div');
            if (item.level === 'warn') row.className = 'll-warn';
            else if (item.level === 'error') row.className = 'll-error';
            else if (item.level === 'verbose') row.className = 'll-verbose';
            row.textContent = '[' + ts + '] ' + text;
            frag.appendChild(row);
            _logCount++;
        }
        _logPending = [];
        el.appendChild(frag);
        trimLogDom(el);
        el.scrollTop = el.scrollHeight;
        updateLogMeta();
    }

    /**
     * @param {string} msg
     * @param {string} [level] info|verbose|warn|error — compact 时跳过 verbose
     */
    function log(msg, level) {
        level = level || 'info';
        if (logCfg.compact && level === 'verbose') return;
        var text = String(msg == null ? '' : msg);
        if (logCfg.consoleMirror || !logCfg.showPage) {
            try {
                if (level === 'error') console.error(text);
                else if (level === 'warn') console.warn(text);
                else console.log(text);
            } catch (e) {}
        }
        if (!logCfg.showPage) return;
        _logPending.push({ t: Date.now(), msg: text, level: level });
        if (!_logFlushScheduled) {
            _logFlushScheduled = true;
            requestAnimationFrame(flushLogs);
        }
    }

    function scheduleLogClearTimer() {
        if (_logClearTimer) {
            clearInterval(_logClearTimer);
            _logClearTimer = null;
        }
        if (!(logCfg.clearMin > 0)) return;
        _logClearTimer = setInterval(function () {
            var el = $('runLog');
            if (!el || !el.childNodes.length) return;
            var keep = Math.min(logCfg.keepOnClear | 0, logCfg.maxLines | 0);
            while (el.childNodes.length > keep) {
                el.removeChild(el.firstChild);
                if (_logCount > 0) _logCount--;
            }
            _logCount = el.childNodes.length;
            updateLogMeta();
            if (keep > 0) {
                // 不刷屏：仅 console
                try { console.log('[log] 定时清理，保留末尾 ' + keep + ' 条'); } catch (e) {}
            }
        }, logCfg.clearMin * 60 * 1000);
    }

    function bindLogControls() {
        loadLogCfg();
        applyLogUi();
        scheduleLogClearTimer();
        var sp = $('logShowPage'), cp = $('logCompact'), ml = $('logMaxLines'), cm = $('logClearMin');
        function syncFromUi() {
            if (sp) logCfg.showPage = !!sp.checked;
            if (cp) logCfg.compact = !!cp.checked;
            if (ml) {
                var n = parseInt(ml.value, 10);
                if (!isNaN(n)) logCfg.maxLines = Math.min(2000, Math.max(50, n));
            }
            if (cm) {
                var m = parseInt(cm.value, 10);
                if (!isNaN(m)) logCfg.clearMin = Math.min(120, Math.max(0, m));
            }
            saveLogCfg();
            applyLogUi();
            trimLogDom($('runLog'));
            scheduleLogClearTimer();
        }
        if (sp) sp.addEventListener('change', syncFromUi);
        if (cp) cp.addEventListener('change', syncFromUi);
        if (ml) ml.addEventListener('change', syncFromUi);
        if (cm) cm.addEventListener('change', syncFromUi);
    }

    window.clearLog = function () {
        var el = $('runLog');
        if (el) el.textContent = '';
        _logPending = [];
        _logCount = 0;
        updateLogMeta();
    };

    function setStatus(text, cls) {
        var el = $('statusBar');
        el.textContent = text;
        el.className = 'status' + (cls ? ' ' + cls : '');
    }

    function hideLootTimerBar() {
        var el = $('lootTimerBar');
        if (el) el.classList.remove('show');
    }

    /** 顶栏拾取倒计时（LOOTING_BOSS 时显示，任意配置页均可见） */
    function updateLootTimerBar(opts) {
        opts = opts || {};
        var wrap = $('lootTimerBar');
        if (!wrap) return;
        if (!opts.show) {
            hideLootTimerBar();
            return;
        }
        var left = Math.max(0, opts.leftSec != null ? Math.ceil(opts.leftSec) : 0);
        var total = Math.max(1, opts.totalSec != null ? opts.totalSec : left || 1);
        var secEl = $('lootTimerSec');
        var fillEl = $('lootTimerFill');
        var metaEl = $('lootTimerMeta');
        if (secEl) secEl.textContent = String(left);
        if (fillEl) fillEl.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
        if (metaEl) {
            var parts = [];
            if (opts.bossName) parts.push(opts.bossName);
            if (opts.drops != null && opts.drops >= 0) parts.push('掉落' + opts.drops);
            metaEl.textContent = parts.join(' · ');
            metaEl.title = parts.join(' · ');
        }
        wrap.classList.add('show');
    }

    function setPhase(p) {
        phase = p;
        var el = $('phaseLabel');
        el.textContent = p;
        el.className = 'phase ' + p;
        if (p !== 'LOOTING_BOSS') hideLootTimerBar();
        var running = p === 'FARMING' || p === 'GOING_FARM' || p === 'GOING_BOSS' ||
            p === 'HUNTING_BOSS' || p === 'LOOTING_BOSS' ||
            p === 'GOING_QUNYING' || p === 'QUNYING' ||
            p === 'GOING_ACTIVITY_PREP' || p === 'GOING_ACTIVITY' || p === 'IN_ACTIVITY' ||
            p === 'GOING_TASK' || p === 'DOING_TASK' ||
            p === 'GOING_RECYCLE' || p === 'RECYCLING';
        $('btnStart').disabled = running || p === 'PAUSED';
        $('btnPause').disabled = !running;
        $('btnStop').disabled = p === 'IDLE';
        if (p === 'PAUSED') $('btnStart').disabled = false;
    }


    /* --- 04b-user-config.js --- */
    /* 挂机方案：localStorage 缓存 + auth 服务端同步（平台+账号） */
    var PLATFORM_ID = '106u';
    var LEGACY_STORAGE_KEY = STORAGE_KEY; // afk_profiles_v1
    var LEGACY_ACTIVE_KEY = ACTIVE_KEY;   // afk_active_profile_id
    var LAST_ACCOUNT_KEY = 'afk_last_account_v2';
    var REMOTE_SAVE_DEBOUNCE_MS = 800;

    var UserConfigStore = {
        account: '',
        sessionId: '',
        remoteEnabled: false,
        syncing: false,
        lastSyncError: '',
        _remoteTimer: null,
        _migratedFlagKey: function (account) {
            return 'afk_migrated_v2__' + PLATFORM_ID + '__' + account;
        },
        cacheKey: function (account) {
            return 'afk_user_cfg_v2__' + PLATFORM_ID + '__' + (account || '');
        },
        isSessionError: function (msg) {
            msg = msg || '';
            return msg.indexOf('会话') >= 0 || msg.indexOf('session') >= 0 || msg.indexOf('过期') >= 0;
        },
        setAuth: function (sessionId, account) {
            this.sessionId = sessionId || '';
            this.account = (account || '').trim();
            this.remoteEnabled = !!(this.sessionId && this.account);
            if (this.account) {
                try { localStorage.setItem(LAST_ACCOUNT_KEY, this.account); } catch (e) {}
            }
        },
        clearAuth: function () {
            this.sessionId = '';
            this.account = '';
            this.remoteEnabled = false;
            clearTimeout(this._remoteTimer);
            this._remoteTimer = null;
        },
        loadFromCache: function (account) {
            var key = account ? this.cacheKey(account) : null;
            var raw = null;
            try {
                if (key) raw = localStorage.getItem(key);
                if (!raw) {
                    var last = localStorage.getItem(LAST_ACCOUNT_KEY);
                    if (last) raw = localStorage.getItem(this.cacheKey(last));
                }
            } catch (e) {}
            if (raw) {
                try {
                    var parsed = JSON.parse(raw);
                    if (parsed && Array.isArray(parsed.profiles)) return parsed;
                } catch (e2) {}
            }
            return this.loadLegacy();
        },
        loadLegacy: function () {
            try {
                var list = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]');
                if (!Array.isArray(list) || !list.length) return null;
                var aid = localStorage.getItem(LEGACY_ACTIVE_KEY) || (list[0] && list[0].id) || '';
                return {
                    schemaVersion: 1,
                    platform: PLATFORM_ID,
                    account: '',
                    activeProfileId: aid,
                    profiles: list,
                    updatedAt: 0,
                    fromLegacy: true
                };
            } catch (e) {
                return null;
            }
        },
        writeCache: function (blob) {
            if (!blob || !this.account) return;
            try {
                localStorage.setItem(this.cacheKey(this.account), JSON.stringify(blob));
                localStorage.setItem(LAST_ACCOUNT_KEY, this.account);
                // 兼容旧 key：同机未登录时也能看到最近方案
                localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(blob.profiles || []));
                localStorage.setItem(LEGACY_ACTIVE_KEY, blob.activeProfileId || '');
            } catch (e) {}
        },
        buildBlob: function (profileList, activeProfileId) {
            return {
                schemaVersion: 1,
                platform: PLATFORM_ID,
                account: this.account || '',
                activeProfileId: activeProfileId || '',
                profiles: profileList || [],
                updatedAt: Math.floor(Date.now() / 1000)
            };
        },
        pickBestConfig: function (remote, local) {
            var hasRemote = remote && Array.isArray(remote.profiles) && remote.profiles.length;
            var hasLocal = local && Array.isArray(local.profiles) && local.profiles.length;
            if (!hasRemote) return hasLocal ? local : null;
            if (!hasLocal) return remote;
            var rt = Number(remote.updatedAt) || 0;
            var lt = Number(local.updatedAt) || 0;
            return lt >= rt ? local : remote;
        },
        applyBlobToMemory: function (blob) {
            if (!blob || !Array.isArray(blob.profiles)) return false;
            profiles = blob.profiles;
            profiles.forEach(ensureBag);
            if (!profiles.length) {
                var d = defaultProfile();
                d.name = '盟重挂机示例';
                profiles = [d];
            }
            activeId = blob.activeProfileId || profiles[0].id;
            if (!profiles.find(function (p) { return p.id === activeId; })) {
                activeId = profiles[0].id;
            }
            return true;
        },
        bootstrap: function (account) {
            var blob = this.loadFromCache(account || this.account);
            if (blob && this.applyBlobToMemory(blob)) return;
            var d = defaultProfile();
            d.name = '盟重挂机示例';
            profiles = [d];
            activeId = d.id;
        },
        persistLocal: function () {
            var blob = this.buildBlob(profiles, activeId);
            if (this.account) {
                this.writeCache(blob);
            } else {
                try {
                    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(profiles));
                    localStorage.setItem(LEGACY_ACTIVE_KEY, activeId || '');
                } catch (e) {}
            }
            return blob;
        },
        fetchRemoteConfig: function (opts) {
            var self = this;
            opts = opts || {};
            if (!self.account) {
                return Promise.resolve({ ok: false, error: '未登录' });
            }
            var base = AUTH_API + '/api/user-config?platform=' + encodeURIComponent(PLATFORM_ID) +
                '&account=' + encodeURIComponent(self.account);
            var url = base;
            if (opts.sessionId) {
                url = base + '&session_id=' + encodeURIComponent(opts.sessionId);
            }
            return fetch(url).then(function (r) {
                return r.json().then(function (j) { return { httpOk: r.ok, status: r.status, j: j }; });
            }).then(function (res) {
                if (!res.j || !res.j.ok) {
                    return {
                        ok: false,
                        error: (res.j && res.j.error) || '拉取失败',
                        status: res.status,
                        sessionExpired: res.status === 401 || self.isSessionError(res.j && res.j.error)
                    };
                }
                return {
                    ok: true,
                    config: res.j.config || null,
                    sessionValid: res.j.session_valid !== false
                };
            });
        },
        pullRemote: function () {
            var self = this;
            if (!self.account) {
                return Promise.resolve({ ok: false, error: '未登录' });
            }
            // 优先带 session；会话过期时自动降级为 account 只读拉取
            return self.fetchRemoteConfig({ sessionId: self.sessionId }).then(function (res) {
                if (res.ok) return res;
                if (res.sessionExpired || self.isSessionError(res.error)) {
                    return self.fetchRemoteConfig({}).then(function (fallback) {
                        if (fallback.ok) {
                            fallback.viaAccountFallback = true;
                            fallback.sessionExpired = true;
                            return fallback;
                        }
                        return res;
                    });
                }
                return res;
            });
        },
        pushRemote: function (blob) {
            var self = this;
            if (!self.remoteEnabled) {
                return Promise.resolve({ ok: false, error: '未登录', sessionExpired: true });
            }
            var body = {
                session_id: self.sessionId,
                platform: PLATFORM_ID,
                config: blob || self.buildBlob(profiles, activeId)
            };
            body.config.account = self.account;
            body.config.platform = PLATFORM_ID;
            return fetch(AUTH_API + '/api/user-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(function (r) {
                return r.json().then(function (j) { return { httpOk: r.ok, status: r.status, j: j }; });
            }).then(function (res) {
                if (!res.j || !res.j.ok) {
                    var err = (res.j && res.j.error) || '上传失败';
                    return {
                        ok: false,
                        error: err,
                        sessionExpired: res.status === 401 || self.isSessionError(err)
                    };
                }
                if (res.j.config) self.writeCache(res.j.config);
                return { ok: true, config: res.j.config };
            });
        },
        scheduleRemoteSave: function () {
            var self = this;
            if (!self.remoteEnabled) {
                self.setSyncHint('local');
                return;
            }
            clearTimeout(self._remoteTimer);
            self._remoteTimer = setTimeout(function () {
                self._remoteTimer = null;
                var blob = self.persistLocal();
                self.pushRemote(blob).then(function (res) {
                    if (res.ok) {
                        self.lastSyncError = '';
                        self.setSyncHint('cloud');
                    } else {
                        self.lastSyncError = res.error || '同步失败';
                        if (res.sessionExpired) {
                            self.remoteEnabled = false;
                            self.setSyncHint('local');
                            if (typeof log === 'function') {
                                log('会话已过期，配置已保留在本地，请重新登录后云同步');
                            }
                        } else {
                            self.setSyncHint('error');
                            if (typeof log === 'function') log('配置云同步失败: ' + self.lastSyncError);
                        }
                    }
                }).catch(function (e) {
                    self.lastSyncError = String(e);
                    self.setSyncHint('error');
                    if (typeof log === 'function') log('配置云同步异常: ' + e);
                });
            }, REMOTE_SAVE_DEBOUNCE_MS);
        },
        setSyncHint: function (mode) {
            var tip = $('pfAutoSaveHint');
            if (!tip) return;
            if (mode === 'cloud') {
                tip.textContent = '已云同步';
                tip.style.color = '#16a34a';
            } else if (mode === 'local') {
                tip.textContent = '仅本地已保存（登录后可云同步）';
                tip.style.color = '#ca8a04';
            } else if (mode === 'error') {
                tip.textContent = '仅本地已保存 · 云同步失败';
                tip.style.color = '#dc2626';
            } else if (mode === 'syncing') {
                tip.textContent = '正在同步配置…';
                tip.style.color = '#2563eb';
            } else {
                tip.textContent = '更改后自动保存';
                tip.style.color = '';
            }
        },
        ensureUniqueNames: function (list) {
            var seen = {};
            (list || []).forEach(function (p) {
                if (!p) return;
                var base = (p.name || '未命名').trim() || '未命名';
                var name = base;
                var n = 2;
                while (seen[name]) {
                    name = base + ' (' + n + ')';
                    n++;
                }
                seen[name] = 1;
                p.name = name;
            });
        },
        isNameTaken: function (name, excludeId) {
            name = (name || '').trim();
            if (!name) return false;
            return profiles.some(function (p) {
                return p.id !== excludeId && (p.name || '').trim() === name;
            });
        },
        syncAfterLogin: function (sessionId, account) {
            var self = this;
            self.setAuth(sessionId, account);
            if (!self.account) {
                return Promise.resolve({ ok: false, error: '缺少账号' });
            }
            self.syncing = true;
            self.setSyncHint('syncing');
            var localCached = self.loadFromCache(self.account) || self.loadLegacy();
            return self.pullRemote().then(function (res) {
                if (!res.ok) {
                    self.syncing = false;
                    self.lastSyncError = res.error || '';
                    if (localCached && self.applyBlobToMemory(localCached)) {
                        self.setSyncHint('local');
                        return { ok: true, source: 'cache', error: res.error };
                    }
                    self.bootstrap(self.account);
                    self.setSyncHint('local');
                    return { ok: false, error: res.error, source: 'cache' };
                }

                var remote = res.config;
                var best = self.pickBestConfig(remote, localCached);
                if (best && best.profiles && best.profiles.length) {
                    self.applyBlobToMemory(best);
                    self.writeCache(best);
                    var needUpload = self.remoteEnabled && (
                        !remote || !remote.profiles || !remote.profiles.length ||
                        (best === localCached && Number(best.updatedAt || 0) > Number((remote && remote.updatedAt) || 0))
                    );
                    if (needUpload) {
                        return self.pushRemote(best).then(function (up) {
                            self.syncing = false;
                            if (up.ok) {
                                self.setSyncHint('cloud');
                                return { ok: true, source: up.ok ? 'merged_upload' : 'merged' };
                            }
                            if (up.sessionExpired) self.remoteEnabled = false;
                            self.setSyncHint('local');
                            return { ok: true, source: 'cache', error: up.error };
                        });
                    }
                    self.syncing = false;
                    self.setSyncHint(res.viaAccountFallback ? 'local' : 'cloud');
                    if (typeof log === 'function') {
                        log('已加载配置: ' + self.account + ' · ' + profiles.length + ' 个方案' +
                            (res.viaAccountFallback ? '（会话过期，仅读取）' : ''));
                    }
                    return { ok: true, source: res.viaAccountFallback ? 'remote_readonly' : 'remote' };
                }

                // 云端与本地都没有：才创建默认方案
                if (localCached && localCached.profiles && localCached.profiles.length) {
                    self.applyBlobToMemory(localCached);
                    self.ensureUniqueNames(profiles);
                    var blob = self.buildBlob(profiles, activeId);
                    if (!self.remoteEnabled) {
                        self.syncing = false;
                        self.setSyncHint('local');
                        return { ok: true, source: 'cache' };
                    }
                    return self.pushRemote(blob).then(function (up) {
                        self.syncing = false;
                        if (up.ok) {
                            try { localStorage.setItem(self._migratedFlagKey(self.account), '1'); } catch (e) {}
                            self.setSyncHint('cloud');
                            return { ok: true, source: 'migrated' };
                        }
                        if (up.sessionExpired) self.remoteEnabled = false;
                        self.setSyncHint('local');
                        return { ok: true, source: 'cache', error: up.error };
                    });
                }

                var d = defaultProfile();
                d.name = '盟重挂机示例';
                profiles = [d];
                activeId = d.id;
                var fresh = self.buildBlob(profiles, activeId);
                if (!self.remoteEnabled) {
                    self.syncing = false;
                    self.setSyncHint('local');
                    return { ok: true, source: 'default_local' };
                }
                return self.pushRemote(fresh).then(function (up) {
                    self.syncing = false;
                    self.setSyncHint(up.ok ? 'cloud' : 'local');
                    return { ok: true, source: up.ok ? 'default' : 'default_local', error: up.error };
                });
            }).catch(function (e) {
                self.syncing = false;
                self.lastSyncError = String(e);
                if (localCached && self.applyBlobToMemory(localCached)) {
                    self.setSyncHint('local');
                    return { ok: true, source: 'cache', error: String(e) };
                }
                self.bootstrap(self.account);
                self.setSyncHint('local');
                return { ok: false, error: String(e), source: 'cache' };
            });
        },
        refreshEditorAfterSync: function () {
            if (typeof fillEditor === 'function') fillEditor(getActive());
            if (typeof renderProfileList === 'function') renderProfileList();
            if (typeof syncSchemeNameLabel === 'function') syncSchemeNameLabel();
        }
    };


    /* --- 04-catalog-modals.js --- */
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
            : itemModalKind === 'buy' ? (itemCatalog.use || []).concat(itemCatalog.discard || [])
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
        else itemModalKind = 'use';
        itemModalDraft = (itemModalKind === 'use' ? selectedUseIds
            : itemModalKind === 'discard' ? selectedDiscardIds
            : selectedRandomIds).slice();
        $('itemModalTitle').textContent = itemModalKind === 'use' ? '选择自动使用道具'
            : itemModalKind === 'discard' ? '选择自动丢弃名单'
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
            ($('bagXuemaiEn') && $('bagXuemaiEn').checked)) parts.push('福利');
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
        var extraMaps = typeof getExtraPollMapIds === 'function' ? getExtraPollMapIds() : [];
        if (extraMaps.length) {
            setTimeout(function () {
                sendCmd('getExtraMapAlive', { mapIds: extraMaps });
                sendCmd('getBossInfo');
            }, 900);
        }
    };

    window.refreshBossCatalog = function () {
        log('刷新首领全量列表…');
        window.__logNextShoulingCatalog = true;
        sendCmd('requestShoulingBoss', {});
        setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 700);
    };


    /* --- 05-profile.js --- */

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
            tip.textContent = '已自动保存（同步中…）';
            tip.style.color = '#16a34a';
        } else {
            tip.textContent = '仅本地已保存';
            tip.style.color = '#ca8a04';
        }
        if (now - lastAutoSaveTipAt < 800) return;
        lastAutoSaveTipAt = now;
        clearTimeout(markAutoSaved._t);
        markAutoSaved._t = setTimeout(function () {
            if (UserConfigStore.remoteEnabled && !UserConfigStore.lastSyncError) {
                tip.textContent = '更改后自动保存 · 云同步';
                tip.style.color = '';
            } else if (!UserConfigStore.remoteEnabled) {
                tip.textContent = '更改后自动保存（登录后可云同步）';
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
            return {
                key: w.key || bossWatchKey(w.type, w.mapId),
                category: w.category || 'shouling',
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


    /* --- 06-bridge-runtime.js --- */
    function allCatalogMaps() {
        var list = [];
        var seen = {};
        var deliverByMap = {};
        (catalog.delivers || []).forEach(function (d) {
            if (!d || !d.toMapId) return;
            if (!deliverByMap[d.toMapId]) deliverByMap[d.toMapId] = d;
            else if (deliverByMap[d.toMapId].cost && !d.cost) deliverByMap[d.toMapId] = d;
        });
        (catalog.mapPlay || []).forEach(function (m) {
            seen[m.id] = 1;
            list.push({
                id: m.id,
                name: m.name,
                label: '[BOSS] ' + m.name + ' (' + m.id + ')',
                deliver: m.deliver || (deliverByMap[m.id] && deliverByMap[m.id].id) || 0,
                kind: 'mapPlay'
            });
        });
        (catalog.maps || []).forEach(function (m) {
            if (seen[m.id]) return;
            var d = deliverByMap[m.id];
            list.push({
                id: m.id,
                name: m.name,
                label: m.name + ' (' + m.id + ')',
                deliver: d ? d.id : 0,
                kind: 'map'
            });
        });
        return list;
    }

    function sendCmd(action, payload) {
        if (!gameWindow) {
            var f = $('gameFrame');
            gameWindow = f.contentWindow;
        }
        if (!gameWindow) { log('游戏窗口未就绪'); return; }
        gameWindow.postMessage({
            type: 'gameCommand',
            action: action,
            payload: payload || {},
            ts: Date.now()
        }, '*');
    }
    window.sendCmd = sendCmd;

    window.refreshCatalog = function () {
        sendCmd('getMapCatalog');
        fetch('afk-catalog.json').then(function (r) { return r.json(); }).then(function (data) {
            if ((!catalog.maps || !catalog.maps.length) && data.maps) {
                catalog = data;
                renderMapSelect();
                updateMapPickedLabel();
                log('已加载本地 afk-catalog.json');
            }
        }).catch(function () {});
    };

    function renderRuntime(d) {
        if (!d) { $('runtimeView').textContent = '--'; return; }
        var p = d.player || {};
        var m = d.map || {};
        var nm = d.nearestMonster;
        var html = '';
        html += '<div><b>连接</b>' + (d.connected ? '已连接' : '未连接') + '</div>';
        html += '<div><b>角色</b>' + (p.name || '-') + ' Lv.' + (p.level || '-') + '</div>';
        html += '<div><b>坐标</b>' + (m.name || m.mapId || '-') + ' @ ' + (p.x || 0) + ',' + (p.y || 0) + '</div>';
        html += '<div><b>生命</b>' + (p.hp || 0) + '/' + (p.hpMax || 0) + (p.isDead ? ' [死亡]' : '') + '</div>';
        html += '<div><b>自动战斗</b>' + d.autoFightType + '（1开/3关）</div>';
        html += '<div><b>自动拾取</b>' + (d.autoPick ? '开' : '关') +
            (d.farmPickupForce ? ' ·强制' : '') +
            (d.dropCount != null ? (' ·掉落' + d.dropCount) : '') +
            (d.emptySlots != null ? (' ·空格' + d.emptySlots) : '') + '</div>';
        html += '<div><b>视野怪</b>存活 ' + d.aliveMonsterCount + '/' + d.monsterCount + '</div>';
        if (nm) html += '<div><b>最近怪</b>' + nm.name + ' dist=' + nm.distance + '</div>';
        if (huntTarget) {
            html += '<div><b>猎杀目标</b>' + (huntTarget.bossName || '') + ' @ ' +
                (huntTarget.mapName || huntTarget.mapId) + '</div>';
            var phaseTxt = huntSawBoss ? ' ·已锁定' :
                (huntMovingToSpawn ? ' ·寻路扫描' :
                    (huntAtSpawnSince ? ' ·刷新点搜寻' :
                        (huntUseRandomFallback ? (' ·随机' + huntRandomUsed) : ' ·准备寻点')));
            html += '<div><b>猎杀队列</b>' + huntQueue.length + phaseTxt;
            if (huntSpawnX && huntSpawnY) {
                html += ' ·点(' + huntSpawnX + ',' + huntSpawnY + ')';
            }
            html += '</div>';
        }
        if (d.qunying && (phase === 'GOING_QUNYING' || phase === 'QUNYING' || d.qunying.open)) {
            var qy = d.qunying;
            html += '<div><b>群英汇</b> 第' + (qy.currentNum || 0) + '题';
            if (qy.questionText) html += ' ·' + String(qy.questionText).slice(0, 28);
            if (qy.suggestedAnswer) html += ' →' + qy.suggestedAnswer;
            html += (qy.mapOk ? ' ·领地' : ' ·未在领地') + '</div>';
        }
        if (phase === 'LOOTING_BOSS' && lootUntil > 0) {
            var lootLeft = Math.max(0, Math.ceil((lootUntil - Date.now()) / 1000));
            var lootTotal = Math.max(1, Math.ceil((lootUntil - (lootStartedAt || Date.now())) / 1000));
            var lootDrops = d.dropCount != null ? Number(d.dropCount) : -1;
            html += '<div class="runtime-loot"><b>拾取倒计时</b> 剩余 <b>' + lootLeft + '</b>s / ' + lootTotal + 's';
            if (huntTarget && huntTarget.bossName) html += ' · ' + huntTarget.bossName;
            if (lootDrops >= 0) html += ' · 视野掉落 ' + lootDrops;
            if (d.autoPet) html += ' · 灵宠吸物';
            else if (d.autoPick) html += ' · 角色拾取';
            html += '</div>';
        }
        if (d.server && d.server.dayKey) {
            var srv = d.server;
            var toMid = srv.secToMidnight != null ? Number(srv.secToMidnight) : null;
            var midTxt = '';
            if (toMid != null && !isNaN(toMid)) {
                if (toMid < 0) midTxt = '已过0点';
                else {
                    var hh = Math.floor(toMid / 3600);
                    var mm = Math.floor((toMid % 3600) / 60);
                    midTxt = '距0点 ' + hh + 'h' + mm + 'm';
                }
            }
            html += '<div><b>服时</b> day=' + (srv.openDay != null ? srv.openDay : '?') +
                (midTxt ? (' ·' + midTxt) : '') +
                (dailyBurstActive ? ' ·日切任务中' : '') + '</div>';
        }
        $('runtimeView').innerHTML = html;
    }


    /* --- 07-scheduler-guards.js --- */
    function isSchedulerActive() {
        return phase === 'FARMING' || phase === 'GOING_FARM' || phase === 'GOING_BOSS' ||
            phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS' ||
            phase === 'GOING_QUNYING' || phase === 'QUNYING' ||
            phase === 'GOING_PANLUAN' || phase === 'PANLUAN' ||
            phase === 'GOING_ACTIVITY_PREP' || phase === 'GOING_ACTIVITY' || phase === 'IN_ACTIVITY' ||
            phase === 'GOING_TASK' || phase === 'DOING_TASK' ||
            phase === 'GOING_RECYCLE' || phase === 'RECYCLING';
    }

    function isInActivityPhases() {
        return huntKind === 'moying' || phase === 'GOING_QUNYING' || phase === 'QUNYING' ||
            phase === 'GOING_PANLUAN' || phase === 'PANLUAN' ||
            (window.ActivityModule && ActivityModule.isActivePhase(phase));
    }

    function shouldDeferToActivity() {
        return shouldRunMoyingHuntNow() || shouldRunQunyingNow() || shouldRunPanluanNow() ||
            (window.ActivityModule && ActivityModule.anyGenericShouldRun());
    }

    function shouldDeferLowerPriorityForTasks(p) {
        // 任务优先于 Boss/挂机；活动更高，不受此函数阻挡
        return window.TaskModule && TaskModule.shouldRunBeforeBoss(p);
    }

    function isInBossPhases() {
        return phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS';
    }

    /** 活动进行中 / 打 Boss 中途 / 回收中：暂不硬切，结束后立刻接活动 */
    function isActivityJoinBlocked() {
        if (phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS') return true;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return true;
        if (phase === 'GOING_QUNYING' || phase === 'QUNYING') return true;
        if (phase === 'GOING_PANLUAN' || phase === 'PANLUAN') return true;
        if (huntKind === 'moying' && (phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS' || phase === 'LOOTING_BOSS')) {
            return true;
        }
        if (window.ActivityModule && ActivityModule.isActivePhase(phase)) return true;
        return false;
    }

    function yieldTasksForActivity(reason) {
        if (phase !== 'GOING_TASK' && phase !== 'DOING_TASK') return;
        if (window.TaskModule && TaskModule.yieldForActivity) {
            TaskModule.yieldForActivity(reason || '活动优先');
        }
        log('活动优先：中断任务' + (reason ? ' ·' + reason : ''));
    }

    /** 仅取消「前往 Boss」；已开打/拾取留给 isActivityJoinBlocked */
    function cancelBossGoForActivity(reason) {
        if (phase !== 'GOING_BOSS' || huntKind === 'moying' || !huntTarget) return false;
        log('活动优先：取消前往 Boss' + (reason ? ' ·' + reason : '') +
            ' ·' + ((huntTarget.bossName || '') + '@' + (huntTarget.mapName || huntTarget.mapId)));
        huntTarget = null;
        huntKind = null;
        huntArrivedAt = 0;
        huntSawBoss = false;
        huntRandomUsed = 0;
        huntBossMissingSince = 0;
        huntBossLastSeenAt = 0;
        resetHuntSpawnState();
        sendCmd('setAutoFight', { type: 3 });
        return true;
    }

    /**
     * 立刻参加当前可跑活动（优先级最高）。
     * 可打断：任务 / 前往 Boss / 挂机；不可硬切：打怪中、拾取、回收、已在活动中。
     */
    function tryJoinOpenActivityNow(reason) {
        if (dailyBurstActive) return false;
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (isActivityJoinBlocked()) return false;

        if (pendingActivityKind) {
            if (tryStartPendingActivity()) return true;
        }

        if (shouldRunMoyingHuntNow() && huntKind !== 'moying') {
            yieldTasksForActivity(reason);
            cancelBossGoForActivity(reason);
            beginMoyingSession();
            return true;
        }
        if (shouldRunQunyingNow() && phase !== 'GOING_QUNYING' && phase !== 'QUNYING') {
            yieldTasksForActivity(reason);
            cancelBossGoForActivity(reason);
            beginQunyingSession();
            return true;
        }
        if (shouldRunPanluanNow() && phase !== 'GOING_PANLUAN' && phase !== 'PANLUAN') {
            yieldTasksForActivity(reason);
            cancelBossGoForActivity(reason);
            beginPanluanSession();
            return true;
        }
        if (window.ActivityModule && !ActivityModule.hasSession()) {
            var gid = ActivityModule.pickNextGeneric();
            if (gid) {
                yieldTasksForActivity(reason);
                cancelBossGoForActivity(reason);
                ActivityModule.beginGeneric(gid, reason || '时段内');
                return true;
            }
        }
        return false;
    }

    /**
     * 活动开启 / 上线检测：立刻参加；若正在打怪/拾取/回收则排队，结束后自动接上。
     * 不再因任务挡路。
     */
    function requestActivityJoin(kind, reason) {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        pendingActivityKind = kind;
        if (isActivityJoinBlocked()) {
            log((reason || '活动') + '：当前忙碌，完成后立刻前往');
            return false;
        }
        if (tryStartPendingActivity()) return true;
        // pending 被条件清掉时，再走通用检测
        return tryJoinOpenActivityNow(reason || '活动优先');
    }

    function isMoyingActivityName(name) {
        return !!name && String(name).indexOf('魔影来袭') >= 0;
    }

    function isMoyingActivityId(id) {
        return MOYING_ACTIVITY_IDS.indexOf(Number(id)) >= 0;
    }

    function isMoyingActivityEv(ev) {
        if (!ev) return false;
        return isMoyingActivityName(ev.name) || isMoyingActivityId(ev.id);
    }

    function isAnyMoyingActivityOpen() {
        for (var i = 0; i < MOYING_ACTIVITY_IDS.length; i++) {
            if (actStateMap[MOYING_ACTIVITY_IDS[i]] === 1) return true;
        }
        return false;
    }

    function isMoyingInWatchList() {
        return selectedActWatch.some(function (w) {
            return isMoyingActivityName(w.name) || isMoyingActivityId(w.id);
        });
    }

    function isQunyingActivityName(name) {
        return !!name && String(name).indexOf('群英汇') >= 0;
    }

    function isQunyingActivityId(id) {
        return QUNYING_ACTIVITY_IDS.indexOf(Number(id)) >= 0;
    }

    function isQunyingActivityEv(ev) {
        if (!ev) return false;
        return isQunyingActivityName(ev.name) || isQunyingActivityId(ev.id);
    }

    function isAnyQunyingActivityOpen() {
        for (var i = 0; i < QUNYING_ACTIVITY_IDS.length; i++) {
            if (actStateMap[QUNYING_ACTIVITY_IDS[i]] === 1) return true;
        }
        return false;
    }

    function isQunyingInWatchList() {
        return selectedActWatch.some(function (w) {
            return isQunyingActivityName(w.name) || isQunyingActivityId(w.id);
        });
    }
    function isPanluanActivityName(name) {
        return !!name && String(name).indexOf('皇陵叛乱') >= 0;
    }

    function isPanluanActivityId(id) {
        return PANLUAN_ACTIVITY_IDS.indexOf(Number(id)) >= 0;
    }

    function isPanluanActivityEv(ev) {
        if (!ev) return false;
        return isPanluanActivityName(ev.name) || isPanluanActivityId(ev.id);
    }

    function isAnyPanluanActivityOpen() {
        for (var i = 0; i < PANLUAN_ACTIVITY_IDS.length; i++) {
            if (actStateMap[PANLUAN_ACTIVITY_IDS[i]] === 1) return true;
        }
        return false;
    }

    function isPanluanInWatchList() {
        return selectedActWatch.some(function (w) {
            return isPanluanActivityName(w.name) || isPanluanActivityId(w.id);
        });
    }

    function shouldRunPanluanNow() {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (!isPanluanInWatchList()) return false;
        if (panluanRoundCompleted) return false;
        return isAnyPanluanActivityOpen();
    }

    function shouldRunQunyingNow(d) {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (!isQunyingInWatchList()) return false;
        if (qunyingRoundCompleted) return false;
        if (!isAnyQunyingActivityOpen()) return false;
        d = d || lastRuntimeSnapshot;
        if (d && d.qunying) {
            if (d.qunying.ended) return false;
            if (!d.qunying.open && !qunyingSessionActive) return false;
        }
        return true;
    }

    function shouldRunMoyingHuntNow() {
        if (!$('actAutoGo') || !$('actAutoGo').checked) return false;
        if (!isSchedulerActive()) return false;
        if (!isMoyingInWatchList()) return false;
        if (moyingRoundCompleted) return false;
        return isAnyMoyingActivityOpen();
    }

    function shuffleArray(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i];
            a[i] = a[j];
            a[j] = t;
        }
        return a;
    }

    function findMoyingMap(mapId) {
        for (var i = 0; i < MOYING_MAP_POOL.length; i++) {
            if (Number(MOYING_MAP_POOL[i].mapId) === Number(mapId)) return MOYING_MAP_POOL[i];
        }
        return null;
    }

    function resetMoyingSession() {
        moyingMapQueue = [];
        moyingClearedMaps = {};
        moyingBoughtForMap = false;
        moyingKillsOnMap = 0;
        moyingSessionActive = false;
        if (huntKind === 'moying') huntKind = null;
    }

    function setSchedulerTickInterval(ms) {
        schedulerTickMs = ms;
        if (!schedulerTimer) return;
        clearInterval(schedulerTimer);
        schedulerTimer = setInterval(tickScheduler, schedulerTickMs);
    }

    function enterQunyingFastMode() {
        setSchedulerTickInterval(QUNYING_TICK_MS);
        sendCmd('setQunyingTurbo', { enabled: true, reset: true });
    }

    function leaveQunyingFastMode() {
        sendCmd('setQunyingTurbo', { enabled: false });
        setSchedulerTickInterval(SCHEDULER_TICK_MS);
    }

    function onQunyingAnsweredEvent(payload) {
        payload = payload || {};
        var cfgId = Number(payload.cfgId) || 0;
        if (cfgId) qunyingLastAnsweredCfgId = cfgId;
        qunyingLastAnswerTs = Date.now();
        var react = payload.reactMs != null ? (' ·' + payload.reactMs + 'ms') : '';
        var src = payload.source === 'updateDaTiInfo' ? '协议' :
            (payload.source === 'poll50' ? '轮询' : (payload.source || ''));
        log('群英汇抢答：第' + (payload.currentNum || '?') + '题 → ' +
            (payload.answer || '') + react + (src ? (' ·' + src) : ''));
        setStatus('云游平台：群英汇抢答 ·第' + (payload.currentNum || '?') + '题' + react, 'running');
    }

    function resetQunyingSession() {
        qunyingSessionActive = false;
        qunyingLastAnsweredCfgId = 0;
        qunyingLastAnswerTs = 0;
        qunyingFoodEquipped = false;
        qunyingStartedAt = 0;
        qunyingPendingGoUntil = 0;
        qunyingTeleportAttempts = 0;
    }

    function markQunyingRoundDone() {
        qunyingRoundCompleted = true;
        qunyingSessionActive = false;
        if (pendingActivityKind === 'qunying') pendingActivityKind = null;
    }

    function markMoyingRoundDone() {
        moyingRoundCompleted = true;
        moyingSessionActive = false;
        if (pendingActivityKind === 'moying') pendingActivityKind = null;
    }

    function requestQunyingTeleport(reason) {
        qunyingTeleportAttempts++;
        var useFallback = qunyingTeleportAttempts >= 2;
        log('群英汇：请求进入行会领地' + (reason ? ' ·' + reason : '') +
            '（第' + qunyingTeleportAttempts + '次' + (useFallback ? '·含deliver兜底' : '·send72') + '）');
        sendCmd('goQunyingGuild', {
            reason: reason || '',
            attempt: qunyingTeleportAttempts,
            useDeliverFallback: useFallback
        });
    }

    function tryStartPendingActivity() {
        if (!pendingActivityKind) return false;
        // 活动优先于任务：不再因任务挡路；打怪/拾取/回收中仍由 isActivityJoinBlocked 延后
        if (isActivityJoinBlocked()) return false;
        var kind = pendingActivityKind;
        if (kind === 'moying' && shouldRunMoyingHuntNow()) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办魔影');
            cancelBossGoForActivity('待办魔影');
            beginMoyingSession();
            return true;
        }
        if (kind === 'qunying' && shouldRunQunyingNow()) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办群英汇');
            cancelBossGoForActivity('待办群英汇');
            beginQunyingSession();
            return true;
        }
        if (kind === 'panluan' && shouldRunPanluanNow()) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办皇陵叛乱');
            cancelBossGoForActivity('待办皇陵叛乱');
            beginPanluanSession();
            return true;
        }
        if (typeof kind === 'number' && window.ActivityModule && ActivityModule.shouldRunGeneric(kind)) {
            pendingActivityKind = null;
            yieldTasksForActivity('待办活动');
            cancelBossGoForActivity('待办活动');
            ActivityModule.beginGeneric(kind, '待办活动');
            return true;
        }
        if (!shouldRunMoyingHuntNow() && !shouldRunQunyingNow() && !shouldRunPanluanNow() &&
            !(window.ActivityModule && ActivityModule.anyGenericShouldRun())) {
            pendingActivityKind = null;


    /* --- 08-qunying-moying.js --- */
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
        panluanClearSince = 0;
        panluanJoinAttempts = 0;
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

    function requestPanluanEnter(reason) {
        var map = PANLUAN_MAP_POOL[panluanMapIndex] || PANLUAN_MAP_POOL[0];
        panluanPendingGoUntil = Date.now() + PANLUAN_JOIN_WAIT_MS;
        panluanJoinAttempts++;
        setPhase('GOING_PANLUAN');
        setStatus('云游平台：皇陵叛乱 → ' + map.mapName, 'running');
        log('皇陵叛乱：前往 ' + map.mapName + '（deliver ' + map.deliverId + '）' +
            (reason ? ' ·' + reason : '') + ' ·第' + panluanJoinAttempts + '次');
        sendCmd('setAutoFight', { type: 3 });
        sendCmd('goMap', {
            type: 'deliver',
            mapId: map.mapId,
            deliverId: map.deliverId
        });
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
        panluanClearSince = 0;
        panluanJoinAttempts = 0;
        log('皇陵叛乱：开始清怪' + (activityId ? ' ·活动' + activityId : '') +
            '（封魔谷→封魔殿→封魔皇宫）');
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

    function advancePanluanMap(reason) {
        if (panluanMapIndex >= PANLUAN_MAP_POOL.length - 1) {
            panluanClearSince = 0;
            log('皇陵叛乱：已在最深层，继续清怪至活动结束' + (reason ? ' ·' + reason : ''));
            return;
        }
        panluanMapIndex++;
        panluanClearSince = 0;
        panluanJoinAttempts = 0;
        panluanJoinedAt = 0;
        var map = PANLUAN_MAP_POOL[panluanMapIndex];
        log('皇陵叛乱：推进至 ' + map.mapName + (reason ? ' ·' + reason : ''));
        requestPanluanEnter('推进');
    }

    function onRuntimePanluan(d, p) {
        var now = Date.now();
        var cur = d && d.map ? Number(d.map.mapId) : 0;
        var alive = d && d.aliveMonsterCount != null ? Number(d.aliveMonsterCount) : -1;

        if (!isAnyPanluanActivityOpen() && now - panluanStartedAt > 90000) {
            finishPanluanSession('活动时段结束');
            return;
        }
        if (now - panluanStartedAt > PANLUAN_MAX_STAY_MS) {
            finishPanluanSession('停留超时');
            return;
        }

        if (phase === 'GOING_PANLUAN') {
            if (isPanluanMapId(cur)) {
                panluanJoinedAt = now;
                panluanClearSince = 0;
                setPhase('PANLUAN');
                setStatus('云游平台：皇陵叛乱清怪中 ·' +
                    ((PANLUAN_MAP_POOL[panluanMapIndex] || {}).mapName || cur), 'running');
                sendCmd('setAutoFight', { type: 1 });
                if (p && p.farm && p.farm.guajiType != null) {
                    sendCmd('setGuajiType', { type: p.farm.guajiType || 0 });
                }
                if (p && p.farm && p.farm.autoPick !== false) {
                    sendCmd('ensureFarmPickup', { enabled: true });
                }
                return;
            }
            if (now > panluanPendingGoUntil) {
                if (panluanJoinAttempts >= 4) {
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
            if (d && d.autoFightType !== 1) {
                sendCmd('setAutoFight', { type: 1 });
            }
            setStatus('云游平台：皇陵叛乱清怪中 ·' +
                ((PANLUAN_MAP_POOL[panluanMapIndex] || {}).mapName || cur) +
                (alive >= 0 ? (' / 怪' + alive) : ''), 'running');

            if (!isAnyPanluanActivityOpen()) {
                finishPanluanSession('活动结束');
                return;
            }

            if (alive === 0) {
                if (!panluanClearSince) panluanClearSince = now;
                if (now - panluanClearSince >= PANLUAN_CLEAR_MS) {
                    advancePanluanMap('当前图已清空');
                }
            } else {
                panluanClearSince = 0;
            }
        }
    }


    /* --- 09-boss-hunt.js --- */
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
        ensureHuntTargetBossMeta(huntTarget);
        var bid = huntTarget.bossId != null ? Number(huntTarget.bossId) : 0;
        if (!bid) bid = resolveBossIdByType(huntTarget.type);
        // 有 bossId 时只认 cfg，避免「魔龙战将」被「变异魔龙战将」子串误匹配
        if (bid) return Number(m.configId) === bid;
        var name = stripMonsterName(huntTarget.bossName || '');
        var mn = stripMonsterName(m.name || '');
        if (!name || !mn) return false;
        if (name === mn) return true;
        // 仅怪物名包含完整目标名（目标较短）；禁止 target.indexOf(monster) 误配小怪
        return mn.indexOf(name) >= 0;
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


    /* --- 10-farm-bag.js --- */
    function abandonHunt(reason) {
        finishHunt(reason || '放弃');
    }

    function getFarmTargetMapId(p) {
        if (window.FarmTacticsModule && FarmTacticsModule.getFarmTargetMapId) {
            return FarmTacticsModule.getFarmTargetMapId(p);
        }
        return p && p.farm ? p.farm.mapId : 0;
    }

    function farmTacticsCtx(extra) {
        var ctx = {
            phase: phase,
            log: log,
            sendCmd: sendCmd,
            setPhase: setPhase,
            pendingGoFarmUntil: function (ts) { pendingGoFarmUntil = ts; },
            mapNameById: mapNameById,
            huntSawBoss: huntSawBoss,
            abandonHunt: abandonHunt
        };
        if (extra) {
            Object.keys(extra).forEach(function (k) { ctx[k] = extra[k]; });
        }
        return ctx;
    }

    function runFarmTacticsRuntime(d, p, extra) {
        if (!window.FarmTacticsModule || !FarmTacticsModule.onRuntime) return false;
        return !!FarmTacticsModule.onRuntime(d, p, farmTacticsCtx(extra));
    }

    function pickNextAliveWatch(excludeKey) {
        // 仅用于诊断/兼容；调度不再用它直接 beginHunt
        for (var i = 0; i < selectedBossWatch.length; i++) {
            var w = selectedBossWatch[i];
            if (excludeKey && w.key === excludeKey) continue;
            if (huntFailCooldown[w.key] && Date.now() < huntFailCooldown[w.key]) continue;
            var alive = getWatchAliveStatus(w);
            if (Number(alive) > 0) return w;
        }
        return null;
    }

    function maybeUseRandomStone(p) {
        if (!huntTarget || huntSawBoss || !huntArrivedAt) return;
        if (phase !== 'HUNTING_BOSS' && phase !== 'GOING_BOSS') return;
        if (!huntUseRandomFallback) return;
        var max = getRandomSearchMax(p);
        if (huntRandomUsed >= max) {
            if (huntKind === 'moying') {
                finishMoyingHunt('随机' + max + '次未发现魔影巨人');
            } else {
                abandonHunt('随机' + max + '次未找到');
            }
            return;
        }
        var interval = (p.boss && p.boss.randomIntervalMs) || 1500;
        var now = Date.now();
        if (now - lastRandomTs < interval) return;
        if (now - huntArrivedAt < 800) return;
        // 购买回包未到：先别连点使用，避免空耗次数
        if (now < randomBuyPendingUntil) return;
        lastRandomTs = now;
        if (huntKind === 'moying') sendCmd('setAutoFight', { type: 3 });
        var ids = parseIdList((p.boss && p.boss.randomItemIds) || '404,8151');
        if (!ids.length) ids = [404, 8151];
        huntRandomUsed++;
        sendCmd('useItemsByRule', { itemIds: ids, maxPerTick: 1 });
        if (huntRandomUsed === 1 || huntRandomUsed % 10 === 0 || huntRandomUsed >= max) {
            log('随机寻怪 ' + huntRandomUsed + '/' + max);
        }
        setStatus('云游平台：随机寻怪 ' + huntRandomUsed + '/' + max + ' · ' +
            (huntTarget.bossName || ''), 'running');
    }

    /** 背包无随机石时，按配置用商城购买（绑定传奇币，与游戏 autoBuySuiji 同源） */
    function tryBuyRandomStone(p) {
        p = p || getActive();
        if (huntKind === 'moying') {
            return buyRandomStoneForMoying(p);
        }
        if (!p || !p.boss || !p.boss.randomBuyEnabled) return false;
        if (phase !== 'HUNTING_BOSS' && phase !== 'GOING_BOSS') return false;
        var now = Date.now();
        if (now < randomBuyPendingUntil) return true;
        if (now - lastRandomBuyTs < 2800) return true;
        lastRandomBuyTs = now;
        randomBuyPendingUntil = now + 4500;
        var count = p.boss.randomBuyCount != null ? Number(p.boss.randomBuyCount) : 50;
        if (isNaN(count) || count < 1) count = 50;
        if (count > 999) count = 999;
        log('背包无随机石，购买 x' + count + '（传奇币商城）');
        setStatus('云游平台：购买随机石 x' + count + '…', 'running');
        sendCmd('buyRandomStone', { count: count, itemId: 404 });
        return true;
    }

    function resumeFarmAfterHunt() {
        huntTarget = null;
        huntKind = null;
        var p = getActive();
        // 活动 > 任务 > Boss：Boss 结束后优先接活动
        if (tryJoinOpenActivityNow('Boss结束')) return;
        if (tryStartPendingActivity()) return;
        if (shouldDeferLowerPriorityForTasks(p)) {
            returnToFarmMap(p, 'Boss结束→任务');
            return;
        }
        var skipFarm = !!(p && p.boss && p.boss.skipFarmIfQueued !== false);
        if (skipFarm && huntQueue.length) {
            setPhase('FARMING');
            setStatus('云游平台：队列还有 ' + huntQueue.length + '，直接下一只 Boss', 'running');
            log('跳过回挂机，直接接下一个 Boss（队列' + huntQueue.length + '）');
            tryStartNextHunt();
            if (huntTarget) return;
        }
        returnToFarmMap(p, '返回挂机');
    }

    /** 回挂机地图（Boss 结束 / NPC 回收后共用） */
    function returnToFarmMap(p, reason) {
        p = p || getActive();
        if (!p || !p.farm || !p.farm.mapId) {
            setPhase('IDLE');
            setStatus('云游平台：无挂机地图');
            return;
        }
        setPhase('GOING_FARM');
        var farmMap = getFarmTargetMapId(p);
        setStatus('云游平台：返回挂机 ' + (mapNameById(farmMap) || farmMap) +
            (huntQueue.length ? '（队列还剩' + huntQueue.length + '）' : ''), 'running');
        log((reason || '返回挂机') + ' → ' + farmMap +
            (huntQueue.length ? '，队列待打 ' + huntQueue.length : ''));
        pendingGoFarmUntil = Date.now() + 5000;
        sendCmd('goMap', {
            type: 'auto',
            mapId: farmMap,
            deliverId: p.farm.deliverId || 0
        });
    }

    function bagAssistIntervalMs(p) {
        var interval = 3000;
        if (p && p.bag && p.bag.autoUse && p.bag.autoUse.intervalMs) {
            interval = Math.max(1000, p.bag.autoUse.intervalMs);
        }
        return interval;
    }

    function needBagSlotAction(p, d, cfgKey, defaultThr) {
        if (!p || !p.bag || !p.bag[cfgKey] || !p.bag[cfgKey].enabled) return false;
        var empty = d && d.emptySlots;
        if (empty == null || empty < 0) return false;
        var thr = p.bag[cfgKey].emptySlotsBelow != null ? Number(p.bag[cfgKey].emptySlotsBelow) : defaultThr;
        return empty <= thr;
    }

    /**
     * 无会员：FARMING 稳态或打 Boss 前触发传送回收。
     */
    function startNpcRecycle(p, reason, opts) {
        opts = opts || {};
        p = p || getActive();
        if (!opts.beforeBoss && phase !== 'FARMING') return false;
        if (!p || !p.bag || !p.bag.autoRecycle || !p.bag.autoRecycle.enabled) return false;
        var now = Date.now();
        if (!opts.beforeBoss && now - lastNpcRecycleTs < 45000) return false;
        if (opts.beforeBoss && opts.watch) pendingBossAfterRecycle = opts.watch;
        recycleLeftMapId = (p.farm && p.farm.mapId) || 0;
        recycleStartedAt = now;
        recycleActionAt = 0;
        recycleRetried = false;
        pendingGoRecycleUntil = now + 2500;
        lastNpcRecycleTs = now;
        setPhase('GOING_RECYCLE');
        setStatus('云游平台：传送回收炉…', 'running');
        log((opts.beforeBoss ? '打 Boss 前传送回收' : '无会员随身回收不可用，传送回收') +
            (reason ? ' ·' + reason : ''));
        sendCmd('setAutoFight', { type: 3 });
        sendCmd('teleportToRecycleNpc', {});
        return true;
    }

    function finishNpcRecycleAndContinue(p) {
        if (tryJoinOpenActivityNow('回收后')) return true;
        if (tryStartPendingActivity()) return true;
        if (shouldDeferLowerPriorityForTasks(p)) {
            log('回收完成，返回挂机执行任务');
            returnToFarmMap(p, '回收后→任务');
            return true;
        }
        if (pendingActivityKind && (shouldRunMoyingHuntNow() || shouldRunQunyingNow() || shouldRunPanluanNow() ||
            (window.ActivityModule && ActivityModule.anyGenericShouldRun()))) {
            var kind = pendingActivityKind;
            pendingActivityKind = null;
            log('回收完成，前往' + (kind === 'qunying' ? '群英汇' : (kind === 'moying' ? '魔影来袭' : (kind === 'panluan' ? '皇陵叛乱' : '活动'))));
            if (kind === 'qunying') beginQunyingSession();
            else if (kind === 'moying') beginMoyingSession();
            else if (kind === 'panluan') beginPanluanSession();
            else if (window.ActivityModule) ActivityModule.beginById(kind, '回收后');
            return true;
        }
        if (pendingBossAfterRecycle) {
            var w = pendingBossAfterRecycle;
            pendingBossAfterRecycle = null;
            log('回收完成，前往 Boss → ' + (w.bossName || w.mapId));
            beginHunt(w);
            return true;
        }
        log('回收完成，立即返回挂机');
        returnToFarmMap(p, '回收后回挂机');
        return true;
    }

    function onRuntimeNpcRecycle(d, p) {
        var now = Date.now();
        var cur = d.map && d.map.mapId;

        if (phase === 'GOING_RECYCLE') {
            var leftFarm = recycleLeftMapId && cur && Number(cur) !== Number(recycleLeftMapId);
            var waited = now - recycleStartedAt;
            if (now < pendingGoRecycleUntil && !leftFarm) {
                setStatus('云游平台：前往回收炉…', 'running');
                return;
            }
            // 已离挂机图，或同图 NPC 传送等了约 2.5s+ → 执行回收
            if (leftFarm || waited >= 2500) {
                setPhase('RECYCLING');
                recycleActionAt = now;
                setStatus('云游平台：回收中…', 'running');
                log('抵达回收点，执行回收' + (leftFarm ? '（已换图）' : '（同图/超时）'));
                sendCmd('openRecycleUi', {});
                sendCmd('runRecycleOnce', { forceNpc: true });
                return;
            }
            return;
        }

        if (phase === 'RECYCLING') {
            setStatus('云游平台：回收中…', 'running');
            // 首次后隔 800ms 再发一次，防止 UI/寻路未就绪
            if (!recycleRetried && recycleActionAt && now - recycleActionAt >= 800) {
                recycleRetried = true;
                sendCmd('runRecycleOnce', { forceNpc: true });
            }
            // 回收完成：稍等协议落地后立刻回挂机
            if (recycleActionAt && now - recycleActionAt >= 1800) {
                finishNpcRecycleAndContinue(p);
                return;
            }
            // 总超时兜底
            if (now - recycleStartedAt > 22000) {
                log('回收超时' + (pendingBossAfterRecycle ? '，仍尝试前往 Boss' : '，强制回挂机'));
                finishNpcRecycleAndContinue(p);
            }
        }
    }

    function maybePollBossStatus(p) {
        if (!p || !p.boss || !p.boss.enabled) return;
        var hasWatch = selectedBossWatch.length > 0 ||
            (typeof hasExtraBossInterest === 'function' && hasExtraBossInterest());
        if (!hasWatch) return;
        if (shouldDeferToActivity() || huntKind === 'moying' || pendingActivityKind ||
            (window.ActivityModule && ActivityModule.hasSession())) return;
        var now = Date.now();
        var interval = Math.max(5, p.boss.pollSec || 20) * 1000;
        if (now - lastBossPollTs < interval) return;
        lastBossPollTs = now;
        sendCmd('requestShoulingBoss', {});
        setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 500);
        // 恶魔广场按地图存活；圣域走 ARPG
        var extraMaps = typeof getExtraPollMapIds === 'function' ? getExtraPollMapIds() : [];
        if (extraMaps.length) {
            sendCmd('getExtraMapAlive', { mapIds: extraMaps });
            var needArpg = typeof getEnabledExtraWatches === 'function' &&
                getEnabledExtraWatches().some(function (w) { return w.arpg; });
            if (needArpg) setTimeout(function () { sendCmd('getBossInfo'); }, 600);
        }
    }

    function tickScheduler() {
        if (!isSchedulerActive()) return;
        sendCmd('getRuntimeState');
        // 进图后持续轮询视野怪：未锁定前搜寻 Boss，锁定后检测击杀
        if ((phase === 'HUNTING_BOSS' || phase === 'GOING_BOSS') && huntTarget && huntArrivedAt) {
            if (huntPendingMonster && huntPendingMonsterSince && Date.now() - huntPendingMonsterSince > 2500) {
                huntPendingMonster = false;
                huntPendingMonsterSince = 0;
            }
            if (!huntPendingMonster) {
                huntPendingMonster = true;
                huntPendingMonsterSince = Date.now();
                sendCmd('getMonsterList');
            }
        }
        // 拾取阶段：只轮询掉落用于提前结束，不再逐个 keyPickup
        if (phase === 'LOOTING_BOSS') {
            if (!lootPendingDrop) {
                lootPendingDrop = true;
                sendCmd('getDropList');
            }
        }
    }

    function maybeAutoSmelt(p, d) {
        if (!p || !p.bag) return;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return;
        if (!needBagSlotAction(p, d, 'autoSmelt', 10)) return;
        var now = Date.now();
        if (now - lastAutoSmeltTs < bagAssistIntervalMs(p)) return;
        lastAutoSmeltTs = now;
        sendCmd('applyAutoSmeltIfNeeded', { autoSmelt: p.bag.autoSmelt });
    }

    function maybeAutoUse(p) {
        if (!p || !p.bag) return;
        var use = p.bag.autoUse;
        if (!use || !use.enabled) return;
        var now = Date.now();
        if (now - lastAutoUseTs < bagAssistIntervalMs(p)) return;
        lastAutoUseTs = now;
        var payload = { autoUse: JSON.parse(JSON.stringify(use)) };
        if (!payload.autoUse.itemIds || !payload.autoUse.itemIds.length) {
            payload.autoUse.itemIds = selectedUseIds.length ? selectedUseIds.slice() : [1001, 4645];
        }
        sendCmd('applyAutoUseIfNeeded', payload);
    }

    function maybeAutoRecycle(p, d) {
        if (!p || !p.bag) return;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return;
        if (!needBagSlotAction(p, d, 'autoRecycle', 7)) return;
        // 无会员：挂机稳态才走随身检测；打 Boss 前由 tryStartNextHunt 专门传送回收
        if (d.hasPortableRecycle === false && phase !== 'FARMING') return;
        var now = Date.now();
        if (now - lastAutoRecycleTs < bagAssistIntervalMs(p)) return;
        lastAutoRecycleTs = now;
        sendCmd('applyAutoRecycleIfNeeded', { autoRecycle: p.bag.autoRecycle });
    }

    function maybeAutoDiscard(p) {
        if (!p || !p.bag) return;
        var disc = p.bag.autoDiscard;
        if (!disc || !disc.enabled || !disc.itemIds || !disc.itemIds.length) return;
        var now = Date.now();
        if (now - lastAutoDiscardTs < bagAssistIntervalMs(p)) return;
        lastAutoDiscardTs = now;
        sendCmd('applyAutoDiscardIfNeeded', { autoDiscard: disc });
    }

    function maybeAutoStore(p, d) {
        if (!p || !p.bag) return;
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') return;
        var now = Date.now();
        if (now - lastAutoStoreTs < bagAssistIntervalMs(p)) return;
        if (needBagSlotAction(p, d, 'autoStoreEquip', 7)) {
            lastAutoStoreTs = now;
            sendCmd('applyAutoStoreIfNeeded', { kind: 'equip', autoStore: p.bag.autoStoreEquip });
            return;
        }
        if (needBagSlotAction(p, d, 'autoStoreMaterial', 7)) {
            lastAutoStoreTs = now;
            sendCmd('applyAutoStoreIfNeeded', { kind: 'material', autoStore: p.bag.autoStoreMaterial });
        }
    }

    function maybeAutoBuy(p) {
        if (!p || !p.bag) return;
        var buy = p.bag.autoBuy;
        if (!buy || !buy.enabled) return;
        var items = normalizeAutoBuyRules(buy);
        if (!items.length) return;
        var now = Date.now();
        var buyIv = Math.max(bagAssistIntervalMs(p), 10000);
        if (now - lastAutoBuyTs < buyIv) return;
        lastAutoBuyTs = now;
        sendCmd('applyAutoBuyIfNeeded', { autoBuy: { enabled: true, items: items } });
    }

    function maybeDailyChores(p, force) {
        if (!p || !p.bag) return;
        var b = p.bag;
        var any = (b.autoSignIn && b.autoSignIn.enabled) ||
            (b.autoUnionDonate && b.autoUnionDonate.enabled) ||
            (b.autoOfflineReward && b.autoOfflineReward.enabled) ||
            (b.autoVipReward && b.autoVipReward.enabled) ||
            (b.autoMailBaodian && b.autoMailBaodian.enabled) ||
            (b.autoExchangeXuemai && b.autoExchangeXuemai.enabled);
        if (!any) return;
        var now = Date.now();
        if (!force && now - lastDailyChoresTs < 60000) return;
        lastDailyChoresTs = now;
        sendCmd('applyDailyChoresIfNeeded', {
            bag: {
                autoSignIn: b.autoSignIn,
                autoUnionDonate: b.autoUnionDonate,
                autoOfflineReward: b.autoOfflineReward,
                autoVipReward: b.autoVipReward,
                autoMailBaodian: b.autoMailBaodian,
                autoExchangeXuemai: b.autoExchangeXuemai
            },
            force: !!force
        });
    }

    /** 日切等场景：忽略 60s 节流立刻领福利 */
    function forceDailyChores(p) {
        p = p || getActive();
        lastDailyChoresTs = 0;
        maybeDailyChores(p, true);
    }


    /* --- 11-scheduler-loop.js --- */
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
            (phase === 'FARMING' || phase === 'GOING_FARM')) {
            if (window.TaskModule && TaskModule.onRuntimeFarmGate(d, p)) return;
        }

        // ---- 无会员传送回收 ----
        if (phase === 'GOING_RECYCLE' || phase === 'RECYCLING') {
            onRuntimeNpcRecycle(d, p);
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
                (cur != null ? '（当前图' + cur + '）' : ''));
            // 连续进不去：放弃，避免空转到猎杀超时
            if (goRetry >= 8) {
                abandonHunt('进图失败(当前' + (cur != null ? cur : '?') +
                    '≠' + targetMap + (arriveMap && arriveMap !== targetMap ? ('/' + arriveMap) : '') + ')');
                return;
            }
            sendCmd('goMap', {
                type: huntTarget.deliver ? 'deliver' : 'auto',
                mapId: targetMap,
                deliverId: huntTarget.deliver || 0
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


    /* --- 12-controls.js --- */

    function onRuntimeLoot(d, p) {
        var now = Date.now();
        var left = Math.max(0, Math.ceil((lootUntil - now) / 1000));
        var totalSec = Math.max(1, Math.ceil((lootUntil - (lootStartedAt || now)) / 1000));
        var drops = d.dropCount != null ? Number(d.dropCount) : -1;
        var petHint = d.autoPet ? ' ·灵宠吸物' : '';
        setStatus('云游平台：系统自动战斗 ·等待拾取' + left + 's' + petHint +
            (drops >= 0 ? (' ·掉落' + drops) : '') +
            (huntTarget ? (' ·' + (huntTarget.bossName || '')) : ''), 'running');
        updateLootTimerBar({
            show: true,
            leftSec: left,
            totalSec: totalSec,
            bossName: huntTarget ? huntTarget.bossName : '',
            drops: drops
        });

        // 仅保证自动战斗开着、挡住超级挂机选怪；不强制 AutoPick / 不改灵宠
        sendCmd('maintainLootMode');

        if (huntTarget) {
            var cur = d.map && d.map.mapId;
            if (cur != null && !isOnHuntTargetMap(cur, huntTarget)) {
                finishHunt('拾取中离开Boss图');
                return;
            }
        }

        // 掉落已空：宽限约 2s 后提前结束（不必撑满 lootSec）
        if (drops === 0 && now - lootStartedAt >= 2000) {
            lootEmptyTicks++;
            if (lootEmptyTicks >= 2) {
                finishHunt('拾取完成(无掉落)');
                return;
            }
        } else if (drops > 0) {
            lootEmptyTicks = 0;
        }

        if (now >= lootUntil) {
            finishHunt('拾取完成');
        }
    }

    function onMonsterListForHunt(list) {
        huntPendingMonster = false;
        huntPendingMonsterSince = 0;
        if (phase !== 'HUNTING_BOSS' && phase !== 'GOING_BOSS') return;
        if (!huntTarget) return;

        if (!huntSawBoss) {
            ensureHuntTargetBossMeta(huntTarget);
            var found = findBossFromMonsterList(list);
            var alives = [];
            if (!found) {
                (list || []).forEach(function (m) {
                    if (isMonsterAliveForHunt(m)) alives.push(m);
                });
            }
            // 魔影随机清查：只打魔影巨人，禁止把视野内单只小怪当 Boss
            if (!found && huntKind !== 'moying' && huntUseRandomFallback && alives.length === 1) {
                found = alives[0];
            }
            if (found) {
                var reason = huntMovingToSpawn ? '寻路途中视野发现' :
                    (huntAtSpawnSince ? '刷新点附近发现' :
                        (huntUseRandomFallback ? ('随机寻怪 ' + huntRandomUsed + ' 次') : '视野发现'));
                lockHuntBoss(found, reason);
            } else {
                logBossScanMiss(list, huntMovingToSpawn ? '寻路' : (huntAtSpawnSince ? '刷新点' : '全图'));
            }
            return;
        }

        // 已锁定：仅 isDead 或视野消失可判定击杀（勿用 hp<=0，游戏 fo.hp 常为 0）
        var deadMatch = null;
        var aliveMatch = null;
        (list || []).forEach(function (m) {
            if (!m || !matchHuntBossIdentity(m)) return;
            if (m.isDead) deadMatch = m;
            else aliveMatch = m;
        });
        if (deadMatch && canConfirmBossKill()) {
            onBossKilledSignal('Boss已死亡(视野)');
            return;
        }
        if (aliveMatch) {
            huntBossMissingSince = 0;
            huntBossLastSeenAt = Date.now();
            var ahp = Number(aliveMatch.hp);
            if (!isNaN(ahp) && ahp >= 0) {
                if (huntBossLastHp < 0 || ahp < huntBossLastHp) {
                    huntBossHpProgressAt = Date.now();
                }
                huntBossLastHp = ahp;
            }
            return;
        }
        if (!huntBossMissingSince) huntBossMissingSince = Date.now();
        if (canConfirmBossKill() && Date.now() - huntBossMissingSince >= 1500) {
            onBossKilledSignal('Boss从视野消失');
        }
    }

    window.startScheduler = function () {
        saveProfile();
        var p = getActive();
        if (!p.farm.mapId) { log('请先选择挂机地图'); return; }
        cancelDayResetRestart();
        huntQueue = [];
        huntTarget = null;
        huntKind = null;
        resetMoyingSession();
        resetQunyingSession();
        resetPanluanSession();
        qunyingRoundCompleted = false;
        panluanRoundCompleted = false;
        if (window.ActivityModule) ActivityModule.resetAll();
        if (window.FarmTacticsModule && FarmTacticsModule.resetRuntime) FarmTacticsModule.resetRuntime();
        pendingActivityKind = null;
        pendingBossAfterRecycle = null;
        lastRuntimeSnapshot = null;
        dailyBurstActive = false;
        bossAliveKnown = {};
        postHuntAliveCooldown = {};
        huntGoRetryCount = {};
        pendingGoFarmUntil = 0;
        pendingGoBossUntil = 0;
        pendingGoRecycleUntil = 0;
        recycleStartedAt = 0;
        recycleActionAt = 0;
        recycleRetried = false;
        recycleLeftMapId = 0;
        lastNpcRecycleTs = 0;
        lootUntil = 0;
        lootStartedAt = 0;
        lootEmptyTicks = 0;
        lootPendingDrop = false;
        moyingRoundCompleted = false;
        // 活动 > 任务 > Boss > 挂机：先去挂机图并拉活动状态；有进行中的活动则立刻参加
        setPhase('GOING_FARM');
        if (window.TaskModule) {
            TaskModule.resetRunner();
            // 任务队列先装好，等活动检测未命中后再由 farm gate / 循环启动
            if (TaskModule.isTaskPriority(getActive()) && TaskModule.hasPendingTasks(getActive())) {
                TaskModule.startRunner(getActive());
                log('任务队列已就绪（活动优先，有活动时先去活动）');
            }
        }
        setStatus('云游平台：调度已启动', 'running');
        log('启动：' + p.name + ' → ' + (mapNameById(p.farm.mapId) || p.farm.mapId) +
            (p.boss && p.boss.enabled ? ' ·Boss猎杀开(击杀后先拾取再回挂机)' : ''));
        lastBagAssistTs = 0;
        lastAutoSmeltTs = 0;
        lastAutoUseTs = 0;
        lastAutoRecycleTs = 0;
        lastAutoDiscardTs = 0;
        lastAutoStoreTs = 0;
        lastAutoBuyTs = 0;
        lastDailyChoresTs = 0;
        lastBossPollTs = 0;
        // 启动时清掉可能残留的拾取劫持
        sendCmd('endLootMode');
        sendCmd('setBagAutoFlags', {
            recycle: !!(p.bag.autoRecycle && p.bag.autoRecycle.enabled),
            smelt: !!(p.bag.autoSmelt && p.bag.autoSmelt.enabled)
        });
        if (window.PkModule && PkModule.syncToGame) PkModule.syncToGame(p, true);
        // 先回/去挂机图；活动检测在 getDailyActivities 回包与主循环中立刻触发
        pendingGoFarmUntil = Date.now() + 5000;
        sendCmd('goMap', {
            type: 'auto',
            mapId: getFarmTargetMapId(p),
            deliverId: p.farm.deliverId || 0
        });
        sendCmd('getDailyActivities', {});
        if (p.boss && p.boss.enabled) {
            sendCmd('requestShoulingBoss', {});
            setTimeout(function () { sendCmd('getShoulingBossInfo'); }, 800);
        }
        if (schedulerTimer) clearInterval(schedulerTimer);
        schedulerTickMs = SCHEDULER_TICK_MS;
        schedulerTimer = setInterval(tickScheduler, schedulerTickMs);
        tickScheduler();
    };

    window.pauseScheduler = function () {
        setPhase('PAUSED');
        setStatus('云游平台：已暂停');
        log('调度已暂停');
    };

    window.stopScheduler = function () {
        cancelDayResetRestart();
        if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
        leaveQunyingFastMode();
        huntQueue = [];
        huntTarget = null;
        huntKind = null;


    /* --- 13-message-bridge.js --- */
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
                if (p.success && p.mapId && huntTarget &&
                    (phase === 'GOING_BOSS' || phase === 'HUNTING_BOSS')) {
                    var landed = parseInt(p.mapId, 10);
                    if (landed && Number(huntTarget.arriveMapId || 0) !== landed &&
                        Number(huntTarget.mapId) !== landed) {
                        huntTarget.arriveMapId = landed;
                        log('进图落地校正: 配置图' + huntTarget.mapId + ' → 实际' + landed +
                            (p.deliverId ? (' deliver=' + p.deliverId) : ''), 'verbose');
                    } else if (landed && !huntTarget.arriveMapId) {
                        huntTarget.arriveMapId = landed;
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
                rows.forEach(function (row) {
                    if (!row || row.mapId == null || row.aliveKnown === false) return;
                    byMap[parseInt(row.mapId, 10)] = row;
                });
                if (typeof getEnabledExtraWatches === 'function') {
                    getEnabledExtraWatches().forEach(function (w) {
                        if (!w) return;
                        var row = byMap[parseInt(w.mapId, 10)];
                        if (!row) return;
                        setBossAliveAndEnqueue(w.mapId, row.isAlive, '扩展地图同步', w.type, {
                            allowEnqueue: false
                        });
                    });
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
                if (p.success) log('已前往活动: ' + (p.name || p.id) + (p.method ? (' ·' + p.method) : ''));
                else if (p.reason) log('前往活动失败: ' + p.reason);
                return;
            }
            if (a === 'useItemsByRule') {
                if (phase === 'HUNTING_BOSS' || phase === 'GOING_BOSS') {
                    var used = (p.used && p.used.length) || 0;
                    var skipped = p.skipped || [];
                    if (!used && skipped.length) {
                        var noBag = skipped.every(function (s) { return s.reason === 'not_in_bag'; });
                        if (noBag) {


    /* --- 14b-day-reset.js --- */
    /**
     * 服日切（0 点）：回盟重 → 停挂机 → 10 秒后重新启动。
     * 触发通道：heartbeat dayReset / runtime dayKey 变化 / activityEvent reset
     */
    var MENGZHONG_MAP_ID = 154;
    var DAY_RESET_RESTART_MS = 10000;

    function resolveDayKey(opts) {
        opts = opts || {};
        if (opts.dayKey) return String(opts.dayKey);
        if (opts.server && opts.server.dayKey) return String(opts.server.dayKey);
        if (lastRuntimeSnapshot && lastRuntimeSnapshot.server && lastRuntimeSnapshot.server.dayKey) {
            return String(lastRuntimeSnapshot.server.dayKey);
        }
        return '';
    }

    function shouldSkipDayKey(dayKey) {
        if (!dayKey) return false;
        if (dayKey === lastHandledDayKey) return true;
        if (lastHandledDayKey && !isNaN(Number(dayKey)) && !isNaN(Number(lastHandledDayKey)) &&
            Number(dayKey) < Number(lastHandledDayKey)) {
            return true;
        }
        return false;
    }

    /** 主循环兜底：比对 getRuntimeState().server.dayKey */
    function checkServerDayRoll(d) {
        if (!d || !d.server || !d.server.dayKey) return;
        var key = String(d.server.dayKey);
        if (!lastServerDayKey) {
            lastServerDayKey = key;
            lastHandledDayKey = key;
            return;
        }
        if (key !== lastServerDayKey) {
            onServerDayReset({ trigger: 'runtime', dayKey: key, server: d.server });
        }
    }

    /** 日切突发窗口结束条件：任务队列 done，或未开任务优先 */
    function maybeClearDailyBurst(p) {
        if (!dailyBurstActive) return;
        p = p || (typeof readEditor === 'function' ? readEditor() : getActive());
        if (!window.TaskModule || !TaskModule.isTaskPriority(p)) {
            dailyBurstActive = false;
            return;
        }
        var rs = TaskModule.getRunnerState ? TaskModule.getRunnerState() : '';
        if (rs === 'done') {
            dailyBurstActive = false;
            log('[日切] 任务突发窗口结束', 'verbose');
        }
    }

    function resolveMengzhongMapId() {
        try {
            var maps = catalog && catalog.maps;
            if (maps && maps.length) {
                for (var i = 0; i < maps.length; i++) {
                    if (maps[i] && maps[i].name === '盟重' && maps[i].id) {
                        return Number(maps[i].id);
                    }
                }
            }
        } catch (e) {}
        return MENGZHONG_MAP_ID;
    }

    function returnToMengzhong() {
        var d = lastRuntimeSnapshot;
        if (d && d.inDuplicate) {
            try { sendCmd('exitDuplicate', {}); } catch (e1) {}
        }
        var mid = resolveMengzhongMapId();
        var cur = d && d.map && d.map.mapId != null ? Number(d.map.mapId) : 0;
        if (cur !== mid) {
            sendCmd('goMap', { type: 'auto', mapId: mid });
            log('[日切] 回盟重 → ' + (mapNameById(mid) || mid));
        } else {
            log('[日切] 已在盟重');
        }
    }

    /**
     * 唯一日切入：回盟重并停挂机，10 秒后重新启动（启动时会自然重置记录器）。
     */
    function onServerDayReset(opts) {
        opts = opts || {};
        var trigger = opts.trigger || 'unknown';
        var dayKey = resolveDayKey(opts);

        if (!dayKey) {
            log('[日切] 缺少 dayKey，跳过 ·触发=' + trigger, 'verbose');
            return;
        }
        if (shouldSkipDayKey(dayKey)) return;

        // 首次见到该服日：只记账，不重启（避免进游戏首包误触发）
        if (!lastHandledDayKey) {
            lastHandledDayKey = dayKey;
            lastServerDayKey = dayKey;
            return;
        }

        lastHandledDayKey = dayKey;
        lastServerDayKey = dayKey;

        log('[日切] 服日更新 ·触发=' + trigger + ' ·dayKey=' + dayKey);

        if (!isSchedulerActive()) {
            return;
        }

        returnToMengzhong();
        if (typeof window.stopScheduler === 'function') window.stopScheduler();
        setStatus('日切：已停挂机，' + (DAY_RESET_RESTART_MS / 1000) + '秒后重启', 'running');
        log('[日切] 已停止挂机，' + (DAY_RESET_RESTART_MS / 1000) + '秒后自动启动');

        cancelDayResetRestart();
        dayResetRestartTimer = setTimeout(function () {
            dayResetRestartTimer = null;
            if (isSchedulerActive()) return;
            log('[日切] 自动重新启动挂机');
            if (typeof window.startScheduler === 'function') window.startScheduler();
        }, DAY_RESET_RESTART_MS);
    }


    /* --- 14-events.js --- */
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
                a === 'applyPkConfig' || a === 'setFightModel' || a === 'applyPkTick' ||
                a === 'teleportToRecycleNpc' || a === 'openRecycleUi' || a === 'hasPortableRecycle' ||
                a === 'confirmEnterMap' || a === 'selectMonster' || a === 'getPlayerInfo') {
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


    /* --- 15-bootstrap.js --- */

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
        bagUseEn: 1, bagUseInterval: 1, bagRecycleEn: 1, bagRecycleSlots: 1,
        bagSmeltEn: 1, bagSmeltSlots: 1, bagDiscardEn: 1,
        bagStoreEquipEn: 1, bagStoreEquipSlots: 1, bagStoreMatEn: 1, bagStoreMatSlots: 1,
        bagBuyEn: 1,
        bagSignInEn: 1, bagUnionDonateEn: 1, bagOfflineRewardEn: 1,
        bagVipRewardEn: 1, bagMailBaodianEn: 1,
        bagXuemaiEn: 1, bagXuemaiCost: 1,
        bagSmeltWhenStoppedEn: 1, bagRecycleWhenStoppedEn: 1,
        bossHuntEn: 1, bossPollSec: 1, bossOccupySec: 1, bossHuntSec: 1, bossLootSec: 1, bossSkipFarm: 1,
        bossRandomMax: 1, bossRandomIntervalSec: 1, bossRandomBuyEn: 1, bossRandomBuyCount: 1,
        bossNotifyEn: 1, bossNotifyBrowser: 1,
        bossHuanglingEn: 1, bossEmoEn: 1,
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
        if (window.PkModule) {
            PkModule.init({
                $: $,
                log: log,
                sendCmd: sendCmd,
                getActive: getActive,
                isSchedulerActive: isSchedulerActive
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



    /* --- 16-extra-boss.js --- */
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


})();
