// tools/shots.mjs — take the four dossier screenshots from this repository's own build.
//
// Uses the Playwright already installed at /root/makefun/tools/node_modules and the system
// Chromium at /usr/bin/chromium. It never opens an image: it prints each JPEG's byte size by code.
//
//   NODE_PATH=/root/makefun/tools/node_modules node tools/shots.mjs [--out <dir>]
//
// It builds main.ts into <dir> (default /tmp/opencode/shots), opens dashboard/index.html from
// there over file://, and writes 1440x1260 JPEGs into this repository's screenshots/.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pw from '/root/makefun/tools/node_modules/playwright/index.js';
const { chromium } = pw;

const here = fileURLToPath(new URL('..', import.meta.url)); // repository root
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('out', '/tmp/opencode/shots');
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const INPUT = arg('input', '/root/makefun/token-radar-01-kit/input/snapshot.json');
const W = 1440, H = 1260;

// 1. build the page we are about to shoot (deterministic, offline)
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const built = spawnSync(process.execPath, ['main.ts', '--input', INPUT], {
  cwd: here, env: { ...process.env, MAKEFUN_OUTPUT_DIR: OUT }, stdio: 'inherit',
});
if (built.status !== 0) { process.stderr.write('shots: build failed\n'); process.exit(1); }

const base = `file://${OUT}/dashboard/index.html`;
const shots = readdirSync(join(here, 'screenshots')).filter((n) => n.startsWith('.') === false && !n.startsWith('..'));
const outDir = join(here, 'screenshots');
mkdirSync(outDir, { recursive: true });

// 2. the four views the rules expect: board, one detail, a filtered view, the method.
// The dossier keeps four JPEGs, so each has to be smaller than the 3-shot rule's 300-350 KB hint:
// every file must land in [MIN, MAX] bytes. Quality is stepped down from Q_HIGH by code until it does.
const MIN = 200_000, MAX = 262_144, Q_HIGH = 95, Q_LOW = 60;
const plan = [
  { name: '1-board.jpg', hash: '#view=board' },
  { name: '2-detail.jpg', hash: '#view=board&p=steakhouse-financial' },
  { name: '3-filtered.jpg', hash: '#view=board&w=1&conf=40&sort=net&dir=desc' },
  { name: '4-method.jpg', hash: '#view=method' },
];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') process.stderr.write(`page error: ${m.text()}\n`); });

for (const s of plan) {
  await page.goto(base + s.hash, { waitUntil: 'load' });
  // wait until the board has rows (or the method prose is present)
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('tbody tr[data-p], tbody tr');
    return rows.length > 0 || document.querySelectorAll('.prose h2').length > 0;
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
  const file = join(outDir, s.name);
  // step the quality down until the JPEG fits the band; the first fit from above is the sharpest one
  let shot = null, used = 0;
  for (let q = Q_HIGH; q >= Q_LOW; q--) {
    const buf = await page.screenshot({ type: 'jpeg', quality: q });
    if (buf.length <= MAX) { shot = buf; used = q; break; }
  }
  if (!shot) { process.stderr.write(`shots: ${s.name} is still over ${MAX} bytes at quality ${Q_LOW}\n`); process.exit(1); }
  if (shot.length < MIN) { process.stderr.write(`shots: ${s.name} is ${shot.length} bytes at quality ${used}, under ${MIN}\n`); process.exit(1); }
  writeFileSync(file, shot);
  process.stdout.write(`${s.name} quality ${used} ${shot.length}B\n`);
}

await browser.close();

// 3. report every screenshot's size by code (never open the image)
process.stdout.write('--- screenshot byte sizes ---\n');
for (const n of readdirSync(outDir).filter((n) => !n.startsWith('.')).sort()) {
  process.stdout.write(`${n} ${statSync(join(outDir, n)).size}B\n`);
}