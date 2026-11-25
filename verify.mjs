// verify.mjs — the whole entry, checked by code, no network, no image is ever viewed.
//
//   1. determinism: main.ts run twice into two directories; every file byte-identical.
//   2. the gate's seven rows, on the first run's output.
//   3. dossier_matches: dossier.json is byte for byte buildDossier(output, {text_max_bytes: 65536}).
//   4. the page in headless Chromium: the checks strip passes 6/6, no console error, no network
//      request, every tab and every filter returns rows, every column sorts, and there is no
//      horizontal overflow at 1440 / 1024 / 390 in both themes.
//
// Usage: node verify.mjs [--input <snapshot.json>] [--out <dir>]
// Needs /usr/bin/chromium (or $CHROME) and Node 22. Exit 0 only when every check passes.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const INPUT = arg('input', '/root/makefun/token-radar-01-kit/input/snapshot.json');
const OUT = arg('out', '/tmp/opencode/verify');
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail || '' }); }
function section(t) { process.stdout.write(`\n== ${t} ==\n`); }

// ---------- 1. determinism ----------
section('determinism');
const A = join(OUT, 'a'), B = join(OUT, 'b');
for (const d of [A, B]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
function build(dir) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, ['main.ts', '--input', INPUT], { cwd: process.cwd(), env: { ...process.env, MAKEFUN_OUTPUT_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res(out.trim()) : rej(new Error(`main.ts exited ${c}: ${err}`))));
  });
}
const logA = await build(A);
const logB = await build(B);
function walk(dir, base = dir) {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f, base)); else out.push(f.slice(base.length + 1));
  }
  return out;
}
const filesA = walk(A), filesB = walk(B);
let diff = [];
if (JSON.stringify(filesA) !== JSON.stringify(filesB)) diff.push(`file lists differ: ${filesA.join(',')} vs ${filesB.join(',')}`);
for (const f of filesA) {
  if (!filesB.includes(f)) continue;
  const x = readFileSync(join(A, f)), y = readFileSync(join(B, f));
  if (!x.equals(y)) diff.push(`${f} differs (${x.length} vs ${y.length} bytes)`);
}
check('two runs are byte-identical', diff.length === 0, diff.length ? diff.join('; ') : `${filesA.length} files, all equal`);
console.log(logA);

// ---------- 2. the gate's seven rows ----------
section('gate');
const snap = JSON.parse(readFileSync(INPUT, 'utf8'));
const snapSlugs = new Set(snap.protocols.map((p) => p.slug));
const watch = new Set(snap.watchlist);

// dashboard_files
const dashDir = join(A, 'dashboard');
const dashFiles = readdirSync(dashDir).filter((n) => !n.startsWith('.')).sort();
const dashAll = dashFiles.map((n) => join(dashDir, n));
const dashBytes = dashFiles.reduce((n, f) => n + statSync(join(dashDir, f)).size, 0);
const hasHtml = dashFiles.some((f) => f.endsWith('.html'));
const hasCss = dashFiles.some((f) => f.endsWith('.css'));
const hasJs = dashFiles.some((f) => f.endsWith('.js'));
const netRe = /https?:\/\//i;
let netHit = null;
for (const f of dashAll) { if (netRe.test(readFileSync(f, 'utf8'))) { netHit = f; break; } }
check('dashboard_files', hasHtml && hasCss && hasJs && dashFiles.length <= 400 && dashBytes <= 4 * 1024 * 1024 && !netHit,
  `${dashFiles.length} files, ${dashBytes} bytes, html/css/js=${hasHtml}/${hasCss}/${hasJs}, network=${netHit ? netHit : 'none'}`);

// board_file
const board = JSON.parse(readFileSync(join(A, 'board.json'), 'utf8'));
const rows = Array.isArray(board) ? board : board.rows;
let boardErr = null;
if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) boardErr = `rows=${rows && rows.length}`;
else {
  for (const r of rows) {
    if (!snapSlugs.has(r.slug)) { boardErr = `invented slug ${r.slug}`; break; }
    if (!r.name || !r.name.trim()) { boardErr = `empty name ${r.slug}`; break; }
    if (!Number.isSafeInteger(r.rank) || r.rank < 1) { boardErr = `bad rank ${r.slug}`; break; }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) { boardErr = `bad value ${r.slug}`; break; }
    if (!Array.isArray(r.farm_steps)) { boardErr = `no steps ${r.slug}`; break; }
  }
}
check('board_file', !boardErr && statSync(join(A, 'board.json')).size <= 8 * 1024 * 1024, boardErr || `${rows.length} rows, all slugs known, values positive whole`);

// sorted_by_value
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
const ranksOk = ranks.every((v, i) => v === i + 1);
let rise = 0;
for (let i = 1; i < rows.length; i++) if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) rise++;
const distinct = new Set(rows.map((r) => r.implied_value_usd)).size;
check('sorted_by_value', ranksOk && rise === 0 && distinct >= 2, `ranks 1..${rows.length} once each=${ranksOk}, rises=${rise}, distinct values=${distinct}`);

// coverage
const have = new Set(rows.map((r) => r.slug));
const missing = [...watch].filter((s) => !have.has(s));
check('coverage', missing.length === 0, `${watch.size - missing.length}/${watch.size} watchlist slugs on the board${missing.length ? ', missing ' + missing.join(',') : ''}`);

// farm_steps
let stepErr = null, minS = 99, maxS = 0;
for (const r of rows) {
  const s = r.farm_steps;
  if (!Array.isArray(s) || s.length < 3 || s.length > 12) { stepErr = `${r.slug}: ${s && s.length} steps`; break; }
  minS = Math.min(minS, s.length); maxS = Math.max(maxS, s.length);
  for (const t of s) { const n = String(t).trim().length; if (n < 20 || n > 600) { stepErr = `${r.slug}: a step of ${n} chars`; break; } }
  if (stepErr) break;
}
check('farm_steps', !stepErr, stepErr || `every row 3-12 steps (${minS}-${maxS}), each 20-600 chars`);

// screenshots
const shotDir = join(A, 'screenshots');
const shots = readdirSync(shotDir).filter((n) => !n.startsWith('.')).sort();
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0xd9) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
let shotErr = null;
if (shots.length < 3 || shots.length > 4) shotErr = `${shots.length} images`;
for (const s of shots) {
  const b = readFileSync(join(shotDir, s));
  if (b.length > 512 * 1024) { shotErr = `${s} is ${b.length} bytes`; break; }
  const dim = jpegSize(b);
  if (!dim) { shotErr = `${s} is not a whole JPEG`; break; }
  const long = Math.max(dim.w, dim.h), short = Math.min(dim.w, dim.h);
  if (long > 1440 || short < 800) { shotErr = `${s} is ${dim.w}x${dim.h}`; break; }
}
check('screenshots', !shotErr, shotErr || shots.map((s) => `${s} ${readFileSync(join(shotDir, s)).length}B`).join(', '));

// dossier_matches
const dossierPath = join(A, 'dossier.json');
const written = readFileSync(dossierPath);
const rebuilt = buildDossier(A, { text_max_bytes: 65536 });
check('dossier_matches', Buffer.from(rebuilt).equals(written) && written.length <= 1.5 * 1024 * 1024,
  `written ${written.length} bytes, rebuilt ${rebuilt.length} bytes, equal=${Buffer.from(rebuilt).equals(written)}`);

// ---------- 3. the page in headless Chromium ----------
section('headless page');
const PORT = 9360;
const BASE = `file://${A}/dashboard/index.html`;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1', '--user-data-dir=/tmp/opencode/verify-chrome', 'about:blank'], { stdio: 'ignore' });
const j = async (p, o) => (await fetch(`http://127.0.0.1:${PORT}${p}`, o)).json();
let ver = null;
for (let i = 0; i < 80; i++) { try { ver = await j('/json/version'); break; } catch { await sleep(200); } }
if (!ver) { check('chromium starts', false, 'no /json/version'); }
else {
  const page = await j(`/json/new?${encodeURIComponent(BASE)}`, { method: 'PUT' });
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const errors = []; const net = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    else if (m.method === 'Network.requestWillBeSent') net.push(m.params.request.url);
  };
  const send = (method, params = {}, ms = 60000) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => { const t = setTimeout(() => { pend.delete(i); rej(new Error(method + ' timed out after ' + ms + 'ms')); }, ms); pend.set(i, (m) => { clearTimeout(t); res(m); }); }); };
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1260, deviceScaleFactor: 1, mobile: false });
  const nav = async (h) => { await send('Page.navigate', { url: BASE + h }); await sleep(700); };
  const waitChecks = async () => { for (let i = 0; i < 150; i++) { if (await ev(`!!document.querySelector('[data-checks="done"]')`)) return true; await sleep(200); } return false; };

  await nav('#view=board');
  const checksDone = await waitChecks();
  const strip = await ev(`(() => { const c=document.querySelector('#checks'); return { title:c?.querySelector('.ctitle')?.textContent.trim(), ok:[...document.querySelectorAll('#checks details.ok')].length, bad:[...document.querySelectorAll('#checks details.bad')].length }; })()`);
  check('checks strip 6/6', checksDone && strip.ok === 6 && strip.bad === 0 && /6 of 6/.test(strip.title || ''), strip.title || 'no strip');

  // tabs return rows
  const tabRows = {};
  for (const v of ['board', 'live', 'excluded', 'method']) {
    await nav(`#view=${v}`);
    tabRows[v] = v === 'method' ? await ev(`document.querySelectorAll('.prose h2').length`) : v === 'board' ? await ev(`document.querySelectorAll('tbody tr[data-p]').length`) : await ev(`document.querySelectorAll('tbody tr').length`);
  }
  check('every tab returns rows', tabRows.board > 0 && tabRows.live > 0 && tabRows.excluded > 0 && tabRows.method > 0, JSON.stringify(tabRows));

  // filters return rows
  await nav('#view=board');
  const filters = [
    ['cat', 'Risk Curators'], ['chain', 'Ethereum'], ['tvl', '50-250M'], ['conf', '40'], ['pr', 'watch'], ['w', '1'],
  ];
  const filterRows = {};
  for (const [k, v] of filters) {
    await nav(`#view=board&${k}=${encodeURIComponent(v)}`);
    filterRows[k] = await ev(`document.querySelectorAll('tbody tr[data-p]').length`);
  }
  check('every filter returns rows', Object.values(filterRows).every((n) => n > 0), JSON.stringify(filterRows));

  // sort every column: set the hash each way and compare the DOM order to the model's own order
  await nav('#view=board');
  const keys = await ev(`[...document.querySelectorAll('th button[data-sort]')].map(b=>b.dataset.sort)`);
  const pageRows = await ev(`window.RADAR.rows`);
  const PR_ORDER = { 'farm now': 0, watch: 1, skip: 2 };
  const keyOf = (r, k) => (k === 'ch' ? r.ch.length : k === 'd7' ? (r.d7 === null ? -1e9 : r.d7) : k === 'pr' ? PR_ORDER[r.pr] : k === 'b' ? r.b : r[k]);
  const sortErr = [];
  for (const k of keys) {
    for (const dir of ['asc', 'desc']) {
      await nav(`#view=board&sort=${k}&dir=${dir}`);
      const got = await ev(`[...document.querySelectorAll('tbody tr[data-p]')].map(tr=>tr.dataset.p)`);
      const d = dir === 'asc' ? 1 : -1;
      const want = pageRows.slice().sort((x, y) => { const p = keyOf(x, k), q = keyOf(y, k); return (p < q ? -1 : p > q ? 1 : 0) * d || x.r - y.r; }).map((r) => r.s);
      if (got.length !== want.length || got.some((s, i) => s !== want[i])) sortErr.push(`${k}/${dir}`);
    }
  }
  check('every column sorts', sortErr.length === 0, sortErr.length ? sortErr.join(', ') : `${keys.length} columns, both directions`);

  // rendered text of every tab and EVERY row's detail sheet: no NaN/undefined/Infinity/$null, no $12345k
  const textBad = [];
  const textPats = [[/NaN/, 'NaN'], [/undefined/, 'undefined'], [/Infinity/, 'Infinity'], [/\$null/, '$null'], [/\d{4,}(\.\d+)?k/, 'big-k']];
  const scanText = (txt, where) => { for (const [re, name] of textPats) { const m = re.exec(txt); if (m) textBad.push(`${where}: ${name} (${m[0]})`); } };
  for (const v of ['board', 'live', 'excluded', 'method']) {
    await ev(`location.hash='#view=${v}'`); await sleep(90);
    scanText(await ev(`document.getElementById('app').innerText`), 'tab ' + v);
  }
  // the value strip must read row #1's own odds and value (no NaN)
  await ev(`location.hash='#view=board'`); await sleep(90);
  const stripTxt = await ev(`document.querySelector('.sworked').innerText`);
  const r1 = pageRows[0];
  const usd1 = (n) => { const a = Math.abs(n); return a >= 1e9 ? '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n); };
  const stripOk = stripTxt.includes(Math.round(r1.od * 100) + '%') && stripTxt.includes(usd1(r1.b)) && !/NaN/.test(stripTxt);
  check('strip value equals row #1', stripOk, stripOk ? `#1 ${r1.n}: ${Math.round(r1.od * 100)}% and ${usd1(r1.b)}, no NaN` : `strip "${stripTxt.slice(0, 90)}" != ${Math.round(r1.od * 100)}% / ${usd1(r1.b)}`);
  // every detail sheet: break-even in the plan equals the stop rule, "cannot break even" above 100%.
  // One in-page pass (not 191 outside round-trips): set the hash, wait for the sheet to show the right
  // row, read the panel. Keeps the renderer in one evaluate and never hangs the socket.
  const slugs = await ev(`window.RADAR.rows.map(r=>r.s)`);
  const detail = await ev(`(async () => {
    const out = [];
    for (const r of window.RADAR.rows) {
      location.hash = '#p=' + r.s;
      let ok = false;
      for (let i = 0; i < 40; i++) {
        await new Promise(res => setTimeout(res, 20));
        const sh = document.getElementById('sheet'), p = document.getElementById('panel');
        if (sh && !sh.hidden && p && /Break-even odds/.test(p.innerText)) { ok = true; break; }
      }
      const p = document.getElementById('panel');
      const facts = [...p.querySelectorAll('.facts span')].map(x => x.innerText);
      const beFact = facts.find(x => /Break-even odds/.test(x)) || '';
      const sr = [...p.querySelectorAll('.facts2 p')].map(x => x.innerText).join(' ');
      out.push({ s: r.s, ok, beFact, sr, txt: p.innerText });
    }
    location.hash = '#view=board';
    return out;
  })()`);
  const beBad = [];
  for (const d of detail) {
    scanText(d.txt, 'detail ' + d.s);
    const beImp = /cannot break even/.test(d.beFact), srImp = /cannot break even/.test(d.sr);
    const beNum = (/\d+/.exec(d.beFact) || [])[0];
    const srM = /break-even is (\d+)%/.exec(d.sr) || /needs (\d+)%/.exec(d.sr);
    const srNum = srM ? srM[1] : null;
    if (!d.ok || beImp !== srImp || (!beImp && beNum !== srNum)) beBad.push(`${d.s}: plan "${d.beFact.replace(/\s+/g, ' ').trim()}" vs stop "${(d.sr.match(/break-even[^.]*|cannot break even[^.]*/) || [''])[0].trim()}"`);
    if (beBad.length > 8) break;
  }
  await ev(`location.hash='#view=board'`); await sleep(60);
  check('rendered text clean (all tabs + every detail)', textBad.length === 0, textBad.length ? textBad.slice(0, 6).join('; ') : `${slugs.length} detail sheets + 4 tabs: no NaN/undefined/Infinity/$null/big-k`);
  check('break-even equal in plan and stop rule', beBad.length === 0, beBad.length ? beBad.slice(0, 5).join('; ') : `all ${slugs.length} rows: one break-even number, "cannot break even" above 100%`);

  // overflow at 3 widths, both themes
  const over = [];
  for (const w of [1440, 1024, 390]) {
    for (const theme of ['light', 'dark']) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1260, deviceScaleFactor: 1, mobile: false });
      await ev(`document.documentElement.dataset.theme='${theme}'`);
      await sleep(120);
      const o = await ev(`(() => { const d=document.documentElement; return d.scrollWidth - d.clientWidth; })()`);
      if (o > 0) over.push(`${w}/${theme}=${o}`);
    }
  }
  check('no horizontal overflow (3 widths, 2 themes)', over.length === 0, over.length ? over.join(', ') : '1440/1024/390 light+dark all 0');

  // no network + no console error
  check('no console error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'none');
  const remote = net.filter((u) => /^https?:\/\//i.test(u));
  check('no network request', remote.length === 0, remote.length ? remote.slice(0, 3).join(', ') : `${net.length} requests, all file://`);

  ws.close();
}
chrome.kill();

// ---------- report ----------
section('result');
let pass = 0;
for (const r of results) { if (r.ok) pass++; process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  — ${r.detail}\n`); }
process.stdout.write(`\n${pass}/${results.length} checks passed\n`);
process.exit(pass === results.length ? 0 : 1);