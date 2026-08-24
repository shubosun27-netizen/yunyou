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
