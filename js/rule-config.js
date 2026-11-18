/* 职位和班次的可编辑设置。稳定编号用于排班、历史和备份。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PaibanRules = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const DAY_TYPES = [
    { key: 'weekday', label: '工作日', days: 5 },
    { key: 'sat', label: '周六', days: 1 },
    { key: 'sun', label: '周日', days: 1 }
  ];
  const DAYS_PER_WEEK = 7;
  const NON_WORK_NAMES = ['休', '休息', '下', '下夜班', '进修', '下乡', '休假', '出差'];
  const STATUS_KEYS = ['POST', 'TRAINING', 'VILLAGE', 'VACATION', 'TRIP'];
  const DEFAULT_SHIFT_NAMES = {
    A: '白A', B: '白B', C: '白C', H: '白H', S1: '白签1', S2: '白签2', S3: '白签3', S4: '白签4',
    SIGN: '白签', WHITE_UP: '白上', CHAIN: '连班', NIGHT: '夜+白上', DAY: '白班'
  };
  const role = (id, name, max, weekday, sat, sun) => ({ id, name, min: 0, max, allowed: { weekday, sat, sun }, limits: {} });
  const DEFAULT = {
    version: 1,
    shifts: Object.entries(DEFAULT_SHIFT_NAMES).map(([id, name]) => ({ id, name })),
    roles: [
      role('director', '科主任', 2, ['DAY', 'S2'], [], []),
      role('signer', '签报告医师', 5, ['S1', 'S2', 'S3', 'S4'], ['SIGN'], ['SIGN']),
      role('writer', '写报告医师', 5, ['A', 'B', 'C', 'H', 'CHAIN'], ['DAY', 'WHITE_UP', 'CHAIN'], ['DAY', 'CHAIN']),
      role('night', '夜班报告医师', 5, ['A', 'B', 'C', 'H', 'CHAIN', 'NIGHT'], ['DAY', 'WHITE_UP', 'CHAIN', 'NIGHT'], ['DAY', 'CHAIN', 'NIGHT'])
    ]
  };
  const defaultRoles = new Set(DEFAULT.roles.map(item => item.id));
  const defaultShifts = new Set(DEFAULT.shifts.map(item => item.id));
  const defaults = () => JSON.parse(JSON.stringify(DEFAULT));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw new Error(message); };

  function checkNames(items, defaultIds, prefix, label, keepDefaults = false) {
    const ids = new Set();
    const names = new Set();
    for (const item of items) {
      if (!object(item) || typeof item.id !== 'string' || (!defaultIds.has(item.id) && !new RegExp(`^${prefix}_[a-z0-9-]{1,48}$`).test(item.id)) || ids.has(item.id)) {
        fail(`${label}编号无效或重复。`);
      }
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name || name.length > 24) fail(`${label}名称须为 1–24 个字符。`);
      if (names.has(name)) fail(`${label}名称「${name}」重复。`);
      if (prefix === 'shift' && NON_WORK_NAMES.includes(name)) fail(`「${name}」是固定状态，请为班次选择其他名称。`);
      ids.add(item.id);
      names.add(name);
    }
    if (keepDefaults && [...defaultIds].some(id => !ids.has(id))) fail(`配置缺少原有${label}。`);
    return ids;
  }

  function checkRange(range, label) {
    if (!object(range) || !Number.isInteger(range.min) || !Number.isInteger(range.max)
      || range.min < 0 || range.max > DAYS_PER_WEEK || range.min > range.max) {
      fail(`${label}须满足 0 ≤ 下限 ≤ 上限 ≤ 7。`);
    }
    return { min: range.min, max: range.max };
  }

  function read(raw) {
    if (raw == null) return defaults();
    if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.roles) || !Array.isArray(raw.shifts)) fail('职位与班次配置格式无效。');
    const shiftIds = checkNames(raw.shifts, defaultShifts, 'shift', '班次');
    checkNames(raw.roles, defaultRoles, 'role', '职位', true);
    const shifts = raw.shifts.map(({ id, name }) => ({ id, name: name.trim() }));
    const names = new Map(shifts.map(shift => [shift.id, shift.name]));
    const roles = raw.roles.map(item => {
      const { id, name } = item;
      const bounds = checkRange(item, `「${name}」的每周总班次`);
      if (!object(item.allowed) || !object(item.limits)) fail(`「${name}」的班次设置无效。`);
      const allowed = {};
      for (const day of DAY_TYPES) {
        const list = item.allowed[day.key];
        if (!Array.isArray(list) || list.some(shift => !shiftIds.has(shift))) fail(`「${name}」的${day.label}班次无效。`);
        allowed[day.key] = [...new Set(list)];
      }
      const limits = {};
      for (const [shift, range] of Object.entries(item.limits)) {
        if (!shiftIds.has(shift)) fail(`「${name}」的单班次范围引用了未知班次。`);
        limits[shift] = checkRange(range, `「${name}」的「${names.get(shift)}」`);
        const possible = DAY_TYPES.reduce((total, day) => total + (allowed[day.key].includes(shift) ? day.days : 0), 0);
        if (range.min > possible) fail(`「${name}」的「${names.get(shift)}」下限超过允许排班的天数。`);
      }
      if (Object.values(limits).reduce((total, range) => total + range.min, 0) > bounds.max) fail(`「${name}」各班次下限之和超过每周总班次上限。`);
      return { id, name: name.trim(), ...bounds, allowed, limits };
    });
    return { version: 1, roles, shifts };
  }

  return { DAY_TYPES, DAYS_PER_WEEK, STATUS_KEYS, defaults, read };
});
