/**
 * 任务 Tab：UI 渲染、配置持久化、调度执行
 * 由 layout-preview.html 在 IIFE 内 TaskModule.init(api) 注入依赖
 */
(function (global) {
    'use strict';

    var api = {};
    var catalog = { groups: [], pickers: {}, hint: '' };
    var catalogSyncedAt = 0;
    var pickerTaskId = '';
    var pickerDraft = [];

    var runner = {
        queue: [],
        index: 0,
        current: null,
        state: 'idle',
        startedAt: 0,
        lastTick: 0,
        dailyDone: {},
        sessionDone: {},
        pendingCmd: false,
        waitUntil: 0,
        subStep: 0,
        lastResult: null,
        taskState: {},
        failCount: {}
    };

    function $(id) { return api.$ ? api.$('id' in { id: 1 } ? id : id) : document.getElementById(id); }
    function $id(id) { return api.$ ? api.$(id) : document.getElementById(id); }
    function log(msg, level) { if (api.log) api.log(msg, level); }
    function sendCmd(cmd, payload) { if (api.sendCmd) api.sendCmd(cmd, payload); }
    function getActive() { return api.getActive ? api.getActive() : null; }
    function readEditor() { return api.readEditor ? api.readEditor() : null; }
    function getPhase() { return api.getPhase ? api.getPhase() : 'IDLE'; }
    function setPhase(p) { if (api.setPhase) api.setPhase(p); }
    function setStatus(t, c) { if (api.setStatus) api.setStatus(t, c); }
    function mapNameById(id) { return api.mapNameById ? api.mapNameById(id) : String(id); }
    function isSchedulerActive() { return api.isSchedulerActive ? api.isSchedulerActive() : false; }
    function returnToFarmMap(p, reason) { if (api.returnToFarmMap) api.returnToFarmMap(p, reason); }
    function scheduleAutoSave() { if (api.scheduleAutoSave) api.scheduleAutoSave(); }

    function todayKey() {
        var snap = api.getLastRuntimeSnapshot ? api.getLastRuntimeSnapshot() : null;
        if (snap && snap.server && snap.server.dayKey) return String(snap.server.dayKey);
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function serverTodayKey(snap) {
        snap = snap || (api.getLastRuntimeSnapshot ? api.getLastRuntimeSnapshot() : null);
        if (snap && snap.server && snap.server.dayKey) return String(snap.server.dayKey);
        return todayKey();
    }

    function defaultTasks() {
        return {
            taskPriority: false,
            groupOpen: { wolong: true },
            items: {}
        };
    }

    function ensureTasks(p) {
        if (!p.tasks) p.tasks = defaultTasks();
        if (!p.tasks.items) p.tasks.items = {};
        if (!p.tasks.groupOpen) p.tasks.groupOpen = { wolong: true };
        if (p.tasks.taskPriority == null) p.tasks.taskPriority = false;
        return p.tasks;
    }

    function getItemDef(id) {
        for (var gi = 0; gi < (catalog.groups || []).length; gi++) {
            var g = catalog.groups[gi];
            for (var ii = 0; ii < (g.items || []).length; ii++) {
                if (g.items[ii].id === id) return g.items[ii];
            }
        }
        return null;
    }

    function getItemCfg(p, id) {
        ensureTasks(p);
        if (!p.tasks.items[id]) {
            var def = getItemDef(id);
            p.tasks.items[id] = { enabled: def && def.kind === 'priority' ? !!p.tasks.taskPriority : false };
            if (def && def.kind === 'number' && def.field) {
                p.tasks.items[id][def.field] = def.default != null ? def.default : 0;
            }
            if (def && def.kind === 'picker') {
                p.tasks.items[id].picked = def.defaultPicker ? [def.defaultPicker] : [];
                if (def.picker === 'double_reward' && def.defaultPicker) {
                    p.tasks.items[id].mode = def.defaultPicker;
                }
            }
        }
        return p.tasks.items[id];
    }

    function wolongHourOk(p) {
        p = p || getActive();
        if (!p || !p.tasks) return true;
        var sch = p.tasks.items && p.tasks.items.wolong_schedule;
        if (!sch || !sch.enabled) return true;
        var hour = sch.hour != null ? sch.hour : 1;
        var snap = api.getLastRuntimeSnapshot ? api.getLastRuntimeSnapshot() : null;
        if (snap && snap.server && snap.server.secSinceMidnight != null && snap.server.secSinceMidnight >= 0) {
            var serverHour = Math.floor(Number(snap.server.secSinceMidnight) / 3600) % 24;
            return serverHour >= hour;
        }
        return new Date().getHours() >= hour;
    }

    function buildAllCfg(p) {
        p = p || getActive();
        var out = {};
        if (!p || !p.tasks) return out;
        ensureTasks(p);
        for (var id in p.tasks.items) {
            if (p.tasks.items.hasOwnProperty(id)) out[id] = p.tasks.items[id];
        }
        return out;
    }

    function taskStateKey(entry) {
        if (!entry || !entry.def) return '';
        return entry.def.handler || entry.def.id || '';
    }

    function mergeDynamicCatalog(data) {
        if (!data || !data.pickers) return;
        if (!catalog.pickers) catalog.pickers = {};
        for (var pk in data.pickers) {
            if (!data.pickers.hasOwnProperty(pk)) continue;
            var incoming = data.pickers[pk];
            if (!catalog.pickers[pk]) catalog.pickers[pk] = incoming;
            else {
                catalog.pickers[pk].title = incoming.title || catalog.pickers[pk].title;
                catalog.pickers[pk].multi = incoming.multi != null ? incoming.multi : catalog.pickers[pk].multi;
                if (incoming.options && incoming.options.length) {
                    catalog.pickers[pk].options = incoming.options;
                }
            }
        }
        if (data.syncedAt) catalogSyncedAt = data.syncedAt;
    }

    function refreshCatalogFromGame() {
        return new Promise(function (resolve) {
            var done = false;
            function finish(ok) {
                if (done) return;
                done = true;
                resolve(ok);
            }
            var timer = setTimeout(function () { finish(false); }, 8000);
            function onResp(ev) {
                var msg = ev.data;
                if (!msg || msg.type !== 'gameResponse' || msg.action !== 'getTaskCatalog') return;
                window.removeEventListener('message', onResp);
                clearTimeout(timer);
                var p = msg.payload || {};
                if (p.success && p.pickers) {
                    mergeDynamicCatalog(p);
                    renderTaskPanel();
                    var ts = catalogSyncedAt ? new Date(catalogSyncedAt).toLocaleTimeString() : '';
                    var n = p.personalBossCount != null ? (' · 个人BOSS ' + p.personalBossCount + '个') : '';
                    log('任务目录已从游戏同步' + (ts ? ' · ' + ts : '') + n +
                        (p.ready === false ? '（游戏配置未就绪）' : ''));
                    finish(true);
                } else finish(false);
            }
            window.addEventListener('message', onResp);
            sendCmd('getTaskCatalog');
        });
    }

    function buildTaskPayload(entry) {
        var key = taskStateKey(entry);
        return {
            handler: entry.def.handler,
            id: entry.def.id,
            cfg: entry.cfg,
            def: entry.def,
            taskState: runner.taskState[key] || {},
            allCfg: buildAllCfg(readEditor() || getActive()),
            subStep: runner.subStep,
            startedAt: runner.startedAt
        };
    }

    function flushTaskLogs(payload) {
        if (!payload || !payload.logs || !payload.logs.length) return;
        payload.logs.forEach(function (entry) {
            var msg = typeof entry === 'string' ? entry : (entry.msg || '');
            if (!msg) return;
            var level = (entry && entry.level) || 'verbose';
            log(msg.indexOf('[个人BOSS]') === 0 || msg.indexOf('[任务]') === 0 ? msg : ('[任务] ' + msg), level);
        });
    }

    function applyTaskResult(payload) {
        // 日志已在 onTaskCmdResult 里 flush，这里不再重复刷
        if (!runner.current || !payload) return;
        var key = taskStateKey(runner.current);
        if (payload.state) runner.taskState[key] = payload.state;
        if (payload.restart) {
            if (payload.reason) {
                log('[任务] 续跑：' + (runner.current.def.label || '') + (payload.reason ? (' · ' + payload.reason) : ''), 'verbose');
            }
            runner.pendingCmd = false;
            runner.subStep++;
            setPhase('GOING_TASK');
            sendCmd('runTask', buildTaskPayload(runner.current));
            runner.pendingCmd = true;
            runner.waitUntil = Date.now() + (payload.waitMs || 8000);
            if (payload.statusText) setStatus('云游平台：' + payload.statusText, 'running');
            return true;
        }
        return false;
    }

    function tagHtml(tag) {
        if (!tag) return '';
        return '【' + tag + '】';
    }

    function pickerSummary(def, cfg) {
        if (!def || def.kind !== 'picker' || !def.picker) return '未配置';
        var pk = catalog.pickers[def.picker];
        if (!pk) return '未配置';
        var picked = cfg.picked || (cfg.mode ? [cfg.mode] : []);
        if (!picked.length) return '点击选择 ▾';
        var labels = [];
        (pk.options || []).forEach(function (o) {
            if (picked.indexOf(o.id) >= 0 || cfg.mode === o.id) labels.push(o.label);
        });
        return labels.length ? labels.join('、') + ' ▾' : '点击选择 ▾';
    }

    function renderTaskPanel() {
        var root = $id('taskPanelRoot');
        if (!root || !catalog.groups) return;
        var p = getActive();
        if (!p) return;
        ensureTasks(p);

        var html = '<div class="hint task-hint">' + (catalog.hint || '') +
            (catalogSyncedAt ? (' <span class="sub">同步于 ' + new Date(catalogSyncedAt).toLocaleTimeString() + '</span>') : '') +
            '</div>';
        catalog.groups.forEach(function (group) {
            if (group.collapsible) {
                var open = p.tasks.groupOpen[group.id] !== false && group.defaultOpen !== false;
                html += '<details class="task-group' + (group.purple ? ' purple' : '') + '"' +
                    (open ? ' open' : '') + ' data-group="' + group.id + '">';
                html += '<summary class="cfg-block purple">' + (group.title || group.id) + '</summary>';
                html += '<ul class="cfg-list">';
            } else {
                html += '<ul class="cfg-list">';
            }
            (group.items || []).forEach(function (item) {
                var cfg = getItemCfg(p, item.id);
                html += renderTaskRow(item, cfg, p);
            });
            html += '</ul>';
            if (group.collapsible) html += '</details>';
        });
        root.innerHTML = html;
        bindTaskPanelEvents();
        updateTaskSummaries();
    }

    function renderTaskRow(item, cfg, p) {
        var id = item.id;
        var chk = '';
        var body = '';
        var actions = '';

        if (item.kind === 'priority') {
            var on = !!p.tasks.taskPriority;
            return '<li class="cfg-row task-priority-row">' +
                '<input class="chk" type="checkbox" data-task-id="' + id + '" data-task-kind="priority"' + (on ? ' checked' : '') + '>' +
                '<div class="body"><div class="title">' + item.label +
                (item.desc ? ' <span class="sub">【' + item.desc + '】</span>' : '') +
                '</div></div></li>';
        }

        var enabled = !!cfg.enabled;
        chk = '<input class="chk" type="checkbox" data-task-id="' + id + '" data-task-kind="' + item.kind + '"' + (enabled ? ' checked' : '') + '>';

        var title = tagHtml(item.tag) + item.label;
        if (item.kind === 'number') {
            var field = item.field || 'value';
            var val = cfg[field] != null ? cfg[field] : (item.default || 0);
            body = '<div class="body"><div class="title">' + title +
                ' <input class="task-inline-num" type="number" data-task-id="' + id + '" data-task-field="' + field + '"' +
                ' min="' + (item.min != null ? item.min : 0) + '" max="' + (item.max != null ? item.max : 9999) + '" value="' + val + '">' +
                (item.suffix ? ' <span class="sub">' + item.suffix + '</span>' : '') +
                '</div></div>';
        } else if (item.kind === 'picker') {
            var sum = pickerSummary(item, cfg);
            var suffix = item.suffix ? ' <span class="sub">' + item.suffix + '</span>' : '';
            body = '<div class="body"><div class="title">' + title + suffix +
                '</div><div class="sub"><span class="linkish task-picker-link" data-task-id="' + id + '">' + sum + '</span></div></div>';
            actions = '<div class="actions"><button class="secondary" type="button" data-task-pick="' + id + '">选择</button></div>';
        } else {
            body = '<div class="body"><div class="title">' + title + '</div></div>';
        }
        return '<li class="cfg-row" data-task-row="' + id + '">' + chk + body + actions + '</li>';
    }

    function bindTaskPanelEvents() {
        var root = $id('taskPanelRoot');
        if (!root) return;
        root.querySelectorAll('input.chk[data-task-id]').forEach(function (el) {
            el.onchange = function () {
                var p = readEditor() || getActive();
                if (!p) return;
                var tid = el.getAttribute('data-task-id');
                var kind = el.getAttribute('data-task-kind');
                if (kind === 'priority') {
                    p.tasks.taskPriority = el.checked;
                } else {
                    getItemCfg(p, tid).enabled = el.checked;
                }
                scheduleAutoSave();
                updateTaskSummaries();
            };
        });
        root.querySelectorAll('.task-inline-num').forEach(function (el) {
            el.onchange = el.oninput = function () {
                var p = readEditor() || getActive();
                if (!p) return;
                var tid = el.getAttribute('data-task-id');
                var field = el.getAttribute('data-task-field');
                getItemCfg(p, tid)[field] = parseInt(el.value, 10) || 0;
                scheduleAutoSave();
            };
        });
        root.querySelectorAll('[data-task-pick], .task-picker-link').forEach(function (el) {
            el.onclick = function (e) {
                e.preventDefault();
                openTaskPicker(el.getAttribute('data-task-pick') || el.getAttribute('data-task-id'));
            };
        });
        root.querySelectorAll('details.task-group').forEach(function (el) {
            el.ontoggle = function () {
                var p = readEditor() || getActive();
                if (!p) return;
                var gid = el.getAttribute('data-group');
                if (gid) {
                    p.tasks.groupOpen[gid] = el.open;
                    scheduleAutoSave();
                }
            };
        });
    }

    function updateTaskSummaries() {
        var el = $id('taskSumMeta');
        if (!el) return;
        var p = getActive();
        if (!p) { el.textContent = ''; return; }
        ensureTasks(p);
        var n = 0;
        var total = 0;
        (catalog.groups || []).forEach(function (g) {
            (g.items || []).forEach(function (it) {
                if (it.kind === 'priority') return;
                total++;
                var c = getItemCfg(p, it.id);
                if (c.enabled) n++;
            });
        });
        var pri = p.tasks.taskPriority ? '优先开 · ' : '';
        el.textContent = pri + (n ? ('已启用 ' + n + '/' + total) : '未启用');
    }

    function openTaskPicker(taskId) {
        var def = getItemDef(taskId);
        if (!def || !def.picker) return;
        var p = getActive();
        var cfg = getItemCfg(p, taskId);
        pickerTaskId = taskId;
        pickerDraft = (cfg.picked || (cfg.mode ? [cfg.mode] : [])).slice();
        var pk = catalog.pickers[def.picker];
        $id('taskModalTitle').textContent = (pk && pk.title) || def.label;
        var listEl = $id('modalTaskList');
        if (listEl) listEl.innerHTML = '<div class="hint" style="padding:12px;">正在从游戏同步列表…</div>';
        $id('taskModal').classList.add('show');
        refreshCatalogFromGame().then(function () {
            pk = catalog.pickers[def.picker];
            if (!pk) {
                if (listEl) listEl.innerHTML = '<div class="hint" style="padding:12px;">配置项不存在</div>';
                return;
            }
            renderTaskPickerList(pk);
        });
    }

    function refreshPickerFromGame() {
        if (!pickerTaskId) return;
        var def = getItemDef(pickerTaskId);
        if (!def || !def.picker) return;
        var listEl = $id('modalTaskList');
        if (listEl) listEl.innerHTML = '<div class="hint" style="padding:12px;">正在刷新…</div>';
        refreshCatalogFromGame().then(function () {
            var pk = catalog.pickers[def.picker];
            if (pk) renderTaskPickerList(pk);
        });
    }

    function renderTaskPickerList(pk) {
        var listEl = $id('modalTaskList');
        var tagsEl = $id('modalTaskTags');
        if (!listEl) return;
        var multi = !!pk.multi;
        var sel = {};
        pickerDraft.forEach(function (id) { sel[id] = 1; });
        if (tagsEl) {
            tagsEl.innerHTML = pickerDraft.map(function (id) {
                var lab = id;
                (pk.options || []).forEach(function (o) { if (o.id === id) lab = o.label; });
                return '<span class="ms-tag">' + lab +
                    '<button type="button" onclick="TaskModule.togglePickerOption(\'' + id + '\',false)">×</button></span>';
            }).join('');
        }
        if (!(pk.options && pk.options.length)) {
            listEl.innerHTML = '<div class="hint" style="padding:12px;">' +
                '暂无BOSS列表。请先<strong>登录并进入游戏角色</strong>，再点下方「刷新」重试。' +
                '</div>';
            return;
        }
        listEl.innerHTML = pk.options.map(function (o) {
            var checked = sel[o.id] ? ' checked' : '';
            return '<label class="ms-opt"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="taskPick"' +
                checked + ' onchange="TaskModule.togglePickerOption(\'' + o.id + '\',' + (multi ? 'null' : 'true') + ')">' +
                '<span>' + o.label + '</span></label>';
        }).join('');
    }

    function togglePickerOption(id, single) {
        var def = getItemDef(pickerTaskId);
        var pk = def && catalog.pickers[def.picker];
        if (!pk) return;
        if (single) {
            pickerDraft = [id];
        } else {
            var forceOn = single === false ? false : undefined;
            var idx = pickerDraft.indexOf(id);
            if (forceOn === false || idx >= 0) {
                if (idx >= 0) pickerDraft.splice(idx, 1);
            } else {
                if (pk.multi) pickerDraft.push(id);
                else pickerDraft = [id];
            }
        }
        renderTaskPickerList(pk);
    }

    function confirmTaskPicker() {
        var p = readEditor() || getActive();
        if (!p || !pickerTaskId) return closeTaskModal();
        var cfg = getItemCfg(p, pickerTaskId);
        var def = getItemDef(pickerTaskId);
        cfg.picked = pickerDraft.slice();
        if (def && def.picker === 'double_reward' && pickerDraft.length) {
            cfg.mode = pickerDraft[0];
        }
        scheduleAutoSave();
        closeTaskModal();
        renderTaskPanel();
    }

    function closeTaskModal() {
        var m = $id('taskModal');
        if (m) m.classList.remove('show');
        pickerTaskId = '';
        pickerDraft = [];
    }

    function fillFromProfile(p) {
        ensureTasks(p);
        renderTaskPanel();
    }

    function readFromEditor(p) {
        ensureTasks(p);
        return p.tasks;
    }

    function mergeProfileDefaults(p) {
        return ensureTasks(p);
    }

    function rebuildQueue(p) {
        var q = [];
        var wolongGate = wolongHourOk(p);
        (catalog.groups || []).forEach(function (g) {
            (g.items || []).forEach(function (it) {
                if (it.kind === 'priority' || !it.handler) return;
                if (it.meta && it.meta.mergedInto) return;
                if (it.handler === 'wolong_invader') return;
                var cfg = getItemCfg(p, it.id);
                if (!cfg.enabled) return;
                if (it.handler.indexOf('wolong_') === 0 && it.handler !== 'wolong_schedule' && !wolongGate) return;
                q.push({ def: it, cfg: cfg });
            });
        });
        return q;
    }

    function isTaskPriority(p) {
        p = p || getActive();
        return !!(p && p.tasks && p.tasks.taskPriority);
    }

    function hasPendingTasks(p) {
        p = p || getActive();
        if (!p) return false;
        var q = rebuildQueue(p);
        for (var i = 0; i < q.length; i++) {
            var id = q[i].def.id;
            if (!runner.sessionDone[id]) return true;
        }
        return false;
    }

    function isTaskEnabled(id, p) {
        p = p || getActive();
        if (!p || !id) return false;
        return !!(getItemCfg(p, id).enabled);
    }

    function shouldRunBeforeBoss(p) {
        // 勾选「任务优先」且队列未完成：优先于 Boss/挂机（活动优先级更高，可打断任务）
        return isTaskPriority(p) && hasPendingTasks(p);
    }

    function yieldForActivity(reason) {
        if (runner.state === 'idle' || runner.state === 'done') return;
        // 保留 sessionDone，活动结束后可从剩余队列继续
        runner.current = null;
        runner.pendingCmd = false;
        runner.waitUntil = 0;
        runner.subStep = 0;
        runner.state = runner.index < runner.queue.length ? 'pending' : 'done';
        log('任务让出：活动优先' + (reason ? ' ·' + reason : ''));
    }

    /** 日切打断：放弃当前项但不写入 sessionDone，便于当日重跑 */
    function abortCurrent(reason) {
        if (runner.current) {
            log('[任务] 中断：' + runner.current.def.label + (reason ? ' ·' + reason : ''), 'warn');
        }
        runner.current = null;
        runner.pendingCmd = false;
        runner.waitUntil = 0;
        runner.subStep = 0;
        runner.state = 'idle';
    }

    /**
     * 日切重置内部记录器。
     * opts.abortCurrent：同时清掉进行中任务状态（日切硬切时用）
     */
    function onDayReset(opts) {
        opts = opts || {};
        runner.sessionDone = {};
        runner.dailyDone = {};
        runner.failCount = {};
        if (opts.abortCurrent) {
            runner.taskState = {};
            runner.current = null;
            runner.pendingCmd = false;
            runner.waitUntil = 0;
            runner.subStep = 0;
            runner.index = 0;
            runner.queue = [];
            runner.state = 'idle';
            runner.startedAt = 0;
            runner.lastResult = null;
        }
    }

    function getRunnerState() {
        return runner.state;
    }

    function resetRunner() {
        runner.queue = [];
        runner.index = 0;
        runner.current = null;
        runner.state = 'idle';
        runner.startedAt = 0;
        runner.pendingCmd = false;
        runner.waitUntil = 0;
        runner.subStep = 0;
        runner.lastResult = null;
        runner.taskState = {};
        runner.failCount = {};
        runner.sessionDone = {};
        runner.dailyDone = {};
    }

    function startRunner(p) {
        p = p || getActive();
        if (!p) return;
        runner.queue = rebuildQueue(p);
        runner.index = 0;
        runner.current = null;
        runner.state = runner.queue.length ? 'pending' : 'done';
        runner.subStep = 0;
        runner.taskState = {};
        runner.failCount = {};
        runner.sessionDone = {};
        log('任务队列：' + runner.queue.length + ' 项' + (isTaskPriority(p) ? '（任务优先）' : ''));
    }

    function currentTaskEntry() {
        if (runner.current) return runner.current;
        if (runner.index >= runner.queue.length) return null;
        return runner.queue[runner.index];
    }

    function finishCurrentTask(reason) {
        var entry = runner.current;
        if (entry) {
            runner.sessionDone[entry.def.id] = true;
            log('[任务] 完成：' + tagHtml(entry.def.tag) + entry.def.label + (reason ? ' · ' + reason : ''));
        }
        runner.current = null;
        runner.state = 'pending';
        runner.pendingCmd = false;
        runner.waitUntil = 0;
        runner.subStep = 0;
        var key = taskStateKey(entry);
        if (key) delete runner.taskState[key];
        runner.index++;
        if (runner.index >= runner.queue.length) {
            runner.state = 'done';
            log('[任务] 本轮队列已全部完成');
            var p = getActive();
            if (api.returnToFarmMap && p) returnToFarmMap(p, '任务队列完成');
            else setPhase('GOING_FARM');
        } else {
            setTimeout(function () { beginNextTask(); }, 400);
        }
    }

    function skipCurrentTask(reason) {
        log('[任务] 跳过：' + (runner.current ? runner.current.def.label : '?') + (reason ? ' · ' + reason : ''), 'warn');
        finishCurrentTask(reason || '跳过');
    }

    function beginNextTask() {
        if (runner.state === 'done') return false;
        if (runner.current) return true;
        var entry = runner.queue[runner.index];
        if (!entry) {
            runner.state = 'done';
            return false;
        }
        if (runner.sessionDone[entry.def.id]) {
            runner.index++;
            return beginNextTask();
        }
        runner.current = entry;
        runner.state = 'running';
        runner.startedAt = Date.now();
        runner.subStep = 0;
        runner.pendingCmd = false;
        var key = taskStateKey(entry);
        if (!runner.taskState[key]) runner.taskState[key] = {};
        setPhase('GOING_TASK');
        setStatus('云游平台：任务 → ' + entry.def.label, 'running');
        log('[任务] 开始：' + tagHtml(entry.def.tag) + entry.def.label);
        sendCmd('runTask', buildTaskPayload(entry));
        runner.pendingCmd = true;
        runner.waitUntil = Date.now() + 8000;
        return true;
    }

    function onTaskCmdResult(payload) {
        flushTaskLogs(payload);
        runner.pendingCmd = false;
        runner.lastResult = payload || {};
        var key = runner.current ? taskStateKey(runner.current) : '';
        if (key && payload && payload.state) runner.taskState[key] = payload.state;
        if (!payload || !payload.success) {
            if (key) {
                runner.failCount[key] = (runner.failCount[key] || 0) + 1;
                if (runner.failCount[key] >= 3) {
                    skipCurrentTask((payload && payload.reason) || '连续失败');
                    return;
                }
            }
            skipCurrentTask((payload && payload.reason) || '执行失败');
            return;
        }
        if (applyTaskResult(payload)) return;
        if (payload.done) {
            finishCurrentTask(payload.reason || '完成');
            return;
        }
        runner.state = 'doing';
        setPhase('DOING_TASK');
        runner.waitUntil = Date.now() + (payload.waitMs || 4000);
        if (payload.statusText) setStatus('云游平台：' + payload.statusText, 'running');
    }

    function onRuntime(d, p) {
        if (!isSchedulerActive()) return false;
        if (getPhase() !== 'GOING_TASK' && getPhase() !== 'DOING_TASK') {
            if (runner.state === 'idle' || runner.state === 'done') return false;
        }
        p = p || readEditor();
        if (!p) return false;

        var now = Date.now();

        if (getPhase() === 'GOING_TASK' && runner.pendingCmd && now > runner.waitUntil) {
            onTaskCmdResult({ success: false, reason: '任务启动超时' });
            return true;
        }

        if (getPhase() === 'DOING_TASK' || getPhase() === 'GOING_TASK') {
            if (!runner.pendingCmd && runner.current) {
                sendCmd('getTaskStatus', buildTaskPayload(runner.current));
                runner.pendingCmd = true;
                runner.waitUntil = now + 5000;
            } else if (runner.pendingCmd && now > runner.waitUntil) {
                runner.pendingCmd = false;
                skipCurrentTask('状态轮询超时');
            }
            return true;
        }

        // 仅「任务优先」时推进待办队列
        if (runner.state === 'pending' && isTaskPriority(p)) {
            beginNextTask();
            return true;
        }

        if (runner.state === 'done') return false;

        return false;
    }

    function onRuntimeFarmGate(d, p) {
        p = p || readEditor();
        if (!p || !isTaskPriority(p)) return false;
        if (runner.state === 'idle') {
            startRunner(p);
        }
        // 相位与 runner 失步：任务仍在做，但调度已回挂机 → 拉回 DOING_TASK 继续 poll
        if (runner.current && (runner.state === 'doing' || runner.state === 'running') &&
            (getPhase() === 'FARMING' || getPhase() === 'GOING_FARM')) {
            setPhase(runner.state === 'running' ? 'GOING_TASK' : 'DOING_TASK');
            setStatus('云游平台：恢复任务 → ' + (runner.current.def.label || ''), 'running');
            log('[任务] 从挂机相位恢复：' + (runner.current.def.label || ''), 'warn');
            return true;
        }
        if (runner.state !== 'done' && runner.index < runner.queue.length) {
            if (getPhase() === 'FARMING' || getPhase() === 'GOING_FARM') {
                beginNextTask();
                return true;
            }
        }
        return getPhase() === 'GOING_TASK' || getPhase() === 'DOING_TASK';
    }

    function loadCatalog(url) {
        return fetch(url || 'task-catalog.json').then(function (r) { return r.json(); }).then(function (data) {
            catalog = data || catalog;
            renderTaskPanel();
            log('任务目录已加载');
            return refreshCatalogFromGame();
        }).catch(function () {
            log('task-catalog.json 加载失败', 'warn');
        });
    }

    function init(hooks) {
        api = hooks || {};
        global.TaskModule = {
            init: init,
            defaultTasks: defaultTasks,
            ensureTasks: ensureTasks,
            mergeProfileDefaults: mergeProfileDefaults,
            renderTaskPanel: renderTaskPanel,
            fillFromProfile: fillFromProfile,
            readFromEditor: readFromEditor,
            updateTaskSummaries: updateTaskSummaries,
            openTaskPicker: openTaskPicker,
            refreshPickerFromGame: refreshPickerFromGame,
            closeTaskModal: closeTaskModal,
            confirmTaskPicker: confirmTaskPicker,
            togglePickerOption: togglePickerOption,
            loadCatalog: loadCatalog,
            refreshCatalogFromGame: refreshCatalogFromGame,
            mergeDynamicCatalog: mergeDynamicCatalog,
            resetRunner: resetRunner,
            onDayReset: onDayReset,
            abortCurrent: abortCurrent,
            getRunnerState: getRunnerState,
            serverTodayKey: serverTodayKey,
            todayKey: todayKey,
            yieldForActivity: yieldForActivity,
            startRunner: startRunner,
            shouldRunBeforeBoss: shouldRunBeforeBoss,
            isTaskPriority: isTaskPriority,
            hasPendingTasks: hasPendingTasks,
            isTaskEnabled: isTaskEnabled,
            onTaskCmdResult: onTaskCmdResult,
            onRuntime: onRuntime,
            onRuntimeFarmGate: onRuntimeFarmGate,
            beginNextTask: beginNextTask,
            getCatalog: function () { return catalog; }
        };
    }

    init({});
})(typeof window !== 'undefined' ? window : this);
