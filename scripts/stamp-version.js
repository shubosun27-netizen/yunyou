/**
 * 版本戳管理：更新 version.json，给 HTML 中 script/link 加 ?v= 防缓存，写入 layout-preview 版本展示。
 *
 * 用法:
 *   node scripts/stamp-version.js              # 刷新 build 时间戳与 stamp（日常开发）
 *   node scripts/stamp-version.js --bump patch # 语义版本 patch/minor/major 递增（发布时）
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var root = path.join(__dirname, '..');
var versionPath = path.join(root, 'version.json');

var HTML_TARGETS = [
    {
        file: 'layout-preview.html',
        assets: [
            { tag: 'link', attr: 'href', file: 'layout-preview.css' },
            { tag: 'script', attr: 'src', file: 'tasks.js' },
            { tag: 'script', attr: 'src', file: 'activity-runtime.js' },
            { tag: 'script', attr: 'src', file: 'farm-tactics.js' },
            { tag: 'script', attr: 'src', file: 'pk-runtime.js' },
            { tag: 'script', attr: 'src', file: 'platform-main.js' }
        ],
        versionDisplay: true
    },
    {
        file: 'game.html',
        assets: [
            { tag: 'script', attr: 'src', file: 'task-handlers.js' },
            { tag: 'script', attr: 'src', file: 'task-handlers-wolong.js' }
        ],
        versionDisplay: false
    }
];

function pad(n) {
    return n < 10 ? '0' + n : String(n);
}

function formatBuildDate(d) {
    return (
        d.getFullYear() +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) +
        pad(d.getHours()) +
        pad(d.getMinutes()) +
        pad(d.getSeconds())
    );
}

function readJson(file) {
    if (!fs.existsSync(file)) {
        return { version: '0.1.0', build: '', git: '', stamp: '' };
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function getGitShortHash() {
    try {
        return cp.execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (e) {
        return '';
    }
}

function parseBumpArg(argv) {
    var idx = argv.indexOf('--bump');
    if (idx === -1) return null;
    var kind = (argv[idx + 1] || 'patch').toLowerCase();
    if (kind !== 'patch' && kind !== 'minor' && kind !== 'major') {
        console.error('Invalid --bump value: ' + kind + ' (use patch|minor|major)');
        process.exit(1);
    }
    return kind;
}

function bumpSemver(version, kind) {
    var m = String(version || '0.1.0').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return '0.1.0';
    var major = parseInt(m[1], 10);
    var minor = parseInt(m[2], 10);
    var patch = parseInt(m[3], 10);
    if (kind === 'major') {
        major += 1;
        minor = 0;
        patch = 0;
    } else if (kind === 'minor') {
        minor += 1;
        patch = 0;
    } else {
        patch += 1;
    }
    return major + '.' + minor + '.' + patch;
}

function stampAttrValue(html, tag, attr, file, stamp) {
    var re = new RegExp(
        '(<' + tag + '[^>]*\\s' + attr + '=")' +
        file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '(?:\\?v=[^"]*)?(")',
        'g'
    );
    if (!re.test(html)) {
        return { html: html, hit: false };
    }
    re.lastIndex = 0;
    return {
        html: html.replace(re, '$1' + file + '?v=' + stamp + '$2'),
        hit: true
    };
}

function updateVersionDisplay(html, label) {
    var spanRe = /(<span[^>]*\bid="appVersion"[^>]*>)[^<]*(<\/span>)/;
    if (spanRe.test(html)) {
        return html.replace(spanRe, '$1' + label + '$2');
    }
    return html;
}

function stampHtmlTarget(target, stamp, label) {
    var full = path.join(root, target.file);
    if (!fs.existsSync(full)) {
        console.warn('skip (missing): ' + target.file);
        return;
    }
    var html = fs.readFileSync(full, 'utf8');
    var missing = [];

    target.assets.forEach(function (asset) {
        var res = stampAttrValue(html, asset.tag, asset.attr, asset.file, stamp);
        html = res.html;
        if (!res.hit) missing.push(asset.file);
    });

    if (target.versionDisplay) {
        html = updateVersionDisplay(html, label);
    }

    fs.writeFileSync(full, html, 'utf8');

    if (missing.length) {
        console.warn('WARN ' + target.file + ': tag not found for ' + missing.join(', '));
    } else {
        console.log('OK   ' + target.file);
    }
}

function main() {
    var bump = parseBumpArg(process.argv.slice(2));
    var meta = readJson(versionPath);

    if (bump) {
        meta.version = bumpSemver(meta.version, bump);
        console.log('Bumped version -> ' + meta.version);
    }

    var now = new Date();
    meta.build = formatBuildDate(now);
    meta.stamp = meta.build;
    meta.git = getGitShortHash();

    writeJson(versionPath, meta);

    var label = 'v' + meta.version + ' · ' + meta.build;
    if (meta.git) label += ' · ' + meta.git;

    HTML_TARGETS.forEach(function (target) {
        stampHtmlTarget(target, meta.stamp, label);
    });

    console.log('Stamp ' + meta.stamp + ' (' + label + ')');
}

main();
