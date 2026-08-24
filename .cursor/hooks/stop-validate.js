/**
 * Agent 一轮结束后再跑 validate；失败则 followup_message 让 agent 继续修。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..', '..');

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
    try {
        runValidate();
        process.exit(0);
    } catch (e) {
        var err = ((e.stdout || '') + (e.stderr || '') + (e.message || '')).trim();
        if (err.length > 4000) err = err.slice(-4000);
        console.log(JSON.stringify({
            followup_message: 'platform 自动校验失败（stop hook）。请修复 platform/parts 或相关 JS 语法错误，确保 `npm run validate` 通过后再结束。\n\n```\n' + err + '\n```'
        }));
        process.exit(0);
    }
}

main();
