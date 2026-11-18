'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../vendor/logic-solver.bundle');
global.Logic = window.Logic;
delete global.window;
const S = require('../js/scheduler');
delete global.Logic;
const Rest = require('../js/rest-balance');
const Rules = require('../js/rule-config');

const worker = { id: 'doctor', name: '医师', role: 'writer' };
const director = { id: 'chief', name: '主任', role: 'director' };

test('工作量包括半分班次和三类出勤状态；欠休抵扣有下限和每周上限', () => {
  assert.deepEqual(S.DEFAULT_WORKLOADS, { A: 1, B: 1, C: 1, H: 1, S1: 1, S2: 1, S3: 1, S4: 1,
    WHITE_UP: 0.5, CHAIN: 0.5, NIGHT: 1, SIGN: 1, DAY: 1 });
  const row = ['TRAINING', 'VILLAGE', 'TRIP', 'CHAIN', 'WHITE_UP', 'NIGHT', 'POST'];
  assert.equal(S.totalWorkload(row), 5);
  assert.equal(S.countWork(row), 3);
  assert.equal(Rest.total(row, S.getWorkloads()), 5);
  assert.equal(Rest.closing(4, 0.5), 2);
  assert.equal(Rest.closing(0.5, 3.5), 0);
  assert.equal(Rest.closing(1.5, 4.5), 1);
  assert.equal(Rest.closing(1.5, 5), 1.5);
  assert.equal(Rest.closing(1.5, 5.5), 2);
  assert.equal(Rest.total(['VACATION', 'POST', null], S.getWorkloads()), 0);
  assert.deepEqual(Rest.closeWeek([director, worker], { doctor: row }, S.getWorkloads(), { doctor: 2, chief: 4 }), { doctor: 2 });
  assert.equal(S.setWorkloads({ A: 1.5 }).A, 1.5);
  S.setWorkloads();
});

test('连续周按各周分值计算，旧周改动会传到后续，手填覆盖结转，断周不会跳过', () => {
  const first = { weekStart: '2026-11-02', staff: [worker], restTracked: true, restOpening: { doctor: 4.5 },
    schedule: { doctor: ['DAY', 'DAY', 'DAY', 'DAY', 'DAY', 'CHAIN', null] }, workloads: {} };
  const second = { weekStart: '2026-11-09', staff: [worker], restTracked: true, restOpening: {},
    schedule: { doctor: ['DAY', 'DAY', null, null, null, null, null] }, workloads: { DAY: 2 } };
  assert.deepEqual(Rest.carryFrom([second, first], '2026-11-16'), { doctor: 4 });
  first.restOpening.doctor = 2;
  assert.deepEqual(Rest.carryFrom([first, second], '2026-11-16'), { doctor: 1.5 });
  second.restOpening.doctor = 0;
  assert.deepEqual(Rest.carryFrom([first, second], '2026-11-16'), { doctor: 0 });
  assert.deepEqual(Rest.carryFrom([first], '2026-11-16'), {});
  assert.deepEqual(Rest.carryFrom([{ ...second, restTracked: false }, first], '2026-11-16'), {});
  assert.deepEqual(Rest.normalizeOpening({ doctor: -1, chief: 0.25 }, [worker, director]), {});
});

test('自动排班在保留锁定和硬规则时，可以选择让欠休较高的人员少排', () => {
  const config = Rules.defaults();
  config.roles.find(role => role.id === 'writer').allowed = { weekday: ['DAY'], sat: ['DAY'], sun: ['DAY'] };
  S.setRuleConfig(config);
  S.setRequirements(Object.fromEntries(S.DAY_TYPES.map(({ key }) => [key,
    Object.fromEntries(S.WORKLOAD_KEYS.map(id => [id, id === 'DAY' ? 1 : 0]))])));
  const staff = [worker, { ...worker, id: 'second', name: '另一位医师' }];
  const pins = { 'doctor|0': { shift: 'DAY', at: 1 }, 'second|2': { shift: 'OFF', at: 2 } };
  try {
    const initial = S.generate(staff, { pins, quota: 0, diversify: false });
    assert.equal(initial.ok, true);
    const high = staff.find(person => S.totalWorkload(initial.schedule[person.id]) > 3);
    const opening = { [high.id]: 4 };
    const result = S.generate(staff, { pins, quota: 0, diversify: false, restOpening: opening });
    assert.equal(result.ok, true);
    assert.deepEqual(result.pins, pins);
    assert.equal(result.schedule.doctor[0], 'DAY');
    assert.equal(result.schedule.second[2], null);
    assert.equal(S.totalWorkload(result.schedule[high.id]), 3);
    assert.equal(Rest.closeWeek(staff, result.schedule, S.getWorkloads(), opening)[high.id], 2);
  } finally { S.setRuleConfig(); S.resetRequirements(); }
});
