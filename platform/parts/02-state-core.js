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
