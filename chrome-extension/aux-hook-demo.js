(function() {
    'use strict';

    if (window.__auxDemo) {
        console.log('%c[Aux] 已注入过，跳过', 'color:#f39c12');
        return;
    }

    // ======= Transport：统一通信层 =======
    var Transport = {
        _mode: 'auto',
        _msgCount: 0,
        _cmdStats: {},
        _hooks: [],
        _eventLog: [],

        init: function() {
            if (window.parent && window.parent !== window) {
                this._mode = 'iframe';
            } else {
                this._mode = 'independent';
            }
        },

        send: function(type, payload) {
            if (this._mode === 'iframe') {
                try { window.parent.postMessage({ type: type, payload: payload, ts: Date.now() }, '*'); } catch(e) {}
            }
            try { localStorage.setItem('__aux_event_' + type, JSON.stringify({ payload: payload, ts: Date.now() })); } catch(e) {}
            this._eventLog.push({ type: type, payload: payload, ts: Date.now() });
            if (this._eventLog.length > 200) this._eventLog.shift();
        },

        onCommand: function(handler) {
            window.addEventListener('message', function(e) {
                var d = e.data || {};
                if (d.type === 'gameCommand' && d.action) handler(d.action, d.payload);
            });
            try {
                window.addEventListener('storage', function(e) {
                    if (e.key === '__aux_cmd') {
                        try { var cmd = JSON.parse(e.newValue); if (cmd && cmd.action) handler(cmd.action, cmd.payload); } catch(err) {}
                    }
                });
            } catch(e) {}
        },

        log: function(msg, level) {
            var colors = { info: '#3498db', ok: '#27ae60', warn: '#f39c12', error: '#e74c3c', hook: '#9b59b6', recv: '#16a085', event: '#e67e22' };
            var icons = { hook: '[HOOK]', recv: '[RECV]', event: '[EVT]' };
            var c = colors[level] || '#9b59b6';
            var icon = icons[level] ? ' ' + icons[level] : '';
            console.log('%c[Aux]' + icon + ' ' + msg, 'color:' + c + ';font-weight:bold');
        }
    };
    Transport.init();

    // ======= 辅助工具函数 =======
    var U = {
        toNum: function(v) {
            if (v == null || v === '') return NaN;
            if (typeof v === 'number') return v;
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (typeof v === 'object') {
                try {
                    if (typeof v.toNumber === 'function') return v.toNumber();
                    if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
                        var n = Number(v.toString()); if (!isNaN(n)) return n;
                    }
                } catch(e) {}
            }
            var n2 = Number(v); return isNaN(n2) ? NaN : n2;
        },
        resolveMapName: function(mapId) {
            try {
                if (window.cm && cm.map) {
                    var m = cm.map[mapId] || cm.map[String(mapId)];
                    if (m && m.name) return m.name;
                }
            } catch(e) {}
            return '';
        },
        isImportantCmd: function(cmd) {
            var list = [
                73015, 73016, 73019, 73025, 73026, 73029,
                73031, 73034, 73040, 73044, 73052,
                108003, 108004, 108005, 108007,
                131002, 131003, 131019, 131020, 131029,
                30001, 30002, 30003, 30004, 30005,
                111001, 111002,
                157001, 157002
            ];
            for (var i = 0; i < list.length; i++) if (list[i] === cmd) return true;
            return (cmd >= 73000 && cmd <= 73999) || (cmd >= 101000 && cmd <= 101099) ||
                   (cmd >= 30000 && cmd <= 30099) || (cmd >= 131000 && cmd <= 131099);
        },
        resolveShoulingBossName: function(type) {
            try {
                if (!window.cm || !cm.bossTiaoZhan) return '';
                for (var k in cm.bossTiaoZhan) {
                    var cfg = cm.bossTiaoZhan[k];
                    if (cfg && Number(cfg.type) === Number(type) && (Number(cfg.type1) === 2 || Number(cfg.type1) === 1)) {
                        var mid = parseInt(cfg.showid, 10);
                        var mon = cm.getMonsterConfig ? cm.getMonsterConfig(mid) : (cm.monster && cm.monster[mid]);
                        if (mon && mon.name) return mon.name;
                        if (cfg.name) return cfg.name;
                        if (cfg.typeName) return cfg.typeName;
                    }
                }
            } catch(e) {}
            return '';
        }
    };

    // ======= 状态容器 =======
    var State = {
        qunyingTurbo: false,
        bossHunt: false,
        bossEvents: [],
        shoulingAlivePrev: {},
        bossPrevTime: {},
        activityPrevState: {},
        importantCmdCount: 0
    };

    // ======= Socket 消息 Hook =======
    function installMessageHandlerHook() {
        if (!window.MessageHandler || !MessageHandler.prototype || !MessageHandler.prototype.received) return false;
        if (MessageHandler.prototype.received.__auxHooked) { Transport._hooks.push('MessageHandler(already)'); return true; }

        var orig = MessageHandler.prototype.received;
        var hooked = function(cmd, bytes) {
            var ret = orig.apply(this, arguments);
            try {
                Transport._msgCount++;
                if (!Transport._cmdStats[cmd]) Transport._cmdStats[cmd] = { count: 0, firstSeen: Date.now() };
                Transport._cmdStats[cmd].count++;

                var isImportant = U.isImportantCmd(cmd);
                if (isImportant) {
                    State.importantCmdCount++;
                    Transport.send('socketMsg', { cmd: cmd, count: Transport._cmdStats[cmd].count, important: true });
                    if (State.importantCmdCount <= 20 || State.importantCmdCount % 50 === 0) {
                        Transport.log('关键协议 cmd=' + cmd + ' 累计' + State.importantCmdCount + '条', 'recv');
                    }
                } else {
                    if (Transport._msgCount <= 10) {
                        Transport.log('socket cmd=' + cmd, 'recv');
                    }
                }

                if (cmd === 131002 || cmd === 131003 || cmd === 131019 || cmd === 131020 || cmd === 131029) {
                    if (typeof onAuctionSocket === 'function') { try { onAuctionSocket(cmd); } catch(e) {} }
                }
            } catch(e) {}
            return ret;
        };
        hooked.__auxHooked = true;
        MessageHandler.prototype.received = hooked;
        Transport.log('MessageHandler.prototype.received hook OK', 'hook');
        return true;
    }

    function installConnection2Hook() {
        if (!window.Connection2 || !Connection2.prototype || !Connection2.prototype.onReceiveMessage) return false;
        if (Connection2.prototype.onReceiveMessage.__auxHooked) { Transport._hooks.push('Connection2(already)'); return true; }

        var orig = Connection2.prototype.onReceiveMessage;
        var hooked = function(socket) {
            return orig.apply(this, arguments);
        };
        hooked.__auxHooked = true;
        Connection2.prototype.onReceiveMessage = hooked;
        Transport.log('Connection2.prototype.onReceiveMessage hook OK', 'hook');
        return true;
    }

    // ======= Boss ARPG 刷新通知 =======
    function buildBossSnapshot(mapId) {
        mapId = String(mapId);
        var snap = { mapId: parseInt(mapId,10)||0, mapName: '', dieState: -1, selectState: -1, reliveCountdown: -1, ownerName: '', hp: 0, hpTotal: 0, category: 'arpg' };
        try {
            if (!window.gd || !gd.boss) return snap;
            var b = gd.boss.arpgBossInfoDic && (gd.boss.arpgBossInfoDic[mapId] || gd.boss.arpgBossInfoDic[parseInt(mapId,10)]);
            if (b) {
                var cfg = b.mapcfg || {};
                snap.mapId = cfg.id || snap.mapId;
                snap.mapName = cfg.name || '';
                snap.dieState = b.dieState;
                snap.selectState = b.state !== undefined ? b.state : -1;
                snap.ownerName = b.ownerName || '';
                snap.hp = b.hp || 0;
                snap.hpTotal = b.hpTotal || 0;
            }
            if (gd.boss.arpgBossTimeDic) {
                var t = gd.boss.arpgBossTimeDic[mapId]; if (t === undefined) t = gd.boss.arpgBossTimeDic[parseInt(mapId,10)];
                if (t !== undefined) snap.reliveCountdown = t;
            }
        } catch(e) {}
        return snap;
    }

    function emitBossEvent(event, mapId, extra) {
        var payload = buildBossSnapshot(mapId);
        payload.event = event;
        payload.ts = Date.now();
        if (extra) { for (var k in extra) payload[k] = extra[k]; }
        State.bossEvents.push(payload);
        if (State.bossEvents.length > 50) State.bossEvents.shift();
        Transport.send('bossEvent', payload);
        Transport.log('Boss[' + (payload.mapName || mapId) + '] ' + event + ' ' + (extra && extra.source ? extra.source : ''), 'event');
    }

    function installBossNotifyHook() {
        if (!window.BossControl || !BossControl.prototype || !BossControl.prototype.update) return false;
        if (BossControl.prototype.update.__auxHooked) { Transport._hooks.push('BossControl(already)'); return true; }

        var orig = BossControl.prototype.update;
        var hooked = function(cmd, data) {
            var ret = orig.apply(this, arguments);
            try {
                if (cmd === 73016) emitBossEvent('refresh', data, { source: '73016' });
                else if (cmd === 73019) emitBossEvent('dead', data, { source: '73019' });
                else if (cmd === 73015 && data && data.length) {
                    for (var i = 0; i < data.length; i++) {
                        if (data[i] && data[i].mapId != null) emitBossEvent('watch', data[i].mapId, { source: '73015', watchState: data[i].state });
                    }
                }
            } catch(e) {}
            return ret;
        };
        hooked.__auxHooked = true;
        BossControl.prototype.update = hooked;
        Transport.log('BossControl.prototype.update hook OK', 'hook');

        if (!State._bossWatchTimer) {
            State._bossWatchTimer = setInterval(function() {
                try {
                    if (!window.gd || !gd.boss || !gd.boss.arpgBossTimeDic) return;
                    var dic = gd.boss.arpgBossTimeDic;
                    var setDic = gd.boss.arpgBossSetDic || {};
                    for (var mid in dic) {
                        var sec = dic[mid];
                        var prev = State.bossPrevTime[mid];
                        State.bossPrevTime[mid] = sec;
                        if (prev != null && prev > 0 && sec <= 0) {
                            var watched = setDic[mid] == 1 || setDic[parseInt(mid,10)] == 1;
                            emitBossEvent('localRefresh', mid, { source: 'timer', watched: !!watched });
                        }
                    }
                } catch(e) {}
            }, 1000);
        }
        return true;
    }

    // ======= 首领（BossChuangShi）刷新通知 =======
    function shoulingCacheKey(mapId, bossType) {
        mapId = parseInt(mapId,10);
        if (!mapId) return '';
        if (bossType != null && bossType !== '' && !isNaN(Number(bossType))) return String(Number(bossType)) + '_' + mapId;
        return String(mapId);
    }

    function buildShoulingSnapshot(mapId, row, bossType) {
        mapId = parseInt(mapId,10)||0;
        var isAlive = row && row.isAlive != null ? Number(row.isAlive) : -1;
        if (isAlive < 0 && window.gd && gd.xuanShang && gd.xuanShang.mapMonsterTime) {
            var v = gd.xuanShang.mapMonsterTime[mapId]; if (v === undefined) v = gd.xuanShang.mapMonsterTime[String(mapId)];
            if (v !== undefined) isAlive = Number(v);
        }
        var count = row && row.count != null ? Number(row.count) : -1;
        return { category: 'shouling', mapId: mapId, mapName: U.resolveMapName(mapId), bossType: bossType!=null?Number(bossType):0, bossName: U.resolveShoulingBossName(bossType), isAlive: isAlive, refreshed: isAlive > 0, dieState: isAlive > 0 ? 0 : 1, count: count };
    }

    function emitShoulingEvent(event, mapId, row, bossType, extra) {
        var payload = buildShoulingSnapshot(mapId, row, bossType);
        payload.event = event;
        payload.ts = Date.now();
        if (extra) { for (var k in extra) payload[k] = extra[k]; }
        State.bossEvents.push(payload);
        if (State.bossEvents.length > 50) State.bossEvents.shift();
        Transport.send('bossEvent', payload);
        var tag = event === 'refresh' ? '🔴' : event === 'dead' ? '⚫' : '⚪';
        Transport.log('首领[' + (payload.bossName || mapId) + '] ' + tag + ' ' + event, 'event');
    }

    function installShoulingBossHook() {
        if (!window.XuanShangControl || !XuanShangControl.prototype || !XuanShangControl.prototype.update) return false;
        if (XuanShangControl.prototype.update.__auxHooked) { Transport._hooks.push('XuanShangControl(already)'); return true; }

        var orig = XuanShangControl.prototype.update;
        var hooked = function(cmd, data) {
            var ret = orig.apply(this, arguments);
            try {
                if (cmd === 108004 && data && data.countList) {
                    var bossType = data.type;
                    for (var i = 0; i < data.countList.length; i++) {
                        var row = data.countList[i];
                        if (!row || row.mapId == null) continue;
                        var cacheKey = shoulingCacheKey(row.mapId, bossType);
                        var alive = Number(row.isAlive) || 0;
                        var prev = cacheKey ? State.shoulingAlivePrev[cacheKey] : null;
                        if (cacheKey) State.shoulingAlivePrev[cacheKey] = alive;
                        if (prev == null) {
                            emitShoulingEvent(alive > 0 ? 'refresh' : 'dead', row.mapId, row, bossType, { source: '108004', initial: true });
                        } else if (prev <= 0 && alive > 0) {
                            emitShoulingEvent('refresh', row.mapId, row, bossType, { source: '108004' });
                        } else if (prev > 0 && alive <= 0) {
                            emitShoulingEvent('dead', row.mapId, row, bossType, { source: '108004' });
                        } else {
                            emitShoulingEvent('sync', row.mapId, row, bossType, { source: '108004' });
                        }
                    }
                }
            } catch(e) {}
            return ret;
        };
        hooked.__auxHooked = true;
        XuanShangControl.prototype.update = hooked;
        Transport.log('XuanShangControl.prototype.update hook OK', 'hook');
        return true;
    }

    // ======= 群英汇极速答题 =======
    var Qunying = {
        enabled: false,
        lastCfgId: 0,
        cfgSeenAt: 0,
        watchCfgId: 0,
        hookInstalled: false,
        pollTimer: 0
    };

    function resolveQunyingAnswer(cfgId) {
        if (!cfgId || !window.cm || !cm.yizhandaodi || !cm.yizhandaodi[cfgId]) return '';
        var qc = cm.yizhandaodi[cfgId];
        if (!qc || !qc.answer) return '';
        return String(qc.answer).split('#').filter(Boolean)[0] || '';
    }

    function tryInstantQunyingAnswer(source) {
        if (!Qunying.enabled) return false;
        try {
            if (!window.gd || !gd.union || !window.net || !net.ChatModel || !net.ChatModel.ins) return false;
            var u = gd.union;
            if (!u.openDati || u.datiEnd) return false;
            if (gd.map && Number(gd.map.curMapId) !== 116) return false;
            var info = u.datiInfo;
            if (!info || !info.cfgId) return false;
            var cfgId = Number(info.cfgId) || 0;
            if (!cfgId || cfgId === Qunying.lastCfgId) return false;
            if (Qunying.watchCfgId !== cfgId) { Qunying.watchCfgId = cfgId; Qunying.cfgSeenAt = Date.now(); }
            var ans = resolveQunyingAnswer(cfgId);
            if (!ans) return false;
            var now = Date.now();
            var reactMs = Qunying.cfgSeenAt ? (now - Qunying.cfgSeenAt) : 0;
            Qunying.lastCfgId = cfgId;
            net.ChatModel.ins().send3(Long.Zero, 9, ans, [], []);
            Transport.send('qunyingAnswered', { cfgId: cfgId, answer: ans, source: source, reactMs: reactMs });
            Transport.log('群英汇答题 cfgId=' + cfgId + ' ans=' + ans + ' 反应' + reactMs + 'ms [' + source + ']', 'event');
            return true;
        } catch(e) { return false; }
    }

    function installQunyingHook() {
        if (Qunying.hookInstalled) return true;
        if (!window.net || !net.UnionModel || !net.UnionModel.prototype || !net.UnionModel.prototype.updateDaTiInfo) return false;
        var orig = net.UnionModel.prototype.updateDaTiInfo;
        net.UnionModel.prototype.updateDaTiInfo = function(e) {
            var ret = orig.apply(this, arguments);
            try {
                if (e && e.cfgId) Qunying.cfgSeenAt = Date.now();
                tryInstantQunyingAnswer('updateDaTiInfo');
            } catch(ex) {}
            return ret;
        };
        Qunying.hookInstalled = true;
        Transport.log('net.UnionModel.prototype.updateDaTiInfo hook OK', 'hook');
        return true;
    }

    function setQunyingTurbo(enabled, reset) {
        Qunying.enabled = !!enabled;
        if (reset) { Qunying.lastCfgId = 0; Qunying.cfgSeenAt = 0; Qunying.watchCfgId = 0; }
        if (!Qunying.enabled) {
            if (Qunying.pollTimer) { clearInterval(Qunying.pollTimer); Qunying.pollTimer = 0; }
            Transport.log('群英汇极速答题：关闭', 'warn');
            return;
        }
        installQunyingHook();
        if (!Qunying.pollTimer) {
            Qunying.pollTimer = setInterval(function() { if (Qunying.enabled) tryInstantQunyingAnswer('poll50'); }, 50);
        }
        tryInstantQunyingAnswer('turboOn');
        Transport.log('群英汇极速答题：开启', 'ok');
    }

    // ======= 面板 UI =======
    var Panel = {
        _el: null, _floatBtn: null, _collapsed: false, _expandedTab: 'status',

        _css: [
            '.aux-panel{position:fixed;top:12px;right:12px;width:280px;background:rgba(20,22,28,0.94);',
            'color:#e8eaed;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-size:12px;',
            'border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.1);',
            'z-index:2147483646;user-select:none;backdrop-filter:blur(10px);overflow:hidden;}',
            '.aux-panel *{box-sizing:border-box;}',
            '.aux-panel-header{display:flex;align-items:center;gap:6px;padding:8px 10px;',
            'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);cursor:move;font-weight:600;}',
            '.aux-panel-header .aux-title{flex:1;font-size:12px;letter-spacing:0.5px;}',
            '.aux-panel-header .aux-btn-head{width:22px;height:22px;border:none;background:rgba(255,255,255,0.18);',
            'color:#fff;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;}',
            '.aux-panel-header .aux-btn-head:hover{background:rgba(255,255,255,0.35);}',
            '.aux-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,0.08);}',
            '.aux-tab{flex:1;padding:7px 0;text-align:center;font-size:11px;cursor:pointer;',
            'border:none;background:transparent;color:#9aa0a6;border-bottom:2px solid transparent;transition:all .15s;}',
            '.aux-tab.active{color:#fff;border-bottom-color:#667eea;background:rgba(102,126,234,0.1);}',
            '.aux-panel-body{padding:10px;max-height:380px;overflow-y:auto;}',
            '.aux-panel-body::-webkit-scrollbar{width:4px;}',
            '.aux-panel-body::-webkit-scrollbar-thumb{background:#4b5563;border-radius:2px;}',
            '.aux-section{margin-bottom:12px;}',
            '.aux-section:last-child{margin-bottom:0;}',
            '.aux-section-title{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;',
            'margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06);}',
            '.aux-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;}',
            '.aux-row-label{color:#9aa0a6;font-size:11px;}',
            '.aux-row-val{font-family:"Consolas","Monaco",monospace;font-size:11px;color:#cbd5e1;}',
            '.aux-row-val.ok{color:#4ade80;}',
            '.aux-row-val.warn{color:#fbbf24;}',
            '.aux-row-val.err{color:#f87171;}',
            '.aux-hook-item{display:flex;align-items:center;gap:6px;padding:2px 0;}',
            '.aux-hook-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}',
            '.aux-hook-dot.on{background:#4ade80;box-shadow:0 0 6px #4ade80;}',
            '.aux-hook-dot.off{background:#4b5563;}',
            '.aux-hook-name{font-family:"Consolas","Monaco",monospace;font-size:11px;color:#cbd5e1;}',
            '.aux-toggle{display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:5px 8px;',
            'background:rgba(255,255,255,0.04);border-radius:4px;margin-bottom:4px;font-size:11px;}',
            '.aux-toggle-label{color:#e8eaed;}',
            '.aux-toggle-switch{width:32px;height:18px;border-radius:9px;background:#4b5563;position:relative;transition:background .2s;}',
            '.aux-toggle-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .2s;}',
            '.aux-toggle.on .aux-toggle-switch{background:#27ae60;}',
            '.aux-toggle.on .aux-toggle-switch::after{transform:translateX(14px);}',
            '.aux-boss-item{padding:4px 6px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:3px;font-size:11px;}',
            '.aux-boss-item.refresh{border-left:3px solid #4ade80;}',
            '.aux-boss-item.dead{border-left:3px solid #f87171;}',
            '.aux-boss-item.localRefresh{border-left:3px solid #fbbf24;}',
            '.aux-boss-name{font-weight:600;color:#e8eaed;}',
            '.aux-boss-meta{color:#9aa0a6;font-size:10px;margin-top:2px;}',
            '.aux-log{background:rgba(0,0,0,0.25);border-radius:4px;padding:6px;max-height:180px;overflow-y:auto;}',
            '.aux-log-line{font-family:"Consolas","Monaco",monospace;font-size:10px;line-height:1.5;color:#cbd5e1;}',
            '.aux-log-line .ts{color:#6b7280;margin-right:4px;}',
            '.aux-log-line.event{color:#e67e22;}',
            '.aux-log-line.recv{color:#16a085;}',
            '.aux-log-line.hook{color:#9b59b6;}',
            '.aux-float-btn{position:fixed;width:42px;height:42px;border-radius:50%;',
            'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;border:none;',
            'cursor:pointer;z-index:2147483646;display:flex;align-items:center;justify-content:center;',
            'font-size:16px;box-shadow:0 4px 16px rgba(102,126,234,0.5);transition:transform .15s;}',
            '.aux-float-btn:hover{transform:scale(1.1);}',
            '.aux-empty{color:#6b7280;font-size:11px;text-align:center;padding:12px 0;}',
            '.aux-cmd-row{display:flex;gap:4px;margin-top:6px;}',
            '.aux-btn{flex:1;padding:5px 8px;font-size:11px;border:1px solid rgba(255,255,255,0.15);',
            'background:rgba(255,255,255,0.05);color:#e8eaed;border-radius:4px;cursor:pointer;transition:all .15s;}',
            '.aux-btn:hover{background:rgba(255,255,255,0.1);}'
        ].join(''),

        _status: {},
        _logLines: [],

        init: function() {
            if (document.getElementById('aux-panel')) return;
            this._injectStyles();
            this._build();
            this._startRefresh();
            Transport.panel = this;
        },

        _injectStyles: function() {
            var style = document.createElement('style');
            style.id = 'aux-panel-styles';
            style.textContent = this._css;
            (document.head || document.documentElement).appendChild(style);
        },

        _build: function() {
            var self = this;
            var el = document.createElement('div');
            el.className = 'aux-panel';
            el.id = 'aux-panel';
            el.innerHTML = [
                '<div class="aux-panel-header">',
                '   <span class="aux-title">🎮 原始传奇辅助</span>',
                '   <button class="aux-btn-head" data-act="collapse" title="折叠">—</button>',
                '   <button class="aux-btn-head" data-act="hide" title="隐藏">×</button>',
                '</div>',
                '<div class="aux-tabs">',
                '   <button class="aux-tab active" data-tab="status">状态</button>',
                '   <button class="aux-tab" data-tab="boss">Boss</button>',
                '   <button class="aux-tab" data-tab="auto">自动化</button>',
                '   <button class="aux-tab" data-tab="log">日志</button>',
                '</div>',
                '<div class="aux-panel-body" id="aux-body"></div>'
            ].join('');
            document.body.appendChild(el);
            this._el = el;

            el.querySelector('[data-act="hide"]').addEventListener('click', function() { self._hide(); });
            el.querySelector('[data-act="collapse"]').addEventListener('click', function() { self._toggleCollapse(); });
            el.querySelectorAll('.aux-tab').forEach(function(tab) {
                tab.addEventListener('click', function() { self._switchTab(this.dataset.tab); });
            });
            this._makeDraggable(el, el.querySelector('.aux-panel-header'));
            this._renderTab('status');
        },

        _switchTab: function(tab) {
            this._expandedTab = tab;
            this._el.querySelectorAll('.aux-tab').forEach(function(t) {
                t.classList.toggle('active', t.dataset.tab === tab);
            });
            this._renderTab(tab);
        },

        _renderTab: function(tab) {
            var body = this._el.querySelector('#aux-body');
            if (tab === 'status') body.innerHTML = this._htmlStatus();
            else if (tab === 'boss') body.innerHTML = this._htmlBoss();
            else if (tab === 'auto') body.innerHTML = this._htmlAuto();
            else if (tab === 'log') body.innerHTML = this._htmlLog();
            this._bindTabEvents(tab);
        },

        _htmlStatus: function() {
            var hooked = Transport._hooks;
            var totalHooks = [
                { name: 'MessageHandler', ok: !!window.MessageHandler },
                { name: 'Connection2', ok: !!window.Connection2 },
                { name: 'BossControl', ok: !!window.BossControl },
                { name: 'XuanShangControl', ok: !!window.XuanShangControl },
                { name: 'UnionModel', ok: !!(window.net && net.UnionModel) }
            ];
            var hookItems = totalHooks.map(function(h) {
                var installed = hooked.indexOf(h.name) >= 0 || hooked.some(function(x) { return x.indexOf(h.name) === 0; });
                return '<div class="aux-hook-item"><div class="aux-hook-dot ' + (installed && h.ok ? 'on' : 'off') + '"></div>' +
                    '<span class="aux-hook-name">' + h.name + '</span></div>';
            }).join('');

            return [
                '<div class="aux-section">',
                '  <div class="aux-section-title">运行状态</div>',
                '  <div class="aux-row"><span class="aux-row-label">模式</span><span class="aux-row-val">' + (Transport._mode === 'iframe' ? 'Iframe' : '独立') + '</span></div>',
                '  <div class="aux-row"><span class="aux-row-label">Socket 消息</span><span class="aux-row-val ok">' + Transport._msgCount + '</span></div>',
                '  <div class="aux-row"><span class="aux-row-label">关键协议</span><span class="aux-row-val warn">' + State.importantCmdCount + '</span></div>',
                '  <div class="aux-row"><span class="aux-row-label">Hook 已安装</span><span class="aux-row-val">' + hooked.length + '/' + totalHooks.length + '</span></div>',
                '</div>',
                '<div class="aux-section">',
                '  <div class="aux-section-title">Hook 状态</div>',
                hookItems,
                '</div>'
            ].join('');
        },

        _htmlBoss: function() {
            var events = State.bossEvents.slice(-10).reverse();
            if (events.length === 0) return '<div class="aux-empty">暂无 Boss 事件，进服后打开 Boss 页面等待...</div>';
            return events.map(function(ev) {
                var name = ev.mapName || ev.bossName || ('地图' + ev.mapId);
                var cls = ev.event === 'refresh' || ev.event === 'localRefresh' ? 'refresh' : ev.event === 'dead' ? 'dead' : '';
                var tag = ev.event === 'refresh' ? '🔴 刷新' : ev.event === 'dead' ? '⚫ 死亡' : ev.event === 'localRefresh' ? '🟡 本地刷新' : '⚪ ' + ev.event;
                var meta = [];
                if (ev.category) meta.push(ev.category);
                if (ev.source) meta.push(ev.source);
                if (ev.ownerName) meta.push('归属:' + ev.ownerName);
                if (ev.reliveCountdown != null && ev.reliveCountdown >= 0) meta.push('倒计时:' + ev.reliveCountdown + 's');
                return '<div class="aux-boss-item ' + cls + '">' +
                    '<div class="aux-boss-name">' + tag + ' ' + name + '</div>' +
                    (meta.length ? '<div class="aux-boss-meta">' + meta.join(' | ') + '</div>' : '') +
                    '</div>';
            }).join('');
        },

        _htmlAuto: function() {
            return [
                '<div class="aux-section">',
                '  <div class="aux-section-title">自动化</div>',
                '  <div class="aux-toggle ' + (Qunying.enabled ? 'on' : '') + '" data-toggle="qunying">',
                '    <span class="aux-toggle-label">群英汇极速答题</span><div class="aux-toggle-switch"></div>',
                '  </div>',
                '  <div class="aux-row"><span class="aux-row-label">答题反应</span><span class="aux-row-val">' + (Qunying.cfgSeenAt ? Math.max(0, Date.now() - Qunying.cfgSeenAt) + 'ms' : '-') + '</span></div>',
                '</div>',
                '<div class="aux-section">',
                '  <div class="aux-section-title">工具</div>',
                '  <div class="aux-cmd-row"><button class="aux-btn" data-cmd="getStats">获取状态</button></div>',
                '  <div class="aux-cmd-row"><button class="aux-btn" data-cmd="clearEvents">清空 Boss 事件</button></div>',
                '</div>'
            ].join('');
        },

        _htmlLog: function() {
            var lines = this._logLines.slice(-30).reverse();
            if (lines.length === 0) return '<div class="aux-empty">等待日志...</div>';
            return '<div class="aux-log">' + lines.map(function(l) {
                return '<div class="aux-log-line ' + l.level + '"><span class="ts">' + l.ts + '</span>' + l.msg + '</div>';
            }).join('') + '</div>';
        },

        _bindTabEvents: function(tab) {
            var self = this;
            if (tab === 'auto') {
                this._el.querySelectorAll('.aux-toggle').forEach(function(t) {
                    t.addEventListener('click', function() {
                        var key = this.dataset.toggle;
                        if (key === 'qunying') {
                            var on = !Qunying.enabled;
                            setQunyingTurbo(on, true);
                            self._renderTab('auto');
                        }
                    });
                });
                this._el.querySelectorAll('[data-cmd]').forEach(function(b) {
                    b.addEventListener('click', function() {
                        var cmd = this.dataset.cmd;
                        if (cmd === 'clearEvents') { State.bossEvents = []; self._renderTab('boss'); }
                        if (cmd === 'getStats') {
                            var status = window.__auxDemo.getStatus();
                            Transport.log('Status: ' + JSON.stringify(status), 'info');
                        }
                    });
                });
            }
        },

        _makeDraggable: function(el, handle) {
            var sx, sy, ol, ot, dragging = false;
            handle.style.cursor = 'move';
            handle.addEventListener('mousedown', function(e) {
                dragging = true; sx = e.clientX; sy = e.clientY;
                var r = el.getBoundingClientRect(); ol = r.left; ot = r.top;
                handle.style.cursor = 'grabbing'; e.preventDefault();
            });
            document.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                var dx = e.clientX - sx, dy = e.clientY - sy;
                var nl = Math.max(8, Math.min(ol + dx, window.innerWidth - el.offsetWidth - 8));
                var nt = Math.max(8, Math.min(ot + dy, window.innerHeight - 40));
                el.style.left = nl + 'px'; el.style.top = nt + 'px'; el.style.right = 'auto';
            });
            document.addEventListener('mouseup', function() { if (dragging) { dragging = false; handle.style.cursor = 'move'; } });
        },

        _toggleCollapse: function() {
            var tabs = this._el.querySelector('.aux-tabs');
            var body = this._el.querySelector('.aux-panel-body');
            var btn = this._el.querySelector('[data-act="collapse"]');
            if (this._collapsed) {
                tabs.style.display = ''; body.style.display = ''; btn.textContent = '—';
                this._collapsed = false;
            } else {
                tabs.style.display = 'none'; body.style.display = 'none'; btn.textContent = '+';
                this._collapsed = true;
            }
        },

        _hide: function() {
            var self = this;
            var rect = this._el.getBoundingClientRect();
            this._el.style.display = 'none';
            var btn = document.createElement('button');
            btn.className = 'aux-float-btn'; btn.textContent = '🎮'; btn.title = '打开辅助面板';
            btn.style.left = rect.left + 'px'; btn.style.top = rect.top + 'px';
            document.body.appendChild(btn); this._floatBtn = btn;
            btn.addEventListener('click', function() {
                self._el.style.display = ''; btn.remove(); self._floatBtn = null;
            });
            this._makeDraggable(btn, btn);
        },

        addLog: function(msg, level) {
            var ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            this._logLines.push({ ts: ts, msg: msg, level: level || '' });
            if (this._logLines.length > 100) this._logLines.shift();
        },

        _startRefresh: function() {
            var self = this;
            setInterval(function() {
                if (!self._el || self._collapsed) return;
                var tab = self._expandedTab || 'status';
                self._renderTab(tab);
            }, 800);
        }
    };

    var origLog = Transport.log.bind(Transport);
    Transport.log = function(msg, level) {
        origLog(msg, level);
        if (Panel._el) Panel.addLog(msg, level);
    };

    // ======= 启动 =======
    function boot() {
        Transport.log('Aux Demo v0.2 启动', 'info');
        Transport.log('运行模式：' + Transport._mode, 'info');

        var tryCount = 0, maxTries = 150;
        function poll() {
            tryCount++;
            var hooked = [];
            if (installMessageHandlerHook()) hooked.push('MessageHandler');
            if (installConnection2Hook()) hooked.push('Connection2');
            if (installBossNotifyHook()) hooked.push('BossControl');
            if (installShoulingBossHook()) hooked.push('XuanShangControl');
            var unionOk = installQunyingHook();
            if (unionOk) hooked.push('UnionModel');

            if (hooked.length > 0) {
                Transport._hooks = hooked;
                Transport.log('本轮 hook: ' + hooked.join(', '), 'ok');
            }
            if (tryCount >= maxTries) {
                Transport.log('等待结束，已安装: ' + Transport._hooks.join(', '), Transport._hooks.length > 0 ? 'ok' : 'warn');
                return;
            }
            setTimeout(poll, 200);
        }
        poll();

        try { Panel.init(); } catch(e) { console.error('[Aux] Panel init failed:', e); }
    }

    // ======= 命令分发 =======
    Transport.onCommand(function(action, payload) {
        Transport.log('收到命令: ' + action, 'event');
        try {
            switch (action) {
                case 'setQunyingTurbo': setQunyingTurbo(payload && payload.enabled, true); break;
                case 'getStats': return window.__auxDemo ? window.__auxDemo.getStatus() : null;
                case 'getBossEvents': return State.bossEvents.slice(-20);
            }
        } catch(e) { Transport.log('命令执行失败: ' + e.message, 'error'); }
    });

    window.__auxDemo = {
        version: '0.2.0',
        transport: Transport,
        state: State,
        setQunyingTurbo: setQunyingTurbo,
        setBossHunt: function(enabled) { State.bossHunt = !!enabled; Transport.log('Boss Hunt: ' + (enabled ? 'ON' : 'OFF'), enabled ? 'ok' : 'warn'); },
        getStatus: function() {
            return {
                mode: Transport._mode,
                msgCount: Transport._msgCount,
                importantCmdCount: State.importantCmdCount,
                hooked: Transport._hooks.slice(),
                cmdStats: Transport._cmdStats,
                qunyingEnabled: Qunying.enabled,
                bossEvents: State.bossEvents.length
            };
        }
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        boot();
    } else {
        window.addEventListener('DOMContentLoaded', boot);
    }
})();