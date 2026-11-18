'use strict';
// 对真实桌面程序做回归检查；数据全部写入 test-output，不接触实际存档。
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Backup = require('../js/backup');
const root = path.resolve(__dirname, '..');
const testRoot = path.join(root, 'test-output', `desktop-${Date.now()}`);
const executable = process.argv[2] || require('electron');
const packaged = process.argv.length > 2;
const env = { ...process.env, PAIBAN_DATA_DIR: testRoot };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
async function start() {
  app = await electron.launch({ executablePath: executable, args: packaged ? [] : [root], env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', err => errors.push(err.message));
  await page.waitForFunction(() => document.querySelector('#coverageTrend')?.textContent.includes('100'), null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#saveState')?.textContent.startsWith('已保存'), null, { timeout: 10000 });
}
async function snapshot() {
  return page.evaluate(keys => Object.fromEntries(keys.map(key => [key, window.paibanDesktop.getItem(key)])), Backup.KEYS);
}
(async () => {
  await start();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const initial = await snapshot();
  const workspace = JSON.parse(initial[Backup.KEYS[0]]);
  assert.equal(workspace.staff.length, 16);
  assert.equal(JSON.parse(initial[Backup.KEYS[1]]).length, 1);
  assert.equal(await page.evaluate(() => window.PaibanScheduler.validate(
    JSON.parse(window.paibanDesktop.getItem('paiban.workspace.v1')).staff,
    JSON.parse(window.paibanDesktop.getItem('paiban.workspace.v1')).schedule, {}).ok), true);
  const worker = workspace.staff.find(person => person.role !== 'director');
  const director = workspace.staff.find(person => person.role === 'director');
  assert.equal(await page.locator(`[data-row-id="${director.id}"] .rest-closing`).textContent(), '—');
  await page.click(`[data-rest-person="${worker.id}"]`);
  await page.fill(`[data-rest-input="${worker.id}"]`, '0.2');
  await page.click('button[form=restOpeningForm]');
  await page.locator('#restOpeningError.show').waitFor();
  await page.fill(`[data-rest-input="${worker.id}"]`, '6.5');
  await page.click('button[form=restOpeningForm]');
  await page.locator('#restOpeningForm').waitFor({ state: 'detached' });
  const firstEnd = await page.evaluate(id => {
    const row = JSON.parse(window.paibanDesktop.getItem('paiban.workspace.v1')).schedule[id];
    return Math.max(4.5, 6.5 + window.PaibanScheduler.totalWorkload(row) - 5);
  }, worker.id);
  assert.equal(await page.locator(`[data-row-id="${worker.id}"] .rest-closing`).textContent(), String(firstEnd));
  await page.click('#viewPeopleBtn');
  const rulesPromise = app.waitForEvent('window', { predicate: win => win !== page });
  await page.click('#ruleConfigBtn');
  const rules = await rulesPromise;
  rules.on('pageerror', err => errors.push(err.message));
  await rules.click('[data-rule-tab="workload"]');
  assert.equal(await rules.inputValue('[data-rule-workload="CHAIN"]'), '0.5');
  await rules.fill('[data-rule-workload="CHAIN"]', '1.5');
  await rules.click('button[form=ruleConfigForm]');
  await page.waitForFunction(() => JSON.parse(window.paibanDesktop.getItem('paiban.workspace.v1')).workloads.CHAIN === 1.5);
  await page.click('#viewScheduleBtn');
  const updatedEnd = Number(await page.locator(`[data-row-id="${worker.id}"] .rest-closing`).textContent());
  await page.click('#notesBtn');
  const textarea = page.locator('#modalCard textarea');
  await textarea.first().fill('桌面回归测试：本地保存、关闭重开与恢复');
  await page.locator('#modalCard button').filter({ hasText: '保存' }).last().click();
  await page.waitForTimeout(400);
  const saved = await snapshot();
  assert.match(JSON.parse(saved[Backup.KEYS[0]]).notes, /桌面回归测试/);
  await app.close();
  await start();
  const reopened = await snapshot();
  assert.equal(JSON.parse(reopened[Backup.KEYS[0]]).restOpenings[workspace.weekStart][worker.id], 6.5);
  assert.equal(JSON.parse(reopened[Backup.KEYS[0]]).workloads.CHAIN, 1.5);
  assert.equal(Number(await page.locator(`[data-row-id="${worker.id}"] .rest-closing`).textContent()), updatedEnd);
  assert.equal(JSON.parse(reopened[Backup.KEYS[0]]).notes, JSON.parse(saved[Backup.KEYS[0]]).notes);
  assert.deepEqual(JSON.parse(reopened[Backup.KEYS[0]]).schedule, JSON.parse(saved[Backup.KEYS[0]]).schedule);
  // 周次切换、生成第二周和跨周下夜班。
  await page.click('#nextWeekBtn');
  await page.click('#generateBtn');
  await page.waitForFunction(() => document.querySelector('#coverageTrend')?.textContent.includes('100'), null, { timeout: 60000 });
  assert.equal(await page.locator(`[data-rest-person="${worker.id}"] span`).first().textContent(), String(updatedEnd));
  const second = await snapshot();
  const next = JSON.parse(second[Backup.KEYS[0]]);
  for (const person of workspace.staff) {
    if (workspace.schedule[person.id][6] === 'NIGHT') assert.equal(next.schedule[person.id][0], 'POST');
  }
  await page.click('#archiveBtn');
  assert.equal(await page.locator('[data-archive-load]').count(), 2);
  await page.locator(`[data-archive-load="${workspace.weekStart}"]`).click();
  await page.locator('#modalCard button').filter({ hasText: /^读取$/ }).click();
  assert.match(await page.locator('#weekLabel').textContent(), /11月16日/);
  await page.click('#dataBtn');
  await page.screenshot({ path: path.join(testRoot, 'data-panel.png'), animations: 'disabled' });
  // 通过真实原生 IPC 恢复备份，并重载验证 beforeunload 不会用旧内容覆盖。
  const storage = Object.fromEntries(Object.entries(saved).filter(([, value]) => value !== null));
  const backup = Backup.makeBackup(storage);
  const backupFile = path.join(testRoot, '测试完整备份.json');
  fs.writeFileSync(backupFile, JSON.stringify(backup));
  await page.setInputFiles('#restoreAllFile', backupFile);
  await page.evaluate(() => { window.__beforeRestore = true; });
  await page.locator('#modalCard button').filter({ hasText: /^恢复数据$/ }).click({ noWaitAfter: true });
  await page.waitForFunction(() => !window.__beforeRestore && window.paibanDesktop, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#coverageTrend')?.textContent.includes('100'), null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const restored = await snapshot();
  assert.equal(JSON.parse(restored[Backup.KEYS[1]]).length, 1);
  assert.equal(JSON.parse(restored[Backup.KEYS[0]]).notes, JSON.parse(saved[Backup.KEYS[0]]).notes);
  assert.ok(fs.readdirSync(path.join(testRoot, 'data', '恢复前备份')).length);
  // 原生备份保存对话框用 Electron 测试端替代选择路径，文件内容仍由生产代码写入。
  const exportFile = path.join(testRoot, '原生导出备份.json');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportFile);
  await page.click('#dataBtn');
  await page.click('#backupAllBtn');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(node => node.textContent.includes('完整备份已保存')));
  assert.equal(Backup.parseBackup(fs.readFileSync(exportFile, 'utf8')).format, 'paiban-backup');
  await page.locator('#modalCard [data-modal-close]').last().click();
  // Word 和 CSV 均使用生产原生保存流程，只在测试中选择输出位置。
  const wordFile = path.join(testRoot, '导出排班.docx');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async (_window, options) => { globalThis.__wordDialog = options; return { canceled: false, filePath }; };
  }, wordFile);
  const beforeExport = await snapshot();
  const previewPromise = app.waitForEvent('window', { predicate: win => win !== page });
  await page.click('#exportBtn');
  let preview = await previewPromise;
  preview.on('pageerror', error => errors.push(error.message));
  await preview.locator('#previewPages .paper').first().waitFor();
  assert.equal(await preview.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await preview.evaluate(() => typeof window.paibanExportDesktop.getItem), 'undefined');
  assert.equal(await preview.locator(`[data-person="${worker.id}"] .owed`).textContent(), `欠${updatedEnd}`);
  assert.equal(await preview.locator(`[data-person="${director.id}"] .owed`).textContent(), '—');
  const zero = await preview.evaluate(() => [...document.querySelectorAll('.owed')].some(node => node.textContent === '欠0'));
  assert.ok(zero);
  await preview.fill('#titleInput', 'CT-MRI 医师周排班表（预览修改）');
  await preview.fill('#annotationsInput', '注：导出预览修改的说明。\n白A：早读片与报告。');
  await preview.fill('#notesInput', '桌面回归测试：本地保存、关闭重开与恢复\n预览新增备注');
  await preview.waitForFunction(() => document.querySelector('.paper-title')?.textContent.includes('预览修改'));
  await preview.locator(`[data-person="${director.id}"] .teaching`).fill('带教甲');
  await preview.locator('#wordBtn').focus();
  await preview.waitForFunction(() => document.querySelector('.annotation-cell')?.textContent.includes('预览新增备注'));
  await preview.screenshot({ path: path.join(testRoot, 'export-preview.png'), animations: 'disabled' });
  await preview.click('#wordBtn');
  await preview.waitForFunction(() => document.querySelector('#exportStatus')?.textContent.includes('已导出 Word'));
  assert.equal(fs.readFileSync(wordFile).subarray(0, 2).toString(), 'PK');
  assert.deepEqual((await app.evaluate(() => globalThis.__wordDialog)).filters[0].extensions, ['docx']);
  const JSZip = require('../vendor/jszip.min');
  const word = await JSZip.loadAsync(fs.readFileSync(wordFile));
  const wordXml = await word.file('word/document.xml').async('string');
  assert.ok(wordXml.includes('桌面回归测试：本地保存、关闭重开与恢复'));
  assert.ok(wordXml.includes('带教'));
  assert.ok(wordXml.includes(director.name));
  for (const value of ['CT-MRI 医师周排班表（预览修改）', '导出预览修改的说明', '带教甲', '预览新增备注', `欠${updatedEnd}`, '欠0']) assert.ok(wordXml.includes(value), value);
  assert.ok(!wordXml.includes('所有报告实行双签名'));
  // 取消保存不产生成功提示，也不会改动排班。
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await preview.click('#wordBtn');
  await preview.waitForFunction(() => !document.querySelector('#wordBtn').disabled);
  assert.equal(await preview.locator('#exportStatus').isHidden(), true);
  const csvFile = path.join(testRoot, '导出排班.csv');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, csvFile);
  await preview.click('#csvBtn');
  await preview.waitForFunction(() => document.querySelector('#exportStatus')?.textContent.includes('已导出 CSV'));
  assert.match(fs.readFileSync(csvFile, 'utf8'), /姓名,类型,上周末欠休,.*本周末欠休/);
  await preview.click('#closeBtn');
  const reopenPreview = app.waitForEvent('window', { predicate: win => win !== page });
  await page.click('#exportBtn'); preview = await reopenPreview;
  await preview.locator('#previewPages .paper').first().waitFor();
  assert.equal(await preview.inputValue('#titleInput'), 'CT-MRI 医师周排班表（预览修改）');
  assert.equal(await preview.locator(`[data-person="${director.id}"] .teaching`).textContent(), '带教甲');
  await preview.click('#resetBtn');
  assert.match(await preview.inputValue('#annotationsInput'), /所有报告实行双签名/);
  assert.equal(await preview.locator(`[data-person="${director.id}"] .teaching`).textContent(), '');
  await preview.screenshot({ path: path.join(testRoot, 'export-default-preview.png'), animations: 'disabled' });
  // 长说明正常分页，不丢失人员或说明内容。
  await preview.fill('#annotationsInput', Array.from({ length: 80 }, (_, i) => `说明${i + 1}：分页预览检查。`).join('\n'));
  await preview.waitForFunction(() => document.querySelectorAll('#previewPages .paper').length > 1);
  assert.equal(await preview.locator('#previewPages tr[data-person]').count(), workspace.staff.length);
  assert.match(await preview.locator('#previewPages').textContent(), /说明80：分页预览检查。/);
  await preview.selectOption('#zoomSelect', '1');
  assert.ok(await preview.evaluate(() => document.querySelector('.sheet-wrap').clientWidth > 1100));
  await preview.screenshot({ path: path.join(testRoot, 'export-long-preview.png'), animations: 'disabled' });
  await preview.fill('#annotationsInput', '长'.repeat(6500));
  await preview.waitForFunction(() => [...document.querySelectorAll('#previewPages .annotation-cell p')].reduce((n, p) => n + [...p.textContent].filter(c => c === '长').length, 0) === 6500);
  assert.ok(await preview.locator('#previewPages .paper').count() > 1);
  assert.ok(await preview.evaluate(() => [...document.querySelectorAll('#previewPages .paper')].every(paper => paper.querySelector('table').getBoundingClientRect().bottom < paper.getBoundingClientRect().bottom)), '长段落预览不应截断');
  await preview.click('#resetBtn');
  // 窄窗口仍可操作，长表只在预览区滚动。
  await app.evaluate(({ BrowserWindow }) => {
    const child = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/desktop/export.html'));
    child.setSize(1000, 700);
  });
  assert.ok(await preview.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await preview.click('#closeBtn');
  assert.deepEqual(await snapshot(), beforeExport, '预览编辑不应改变实际排班或历史存档');
  let printOptions;
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.print = (options, callback) => { globalThis.__printOptions = options; callback(true); };
  });
  await page.click('#printBtn');
  printOptions = await app.evaluate(() => globalThis.__printOptions);
  assert.equal(printOptions.landscape, true);
  assert.equal(printOptions.pageSize, 'A4');
  await page.screenshot({ path: path.join(testRoot, 'main-window.png'), animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(1100, 800);
  });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '窄桌面窗口不应产生页面横向溢出');
  await page.click('#dataBtn');
  await page.screenshot({ path: path.join(testRoot, 'narrow-window.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  await app.close();
  console.log(`PASS: 桌面生成、规则校验、重启持久化、双周历史、跨周衔接、界面恢复、原生备份、隔离检查。\n输出：${testRoot}`);
})().catch(async err => {
  console.error(err);
  if (page) await page.screenshot({ path: path.join(testRoot, 'failure.png') }).catch(() => {});
  if (app) await app.close().catch(() => {});
  process.exitCode = 1;
});

