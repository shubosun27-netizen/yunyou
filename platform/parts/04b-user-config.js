    /* 挂机方案：云端为准，本地仅作账号缓存（登录拉取 → 改完写回云端） */
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
        hasProfiles: function (blob) {
            return !!(blob && Array.isArray(blob.profiles) && blob.profiles.length);
        },
        setAuth: function (sessionId, account) {
            this.sessionId = sessionId || '';
            this.account = (account || '').trim();
            // 云端读写按账号即可，不依赖会话是否仍有效
            this.remoteEnabled = !!this.account;
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
        /** 仅读当前账号缓存；不串用其他账号 / 无账号 legacy，避免与云端混淆 */
        loadFromCache: function (account) {
            account = (account || this.account || '').trim();
            if (!account) return null;
            try {
                var raw = localStorage.getItem(this.cacheKey(account));
                if (!raw) return null;
                var parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.profiles)) return parsed;
            } catch (e) {}
            return null;
        },
        /** 仅首次迁云：读旧版无账号 key（不会在日常加载路径使用） */
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
                        status: res.status
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
            // 有 session 则带上；无效时服务端会按 account 拉
            return self.fetchRemoteConfig({ sessionId: self.sessionId });
        },
        pushRemote: function (blob) {
            var self = this;
            if (!self.account) {
                return Promise.resolve({ ok: false, error: '未登录' });
            }
            var body = {
                session_id: self.sessionId || '',
                account: self.account,
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
            self.setSyncHint('syncing');
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
                tip.textContent = '已保存到云端';
                tip.style.color = '#16a34a';
            } else if (mode === 'local') {
                tip.textContent = '已缓存在本地（未登录，无法写云端）';
                tip.style.color = '#ca8a04';
            } else if (mode === 'error') {
                tip.textContent = '已缓存本地 · 云端同步失败';
                tip.style.color = '#dc2626';
            } else if (mode === 'syncing') {
                tip.textContent = '正在同步到云端…';
                tip.style.color = '#2563eb';
            } else if (mode === 'offline') {
                tip.textContent = '使用本地缓存（云端不可用）';
                tip.style.color = '#ca8a04';
            } else {
                tip.textContent = '更改后自动保存到云端';
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
        /**
         * 登录后：云端有方案 → 一律以云端为准写回本地缓存；
         * 云端空 → 把本账号缓存（或一次性 legacy）迁上去；
         * 拉取失败 → 仅用本账号缓存兜底，不与云端竞胜。
         */
        syncAfterLogin: function (sessionId, account) {
            var self = this;
            self.setAuth(sessionId, account);
            if (!self.account) {
                return Promise.resolve({ ok: false, error: '缺少账号' });
            }
            self.syncing = true;
            self.setSyncHint('syncing');
            var localCached = self.loadFromCache(self.account);
            return self.pullRemote().then(function (res) {
                if (!res.ok) {
                    self.syncing = false;
                    self.lastSyncError = res.error || '';
                    if (localCached && self.applyBlobToMemory(localCached)) {
                        self.setSyncHint('offline');
                        return { ok: true, source: 'cache', error: res.error };
                    }
                    self.bootstrap(self.account);
                    self.setSyncHint('offline');
                    return { ok: false, error: res.error, source: 'cache' };
                }

                var remote = res.config;
                // 云端有方案：覆盖本地缓存（云端为准）
                if (self.hasProfiles(remote)) {
                    self.applyBlobToMemory(remote);
                    self.writeCache(remote);
                    self.syncing = false;
                    self.setSyncHint('cloud');
                    if (typeof log === 'function') {
                        log('已从云端加载配置: ' + self.account + ' · ' + profiles.length + ' 个方案');
                    }
                    return { ok: true, source: 'remote' };
                }

                // 云端空：优先迁本账号缓存；否则一次性迁 legacy；再否则建默认并上传
                var migrateSrc = localCached;
                if (!self.hasProfiles(migrateSrc)) {
                    migrateSrc = self.loadLegacy();
                }
                if (self.hasProfiles(migrateSrc)) {
                    self.applyBlobToMemory(migrateSrc);
                    self.ensureUniqueNames(profiles);
                    var blob = self.buildBlob(profiles, activeId);
                    self.writeCache(blob);
                    return self.pushRemote(blob).then(function (up) {
                        self.syncing = false;
                        if (up.ok) {
                            try { localStorage.setItem(self._migratedFlagKey(self.account), '1'); } catch (e) {}
                            self.setSyncHint('cloud');
                            return { ok: true, source: 'migrated' };
                        }
                        self.setSyncHint('error');
                        return { ok: true, source: 'cache', error: up.error };
                    });
                }

                var d = defaultProfile();
                d.name = '盟重挂机示例';
                profiles = [d];
                activeId = d.id;
                var fresh = self.buildBlob(profiles, activeId);
                self.writeCache(fresh);
                return self.pushRemote(fresh).then(function (up) {
                    self.syncing = false;
                    self.setSyncHint(up.ok ? 'cloud' : 'error');
                    return { ok: true, source: up.ok ? 'default' : 'default_local', error: up.error };
                });
            }).catch(function (e) {
                self.syncing = false;
                self.lastSyncError = String(e);
                if (localCached && self.applyBlobToMemory(localCached)) {
                    self.setSyncHint('offline');
                    return { ok: true, source: 'cache', error: String(e) };
                }
                self.bootstrap(self.account);
                self.setSyncHint('offline');
                return { ok: false, error: String(e), source: 'cache' };
            });
        },
        refreshEditorAfterSync: function () {
            if (typeof fillEditor === 'function') fillEditor(getActive());
            if (typeof renderProfileList === 'function') renderProfileList();
            if (typeof syncSchemeNameLabel === 'function') syncSchemeNameLabel();
        }
    };
