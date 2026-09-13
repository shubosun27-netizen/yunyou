var MATCH_PATTERN = /106u|yscq|原始传奇|chuanshi|4399\.com\/yscq|7k7k\.com\/games\/yscq/i;

chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
        id: 1001,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            responseHeaders: [
                { header: 'content-security-policy', operation: 'remove' },
                { header: 'content-security-policy-report-only', operation: 'remove' }
            ]
        },
        condition: {
            urlFilter: MATCH_PATTERN.source,
            resourceTypes: ['main_frame', 'xmlhttprequest', 'script']
        }
    }]
});

chrome.webNavigation.onCompleted.addListener(function(details) {
    if (details.frameId !== 0) return;
    if (!details.url || !MATCH_PATTERN.test(details.url)) return;

    console.log('[Aux Demo] 检测到目标页面，准备注入：', details.url);

    chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['aux-hook-demo.js'],
        world: 'MAIN'
    }).then(function() {
        console.log('[Aux Demo] 注入成功');
        chrome.action.setBadgeText({ text: 'OK', tabId: details.tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#27ae60', tabId: details.tabId });
    }).catch(function(err) {
        console.error('[Aux Demo] 注入失败：', err);
        chrome.action.setBadgeText({ text: 'ERR', tabId: details.tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: details.tabId });
    });
}, { url: [{ urlMatches: MATCH_PATTERN.source }] });

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'manualInject') {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs[0]) return sendResponse({ ok: false, error: 'no tab' });
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                files: ['aux-hook-demo.js'],
                world: 'MAIN'
            }).then(function() { sendResponse({ ok: true }); })
              .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
        });
        return true;
    }
    if (msg.type === 'manualDetect') {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs[0]) return sendResponse({ ok: false });
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                world: 'MAIN',
                func: function() {
                    return {
                        hasMessageHandler: typeof window.MessageHandler !== 'undefined',
                        hasBossControl: typeof window.BossControl !== 'undefined',
                        hasConnection2: typeof window.Connection2 !== 'undefined',
                        hasAuxBridge: typeof window.__auxDemo !== 'undefined',
                        url: location.href
                    };
                }
            }).then(function(results) { sendResponse({ ok: true, data: results[0] || {} }); })
              .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
        });
        return true;
    }
});