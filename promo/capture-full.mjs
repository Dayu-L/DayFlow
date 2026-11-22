import { Browser, sleep } from 'file:///C:/Users/llyyt/.config/opencode/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/llyyt/Desktop/DayFlow/promo/assets-full';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8765/index.html';

const browser = await Browser.launch({ width: 1440, height: 900 });

function noToast(p) {
  return p.eval(`(() => { const t=document.getElementById('toast'); if(t) t.classList.remove('show'); })()`);
}

async function setTheme(p, theme) {
  await p.eval(`(() => { document.getElementById('themeBtn').click(); const b=document.querySelector('#themeGrid [data-theme="${theme}"]'); if(b) b.click(); document.getElementById('themeDialog').close(); })()`);
  await sleep(450);
}

const p = await browser.newPage({ width: 1440, height: 900, dsf: 2 });
await p.goto(BASE, { settleMs: 1600 });
await p.eval(`localStorage.clear()`);
await p.goto(BASE, { settleMs: 1800 });
await sleep(3200);
await noToast(p);
await p.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=7.6*64; })()`);
await sleep(450);
await noToast(p);
await p.screenshot({ path: OUT + '/app-day-full.png', format: 'png' });
await p.screenshot({ path: OUT + '/app-day.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });

// selected event + on-block done button
await p.eval(`(() => { const b=[...document.querySelectorAll('.event-block')].find(e=>!e.classList.contains('done')) || document.querySelector('.event-block'); if(b) b.click(); })()`);
await sleep(450);
await noToast(p);
await p.screenshot({ path: OUT + '/app-day-selected.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });

// quick input focus (same day view)
await p.eval(`(() => { const b=[...document.querySelectorAll('.event-block')].find(e=>e.dataset.id); if(b) b.click(); })()`);
await sleep(200);
await p.eval(`(() => { const i=document.getElementById('quickAddInput'); if(i) { i.value='明天下午4点 产品评审 1小时'; i.dispatchEvent(new Event('input',{bubbles:true})); i.focus(); } })()`);
await sleep(300);
await noToast(p);
await p.screenshot({ path: OUT + '/app-quick-add.png', format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });

// feature page
await p.eval(`document.getElementById('featuresBtn').click()`);
await sleep(700);
await noToast(p);
await p.screenshot({ path: OUT + '/app-features.png', format: 'png' });
await p.eval(`document.getElementById('featuresBackBtn').click()`);
await sleep(400);

// theme panel
await p.eval(`document.getElementById('themeBtn').click()`);
await sleep(500);
await noToast(p);
await p.screenshot({ path: OUT + '/app-themes.png', format: 'png' });
await p.eval(`document.getElementById('themeDialog').close()`);
await sleep(250);

// theme screenshots
for (const theme of ['hud', 'parallax', 'spatial', 'glass', 'aurora', 'ink', 'sand', 'forest', 'paper']) {
  await setTheme(p, theme);
  await p.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=7.4*64; })()`);
  await sleep(350);
  await noToast(p);
  await p.screenshot({ path: `${OUT}/theme-${theme}.png`, format: 'png', clip: { x: 336, y: 0, width: 1104, height: 900 } });
}

// review chat
await p.eval(`(() => { const i=document.getElementById('chatInput'); i.value='本周复盘'; i.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('composer').requestSubmit(); })()`);
await sleep(2200);
await noToast(p);
await p.screenshot({ path: OUT + '/app-review.png', format: 'png' });
await p.screenshot({ path: OUT + '/agent-review.png', format: 'png', clip: { x: 0, y: 0, width: 336, height: 900 } });

await p.close();

// mobile
const m = await browser.newPage({ width: 390, height: 844, dsf: 3, mobile: true });
await m.goto(BASE, { settleMs: 1600 });
await m.eval(`(() => { localStorage.setItem('dayflow.theme.v1','hud'); })()`);
await m.goto(BASE, { settleMs: 1800 });
await sleep(1200);
await noToast(m);
await m.eval(`(() => { const sc=document.getElementById('timelineScroll'); if(sc) sc.scrollTop=7.2*64; })()`);
await sleep(350);
await m.screenshot({ path: OUT + '/mobile-day.png', format: 'png' });
await m.eval(`document.getElementById('tabFeatures').click()`);
await sleep(600);
await noToast(m);
await m.screenshot({ path: OUT + '/mobile-features.png', format: 'png' });
await m.eval(`document.getElementById('tabCalendar').click()`);
await sleep(350);
await m.eval(`document.getElementById('themeBtn').click()`);
await sleep(450);
await noToast(m);
await m.screenshot({ path: OUT + '/mobile-themes.png', format: 'png' });
await m.close();

await browser.close();
console.log('capture full done');
