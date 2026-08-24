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
