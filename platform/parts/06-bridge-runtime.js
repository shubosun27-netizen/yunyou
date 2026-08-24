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
