import { Browser, sleep } from 'file:///C:/Users/llyyt/.config/opencode/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/llyyt/Desktop/DayFlow/promo/assets-glass';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8766/index.html';
const FIXED = new Date('2026-11-06T09:12:00+08:00').getTime();
const MOCK = `(() => {
  const FIXED=${FIXED}; const R=Date;
  class D extends R { constructor(...a){ if(!a.length) super(FIXED); else super(...a); } static now(){ return FIXED; } }
  D.parse=R.parse; D.UTC=R.UTC; window.Date=D;
})();`;

const browser = await Browser.launch({ width: 1440, height: 900 });

async function hideToast(p) {
  await p.eval(`(() => { const t=document.getElementById('toast'); if(t) t.classList.remove('show'); })()`);
}

async function reset(p) {
  await p.eval(`(() => { document.querySelectorAll('dialog[open]').forEach(d=>d.close()); const t=document.getElementById('toast'); if(t) t.classList.remove('show'); })()`);
}

async function send(p, text) {
  await p.eval(`(() => { const i=document.getElementById('chatInput'); i.value=${JSON.stringify(text)}; i.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('composer').requestSubmit(); })()`);
  await sleep(1700);
  await reset(p);
}

async function runAgent(p) {
  await send(p, '明天下午4点 产品评审 1小时 @线上·腾讯会议');
  await send(p, '记一个任务：整理项目周报 2小时');
  await send(p, '这周还有什么空档？');
}

/* ---------------- 1920 × 1200 agent hero ---------------- */
const wide = await browser.newPage({ width: 1920, height: 1200, dsf: 2 });
await wide.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await wide.goto(BASE, { settleMs: 1500 });
await wide.eval(`localStorage.clear()`);
await wide.goto(BASE, { settleMs: 1800 });
await wide.eval(`(() => { localStorage.setItem('dayflow.theme.v1','glass'); })()`);
await wide.goto(BASE, { settleMs: 1800 });
await sleep(2800);
await runAgent(wide);
await wide.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=15.2*64; })()`);
await sleep(500);
await reset(wide);
await wide.screenshot({ path: OUT + '/app-agent-glass.png', format: 'png' });
await wide.close();

/* ---------------- 1440 × 900 product shots ---------------- */
const p = await browser.newPage({ width: 1440, height: 900, dsf: 2 });
await p.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await p.goto(BASE, { settleMs: 1500 });
await p.eval(`localStorage.clear()`);
await p.goto(BASE, { settleMs: 1800 });
await p.eval(`(() => { localStorage.setItem('dayflow.theme.v1','glass'); })()`);
await p.goto(BASE, { settleMs: 1800 });
await sleep(2800);
await runAgent(p);

// day view, scrolled to the new 16:00 event
await p.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=15.2*64; })()`);
await sleep(500);
await reset(p);
await p.screenshot({ path: OUT + '/app-day-glass-full.png', format: 'png' });
await p.screenshot({ path: OUT + '/app-day-glass.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });

// selected event -> complete button on the block
await p.eval(`(() => { const b=[...document.querySelectorAll('.event-block')].find(e=>e.textContent.includes('产品评审')); if(b) b.click(); })()`);
await sleep(500);
await reset(p);
await p.screenshot({ path: OUT + '/app-day-selected-glass.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });

// quick add focused
await p.eval(`(() => { const i=document.getElementById('quickAddInput'); if(i){ i.value='明天下午3点 产品评审 1小时'; i.dispatchEvent(new Event('input',{bubbles:true})); i.focus(); } })()`);
await sleep(350);
await reset(p);
await p.screenshot({ path: OUT + '/app-quick-add-glass.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });

// week view
await p.eval(`document.getElementById('viewWeek').click()`);
await sleep(900);
await reset(p);
await p.screenshot({ path: OUT + '/app-week-glass.png', format: 'png' });
await p.screenshot({ path: OUT + '/week-grid-glass.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 660 } });
await p.eval(`document.getElementById('viewDay').click()`);
await sleep(500);

// task inbox dialog
await p.eval(`document.getElementById('tasksBtn').click()`);
await sleep(700);
await hideToast(p);
const taskRect = await p.eval(`(() => { const el=document.querySelector('#tasksDialog .dialog-card'); const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
await p.screenshot({ path: OUT + '/app-tasks-glass.png', format: 'png' });
await p.screenshot({ path: OUT + '/task-card-glass.png', format: 'png', clip: taskRect });
await p.eval(`document.getElementById('tasksDialog').close()`);
await sleep(350);

// focus dialog
await p.eval(`document.getElementById('focusBtn').click()`);
await sleep(500);
await p.eval(`(() => { const i=document.getElementById('focusTitle'); if(i){ i.value='整理项目周报'; i.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
await sleep(300);
await hideToast(p);
const focusRect = await p.eval(`(() => { const el=document.querySelector('#focusDialog .dialog-card'); const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
await p.screenshot({ path: OUT + '/app-focus-glass.png', format: 'png' });
await p.screenshot({ path: OUT + '/focus-card-glass.png', format: 'png', clip: focusRect });
await p.eval(`document.getElementById('focusDialog').close()`);
await sleep(350);

// feature page
await p.eval(`document.getElementById('featuresBtn').click()`);
await sleep(900);
await reset(p);
await p.screenshot({ path: OUT + '/app-features-glass.png', format: 'png' });
await p.eval(`document.getElementById('featuresBackBtn').click()`);
await sleep(500);

await p.close();

/* ---------------- mobile ---------------- */
const m = await browser.newPage({ width: 390, height: 844, dsf: 3, mobile: true });
await m.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await m.goto(BASE, { settleMs: 1500 });
await m.eval(`localStorage.clear()`);
await m.goto(BASE, { settleMs: 1800 });
await m.eval(`(() => { localStorage.setItem('dayflow.theme.v1','glass'); })()`);
await m.goto(BASE, { settleMs: 1800 });
await sleep(1500);
await reset(m);
await m.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=7.2*64; })()`);
await sleep(350);
await reset(m);
await m.screenshot({ path: OUT + '/mobile-day-glass.png', format: 'png' });
await m.close();

await browser.close();
console.log('capture glass done');
