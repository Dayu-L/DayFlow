import { Browser, sleep } from 'file:///C:/Users/llyyt/.config/opencode/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/llyyt/Desktop/DayFlow/promo/preview';
mkdirSync(OUT, { recursive: true });
const browser = await Browser.launch({ width: 1920, height: 1080 });
const p = await browser.newPage({ width: 1920, height: 1080, dsf: 1 });
await p.goto('http://127.0.0.1:8765/promo/stage.html', { settleMs: 1200 });
await p.eval('window.__ready');
const times = [1.6, 3.6, 6.4, 9.7, 13.2, 16.8, 20.2, 22.8, 26.6, 31.8, 37.4, 39.2];
for (const t of times) {
  await p.eval(`window.renderFrame(${t})`);
  await sleep(80);
  await p.screenshot({ path: `${OUT}/t${String(t).replace('.', '_')}.png`, format: 'png' });
}
await browser.close();
console.log('preview done');
