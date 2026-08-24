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
        pullRemote: function () {
            var self = this;
            if (!self.remoteEnabled) {
                return Promise.resolve({ ok: false, error: '未登录' });
            }
            var url = AUTH_API + '/api/user-config?session_id=' +
                encodeURIComponent(self.sessionId) +
                '&platform=' + encodeURIComponent(PLATFORM_ID);
            return fetch(url).then(function (r) {
                return r.json().then(function (j) { return { httpOk: r.ok, j: j }; });
            }).then(function (res) {
                if (!res.j || !res.j.ok) {
                    return { ok: false, error: (res.j && res.j.error) || '拉取失败' };
                }
                return { ok: true, config: res.j.config || null };
            });
        },
        pushRemote: function (blob) {
            var self = this;
            if (!self.remoteEnabled) {
                return Promise.resolve({ ok: false, error: '未登录' });
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
                return r.json().then(function (j) { return { httpOk: r.ok, j: j }; });
            }).then(function (res) {
                if (!res.j || !res.j.ok) {
                    return { ok: false, error: (res.j && res.j.error) || '上传失败' };
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
                        self.setSyncHint('error');
                        if (typeof log === 'function') log('配置云同步失败: ' + self.lastSyncError);
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
            if (!self.remoteEnabled) {
                return Promise.resolve({ ok: false, error: '缺少会话或账号' });
            }
            self.syncing = true;
            self.setSyncHint('syncing');
            return self.pullRemote().then(function (res) {
                if (!res.ok) {
                    self.syncing = false;
                    self.setSyncHint('error');
                    self.lastSyncError = res.error || '';
                    // 拉取失败：仍用本地缓存
                    self.bootstrap(self.account);
                    return { ok: false, error: res.error, source: 'cache' };
                }
                if (res.config && Array.isArray(res.config.profiles) && res.config.profiles.length) {
                    self.applyBlobToMemory(res.config);
                    self.writeCache(res.config);
                    self.syncing = false;
                    self.setSyncHint('cloud');
                    if (typeof log === 'function') {
                        log('已从云端加载配置: ' + self.account + ' · ' + profiles.length + ' 个方案');
                    }
                    return { ok: true, source: 'remote' };
                }
                // 服务端无数据：尝试迁移本地 / legacy
                var local = self.loadFromCache(self.account) || self.loadLegacy();
                if (local && Array.isArray(local.profiles) && local.profiles.length) {
                    self.applyBlobToMemory(local);
                    self.ensureUniqueNames(profiles);
                    var blob = self.buildBlob(profiles, activeId);
                    return self.pushRemote(blob).then(function (up) {
                        self.syncing = false;
                        if (up.ok) {
                            try {
                                localStorage.setItem(self._migratedFlagKey(self.account), '1');
                            } catch (e) {}
                            self.setSyncHint('cloud');
                            if (typeof log === 'function') {
                                log('已上传本地配置到云端: ' + self.account);
                            }
                            return { ok: true, source: 'migrated' };
                        }
                        self.setSyncHint('error');
                        return { ok: false, error: up.error, source: 'local' };
                    });
                }
                // 都无：默认方案并上传
                var d = defaultProfile();
                d.name = '盟重挂机示例';
                profiles = [d];
                activeId = d.id;
                var fresh = self.buildBlob(profiles, activeId);
                return self.pushRemote(fresh).then(function (up) {
                    self.syncing = false;
                    self.setSyncHint(up.ok ? 'cloud' : 'error');
                    if (typeof log === 'function') log('已创建默认云端配置: ' + self.account);
                    return { ok: !!up.ok, source: 'default' };
                });
            }).catch(function (e) {
                self.syncing = false;
                self.lastSyncError = String(e);
                self.setSyncHint('error');
                self.bootstrap(self.account);
                return { ok: false, error: String(e), source: 'cache' };
            });
        },
        refreshEditorAfterSync: function () {
            if (typeof fillEditor === 'function') fillEditor(getActive());
            if (typeof renderProfileList === 'function') renderProfileList();
            if (typeof syncSchemeNameLabel === 'function') syncSchemeNameLabel();
        }
    };
