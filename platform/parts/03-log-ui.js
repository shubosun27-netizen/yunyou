
    function $(id) { return document.getElementById(id); }

    var FEATURE_TAB_KEY = 'yy_cfg_tab';
    var FEATURE_TABS = { global: 1, farm: 1, bag: 1, boss: 1, act: 1, task: 1, pk: 1 };
    var CFG_COLLAPSE_KEY = 'yy_cfg_collapsed';

    function applyCfgShellCollapsed(collapsed) {
        collapsed = !!collapsed;
        var layout = document.querySelector('.layout');
        if (layout) layout.classList.toggle('cfg-collapsed', collapsed);
        document.body.classList.toggle('cfg-collapsed', collapsed);
        var btn = $('btnCollapseCfg');
        if (btn) {
            btn.textContent = collapsed ? '展开' : '隐藏';
            btn.title = collapsed ? '展开配置栏' : '隐藏配置栏，游戏区横向全屏';
        }
        try { localStorage.setItem(CFG_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
    }

    window.toggleCfgShell = function () {
        var layout = document.querySelector('.layout');
        var collapsed = !(layout && layout.classList.contains('cfg-collapsed'));
        applyCfgShellCollapsed(collapsed);
    };

    function initCfgShellCollapse() {
        var saved = false;
        try { saved = localStorage.getItem(CFG_COLLAPSE_KEY) === '1'; } catch (e) {}
        applyCfgShellCollapsed(saved);
    }

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
        initCfgShellCollapse();
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
            p === 'GOING_PANLUAN' || p === 'PANLUAN' ||
            p === 'GOING_HANGHUI' || p === 'HANGHUI' ||
            p === 'GOING_ACTIVITY_PREP' || p === 'GOING_ACTIVITY' || p === 'IN_ACTIVITY' ||
            p === 'GOING_TASK' || p === 'DOING_TASK' ||
            p === 'GOING_RECYCLE' || p === 'RECYCLING' ||
            p === 'GOING_SOUL_HALL' || p === 'SOUL_HALL';
        $('btnStart').disabled = running || p === 'PAUSED';
        $('btnPause').disabled = !running;
        $('btnStop').disabled = p === 'IDLE';
        if (p === 'PAUSED') $('btnStart').disabled = false;
    }
