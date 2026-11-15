'use strict';
// Drives the real app window (under SROT_TEST=1) and saves screenshots. Not part of the shipped app.
const fs = require('node:fs');
const path = require('node:path');
const { nativeTheme } = require('electron');
const { createServer, makeData } = require('./server');

module.exports = async ({ app, manager, settings, getWindow }) => {
  const out = process.env.SROT_SHOTS;
  const log = (...a) => console.log('[e2e]', ...a);
  const problems = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, what, ms = 15000) => {
    const t0 = Date.now();
    while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`); await sleep(50); }
  };
  try {
    const srv = await createServer({ 'Thermodynamics Lecture 07.pdf': makeData(900 * 1024, 1), 'ubuntu-26.04-desktop.iso': makeData(40 * 1024 * 1024, 2), 'dataset.zip': makeData(12 * 1024 * 1024, 3), 'paper.pdf': makeData(300 * 1024, 4) });
    const win = getWindow();
    win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') problems.push(`console ${e.level}: ${e.message}`); });
    win.webContents.on('render-process-gone', () => problems.push('renderer crashed'));
    await until(() => !win.webContents.isLoading(), 'window load');
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const shot = async (name) => { await sleep(350); fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG()); log('shot', name); };
    await until(() => js('!!document.querySelector("#side button")'), 'sidebar rendered');
    const credit = await js(`(() => { const n = document.getElementById('credit'); if (!n) return null; const r = n.getBoundingClientRect();
      return { text: n.textContent.replace(/\\s+/g, ' ').trim(), shown: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 }; })()`);
    if (!credit || !credit.shown || !credit.text.includes('Joy Sarkar') || !credit.text.includes('Dhrubo Das')) problems.push(`developer credit not visible on the main window: ${JSON.stringify(credit)}`);
    await shot('01-empty');

    // seed a mix of states
    const done = manager.add({ url: srv.url('ok', 'Thermodynamics Lecture 07.pdf') });
    await until(() => manager.detail(done.id).status === 'completed', 'first download');
    const big = manager.add({ url: srv.url('ok', 'ubuntu-26.04-desktop.iso', { bps: 400 * 1024 }) });
    const zip = manager.add({ url: srv.url('ok', 'dataset.zip', { bps: 150 * 1024 }) });
    const bad = manager.add({ url: srv.url('ok', 'missing-file.rar') });
    const later = manager.add({ url: srv.url('ok', 'paper.pdf'), scheduleAt: Date.now() + 2 * 3600 * 1000 });
    await until(() => manager.detail(bad.id).status === 'error', '404 shown as error');
    await until(() => manager.detail(big.id).downloaded > 3 * 1024 * 1024, 'big download moving');
    await manager.pause(zip.id);
    await shot('02-list');

    // UI flow 1: click a row -> detail panel with segment map
    await js(`document.querySelector('.row[data-id="${big.id}"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
    await until(() => js('!document.getElementById("detail").hidden && document.querySelectorAll("#d-map i").length > 1'), 'detail map');
    await shot('03-detail');

    // UI flow 2: toolbar pause, then resume, through the real buttons
    await until(() => js('!document.getElementById("btn-pause").disabled'), 'pause button enabled');
    await js('document.getElementById("btn-pause").click()');
    await until(() => manager.detail(big.id).status === 'paused', 'pause via toolbar');
    await until(() => js('!document.getElementById("btn-resume").disabled'), 'resume button enabled');
    await js('document.getElementById("btn-resume").click()');
    await until(() => manager.detail(big.id).status === 'downloading', 'resume via toolbar');

    // UI flow 3: add dialog -> probe -> submit
    const before = manager.snapshot().tasks.length;
    await js(`(() => { document.getElementById('btn-add').click(); })()`);
    await until(() => js('document.getElementById("dlg-add").open'), 'add dialog open');
    await js(`(() => { const t = document.getElementById('add-urls'); t.value = ${JSON.stringify(srv.url('ok', 'paper.pdf', { v: 2 }))}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(() => js('!document.getElementById("add-name-row").hidden && document.getElementById("add-name").value === "paper.pdf"'), 'probe filled the name');
    await shot('04-add-dialog');
    await js('document.getElementById("add-ok").click()');
    await until(() => manager.snapshot().tasks.length === before + 1, 'task added from dialog');
    await until(() => js('!document.getElementById("dlg-add").open'), 'add dialog closed');

    // UI flow 4: remove through the confirm dialog
    await js(`document.querySelector('.row[data-id="${bad.id}"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
    await until(() => js('!document.getElementById("btn-remove").disabled'), 'remove button enabled');
    await js('document.getElementById("btn-remove").click()');
    await until(() => js('document.getElementById("dlg-remove").open'), 'remove dialog');
    await js('document.querySelector("#dlg-remove button[type=submit]").click()');
    await until(() => !manager.detail(bad.id), 'removed');

    // UI flow 5: settings change reaches the engine
    await js('document.getElementById("btn-settings").click()');
    await until(() => js('document.getElementById("dlg-settings").open && document.getElementById("tool-ytdlp").textContent !== "checking…"'), 'settings open');
    await js(`(() => { const i = document.getElementById('set-conn'); i.value = '16'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(() => manager.settings.connections === 16, 'connections setting applied');
    if (!(await js('document.getElementById("set-version").textContent')).includes('developed by Joy Sarkar and Dhrubo Das')) problems.push('developer credit missing in Settings');
    await shot('05-settings');
    await js('document.querySelector("#dlg-settings button[type=submit]").click()');

    // UI flow 6: speed limit from the status bar menu
    await js('document.getElementById("s-limit").click()');
    await until(() => js('!document.getElementById("menu").hidden'), 'limit menu');
    await js('[...document.querySelectorAll("#menu button")].find((b) => b.textContent.includes("512 KB/s")).click()');
    await until(() => manager.settings.speedLimit === 512 * 1024, 'limit applied');

    // video dialog (helper not installed here)
    await js('document.getElementById("btn-video").click()');
    await until(() => js('document.getElementById("dlg-video").open && !document.getElementById("vid-tools").hidden'), 'video dialog with install prompt');
    await shot('06-video-dialog');
    await js('document.querySelector("#dlg-video [data-close]").click()');

    // UI flow 7: appearance. Starts by following the system; the toolbar button flips it; Settings can set it too.
    const isDark = () => js('matchMedia("(prefers-color-scheme: dark)").matches');
    const paper = () => js('getComputedStyle(document.body).backgroundColor');
    if (settings.get().theme !== 'system') problems.push(`theme should start as "system", got ${settings.get().theme}`);
    const startedDark = await isDark();
    const startColor = await paper();
    await js('document.getElementById("btn-theme").click()');
    await until(async () => (await isDark()) === !startedDark, 'toolbar button flips the appearance');
    if (settings.get().theme !== (startedDark ? 'light' : 'dark')) problems.push(`toolbar toggle saved ${settings.get().theme}`);
    if ((await paper()) === startColor) problems.push('page colours did not change with the appearance');
    await js('document.getElementById("btn-settings").click()');
    await until(() => js('document.getElementById("dlg-settings").open'), 'settings open again');
    for (const want of ['light', 'dark']) {
      await js(`(() => { const sel = document.getElementById('set-theme'); sel.value = '${want}'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(async () => settings.get().theme === want && (await isDark()) === (want === 'dark'), `settings choice ${want} applied`);
      if (nativeTheme.themeSource !== want) problems.push(`native theme is ${nativeTheme.themeSource}, wanted ${want}`);
    }
    await js('document.querySelector("#dlg-settings button[type=submit]").click()');
    await js(`document.querySelector('.row[data-id="${big.id}"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
    await shot('07-dark');
    await js('document.getElementById("btn-theme").click()');
    await until(async () => !(await isDark()) && settings.get().theme === 'light', 'toolbar button back to light');
    await shot('08-light');

    await srv.close();
  } catch (e) { problems.push(`driver: ${e.stack || e}`); }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
  log(problems.length ? `FAILED\n${problems.join('\n')}` : 'PASSED');
  app.exit(problems.length ? 1 : 0);
};
