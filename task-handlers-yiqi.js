/**
 * 一骑绝尘（GuessNum / activity 106）任务执行器
 * 策略：
 *  1) 提示进度满且有提示次数 → 用提示，按 isBigger 必赢
 *  2) 当前位置只能前进/后退（端点，或未访问点只剩单侧）→ 必选该方向
 *  3) 两侧都可能 → 按未访问点数量偏向，相等默认前进
 * 配置（tasks.items）：
 *  yiqi_juechen / yiqi_use_hint / yiqi_claim_fuli / yiqi_buy_item
 */
(function (global) {
    'use strict';

    var TH = global.TaskHandlers;
    if (!TH || !TH.helpers || !TH.registerHandlers) {
        console.warn('[task-handlers-yiqi] TaskHandlers 未就绪，跳过注册');
        return;
    }

    var ok = TH.helpers.ok;
    var fail = TH.helpers.fail;
    var skip = TH.helpers.skip;
    var stateOf = TH.helpers.stateOf;
    var taskLog = TH.helpers.taskLog;

    var ACT_ID = 106;
    var FULI_ID = 107;
    var PATH_LEN = 13;
    var MAX_ROUNDS = 36;
    var MAX_MS = 180000;

    function flag(allCfg, id, defaultVal) {
        if (!allCfg || !allCfg[id]) return !!defaultVal;
        return !!allCfg[id].enabled;
    }

    function model() {
        try {
            return net.GuesscardModel && net.GuesscardModel.ins ? net.GuesscardModel.ins() : null;
        } catch (e) {
            return null;
        }
    }

    function snapGuess() {
        var a = (global.gd && gd.activity) || {};
        return {
            state: Number(a.gn_zbstate) || 0,
            pos: Number(a.gn_dqkp) || 0,
            leftCount: Number(a.gn_sycsnum) || 0,
            tipLeft: Number(a.gn_sytsnum) || 0,
            tipScore: Number(a.gn_tsjd) || 0,
            tipUsed: Number(a.gn_usets) || 0,
            tipActive: !!a.gn_tscheck,
            tipDir: !!a.gn_tsnum,
            remainCards: a.gn_sypk != null ? Number(a.gn_sypk) : -1,
            winStreak: Number(a.gn_winStreakCount) || 0,
            itemPlayBought: Number(a.gndj_csnum) || 0,
            itemTipBought: Number(a.gndj_tsnum) || 0,
            moneyPlayBought: Number(a.gnyb_csnum) || 0,
            moneyTipBought: Number(a.gnyb_tsnum) || 0
        };
    }

    function tipNeedScore(tipUsed) {
        try {
            var arr = String((cm.global[60207] && cm.global[60207].value) || '2#3#4#5').split(/[#|]/);
            var n = arr[tipUsed] != null ? parseInt(arr[tipUsed], 10) : NaN;
            if (isNaN(n)) n = parseInt(arr[arr.length - 1], 10) || 9;
            return n;
        } catch (e) {
            return 2;
        }
    }

    function freePlayMax() {
        try { return parseInt(cm.global[60201].value, 10) || 3; } catch (e) { return 3; }
    }

    function freeTipMax() {
        try { return parseInt(cm.global[60204].value, 10) || 2; } catch (e) { return 2; }
    }

    function itemBuyLimit(kind) {
        // kind: play|tip → global 60202 / 60205 前缀次数
        try {
            var g = kind === 'tip' ? cm.global[60205] : cm.global[60202];
            var head = String(g && g.value || '3').split('&')[0];
            return parseInt(head, 10) || 0;
        } catch (e) {
            return 0;
        }
    }

    function activityReady() {
        try {
            if (!cm.activitys || !cm.activitys[ACT_ID]) return false;
            var cond = cm.activitys[ACT_ID].conditions || '90008&30002';
            if (global.Logic) {
                if (typeof Logic.checkConditionStr === 'function') return !!Logic.checkConditionStr(cond);
                if (typeof Logic.checkCondition === 'function') return !!Logic.checkCondition(cond);
                if (typeof Logic.isMeetCondition === 'function') return !!Logic.isMeetCondition(cond);
            }
            return true;
        } catch (e) {
            return true;
        }
    }

    function ensureVisited(st, pos) {
        if (!st.visited) st.visited = {};
        pos = Number(pos) || 0;
        if (pos >= 1 && pos <= PATH_LEN) st.visited[pos] = 1;
    }

    function resetVisited(st, pos) {
        st.visited = {};
        ensureVisited(st, pos);
        st.pathGen = (st.pathGen || 0) + 1;
    }

    function syncVisitedFromSnap(st, g) {
        if (!g.pos) return;
        if (st.lastRemainCards == null) {
            st.lastRemainCards = g.remainCards;
            ensureVisited(st, g.pos);
            return;
        }
        // 新路径：剩余点数突然回到高位（如 12）
        if (g.remainCards >= 12 && st.lastRemainCards < 12 && st.lastRemainCards >= 0) {
            resetVisited(st, g.pos);
        } else {
            ensureVisited(st, g.pos);
        }
        st.lastRemainCards = g.remainCards;
    }

    /**
     * @returns {{ dir: boolean, stable: boolean, reason: string }}
     * dir=true 前进，false 后退
     */
    function decideDir(pos, visited) {
        pos = Number(pos) || 0;
        visited = visited || {};
        var fwd = 0;
        var back = 0;
        var i;
        for (i = 1; i <= PATH_LEN; i++) {
            if (visited[i] || i === pos) continue;
            if (i > pos) fwd++;
            else if (i < pos) back++;
        }
        if (pos <= 1 || (fwd > 0 && back === 0)) {
            return { dir: true, stable: true, reason: pos <= 1 ? '起点只能前进' : '未访问点仅在前方' };
        }
        if (pos >= PATH_LEN || (back > 0 && fwd === 0)) {
            return { dir: false, stable: true, reason: pos >= PATH_LEN ? '终点只能后退' : '未访问点仅在后方' };
        }
        if (fwd > back) {
            return { dir: true, stable: false, reason: '偏向前进(' + fwd + '>' + back + ')' };
        }
        if (back > fwd) {
            return { dir: false, stable: false, reason: '偏向后退(' + back + '>' + fwd + ')' };
        }
        return { dir: true, stable: false, reason: '两侧相当，默认前进' };
    }

    function claimFuli(st) {
        var claimed = 0;
        try {
            var list = cm.activitygoals && cm.activitygoals[FULI_ID];
            if (!list || !list.length) return 0;
            if (!net.ActivityModel || !net.ActivityModel.ins) return 0;
            for (var i = 0; i < list.length; i++) {
                var g = list[i];
                if (!g) continue;
                var bean = gd.activity.getActivityBean(g.id, g.goal, g.type);
                if (bean && Number(bean.rewardState) === 1) {
                    net.ActivityModel.ins().send1(g.id, g.type, g.goal, 1);
                    claimed++;
                }
            }
        } catch (e) {}
        if (claimed) taskLog(st, '统御试炼领奖 ×' + claimed);
        return claimed;
    }

    function tryBuyPlayItem(st, g) {
        var lim = itemBuyLimit('play');
        if (g.itemPlayBought >= lim) return false;
        var m = model();
        if (!m) return false;
        m.send9(1, 1);
        taskLog(st, '道具购买驯养次数');
        return true;
    }

    function tryBuyTipItem(st, g) {
        var lim = itemBuyLimit('tip');
        if (g.itemTipBought >= lim) return false;
        var m = model();
        if (!m) return false;
        m.send9(2, 1);
        taskLog(st, '道具购买提示次数');
        return true;
    }

    function markGuessSent(st, dir, meta) {
        st.pendingGuess = true;
        st.pendingDir = !!dir;
        st.pendingMeta = meta || '';
        st.guessAt = Date.now();
        st.prevPos = snapGuess().pos;
        st.prevStreak = snapGuess().winStreak;
        st.prevRemain = snapGuess().remainCards;
    }

    function finishGuessObserve(st, g) {
        if (!st.pendingGuess) return false;
        var moved = g.pos !== st.prevPos || g.winStreak !== st.prevStreak || g.remainCards !== st.prevRemain ||
            g.state === 0;
        if (!moved && Date.now() - (st.guessAt || 0) < 2500) return false;
        ensureVisited(st, st.prevPos);
        ensureVisited(st, g.pos);
        var won = g.winStreak > (st.prevStreak || 0);
        if (g.state === 0 && (st.prevStreak || 0) > 0 && g.winStreak === 0) won = false;
        st.rounds = (st.rounds || 0) + 1;
        st.wins = (st.wins || 0) + (won ? 1 : 0);
        taskLog(st, (won ? '胜' : '负') + ' ·选' + (st.pendingDir ? '前进' : '后退') +
            (st.pendingMeta ? (' ·' + st.pendingMeta) : '') +
            ' ·pos ' + (st.prevPos || '?') + '→' + (g.pos || '?') +
            ' ·连胜' + g.winStreak + ' ·局' + st.rounds);
        st.pendingGuess = false;
        st.waitingHint = false;
        st.hintDir = null;
        return true;
    }

    function tick(p, isStart) {
        var st = stateOf(p);
        var allCfg = p.allCfg || {};
        var useHint = flag(allCfg, 'yiqi_use_hint', true);
        var doClaim = flag(allCfg, 'yiqi_claim_fuli', true);
        var buyItem = flag(allCfg, 'yiqi_buy_item', false);

        if (isStart && !st.boot) {
            st.boot = true;
            st.rounds = 0;
            st.wins = 0;
            st.visited = {};
            st.synced = false;
            st.syncAt = 0;
            st.waitingHint = false;
            st.pendingGuess = false;
            st.startedWall = Date.now();
            taskLog(st, '一骑绝尘开始 ·提示' + (useHint ? '开' : '关') +
                ' ·领奖' + (doClaim ? '开' : '关') +
                ' ·道具续' + (buyItem ? '开' : '关'));
        }

        if (!activityReady()) {
            return skip('一骑绝尘未开启（开服8天且2转）', st);
        }
        var m = model();
        if (!m) return fail('GuesscardModel 不可用', st);

        var now = Date.now();
        if (now - (st.startedWall || p.startedAt || now) > MAX_MS) {
            if (doClaim) claimFuli(st);
            return ok({
                done: true,
                reason: '一骑绝尘超时 ·胜' + (st.wins || 0) + '/' + (st.rounds || 0),
                state: st
            });
        }

        if (!st.synced || now - (st.syncAt || 0) > 8000) {
            try { m.send1(); } catch (e1) {}
            st.synced = true;
            st.syncAt = now;
            return ok({ done: false, waitMs: 600, statusText: '一骑绝尘同步状态', state: st });
        }

        var g = snapGuess();
        syncVisitedFromSnap(st, g);

        if (st.pendingGuess) {
            if (!finishGuessObserve(st, g)) {
                return ok({ done: false, waitMs: 500, statusText: '一骑绝尘等待结果', state: st });
            }
            st.synced = false;
            if (doClaim) claimFuli(st);
        }

        if ((st.rounds || 0) >= MAX_ROUNDS) {
            if (doClaim) claimFuli(st);
            return ok({
                done: true,
                reason: '一骑绝尘达上限 ·胜' + (st.wins || 0) + '/' + (st.rounds || 0),
                state: st
            });
        }

        // 未开局
        if (g.state === 0) {
            if (doClaim) claimFuli(st);
            if (g.leftCount > 0) {
                try { m.send10(); } catch (e2) {}
                st.synced = false;
                taskLog(st, '开始驯养 ·剩余次数' + g.leftCount);
                return ok({ done: false, waitMs: 800, statusText: '一骑绝尘开局', state: st });
            }
            if (buyItem && tryBuyPlayItem(st, g)) {
                st.synced = false;
                return ok({ done: false, waitMs: 900, statusText: '一骑绝尘购买次数', state: st });
            }
            return ok({
                done: true,
                reason: '一骑绝尘完成 ·胜' + (st.wins || 0) + '/' + (st.rounds || 0) +
                    (g.leftCount <= 0 ? ' ·次数用尽' : ''),
                state: st
            });
        }

        // 进行中 state==1
        if (st.waitingHint) {
            var tipArrived = false;
            if (st.hintLeftBefore != null && g.tipLeft < st.hintLeftBefore) tipArrived = true;
            if (st.hintUsedBefore != null && g.tipUsed > st.hintUsedBefore) tipArrived = true;
            if (tipArrived) {
                var tipDir = !!g.tipDir;
                st.waitingHint = false;
                st.hintDir = tipDir;
                try { m.send5(tipDir); } catch (e3) {}
                markGuessSent(st, tipDir, '提示必赢');
                st.synced = false;
                return ok({
                    done: false,
                    waitMs: 900,
                    statusText: '一骑绝尘提示→' + (tipDir ? '前进' : '后退'),
                    state: st
                });
            }
            if (now - (st.hintSentAt || 0) > 3000) {
                taskLog(st, '提示超时，改位置推测', 'warn');
                st.waitingHint = false;
            } else {
                return ok({ done: false, waitMs: 400, statusText: '一骑绝尘等待提示', state: st });
            }
        }

        var need = tipNeedScore(g.tipUsed);
        var canHint = useHint && g.tipScore >= need && g.tipLeft > 0;
        if (!canHint && useHint && g.tipScore >= need && g.tipLeft <= 0 && buyItem) {
            if (tryBuyTipItem(st, g)) {
                st.synced = false;
                return ok({ done: false, waitMs: 900, statusText: '一骑绝尘购买提示', state: st });
            }
        }
        if (canHint) {
            st.hintLeftBefore = g.tipLeft;
            st.hintUsedBefore = g.tipUsed;
            try { m.send7(); } catch (e4) {}
            st.waitingHint = true;
            st.hintSentAt = now;
            taskLog(st, '请求提示 ·进度' + g.tipScore + '/' + need + ' ·剩' + g.tipLeft);
            return ok({ done: false, waitMs: 500, statusText: '一骑绝尘用提示', state: st });
        }

        var decision = decideDir(g.pos, st.visited);
        try { m.send5(!!decision.dir); } catch (e6) {}
        markGuessSent(st, !!decision.dir, (decision.stable ? '稳:' : '测:') + decision.reason);
        st.synced = false;
        return ok({
            done: false,
            waitMs: 900,
            statusText: '一骑绝尘' + (decision.dir ? '前进' : '后退') +
                (decision.stable ? '·稳' : '·测') + ' @' + g.pos,
            state: st
        });
    }

    var handlers = {
        yiqi_juechen: {
            start: function (p) { return tick(p, true); },
            poll: function (p) { return tick(p, false); }
        },
        // merged 占位，避免未知 handler
        yiqi_use_hint: {
            start: function (p) { return skip('附属配置项', stateOf(p)); }
        },
        yiqi_claim_fuli: {
            start: function (p) { return skip('附属配置项', stateOf(p)); }
        },
        yiqi_buy_item: {
            start: function (p) { return skip('附属配置项', stateOf(p)); }
        }
    };

    TH.registerHandlers(handlers);
})(typeof window !== 'undefined' ? window : this);
