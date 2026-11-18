/* 浏览器迁移与桌面备份共用格式。只接受本软件的三个数据项。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rule-config'));
  else root.PaibanBackup = factory(root.PaibanRules);
})(typeof window === 'object' ? window : globalThis, function (Rules) {
  'use strict';
  const KEYS = ['paiban.workspace.v1', 'paiban.schedules.v1', 'paiban.rosters.v1'];
  const fail = message => { throw new Error(`备份格式不正确：${message}`); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function ruleConfig(record) {
    try { return Rules.read(record.ruleConfig); } catch (error) { fail(error.message); }
  }
  function staff(list, roles) {
    if (!Array.isArray(list)) fail('人员名单必须为列表');
    const ids = new Set();
    for (const person of list) {
      if (!object(person) || typeof person.id !== 'string' || !person.id || typeof person.name !== 'string' || !person.name.trim() || !roles.some(role => role.id === person.role) || ids.has(person.id)) fail('人员姓名、编号或职位无效');
      ids.add(person.id);
    }
    return ids;
  }
  const isMonday = week => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return false;
    const date = new Date(`${week}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === week && date.getUTCDay() === 1;
  };
  const isBalanceMap = map => object(map) && Object.values(map).every(value =>
    typeof value === 'number' && value >= 0 && Number.isSafeInteger(value * 2));
  function week(record) {
    if (!object(record)) fail('排班记录无效');
    const rules = ruleConfig(record);
    const ids = staff(record.staff, rules.roles);
    const shiftIds = new Set([...rules.shifts.map(shift => shift.id), ...Rules.STATUS_KEYS]);
    if (!isMonday(record.weekStart)) fail('排班日期必须是有效的周一');
    if (!object(record.schedule)) fail('缺少排班表');
    for (const [id, row] of Object.entries(record.schedule)) {
      if (!ids.has(id) || !Array.isArray(row) || row.length !== 7 || row.some(s => s != null && !shiftIds.has(s))) fail('排班人员或班次无效');
    }
    if (record.notes != null && typeof record.notes !== 'string') fail('备注无效');
    if (record.restTracked != null && typeof record.restTracked !== 'boolean') fail('欠休结转状态无效');
    if (record.restOpening != null && !isBalanceMap(record.restOpening)) fail('期初欠休无效');
    if (record.restOpenings != null && (!object(record.restOpenings) || !Object.entries(record.restOpenings).every(([week, map]) => isMonday(week) && isBalanceMap(map)))) fail('期初欠休设置无效');
  }
  function validateStorage(storage) {
    if (!object(storage) || Object.keys(storage).some(key => !KEYS.includes(key))) fail('包含未知数据项');
    if (!Object.keys(storage).length) fail('没有可恢复的数据');
    for (const key of KEYS) {
      if (!(key in storage)) continue;
      if (typeof storage[key] !== 'string') fail('数据项必须是 JSON 文本');
      let value;
      try { value = JSON.parse(storage[key]); } catch { fail('数据项无法解析'); }
      if (key === KEYS[0]) week(value);
      if (key === KEYS[1]) {
        if (!Array.isArray(value)) fail('历史存档必须为列表');
        const seen = new Set();
        for (const record of value) {
          week(record);
          if (seen.has(record.weekStart)) fail('历史存档周次重复');
          seen.add(record.weekStart);
        }
      }
      if (key === KEYS[2]) {
        if (!Array.isArray(value)) fail('名单方案必须为列表');
        value.forEach(profile => { if (!object(profile) || typeof profile.name !== 'string') fail('名单方案无效'); staff(profile.staff, ruleConfig(profile).roles); });
      }
    }
    return storage;
  }
  function parseBackup(input) {
    const data = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : input;
    if (!object(data) || data.format !== 'paiban-backup' || data.version !== 1) fail('请使用“备份全部数据”生成的 JSON 文件');
    validateStorage(data.storage);
    return data;
  }
  function makeBackup(storage) {
    validateStorage(storage);
    return { format: 'paiban-backup', version: 1, exportedAt: new Date().toISOString(), storage };
  }
  return { KEYS, validateStorage, parseBackup, makeBackup };
});
