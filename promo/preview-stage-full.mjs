import { Browser, sleep } from 'file:///C:/Users/llyyt/.config/opencode/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/llyyt/Desktop/DayFlow/promo/preview-full';
mkdirSync(OUT, { recursive: true });
const browser = await Browser.launch({ width: 1920, height: 1080 });
const p = await browser.newPage({ width: 1920, height: 1080, dsf: 1 });
await p.goto('http://127.0.0.1:8765/promo/stage-full.html', { settleMs: 1200 });
await p.eval('window.__ready');
const times = [3.0, 10.0, 13.5, 20.0, 29.0, 38.0, 48.0, 57.0, 69.0, 82.0, 95.0, 106.0, 109.0];
for (const t of times) {
  await p.eval(`window.renderFrame(${t})`);
  await sleep(80);
  await p.screenshot({ path: `${OUT}/t${String(t).replace('.', '_')}.png`, format: 'png' });
}
await browser.close();
console.log('preview full done');
