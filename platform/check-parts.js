/**
 * 校验 platform/parts 分片：花括号深度、孤立 }、合并后语法。
 * 用法: node platform/check-parts.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var os = require('os');

var partsDir = path.join(__dirname, 'parts');
var rootDir = path.dirname(__dirname);
var outFile = path.join(rootDir, 'platform-main.js');

function stripForBraceCount(line) {
    var s = line;
    // 去掉 // 注释
    var idx = s.indexOf('//');
    if (idx >= 0) s = s.slice(0, idx);
    // 粗略去掉字符串（不处理转义，够用于抓孤立 }）
    s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
    s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
    s = s.replace(/`(?:\\.|[^`\\])*`/g, '``');
    return s;
}

function braceDelta(line) {
    var s = stripForBraceCount(line);
    var open = 0;
    var close = 0;
    for (var i = 0; i < s.length; i++) {
        if (s[i] === '{') open++;
        else if (s[i] === '}') close++;
    }
    return open - close;
}

function listParts() {
    return fs.readdirSync(partsDir)
        .filter(function (f) { return f.endsWith('.js'); })
        .sort();
}

function mergeParts(parts) {
    var sb = '/**\n * @generated check merge\n */\n(function () {\n';
    parts.forEach(function (name) {
        sb += '\n    /* --- ' + name + ' --- */\n';
        sb += fs.readFileSync(path.join(partsDir, name), 'utf8');
    });
    sb += '\n})();\n';
    return sb;
}

function checkParts() {
    var parts = listParts();
    if (!parts.length) {
        console.error('check-parts: no files in platform/parts');
        process.exit(1);
    }

    var issues = [];
    var depth = 0;

    parts.forEach(function (name) {
        var lines = fs.readFileSync(path.join(partsDir, name), 'utf8').split(/\r?\n/);
        var firstIdx = -1;
        for (var f = 0; f < lines.length; f++) {
            if (lines[f].trim()) {
                firstIdx = f;
                break;
            }
        }
        if (firstIdx >= 0 && /^\s*}\s*;?\s*$/.test(lines[firstIdx])) {
            if (depth <= 0) {
                issues.push({
                    part: name,
                    line: firstIdx + 1,
                    msg: '以孤立的 } 开头且当前深度已为 0，属于多余闭合'
                });
            }
            // 连续多行仅 } 常见于错误截断
            var orphanRun = 0;
            for (var r = firstIdx; r < lines.length; r++) {
                if (!lines[r].trim()) continue;
                if (/^\s*}\s*;?\s*$/.test(lines[r])) orphanRun++;
                else break;
            }
            if (orphanRun >= 2) {
                issues.push({
                    part: name,
                    line: firstIdx + 1,
                    msg: '开头连续 ' + orphanRun + ' 个 }，疑似函数被截断到两个 part 之间'
                });
            }
        }

        for (var i = 0; i < lines.length; i++) {
            var delta = braceDelta(lines[i]);
            depth += delta;
            if (depth < 0) {
                issues.push({
                    part: name,
                    line: i + 1,
                    msg: '花括号深度变为 ' + depth + '（多余的 }）'
                });
                depth = 0;
            }
        }
    });

    if (depth !== 0) {
        issues.push({
            part: '(merge)',
            line: 0,
            msg: '全部分片合并后花括号未平衡，剩余深度 ' + depth
        });
    }

    return { parts: parts, issues: issues };
}

function syntaxCheck(source, label) {
    var tmp = path.join(os.tmpdir(), 'platform-main-check-' + process.pid + '.js');
    fs.writeFileSync(tmp, source, 'utf8');
    try {
        cp.execFileSync('node', ['--check', tmp], { stdio: 'pipe', encoding: 'utf8' });
        return null;
    } catch (e) {
        var err = (e.stderr || e.stdout || e.message || '').trim();
        return label + ': ' + err.split('\n')[0];
    } finally {
        try { fs.unlinkSync(tmp); } catch (ignore) {}
    }
}

function checkOnclickExports(parts) {
    var htmlPath = path.join(rootDir, 'layout-preview.html');
    if (!fs.existsSync(htmlPath)) return [];

    var html = fs.readFileSync(htmlPath, 'utf8');
    var merged = mergeParts(parts);
    // 排除 onclick="if(event..." 等内联语句，只匹配直接函数调用
    var onclickRe = /onclick="(?!if\s*\()([A-Za-z_$][\w$]*)\s*\(/g;
    var needed = {};
    var m;
    while ((m = onclickRe.exec(html)) !== null) {
        needed[m[1]] = true;
    }

    var warnings = [];
    Object.keys(needed).forEach(function (fn) {
        var patterns = [
            'window.' + fn + ' =',
            'window.' + fn + '=',
            'window["' + fn + '"]',
            "window['" + fn + "']"
        ];
        var found = patterns.some(function (p) { return merged.indexOf(p) >= 0; });
        if (!found) {
            warnings.push('layout-preview onclick 使用 ' + fn + '()，但 parts 中未找到 window.' + fn + ' 赋值');
        }
    });
    return warnings;
}

function main() {
    var result = checkParts();
    var failed = false;

    if (result.issues.length) {
        failed = true;
        console.error('check-parts: 分片结构问题:');
        result.issues.forEach(function (it) {
            console.error('  [' + it.part + ':' + it.line + '] ' + it.msg);
        });
    }

    var merged = mergeParts(result.parts);
    var synErr = syntaxCheck(merged, '合并语法');
    if (synErr) {
        failed = true;
        console.error('check-parts: ' + synErr);
    }

    if (fs.existsSync(outFile)) {
        var builtErr = syntaxCheck(fs.readFileSync(outFile, 'utf8'), 'platform-main.js');
        if (builtErr) {
            failed = true;
            console.error('check-parts: ' + builtErr);
            console.error('  → 若刚改过 parts，请先运行: powershell -File platform/build.ps1');
        }
    }

    var onclickWarnings = checkOnclickExports(result.parts);
    if (onclickWarnings.length) {
        console.warn('check-parts: onclick 导出警告:');
        onclickWarnings.forEach(function (w) { console.warn('  ' + w); });
    }

    if (failed) {
        process.exit(1);
    }

    console.log('check-parts: OK (' + result.parts.length + ' parts, syntax + brace balance)');
}

main();
