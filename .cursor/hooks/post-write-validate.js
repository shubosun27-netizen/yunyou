/**
 * Agent 编辑 platform/parts 后自动 build + 校验，结果注入 additional_context。
 * stdin: postToolUse JSON（含 tool_input.file_path 等）
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var os = require('os');

var ROOT = path.resolve(__dirname, '..', '..');
var STAMP = path.join(ROOT, '.cursor', '.validate-last-run');
var DEBOUNCE_MS = 4000;

function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch (e) {
        return '';
    }
}

function extractPath(input) {
    if (!input) return '';
    try {
        var j = JSON.parse(input);
        var ti = j.tool_input || j.arguments || j.input || j;
        if (typeof ti === 'string') {
            try { ti = JSON.parse(ti); } catch (e) {}
        }
        return ti.file_path || ti.path || ti.target_file || ti.filePath || '';
    } catch (e) {
        return '';
    }
}

function shouldValidate(filePath) {
    if (!filePath) return false;
    var norm = filePath.replace(/\\/g, '/');
    return /platform\/parts\//.test(norm) ||
        /platform\/build\.ps1$/.test(norm) ||
        /platform\/check-/.test(norm);
}

function debounced() {
    try {
        var last = parseInt(fs.readFileSync(STAMP, 'utf8'), 10) || 0;
        if (Date.now() - last < DEBOUNCE_MS) return true;
    } catch (e) {}
    return false;
}

function touchStamp() {
    try {
        fs.mkdirSync(path.dirname(STAMP), { recursive: true });
        fs.writeFileSync(STAMP, String(Date.now()));
    } catch (e) {}
}

function runValidate() {
    return cp.execSync('npm run validate', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
        shell: true
    });
}

function main() {
    var input = readStdin();
    var filePath = extractPath(input);

    if (!shouldValidate(filePath)) {
        process.exit(0);
    }

    if (debounced()) {
        console.log(JSON.stringify({
            additional_context: '[platform-auto-validate] 跳过（' + (DEBOUNCE_MS / 1000) + 's 内已校验过）: ' + filePath
        }));
        process.exit(0);
    }

    touchStamp();

    try {
        var out = runValidate();
        var tail = out.split('\n').filter(Boolean).slice(-6).join('\n');
        console.log(JSON.stringify({
            additional_context: '[platform-auto-validate] 已通过 npm run validate（因编辑 ' + path.basename(filePath) + '）\n' + tail
        }));
    } catch (e) {
        var err = ((e.stdout || '') + (e.stderr || '') + (e.message || '')).trim();
        if (err.length > 3500) err = err.slice(-3500);
        console.log(JSON.stringify({
            additional_context: '[platform-auto-validate] 失败 — 必须修复后再结束本轮。常见原因：part 之间截断函数、多余 }。\n\n' + err + '\n\n请修复 platform/parts 后无需用户手动跑 build，保存后会再次触发校验。'
        }));
    }
    process.exit(0);
}

main();
