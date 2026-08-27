const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const state = {
  profile: { name: '小伙伴' },
  tasks: [
    { id: 't1', title: '整理本周学习笔记', duration: 45, period: '上午', status: 'todo', elapsed: 0 },
    { id: 't2', title: '完成产品原型草图', duration: 60, period: '下午', status: 'active', elapsed: 18 * 60, startedAt: Date.now() - 18 * 60 * 1000 },
    { id: 't3', title: '晚间散步和拉伸', duration: 30, period: '晚上', status: 'todo', elapsed: 0 }
  ],
  goal: { title: '完成陪伴任务 AI 的第一个版本', targetHours: 200, completedHours: 68, daysLeft: 127 },
  mood: '有一点忙，但也在慢慢变好',
  messages: [{ role: 'assistant', text: '早上好呀，今天也一起轻轻地往前走。你可以告诉我今天想完成什么，或直接说“哇布，开始原型草图”。' }]
};

function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } }); }); }
function findTask(idOrText) { return state.tasks.find(t => t.id === idOrText) || state.tasks.find(t => idOrText && t.title.includes(idOrText)); }
function elapsed(task) { return task.status === 'active' ? task.elapsed + Math.floor((Date.now() - task.startedAt) / 1000) : task.elapsed; }
function snapshot() { return { ...state, tasks: state.tasks.map(t => ({ ...t, elapsed: elapsed(t) })) }; }

function handleChat(text) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();
  let reply = '我听见啦。可以告诉我一个具体任务，或者说“开始”“暂停”“停止”加上任务名称。';
  let action = null;
  const query = lower.replace(/(开始|暂停|停止|完成|计时|专注|任务|一下|先|我|要|做)/g, '').trim();
  const task = state.tasks.find(t => clean.includes(t.title)) || state.tasks.find(t => lower.includes(t.title.toLowerCase())) || state.tasks.find(t => query && (t.title.toLowerCase().includes(query) || query.includes(t.title.toLowerCase().replace(/^(完成|整理|进行)/, ''))));
  if ((clean.includes('开始') || lower.includes('start')) && task) { startTask(task); action = 'start'; reply = `好呀，已经开始记录「${task.title}」啦。先专注一小会儿，不用想着一次做完。`; }
  else if ((clean.includes('暂停') || clean.includes('休息') || lower.includes('pause')) && task) { pauseTask(task); action = 'pause'; reply = `收到，已暂停「${task.title}」。去喝口水吧，回来时我们再继续。`; }
  else if ((clean.includes('停止') || clean.includes('完成') || lower.includes('stop')) && task) { stopTask(task, clean.includes('完成')); action = 'stop'; reply = clean.includes('完成') ? `太棒了，「${task.title}」已标记完成，今天的这一小步也值得被看见。` : `已停止「${task.title}」的计时，时间会被好好保存。`; }
  else {
    const names = clean.replace(/^(我今天要|今天要|我想|安排|帮我安排)/, '').split(/[，,、。和以及]/).map(x => x.trim()).filter(x => x.length > 1);
    if (names.length) {
      names.slice(0, 4).forEach((name, i) => state.tasks.push({ id: crypto.randomUUID(), title: name, duration: 25, period: i < 2 ? '今天' : '晚上', status: 'todo', elapsed: 0 }));
      action = 'create'; reply = `我先帮你放进今天的计划里啦，共 ${Math.min(names.length, 4)} 件。预计每件从 25 分钟开始，你可以随时调整。`;
    }
  }
  state.messages.push({ role: 'user', text: clean }, { role: 'assistant', text: reply });
  return { reply, action, state: snapshot() };
}
function startTask(t) { state.tasks.forEach(x => { if (x.status === 'active') pauseTask(x); }); t.status = 'active'; t.startedAt = Date.now(); }
function pauseTask(t) { t.elapsed = elapsed(t); t.status = 'paused'; delete t.startedAt; }
function stopTask(t, complete) { t.elapsed = elapsed(t); t.status = complete ? 'done' : 'paused'; delete t.startedAt; }

async function api(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, snapshot());
  if (req.method === 'POST' && pathname === '/api/profile') {
    const b = await body(req);
    const name = String(b.name || '').trim().slice(0, 20);
    if (!name) return json(res, 400, { error: 'Name is required' });
    state.profile.name = name;
    return json(res, 200, snapshot());
  }
  if (req.method === 'GET' && pathname === '/api/summary') {
    const tasks = snapshot().tasks;
    return json(res, 200, { planned: tasks.length, completed: tasks.filter(t => t.status === 'done').length, focusedSeconds: tasks.reduce((sum, t) => sum + t.elapsed, 0), interruptions: tasks.filter(t => t.status === 'paused').length, mood: state.mood, nextAdjustment: '为最难开始的任务预留一个 25 分钟专注块' });
  }
  if (req.method === 'GET' && pathname === '/api/goal/prediction') {
    const remaining = Math.max(0, state.goal.targetHours - state.goal.completedHours);
    const dailyAverage = 0.72;
    return json(res, 200, { ...state.goal, remainingHours: remaining, recentDailyAverageHours: dailyAverage, forecastDays: Math.ceil(remaining / dailyAverage), advice: '每周增加两个 90 分钟专注块，可以逐步回到计划线。' });
  }
  if (req.method === 'POST' && pathname === '/api/chat') { const b = await body(req); return json(res, 200, handleChat(b.text)); }
  const match = pathname.match(/^\/api\/tasks\/([^/]+)\/(start|pause|stop|complete)$/);
  if (req.method === 'POST' && match) {
    const t = findTask(match[1]); if (!t) return json(res, 404, { error: 'Task not found' });
    const action = match[2]; if (action === 'start') startTask(t); if (action === 'pause') pauseTask(t); if (action === 'stop') stopTask(t, false); if (action === 'complete') stopTask(t, true);
    return json(res, 200, snapshot());
  }
  if (req.method === 'POST' && pathname === '/api/tasks') { const b = await body(req); const t = { id: crypto.randomUUID(), title: b.title || '新任务', duration: Number(b.duration) || 25, period: b.period || '今天', status: 'todo', elapsed: 0 }; state.tasks.push(t); return json(res, 201, { task: t, state: snapshot() }); }
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try { if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname); } catch (e) { return json(res, 400, { error: e.message }); }
  const file = url.pathname === '/' ? path.join(root, 'frontend/index.html') : path.join(root, 'frontend', url.pathname);
  if (!file.startsWith(path.join(root, 'frontend'))) return json(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => { if (err) return json(res, 404, { error: 'Not found' }); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
});
server.listen(PORT, '127.0.0.1', () => console.log(`Waboo / 哇布 running at http://localhost:${PORT}`));
