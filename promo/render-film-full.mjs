import { Browser, sleep } from 'file:///C:/Users/llyyt/.config/opencode/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { mkdirSync, rmSync } from 'node:fs';

const OUT = 'C:/Users/llyyt/Desktop/DayFlow/promo/frames-full';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const FPS = 24;
const DUR = 97;
const TOTAL = FPS * DUR;

const browser = await Browser.launch({ width: 1920, height: 1080 });
const p = await browser.newPage({ width: 1920, height: 1080, dsf: 1 });
await p.goto('http://127.0.0.1:8765/promo/stage-full.html', { settleMs: 1200 });
await p.eval('window.__ready');
await sleep(400);

const t0 = Date.now();
for (let i = 0; i < TOTAL; i++) {
  const t = i / FPS;
  await p.eval(`window.renderFrame(${t.toFixed(4)})`);
  await p.screenshot({
    path: `${OUT}/f${String(i).padStart(5, '0')}.jpg`,
    format: 'jpeg',
    quality: 93
  });
  if (i % 120 === 0) {
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`frame ${i}/${TOTAL} (${t.toFixed(1)}s) — ${secs}s elapsed`);
  }
}
await browser.close();
console.log('frames done in', ((Date.now() - t0) / 1000).toFixed(0), 's');
