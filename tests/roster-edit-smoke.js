'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Store } = require('../desktop/store');
const [WORKSPACE, ARCHIVE] = require('../js/backup').KEYS;

const root = path.resolve(__dirname, '..');
const testRoot = path.join(root, 'test-output', `roster-${Date.now()}`);
const executablePath = process.argv[2] || path.join(root, '排班工作台', '排班工作台.exe');
let app;
let page;
const errors = [];

function seed(folder, staff, schedule = {}) {
  const store = new Store(path.join(folder, 'data'));
  store.set(WORKSPACE, JSON.stringify({ version: 3, staff, schedule, weekStart: '2026-11-16', pins: {}, seed: 7 }));
}

async function launch(folder) {
  const env = { ...process.env, PAIBAN_DATA_DIR: folder };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, env });
  page = await app.firstWindow();
  page.on('pageerror', err => errors.push(err.message));
  await page.click('#viewPeopleBtn');
  await page.locator('#addStaffBtn').waitFor();
  await page.waitForFunction(() => !document.querySelector('#addStaffBtn').disabled);
}

async function close() {
  await app.close();
  app = null;
}

async function countStaff(count) {
  await page.waitForFunction(count => document.querySelectorAll('.person-name-input').length === count, count);
}

async function stored(key) {
  return page.evaluate(key => JSON.parse(window.paibanDesktop.getItem(key)), key);
}

async function add(name, role) {
  await page.click('#addStaffBtn');
  await page.fill('#newStaffName', name);
  await page.selectOption('#newStaffRole', role);
  await page.click('button[form=addStaffForm]');
}

async function remove(id) {
  await page.click(`[data-delete-id="${id}"]`);
  await page.click('#confirmGo');
}

async function waitForCompleteSchedule() {
  await page.waitForFunction(() => document.querySelector('#coverageTrend')?.textContent === '100%', null, { timeout: 60000 });
}

async function repairIncompleteRoster() {
  const folder = path.join(testRoot, 'partial');
  const signer = { id: 's', name: '测试签报告', role: 'signer', training: false };
  const writer = { id: 'w', name: '测试写报告', role: 'writer', training: false };
  seed(folder, [signer, writer], { s: ['S1', null, null, null, null, null, null] });
  await launch(folder);
  await add('测试新夜班医师', 'night');
  await countStaff(3);
  assert.deepEqual((await stored(WORKSPACE)).schedule, {});
  assert.equal(await stored(ARCHIVE), null);
  assert.equal(await page.locator('#addStaffBtn').isEnabled(), true);

  await page.selectOption('.role-select[data-role-id="w"]', 'night');
  await page.click('[data-person-id="w"] .training-toggle');
  const updated = (await stored(WORKSPACE)).staff.find(person => person.id === 'w');
  assert.equal(updated.role, 'night');
  assert.equal(updated.training, true);

  await close();
  await launch(folder);
  await countStaff(3);
  assert.deepEqual((await stored(WORKSPACE)).staff.find(person => person.id === 'w'), updated);
  await close();
}

async function replaceOneRequiredSigner() {
  const folder = path.join(testRoot, 'replace');
  await launch(folder);
  await waitForCompleteSchedule();
  const initial = await stored(WORKSPACE);
  const previous = await stored(ARCHIVE);
  const signer = initial.staff.find(person => person.role === 'signer');

  await remove(signer.id);
  await countStaff(15);
  assert.deepEqual((await stored(WORKSPACE)).schedule, {});
  assert.deepEqual(await stored(ARCHIVE), previous);
  assert.equal(await page.locator('#exportBtn').isDisabled(), true);

  await page.click('#viewScheduleBtn');
  await page.click('#undoBtn');
  await waitForCompleteSchedule();
  assert.deepEqual((await stored(WORKSPACE)).schedule, initial.schedule);
  await page.click('#redoBtn');
  await countStaff(15);

  await page.click('#viewPeopleBtn');
  await add('测试替补签报告', 'signer');
  await countStaff(16);
  await page.click('#generateBtn');
  await waitForCompleteSchedule();
  const result = await stored(WORKSPACE);
  assert.ok(result.staff.some(person => person.name === '测试替补签报告'));
  assert.ok(!result.staff.some(person => person.id === signer.id));
  const validation = await page.evaluate(({ staff, schedule, pins }) => window.PaibanScheduler.validate(staff, schedule, pins).ok, result);
  assert.equal(validation, true);
  await close();
}

async function keepAnEmptyRoster() {
  const folder = path.join(testRoot, 'empty');
  seed(folder, [{ id: 'last', name: '最后一名测试医师', role: 'writer', training: false }]);
  await launch(folder);
  await remove('last');
  await countStaff(0);
  assert.deepEqual((await stored(WORKSPACE)).staff, []);
  await close();
  await launch(folder);
  await countStaff(0);
  assert.equal(await page.locator('#addStaffBtn').isEnabled(), true);
  await add('测试从空名单添加', 'writer');
  await countStaff(1);
  await close();
}

(async () => {
  await repairIncompleteRoster();
  await replaceOneRequiredSigner();
  await keepAnEmptyRoster();
  assert.deepEqual(errors, []);
  console.log('PASS: 人数不足时连续编辑、历史保留、撤销与重做、补足人员后排班、空名单重启。');
})().catch(async err => {
  console.error(err);
  if (app) await close().catch(() => {});
  process.exitCode = 1;
});
