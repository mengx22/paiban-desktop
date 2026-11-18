'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const Backup = require('../js/backup');

const root = path.resolve(__dirname, '..');
const executablePath = process.argv[2] || path.join(root, '排班工作台', '排班工作台.exe');
const testRoot = path.join(root, 'test-output', `rules-${Date.now()}`);
const env = { ...process.env, PAIBAN_DATA_DIR: testRoot };
delete env.ELECTRON_RUN_AS_NODE;
const [WORKSPACE, ARCHIVE] = Backup.KEYS;
let app;
let page;
const pageErrors = [];

async function start(expectSchedule = true) {
  app = await electron.launch({ executablePath, env });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  if (expectSchedule) await page.waitForFunction(() => document.querySelector('#coverageTrend')?.textContent === '100%');
  else await page.locator('#scheduleEmpty').waitFor();
}

async function read(key) {
  return page.evaluate(key => JSON.parse(window.paibanDesktop.getItem(key)), key);
}

(async () => {
  await start();
  assert.equal((await read(WORKSPACE)).staff.length, 16);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setSize(1080, 740);
  });
  await page.waitForFunction(() => window.innerHeight < 740);
  const geometry = await page.evaluate(() => {
    const table = document.querySelector('#tableScroll');
    const header = table.querySelector('thead th.day-head');
    const firstTop = header.getBoundingClientRect().top;
    table.scrollTop = 90;
    const lastTop = header.getBoundingClientRect().top;
    const result = { scroll: table.scrollTop, sticky: Math.abs(lastTop - firstTop) < 2,
      viewport: document.documentElement.scrollHeight <= window.innerHeight + 2,
      boxes: ['.roster-shell', '.app-main', '#scheduleView', '.schedule-panel', '.schedule-body', '#tableScroll']
        .map(selector => [selector, document.querySelector(selector).clientHeight]) };
    table.scrollTop = 0;
    return result;
  });
  assert.ok(geometry.scroll > 0 && geometry.sticky && geometry.viewport, JSON.stringify(geometry));
  await page.screenshot({ path: path.join(testRoot, 'schedule.png'), animations: 'disabled' });
  assert.equal(await page.locator('#peopleView').isVisible(), false);
  assert.equal(await page.locator('#checksView').isVisible(), false);

  await page.click('#viewPeopleBtn');
  assert.equal(await page.locator('#scheduleView').isVisible(), false);
  await page.screenshot({ path: path.join(testRoot, 'people.png'), animations: 'disabled' });
  await page.click('#shiftCatalogBtn');
  assert.match(await page.locator('.shift-catalog-head').textContent(), /直接修改/);
  await page.fill('[data-rule-shift-name="NIGHT"]', '值夜班');
  await page.click('#ruleAddShift');
  const shiftField = page.locator('[data-rule-shift-name^="shift_"]');
  const shiftId = await shiftField.getAttribute('data-rule-shift-name');
  await shiftField.fill('复核加班');
  await page.click('button[form=ruleConfigForm]');
  const openedRules = app.waitForEvent('window', { predicate: win => win !== page });
  await page.click('#ruleConfigBtn');
  const settings = await openedRules;
  settings.on('pageerror', error => pageErrors.push(error.message));
  await settings.selectOption('#ruleRoleSelect', 'night');
  await settings.fill('#ruleRoleName', '值夜医师');
  await settings.click('#ruleAddRole');
  const roleId = await settings.inputValue('#ruleRoleSelect');
  await settings.fill('#ruleRoleName', '复核医师');
  await settings.fill('#ruleTotalMin', '2');
  await settings.fill('#ruleTotalMax', '1');
  await settings.click('button[form=ruleConfigForm]');
  await settings.locator('#ruleConfigError.show').waitFor();
  assert.match(await settings.locator('#ruleConfigError').textContent(), /下限/);
  await settings.fill('#ruleTotalMin', '1');
  await settings.locator(`[data-rule-day="sun"][value="${shiftId}"]`).check();
  await settings.fill(`[data-rule-min="${shiftId}"]`, '1');
  await settings.fill(`[data-rule-max="${shiftId}"]`, '1');
  await settings.click('button[form=ruleConfigForm]');
  await page.waitForFunction(id => JSON.parse(window.paibanDesktop.getItem('paiban.workspace.v1')).ruleConfig.roles.some(role => role.id === id), roleId);
  const configured = (await read(WORKSPACE)).ruleConfig;
  assert.equal(configured.roles.find(role => role.id === 'night').name, '值夜医师');
  assert.equal(configured.shifts.find(shift => shift.id === 'NIGHT').name, '值夜班');
  assert.equal(configured.roles.find(role => role.id === roleId).min, 1);
  assert.deepEqual(configured.roles.find(role => role.id === roleId).limits[shiftId], { min: 1, max: 1 });

  await page.click('#addStaffBtn');
  await page.fill('#newStaffName', '测试复核医师');
  await page.selectOption('#newStaffRole', roleId);
  await page.click('button[form=addStaffForm]');
  await page.waitForFunction(() => document.querySelectorAll('.person-name-input').length === 17 && !document.querySelector('#requirementBtn').disabled);
  assert.deepEqual((await read(WORKSPACE)).schedule, {});

  await page.click('#viewChecksBtn');
  await page.screenshot({ path: path.join(testRoot, 'checks.png'), animations: 'disabled' });
  await page.click('#requirementBtn');
  await page.fill(`[data-req-type="sun"][data-req-shift="${shiftId}"]`, '1');
  await page.click('#saveRequirementsBtn');
  await page.click('#generateBtn');
  await page.waitForFunction(() => document.querySelector('#coverageTrend')?.textContent === '100%');
  const generated = await read(WORKSPACE);
  const reviewer = generated.staff.find(person => person.role === roleId);
  assert.deepEqual(generated.schedule[reviewer.id], [null, null, null, null, null, null, shiftId]);
  assert.deepEqual((await read(ARCHIVE))[0].ruleConfig, configured);

  await app.close();
  app = null;
  await start();
  assert.deepEqual((await read(WORKSPACE)).ruleConfig, configured);
  assert.deepEqual((await read(WORKSPACE)).schedule[reviewer.id], generated.schedule[reviewer.id]);
  const originalHistory = (await read(ARCHIVE))[0];

  await page.click('#shiftCatalogBtn');
  await page.screenshot({ path: path.join(testRoot, 'shift-catalog.png'), animations: 'disabled' });
  const renamedField = page.locator(`[data-rule-shift-name="${shiftId}"]`);
  await page.click(`[data-rule-delete-shift="${shiftId}"]`);
  await page.click('#ruleCancelShiftDelete');
  assert.equal(await renamedField.count(), 1);
  await page.click(`[data-rule-delete-shift="${shiftId}"]`);
  await page.click('#ruleConfirmShiftDelete');
  assert.equal(await renamedField.count(), 0);
  assert.ok((await read(WORKSPACE)).ruleConfig.shifts.some(shift => shift.id === shiftId));
  await page.click('button[form=ruleConfigForm]');
  const deleted = await read(WORKSPACE);
  assert.ok(!deleted.ruleConfig.shifts.some(shift => shift.id === shiftId));
  assert.ok(deleted.ruleConfig.roles.every(role => !role.allowed.sun.includes(shiftId) && !role.limits[shiftId]));
  assert.equal(deleted.requirements.sun[shiftId], undefined);
  assert.equal(deleted.workloads[shiftId], undefined);
  assert.equal(deleted.waitingForSchedule, true);
  assert.deepEqual(deleted.schedule, {});
  assert.deepEqual((await read(ARCHIVE))[0], originalHistory);
  await page.click('#viewPeopleBtn');
  const reopenedRules = app.waitForEvent('window', { predicate: win => win !== page });
  await page.click('#ruleConfigBtn');
  const workload = await reopenedRules;
  await workload.click('[data-rule-tab="workload"]');
  assert.equal(await workload.locator(`[data-rule-workload="${shiftId}"]`).count(), 0);
  await workload.screenshot({ path: path.join(testRoot, 'position-workload.png'), animations: 'disabled' });
  const closed = workload.waitForEvent('close');
  try { await workload.keyboard.press('Escape'); } catch (error) { if (!workload.isClosed()) throw error; }
  await closed;
  await app.close();
  app = null;
  await start(false);
  assert.ok(!(await read(WORKSPACE)).ruleConfig.shifts.some(shift => shift.id === shiftId));
  assert.deepEqual((await read(ARCHIVE))[0], originalHistory);
  assert.deepEqual(pageErrors, []);
  await app.close();
  app = null;
  console.log(`PASS: 工作台导航、职位与班次管理、删除确认、岗位数量、排班、历史与重启。\n输出：${testRoot}`);
})().catch(async error => {
  console.error(error);
  if (app) await app.close().catch(() => {});
  process.exitCode = 1;
});
