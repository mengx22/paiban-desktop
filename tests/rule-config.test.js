'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../vendor/logic-solver.bundle');
global.Logic = window.Logic;
delete global.window;
const S = require('../js/scheduler');
delete global.Logic;
const Rules = require('../js/rule-config');
const Backup = require('../js/backup');

const roleId = 'role_review';
const shiftId = 'shift_review';
const person = { id: 'reviewer', name: '测试医师', role: roleId, training: false };
function customRules() {
  const config = Rules.defaults();
  config.shifts.push({ id: shiftId, name: '复核班' });
  config.roles.push({ id: roleId, name: '复核医师', min: 2, max: 2,
    allowed: { weekday: [], sat: [shiftId], sun: ['DAY', shiftId] }, limits: { [shiftId]: { min: 1, max: 1 } } });
  return config;
}
function requirements(saturday, sunday) {
  const empty = Object.fromEntries(S.WORKLOAD_KEYS.map(shift => [shift, 0]));
  return { weekday: empty, sat: { ...empty, ...saturday }, sun: { ...empty, ...sunday } };
}
afterEach(() => { S.setRuleConfig(); S.resetRequirements(); });

test('自定义职位和班次达到总范围及单班次范围，且只能排勾选日期', () => {
  S.setRuleConfig(customRules());
  S.setRequirements(requirements({ [shiftId]: 1 }, { DAY: 1 }));
  assert.equal(S.isEligible(roleId, 0, shiftId), false);
  assert.equal(S.isEligible(roleId, 5, shiftId), true);
  const result = S.generate([person], { seed: 7 });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(result.schedule.reviewer, [null, null, null, null, null, shiftId, 'DAY']);
  const wrong = { reviewer: [shiftId, null, null, null, null, shiftId, 'DAY'] };
  assert.deepEqual(new Set(S.validate([person], wrong).violations.map(item => item.type)), new Set(['role', 'weeklyTotal', 'weeklyShift']));
});

test('规则下限无法达到时返回无解，进修人员免除下限', () => {
  S.setRuleConfig(customRules());
  S.setRequirements(requirements({}, { DAY: 1 }));
  const result = S.generate([person], { seed: 7 });
  assert.equal(result.ok, false);
  assert.match(result.error.hints.join(' '), /至少|下限/);
  assert.ok(S.validate([{ ...person, training: true }], { reviewer: Array(7).fill('TRAINING') }).violations.every(item => item.type === 'coverage'));
});

test('当所有分配均需要超过单班次上限时不能出表', () => {
  S.setRuleConfig(customRules());
  S.setRequirements(requirements({ [shiftId]: 1 }, { [shiftId]: 1 }));
  const result = S.generate([person]);
  assert.equal(result.ok, false);
  assert.match(result.error.hints.join(' '), /最多能排 1 班/);
});

test('改名夜班仍保有周日到下周一的下夜班衔接', () => {
  const config = Rules.defaults();
  config.shifts.find(item => item.id === 'NIGHT').name = '急诊夜班';
  S.setRuleConfig(config);
  S.setRequirements(requirements({}, { NIGHT: 1 }));
  const night = { ...person, role: 'night' };
  const first = S.generate([night], { seed: 7 });
  assert.equal(first.ok, true);
  const second = S.generate([night], { previousWeek: first.schedule, seed: 7 });
  assert.equal(second.ok, true);
  assert.equal(second.schedule.reviewer[0], 'POST');
  assert.equal(S.shiftName('NIGHT'), '急诊夜班');
});

test('完整备份可使用自定义编号，旧版记录仍使用默认编号', () => {
  const [workspace, archive, rosters] = Backup.KEYS;
  const config = customRules();
  const current = { staff: [person], weekStart: '2026-11-16', schedule: { reviewer: [null, null, null, null, null, shiftId, 'DAY'] }, ruleConfig: config };
  const old = { staff: [{ ...person, role: 'writer' }], weekStart: '2026-11-09', schedule: { reviewer: ['A', null, null, null, null, null, null] } };
  const storage = {
    [workspace]: JSON.stringify(current),
    [archive]: JSON.stringify([old, current]),
    [rosters]: JSON.stringify([{ id: 'test', name: '医师方案', staff: [person], ruleConfig: config }])
  };
  assert.deepEqual(Backup.parseBackup(JSON.stringify(Backup.makeBackup(storage))).storage, storage);
  assert.throws(() => Backup.makeBackup({ [workspace]: JSON.stringify({ ...current, ruleConfig: null }) }), /职位无效/);
  config.roles.at(-1).limits[shiftId].min = 3;
  assert.throws(() => Rules.read(config), /下限/);
});

test('删除原有班次后，默认岗位、工作量、手动锁定都不会重新引入该班次', () => {
  const config = Rules.defaults();
  config.shifts = config.shifts.filter(shift => shift.id !== 'NIGHT');
  for (const role of config.roles) {
    for (const day of Rules.DAY_TYPES) role.allowed[day.key] = role.allowed[day.key].filter(shift => shift !== 'NIGHT');
  }
  S.setRuleConfig(config);
  S.resetRequirements();
  const night = { ...person, role: 'night' };
  assert.equal(S.requirementCount(6, 'NIGHT'), 0);
  assert.equal(S.WORKLOAD_KEYS.includes('NIGHT'), false);
  assert.equal(S.getWorkloads().NIGHT, undefined);
  assert.deepEqual(S.sanitizePins([night], { 'reviewer|6': { shift: 'NIGHT', at: 1 } }).pins, {});

  // 本周无夜班类型时，上一份存档的周日夜班仍须衔接周一。
  S.setRequirements(requirements({ CHAIN: 1 }, {}));
  const previousWeek = { reviewer: [null, null, null, null, null, null, 'NIGHT'] };
  const result = S.generate([night], { previousWeek, seed: 7 });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(result.schedule.reviewer, ['POST', null, null, null, null, 'CHAIN', null]);
});
