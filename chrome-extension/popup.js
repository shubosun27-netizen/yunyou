var detectEl = document.getElementById('detect-result');
var engineEl = document.getElementById('engine-info');

function sendMessage(msg) {
    return new Promise(function(resolve) {
        chrome.runtime.sendMessage(msg, resolve);
    });
}

function renderDetect(data) {
    if (!data) {
        detectEl.innerHTML = '<span class="err">无法读取页面状态</span>';
        return;
    }

    if (data.hasAuxBridge) {
        detectEl.innerHTML = '<span class="ok">Aux Demo 已注入</span>';
    } else {
        detectEl.innerHTML = '<span class="warn">未检测到 Aux Demo（可能还没注入或不是目标页面）</span>';
    }

    var items = [
        { key: 'MessageHandler', v: data.hasMessageHandler },
        { key: 'BossControl', v: data.hasBossControl },
        { key: 'Connection2', v: data.hasConnection2 }
    ];
    engineEl.innerHTML = items.map(function(it) {
        return '<span class="tag ' + (it.v ? 'tag-ok' : 'tag-no') + '">' +
            it.key + (it.v ? ' OK' : ' X') + '</span>';
    }).join(' ');
    engineEl.style.display = 'block';
}

document.getElementById('btn-detect').addEventListener('click', async function() {
    detectEl.innerHTML = '<span>检测中...</span>';
    var res = await sendMessage({ type: 'manualDetect' });
    if (res && res.ok) {
        renderDetect(res.data);
    } else {
        detectEl.innerHTML = '<span class="err">检测失败：' + (res && res.error || 'unknown') + '</span>';
    }
});

document.getElementById('btn-inject').addEventListener('click', async function() {
    detectEl.innerHTML = '<span>注入中...</span>';
    var res = await sendMessage({ type: 'manualInject' });
    if (res && res.ok) {
        detectEl.innerHTML = '<span class="ok">注入成功！刷新页面或点"检测"查看</span>';
    } else {
        detectEl.innerHTML = '<span class="err">注入失败：' + (res && res.error || 'unknown') + '</span>';
    }
});