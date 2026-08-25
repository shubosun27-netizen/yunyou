var fs = require('fs');
var h = fs.readFileSync('d:/Project/yuanshichuanqi/html/task-handlers.js', 'utf8');
function findDef(n) {
    var re = new RegExp('function\\s+' + n + '\\s*\\(');
    var m = re.exec(h);
    return m ? m.index : -1;
}
[
    'taskProgressSig', 'requestTaskType', 'nudgeTaskGo', 'tryAcceptOrClaim',
    'ensureAutoFightOn', 'taskLog', 'taskModel', 'taskLabel',
    'getChuMoTask', 'getBossTaskList', 'pickEliteTask'
].forEach(function (n) {
    console.log(n, findDef(n));
});
var re = /function\s+(\w+)\s*\(/g, m, names = [];
while ((m = re.exec(h))) names.push(m[1]);
names.filter(function (n) {
    return /^(try|nudge|request|ensure|task|getChu|getBoss|pick|main)/i.test(n);
}).forEach(function (n) { console.log('FN', n); });
