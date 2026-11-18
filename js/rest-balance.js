/* 欠休余额以工作量为单位，允许半分。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PaibanRest = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TARGET = 5;
  const MAX_REDUCTION = 2;
  const DEFAULT_WORKLOADS = Object.freeze({
    A: 1, B: 1, C: 1, H: 1, S1: 1, S2: 1, S3: 1, S4: 1,
    WHITE_UP: 0.5, CHAIN: 0.5, NIGHT: 1, SIGN: 1, DAY: 1
  });
  const STATUS_WORKLOADS = Object.freeze({ TRAINING: 1, VILLAGE: 1, TRIP: 1 });
  const exempt = person => person.role === 'director';
  const validBalance = value => typeof value === 'number' && value >= 0 && Number.isSafeInteger(value * 2);
  const valueFor = (map, id) => Object.hasOwn(map || {}, id) && validBalance(map[id]) ? map[id] : undefined;
  const shiftWorkload = (shift, workloads) => STATUS_WORKLOADS[shift] ??
    (Object.hasOwn(workloads || {}, shift) && Number.isFinite(workloads[shift]) ? workloads[shift] : DEFAULT_WORKLOADS[shift]) ?? 0;
  const total = (row, workloads) => (row || []).reduce((sum, shift) => sum + shiftWorkload(shift, workloads), 0);
  const closing = (opening, workload) => Math.max(0, opening - MAX_REDUCTION, opening + workload - TARGET);

  function normalizeOpening(raw, staff) {
    return Object.fromEntries((staff || []).filter(p => valueFor(raw, p.id) !== undefined).map(p => [p.id, raw[p.id]]));
  }

  function openingFor(staff, overrides, inherited) {
    return Object.fromEntries((staff || []).filter(p => !exempt(p)).map(p => [p.id,
      valueFor(overrides, p.id) ?? valueFor(inherited, p.id) ?? 0]));
  }

  function closeWeek(staff, schedule, workloads, opening) {
    return Object.fromEntries((staff || []).filter(p => !exempt(p)).map(p => [p.id,
      closing(valueFor(opening, p.id) ?? 0, total(schedule?.[p.id], workloads))]));
  }

  // 仅接续连续且已启用欠休的存档。按存档使用各周当时的班次分值，重算修改后的后续余额。
  function carryFrom(records, beforeWeek) {
    function previous(week) {
      const date = new Date(`${week}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - 7);
      return date.toISOString().slice(0, 10);
    }
    const byWeek = new Map(records.map(record => [record.weekStart, record]));
    const chain = [];
    let week = previous(beforeWeek);
    while (byWeek.get(week)?.restTracked === true) {
      const record = byWeek.get(week);
      chain.push(record);
      week = previous(week);
    }
    let inherited = {};
    while (chain.length) {
      const record = chain.pop();
      inherited = closeWeek(record.staff, record.schedule, record.workloads,
        openingFor(record.staff, record.restOpening, inherited));
    }
    return inherited;
  }

  return { TARGET, MAX_REDUCTION, DEFAULT_WORKLOADS, STATUS_WORKLOADS, exempt, validBalance, valueFor,
    shiftWorkload, total, closing, normalizeOpening, openingFor, closeWeek, carryFrom };
});
