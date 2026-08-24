/**
 * 校验 html 目录下主要 JS：分片 + 合并产物 + 并列模块。
 * 用法: node platform/check-all.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var root = path.join(__dirname, '..');

var FILES = [
    'platform-main.js',
    'tasks.js',
    'activity-runtime.js',
    'farm-tactics.js',
    'pk-runtime.js',
    'task-handlers.js',
    'task-handlers-wolong.js'
];

function check(file) {
    var full = path.join(root, file);
    if (!fs.existsSync(full)) {
        console.warn('skip (missing): ' + file);
        return true;
    }
    try {
        cp.execFileSync('node', ['--check', full], { stdio: 'pipe' });
        console.log('OK  ' + file);
        return true;
    } catch (e) {
        var err = (e.stderr || e.stdout || '').toString().trim();
        console.error('FAIL ' + file);
        console.error(err.split('\n').slice(0, 3).join('\n'));
        return false;
    }
}

var ok = true;
try {
    cp.execFileSync('node', [path.join(__dirname, 'check-parts.js')], {
        stdio: 'inherit',
        cwd: root
    });
} catch (e) {
    ok = false;
}

FILES.forEach(function (f) {
    if (!check(f)) ok = false;
});

process.exit(ok ? 0 : 1);
