import { Browser, sleep } from 'file:///C:/Users/llyyt/.config/opencode/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/llyyt/Desktop/DayFlow/promo/assets';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8765/index.html';
const FIXED = new Date('2026-10-30T13:30:00+08:00').getTime();
const mockDate = `(() => { const FIXED=${FIXED}; const R=Date; class D extends R { constructor(...a){ if(!a.length) super(FIXED); else super(...a); } static now(){ return FIXED; } } D.parse=R.parse; D.UTC=R.UTC; window.Date=D; })();`;

const events = [
  ['深度工作 · 版本方案', '2026-10-26', 9 * 60, 11 * 60, '工作', '2F 静音区', '关掉消息，只写方案'],
  ['午餐 · 园区食堂', '2026-10-26', 12 * 60, 12 * 60 + 45, '生活', '', ''],
  ['健身 · 有氧', '2026-10-26', 19 * 60 + 30, 20 * 60 + 30, '运动', '楼下健身房', ''],
  ['产品评审', '2026-10-27', 10 * 60, 11 * 60, '工作', '3F 会议室 A', '过一遍下个版本的范围'],
  ['用户访谈', '2026-10-27', 14 * 60, 15 * 60 + 30, '工作', '线上 · 腾讯会议', '3 位受访者'],
  ['阅读 · 《深度工作》', '2026-10-27', 20 * 60, 20 * 60 + 45, '学习', '', ''],
  ['晨间规划', '2026-10-28', 8 * 60 + 30, 9 * 60, '生活', '', '写下今天最重要的三件事', true],
  ['高等数学', '2026-10-28', 10 * 60, 11 * 60 + 30, '学习', '教学楼 B203', '第 3–4 节'],
  ['写方案 · 交互稿', '2026-10-28', 14 * 60, 16 * 60, '工作', '2F 静音区', ''],
  ['跑步 · 5 公里', '2026-10-28', 18 * 60 + 30, 19 * 60 + 10, '运动', '操场', ''],
  ['站会', '2026-10-29', 9 * 60 + 30, 10 * 60, '工作', '线上', '同步进度和风险'],
  ['和设计师对齐改稿', '2026-10-29', 11 * 60, 12 * 60, '工作', '4F 设计区', ''],
  ['英语 · 听力', '2026-10-29', 15 * 60, 16 * 60, '学习', '', ''],
  ['复盘 · 本周', '2026-10-29', 21 * 60, 21 * 60 + 30, '生活', '', ''],
  ['季度复盘', '2026-10-31', 10 * 60, 11 * 60 + 30, '工作', '', ''],
  ['爬山 · 白云山', '2026-10-31', 15 * 60, 17 * 60 + 30, '运动', '白云山南门', '带水和防晒'],
  ['家庭午餐', '2026-11-01', 11 * 60 + 30, 13 * 60, '生活', '', ''],
  ['周复盘 · 下周计划', '2026-11-01', 16 * 60, 17 * 60, '学习', '', ''],
  ['晨间规划', '2026-10-30', 8 * 60 + 30, 9 * 60, '生活', '', '写下今天最重要的三件事', true],
  ['产品周会', '2026-10-30', 10 * 60, 11 * 60, '工作', '3F 会议室 A', '同步本周进度与风险', true],
  ['午餐 · 楼下小馆', '2026-10-30', 11 * 60 + 30, 12 * 60 + 15, '生活', '园区东门', ''],
  ['需求评审', '2026-10-30', 14 * 60, 15 * 60 + 30, '工作', '线上 · 腾讯会议', '带上下个版本的交互稿'],
  ['和设计师对齐改稿', '2026-10-30', 16 * 60 + 30, 17 * 60 + 15, '工作', '4F 设计区', ''],
  ['健身 · 力量训练', '2026-10-30', 19 * 60, 20 * 60, '运动', '楼下健身房', ''],
  ['阅读 · 《深度工作》', '2026-10-30', 21 * 60 + 10, 21 * 60 + 50, '学习', '', '']
];
const evtJson = events.map(([title, date, start, end, category, location, note, done]) => ({
  id: 'evt_demo_' + date + '_' + start, title, date, start, end, category, location,
  note: note || '', done: !!done, reminder: 10, actualMinutes: 0, seriesId: null, source: 'sample', createdAt: FIXED
}));
const tasks = [
  { id: 'task_demo_1', title: '写周报', estimate: 120, priority: '高', due: '2026-10-31', category: '工作', note: '本周进展 + 下周计划', status: 'inbox', eventId: null, createdAt: FIXED },
  { id: 'task_demo_2', title: '整理下周计划', estimate: 60, priority: '中', due: '2026-11-01', category: '生活', note: '', status: 'inbox', eventId: null, createdAt: FIXED },
  { id: 'task_demo_3', title: '买牛奶', estimate: 15, priority: '低', due: null, category: '生活', note: '', status: 'inbox', eventId: null, createdAt: FIXED }
];
const ddls = [
  { id: 'ddl_demo_1', title: '提交实验报告', date: '2026-10-30', time: 17 * 60 + 30, note: '把数据和图补全', estimate: 90, done: false, source: 'manual', createdAt: FIXED },
  { id: 'ddl_demo_2', title: '高数作业', date: '2026-11-01', time: 23 * 60 + 59, note: '第 5 章习题', estimate: 120, done: false, source: 'manual', createdAt: FIXED }
];

const browser = await Browser.launch({ width: 1440, height: 900 });

async function newApp(width = 1440, height = 900, dsf = 2, mobile = false) {
  const p = await browser.newPage({ width, height, dsf, mobile });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: mockDate });
  await p.goto(BASE, { settleMs: 1400 });
  await p.eval(`(() => {
    localStorage.setItem('dayflow.seeded.v1', '1');
    localStorage.setItem('dayflow.events.v1', ${JSON.stringify(JSON.stringify(evtJson))});
    localStorage.setItem('dayflow.tasks.v1', ${JSON.stringify(JSON.stringify(tasks))});
    localStorage.setItem('dayflow.ddl.v1', ${JSON.stringify(JSON.stringify(ddls))});
    localStorage.removeItem('dayflow.chat.v1');
    localStorage.removeItem('dayflow.series.v1');
  })()`);
  await p.goto(BASE, { settleMs: 1600 });
  await sleep(500);
  return p;
}

async function rect(p, sel) {
  return await p.eval(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
}

let p = await newApp();
await p.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=7.6*64; document.getElementById('toast')?.remove(); })()`);
await sleep(400);
await p.screenshot({ path: OUT + '/day-cal.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });
console.log('DAYBLOCKS', await p.eval(`JSON.stringify([...document.querySelectorAll('.event-block')].map(e=>({t:e.textContent.slice(0,12),r:(()=>{const x=e.getBoundingClientRect();return [x.x,x.y,x.width,x.height]})()})))`));

// agent
await p.eval(`(() => {
  const input=document.getElementById('chatInput');
  input.value='明天上午9点产品评审1小时，在3楼会议室';
  input.dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('composer').requestSubmit();
})()`);
await sleep(2200);
await p.eval(`document.getElementById('toast')?.remove()`);
await sleep(200);
await p.screenshot({ path: OUT + '/app-agent.png', format: 'png' });
await p.screenshot({ path: OUT + '/agent-chat.png', format: 'png', clip: { x: 0, y: 90, width: 360, height: 810 } });

// week
await p.eval(`document.getElementById('viewWeek').click()`);
await sleep(1200);
await p.eval(`(() => { const sc=document.getElementById('weekGridScroll'); if(sc) sc.scrollTop=7.2*64; document.getElementById('toast')?.remove(); })()`);
await sleep(500);
await p.screenshot({ path: OUT + '/week-cal.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });
console.log('WEEKDDL', await p.eval(`JSON.stringify([...document.querySelectorAll('.week-ddl-chip')].map(e=>({t:e.textContent.slice(0,20),r:(()=>{const x=e.getBoundingClientRect();return [x.x,x.y,x.width,x.height]})()})))`));

// task dialog
await p.eval(`document.getElementById('tasksBtn').click()`);
await sleep(900);
let r = await rect(p, '#tasksDialog .dialog-card');
await p.screenshot({ path: OUT + '/task-card.png', format: 'png', clip: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } });
await p.eval(`document.querySelector('#tasksDialog')?.close()`);
await sleep(250);

// ddl
await p.eval(`document.getElementById('viewDay').click()`);
await sleep(500);
await p.eval(`document.getElementById('ddlBtn').click()`);
await sleep(900);
await p.eval(`document.activeElement?.blur()`);
await sleep(120);
r = await rect(p, '#ddlListDialog .dialog-card');
await p.screenshot({ path: OUT + '/ddl-card.png', format: 'png', clip: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } });
await p.eval(`document.querySelector('#ddlListDialog')?.close()`);
await sleep(250);

// focus
await p.eval(`document.getElementById('focusBtn').click()`);
await sleep(900);
r = await rect(p, '#focusDialog .dialog-card');
await p.screenshot({ path: OUT + '/focus-card.png', format: 'png', clip: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } });
await p.eval(`document.querySelector('#focusDialog')?.close()`);
await sleep(250);

await p.close();

const m = await newApp(390, 844, 3, true);
await m.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=7.4*64; document.getElementById('toast')?.remove(); })()`);
await sleep(500);
await m.screenshot({ path: OUT + '/app-mobile.png', format: 'png' });
await m.close();

await browser.close();
console.log('crops done');
