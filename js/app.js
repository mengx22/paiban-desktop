/* 排班工作台 · 交互层 */
(function () {
  'use strict';

  const S = window.PaibanScheduler;
  const Rest = window.PaibanRest;
  const positionWindow = location.hash === '#position-rules';
  if (!S) {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">排班规则引擎加载失败，请确认 vendor/logic-solver.bundle.js 与 js/scheduler.js 存在。</div>';
    return;
  }

  const STORAGE_KEY = 'paiban.workspace.v1';
  const desktop = window.paibanDesktop;
  const storage = desktop || {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key)
  };
  const storageLabel = desktop ? '本地数据文件' : '当前浏览器';
  let restoringData = false;
  const ARCHIVE_KEY = 'paiban.schedules.v1';
  const ROSTER_LIBRARY_KEY = 'paiban.rosters.v1';
  const roleIds = () => Object.keys(S.ROLES);
  const DEFAULT_STAFF = [
    { id: 'demo_01', name: '张三', role: 'director', training: false },
    { id: 'demo_02', name: '李四', role: 'signer', training: false },
    { id: 'demo_03', name: '王五', role: 'signer', training: false },
    { id: 'demo_04', name: '赵六', role: 'signer', training: false },
    { id: 'demo_05', name: '孙七', role: 'signer', training: false },
    { id: 'demo_06', name: '周八', role: 'signer', training: false },
    { id: 'demo_07', name: '吴九', role: 'night', training: false },
    { id: 'demo_08', name: '郑十', role: 'night', training: false },
    { id: 'demo_09', name: '钱一', role: 'night', training: false },
    { id: 'demo_10', name: '陈二', role: 'night', training: false },
    { id: 'demo_11', name: '刘三', role: 'night', training: false },
    { id: 'demo_12', name: '杨四', role: 'writer', training: false },
    { id: 'demo_13', name: '黄五', role: 'writer', training: false },
    { id: 'demo_14', name: '徐六', role: 'writer', training: false },
    { id: 'demo_15', name: '林七', role: 'writer', training: false },
    { id: 'demo_16', name: '何八', role: 'writer', training: false }
  ];

  const state = {
    staff: [],
    schedule: {},
    pins: {},
    workloads: {},
    requirements: null,
    seed: 7,
    weekStart: getMonday(new Date()),
    previousWeek: null,
    notes: '',
    owedRest: {}, // 旧版文字备注
    restOpenings: {},
    restInherited: {},
    restTracked: false,
    history: [],
    future: [],
    busy: false,
    lastError: null,
    hasLoaded: false,
    storageOk: true,
    savedAt: null,
    waitingForSchedule: false,
    pinSeq: 1,
    view: null
  };

  const els = {};
  let saveTimer = null;
  let toastSeq = 0;
  let modalReturnFocus = null;

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                           */
  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getMonday(input) {
    const d = new Date(input.getFullYear(), input.getMonth(), input.getDate());
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  function formatDate(d, withYear) {
    const prefix = withYear ? `${d.getFullYear()}年` : '';
    return `${prefix}${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function formatShortDate(d) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return null;
    return getMonday(date);
  }

  function archiveIdFor(start) {
    return isoDate(start || state.weekStart);
  }

  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  function weekDates() {
    return Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  }

  function weekRangeLabelFor(start) {
    const first = start;
    const last = addDays(start, 6);
    const sameYear = first.getFullYear() === last.getFullYear();
    const left = sameYear
      ? `${first.getFullYear()}年${first.getMonth() + 1}月${first.getDate()}日`
      : formatDate(first, true);
    return `${left} — ${formatDate(last, !sameYear)} · 第${isoWeek(first)}周`;
  }

  function weekRangeLabel() {
    return weekRangeLabelFor(state.weekStart);
  }

  function roleName(role) { return S.ROLES[role]?.label || role; }
  function roleColor(role) { return ['director', 'signer', 'writer', 'night'].includes(role) ? role : 'night'; }
  function normalizeRole(role) { return S.ROLES[role] ? role : 'writer'; }

  function normalizeStaffList(rawStaff, options) {
    const promoteNight = !!(options && options.promoteNight);
    const usedIds = new Set();
    const staff = (Array.isArray(rawStaff) ? rawStaff : [])
      .filter(person => person && person.name && person.role)
      .map(person => {
        let id = String(person.id || S.createId('p'));
        while (usedIds.has(id)) id = S.createId('p');
        usedIds.add(id);
        return {
          id,
          name: String(person.name),
          role: normalizeRole(person.role),
          training: !!person.training
        };
      });
    // 仅对旧版本做一次迁移：旧数据没有“夜班报告医师”，补足夜班能力，避免升级后夜班无人可排。
    // v3 之后即使使用者把所有人改成写报告医师，也不会被反复强行改回。
    if (promoteNight && staff.length && !staff.some(person => person.role === 'night')) {
      staff.filter(person => person.role === 'writer').slice(0, 5).forEach(person => { person.role = 'night'; });
    }
    return staff;
  }
  function initials(name) {
    const chars = Array.from(String(name || '医').trim());
    return chars.slice(0, 1).join('') || '医';
  }

  function pinCount() { return Object.keys(state.pins || {}).length; }

  function hasAnyWork(schedule, staff = state.staff) {
    const map = schedule || state.schedule;
    return staff.some(person => (map[person.id] || []).some(shift => S.isWorkShift(shift)));
  }

  function hasCompleteTable() {
    return hasAnyWork() || (!state.waitingForSchedule && S.WEEKLY_SLOT_COUNT === 0 && state.staff.length > 0
      && state.staff.every(person => state.schedule[person.id]?.length === 7));
  }

  function findStaff(id) {
    return state.staff.find(person => person.id === id);
  }

  function dayDate(dayIndex) {
    const dates = weekDates();
    return dates[dayIndex];
  }

  function dayDateLabel(dayIndex) {
    return formatShortDate(dayDate(dayIndex));
  }

  function pinAt() {
    state.pinSeq = Math.max(state.pinSeq + 1, Date.now());
    return state.pinSeq;
  }

  function recalcPinSeq() {
    let max = 0;
    Object.values(state.pins || {}).forEach(pin => { max = Math.max(max, Number(pin.at) || 0); });
    state.pinSeq = Math.max(Date.now(), max + 1);
  }

  function nextPaint() {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(finish, 38));
      }
      // 后台标签页或无渲染帧的环境（如部分无头浏览器）也要继续求解。
      setTimeout(finish, 140);
    });
  }

  function formatClock(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function sortPins(pins) {
    return Object.keys(pins || {}).map(key => {
      const [staffId, day] = key.split('|');
      return { key, staffId, day: Number(day), shift: pins[key].shift, at: pins[key].at };
    }).sort((a, b) => a.day - b.day || a.at - b.at);
  }

  /* ------------------------------------------------------------------ */
  /* 初始化与持久化                                                      */
  /* ------------------------------------------------------------------ */

  function defaultState() {
    S.setRuleConfig();
    state.staff = clone(DEFAULT_STAFF);
    state.schedule = {};
    state.waitingForSchedule = false;
    state.pins = {};
    state.workloads = S.setWorkloads(S.DEFAULT_WORKLOADS);
    state.requirements = S.resetRequirements();
    state.weekStart = getMonday(new Date());
    state.notes = '';
    state.owedRest = {};
    state.restOpenings = {};
    state.restTracked = false;
    state.seed = 7;
    refreshPreviousWeek();
  }

  function loadState() {
    let raw = null;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (err) {
      state.storageOk = false;
    }

    if (!raw) {
      defaultState();
      return;
    }

    try {
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.staff)) throw new Error('invalid staff');
      const needsNightMigration = !data.version || Number(data.version) < 3;
      S.setRuleConfig(data.ruleConfig);
      const staff = normalizeStaffList(data.staff, { promoteNight: needsNightMigration });
      if (data.staff.length && !staff.length) throw new Error('invalid staff');
      state.staff = staff;
      state.weekStart = parseIsoDate(data.weekStart) || getMonday(new Date());
      state.requirements = S.setRequirements(data.requirements || S.DEFAULT_REQUIREMENTS);
      state.schedule = normalizeSchedule(data.schedule, staff);
      state.waitingForSchedule = data.waitingForSchedule === true;
      state.pins = normalizePins(data.pins, staff);
      state.workloads = S.setWorkloads(workloadsForRecord(data));
      state.restOpenings = normalizeRestDrafts(data.restOpenings);
      state.restTracked = data.restTracked === true;
      state.notes = typeof data.notes === 'string' ? data.notes : '';
      state.owedRest = normalizeOwedRest(data.owedRest, staff);
      state.seed = Number(data.seed) || 7;
      state.savedAt = data.savedAt || null;
      recalcPinSeq();
      refreshPreviousWeek();
    } catch (err) {
      defaultState();
    }
  }

  function normalizeSchedule(raw, staff) {
    const schedule = {};
    staff.forEach(person => {
      const source = raw && Array.isArray(raw[person.id]) ? raw[person.id] : [];
      const row = [];
      for (let d = 0; d < 7; d++) {
        let value = source[d];
        if (!value || value === 'OFF' || value === 'REST') value = null;
        if (value === 'UP') value = d < 5 ? 'S1' : 'SIGN';
        if (value && !S.SHIFTS[value]) value = null;
        if (person.training) value = 'TRAINING';
        if (!person.training && value === 'TRAINING') value = null;
        row.push(value);
      }
      schedule[person.id] = row;
    });
    return schedule;
  }

  function normalizePins(raw, staff) {
    const pins = {};
    if (!raw || typeof raw !== 'object') return pins;
    const staffIds = new Set(staff.map(p => p.id));
    Object.keys(raw).forEach(key => {
      const [staffId, dayRaw] = key.split('|');
      const day = Number(dayRaw);
      const pin = raw[key];
      if (!staffIds.has(staffId) || !pin || !Number.isInteger(day) || day < 0 || day > 6) return;
      let shift = typeof pin === 'string' ? pin : pin && pin.shift;
      if (shift === 'UP') shift = day < 5 ? 'S1' : 'SIGN';
      if (shift && shift !== 'OFF' && shift !== 'POST' && !S.SHIFTS[shift]) return;
      if (typeof pin === 'string') {
        pins[key] = { shift, at: 0 };
      } else if (shift) {
        pins[key] = { shift, at: Number(pin.at) || 0 };
      }
    });
    return pins;
  }

  function saveState(immediate) {
    clearTimeout(saveTimer);
    const doSave = () => {
      try {
        const payload = {
          version: 4,
          staff: state.staff,
          ruleConfig: S.getRuleConfig(),
          schedule: state.schedule,
          ...(state.waitingForSchedule ? { waitingForSchedule: true } : {}),
          pins: state.pins,
          workloads: state.workloads,
          requirements: state.requirements || S.getRequirements(),
          weekStart: isoDate(state.weekStart),
          notes: state.notes || '',
          owedRest: state.owedRest || {},
          restOpenings: state.restOpenings,
          restTracked: state.restTracked,
          seed: state.seed,
          savedAt: Date.now()
        };
        storage.setItem(STORAGE_KEY, JSON.stringify(payload));
        // 工作区可以暂时无解，历史库只自动收录通过校验的班表。
        if (hasCompleteTable()) {
          const validation = S.validate(state.staff, state.schedule, state.pins, { previousWeek: state.previousWeek });
          if (validation.ok && !archiveCurrentWeek(validation)) throw new Error('本周历史存档写入失败');
        }
        state.storageOk = true;
        state.savedAt = payload.savedAt;
        if (els.saveState) els.saveState.textContent = `已保存 ${formatClock(new Date(payload.savedAt))}`;
        if (els.saveState) {
          els.saveState.classList.remove('saving');
          els.saveState.title = `人员、排班与备注保存在${storageLabel}`;
        }
      } catch (err) {
        state.storageOk = false;
        if (els.saveState) {
          els.saveState.textContent = '未能写入本机存储';
          els.saveState.classList.remove('saving');
          els.saveState.title = err.message || '请检查数据目录是否可写';
        }
      }
    };
    if (immediate) {
      doSave();
    } else {
      if (els.saveState) {
        els.saveState.textContent = '正在保存…';
        els.saveState.classList.add('saving');
      }
      saveTimer = setTimeout(doSave, 220);
    }
  }

  function workloadsForRecord(record) {
    const values = { ...record.workloads };
    // 旧版内置班次用的是另一套工分；自定义班次的设定照常保留。
    if (Number(record.version) < 4 || !record.version) {
      Object.keys(Rest.DEFAULT_WORKLOADS).forEach(id => { delete values[id]; });
    }
    return values;
  }

  function normalizeRestDrafts(raw) {
    return Object.fromEntries(Object.entries(raw || {}).filter(([week, map]) => {
      const date = parseIsoDate(week);
      return date && date.getDay() === 1 && map && typeof map === 'object' && !Array.isArray(map);
    }).map(([week, map]) => [week, Object.fromEntries(Object.entries(map).filter(([, value]) => Rest.validBalance(value)))]));
  }

  function currentRestOverrides() {
    return state.restOpenings[archiveIdFor()] || {};
  }

  function readArchiveRest(record) {
    const week = archiveIdFor();
    if (record?.restTracked && !Object.hasOwn(state.restOpenings, week)) {
      state.restOpenings[week] = Rest.normalizeOpening(record.restOpening, record.staff);
    }
    state.restTracked = record?.restTracked === true || Object.hasOwn(state.restOpenings, week);
  }

  function restOpening() { return Rest.openingFor(state.staff, currentRestOverrides(), state.restInherited); }

  function normalizeOwedRest(raw, staff) {
    const result = {};
    const valid = new Set((staff || []).map(person => person.id));
    Object.keys(raw && typeof raw === 'object' ? raw : {}).forEach(id => {
      if (!valid.has(id)) return;
      const value = String(raw[id] == null ? '' : raw[id]).trim();
      if (value) result[id] = value.slice(0, 200);
    });
    return result;
  }

  function readJsonStorage(key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      state.storageOk = false;
      return fallback;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      state.storageOk = true;
      return true;
    } catch (err) {
      state.storageOk = false;
      if (els.saveState) {
        els.saveState.textContent = '未能写入本机存储';
        els.saveState.title = err.message || '请检查数据目录是否可写';
      }
      return false;
    }
  }

  function loadArchive() {
    const raw = readJsonStorage(ARCHIVE_KEY, []);
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.records) ? raw.records : []);
    return list
      .filter(record => record && record.weekStart && record.schedule && record.staff)
      .map(record => Object.assign({}, record, { weekStart: String(record.weekStart) }))
      .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
  }

  function writeArchive(records) {
    return writeJsonStorage(ARCHIVE_KEY, records || []);
  }

  function archiveCurrentWeek(validation) {
    if (!state.staff.length || !hasCompleteTable()) return null;
    const check = validation || S.validate(state.staff, state.schedule, state.pins, { previousWeek: state.previousWeek });
    if (!check.ok) return null;
    const id = archiveIdFor();
    const records = loadArchive().filter(record => record.weekStart !== id);
    const { filled, total, nights } = check.totals;
    const record = {
      id: `week_${id}`,
      version: 4,
      weekStart: id,
      weekEnd: isoDate(addDays(state.weekStart, 6)),
      weekLabel: weekRangeLabel(),
      savedAt: Date.now(),
      staff: clone(state.staff),
      ruleConfig: S.getRuleConfig(),
      schedule: clone(state.schedule),
      pins: clone(state.pins),
      requirements: S.getRequirements(),
      workloads: S.getWorkloads(),
      notes: state.notes || '',
      owedRest: clone(state.owedRest || {}),
      ...(state.restTracked ? {
        restTracked: true,
        restOpening: Rest.normalizeOpening(currentRestOverrides(), state.staff)
      } : {}),
      totals: { filled, total, nights }
    };
    records.push(record);
    records.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
    return writeArchive(records) ? record : null;
  }

  function findArchiveRecord(start) {
    const id = typeof start === 'string' ? start : isoDate(start);
    return loadArchive().find(record => record.weekStart === id) || null;
  }

  function refreshPreviousWeek() {
    const records = loadArchive();
    const key = isoDate(addDays(state.weekStart, -7));
    state.previousWeek = records.find(record => record.weekStart === key) || null;
    state.restInherited = Rest.carryFrom(records, archiveIdFor());
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(row => row.some(cell => String(cell).trim() !== ''));
  }

  function shiftFromLabel(label) {
    const text = String(label == null ? '' : label).replace(/\s+/g, '');
    if (!text || text === '休息' || text === '休' || text === 'OFF') return null;
    if (text === '下' || text === '下夜班' || text === 'POST') return 'POST';
    const shift = Object.values(S.SHIFTS).find(info => info.name === text || info.shortName === text);
    if (shift) return shift.key;
    return /^[ABCH]$/.test(text) ? text : null;
  }

  async function importScheduleCsv(file, weekStartIso) {
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch (err) { text = ''; }
    const rows = parseCsvRows(text);
    const headerIndex = rows.findIndex(row => String(row[0] || '').trim() === '姓名' && String(row[2] || '').trim());
    if (headerIndex < 0) {
      const error = $('archiveError');
      if (error) { error.textContent = '没有找到“姓名”表头，请选择本软件导出的 CSV 排班表。'; error.classList.add('show'); }
      return;
    }
    const schedule = {};
    const firstDayColumn = rows[headerIndex][2] === '上周末欠休' ? 3 : 2;
    let matched = 0;
    const names = new Set();
    rows.slice(headerIndex + 1).forEach(row => {
      const name = String(row[0] || '').trim();
      if (!name || name === '规则检查' || name === '岗位覆盖' || name === '本周岗位工分合计' || name === '导出时间') return;
      const person = state.staff.find(item => item.name === name);
      if (!person) return;
      if (names.has(person.id)) return;
      names.add(person.id);
      const rowShifts = Array(7).fill(null);
      for (let d = 0; d < 7; d++) rowShifts[d] = shiftFromLabel(row[d + firstDayColumn]);
      schedule[person.id] = rowShifts;
      matched += 1;
    });
    if (!matched) {
      const error = $('archiveError');
      if (error) { error.textContent = 'CSV 中没有与当前名单同名的医师，未导入。'; error.classList.add('show'); }
      return;
    }
    const start = parseIsoDate(weekStartIso) || addDays(state.weekStart, -7);
    const id = isoDate(start);
    const records = loadArchive().filter(record => record.weekStart !== id);
    const record = {
      id: `week_${id}`,
      version: 4,
      weekStart: id,
      weekEnd: isoDate(addDays(start, 6)),
      weekLabel: weekRangeLabelFor(start),
      savedAt: Date.now(),
      staff: clone(state.staff),
      ruleConfig: S.getRuleConfig(),
      schedule,
      pins: {},
      requirements: S.getRequirements(),
      workloads: S.getWorkloads(),
      notes: '',
      owedRest: {},
      imported: true,
      totals: null
    };
    try {
      const validation = S.validate(state.staff, schedule, {}, {});
      record.totals = {
        filled: validation.totals.filled,
        total: validation.totals.total,
        nights: validation.totals.nights
      };
    } catch (err) { /* keep null */ }
    records.push(record);
    records.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
    if (!writeArchive(records)) {
      toast({ type: 'error', title: '导入未保存', message: '无法写入本地存档，请检查保存位置。' });
      return;
    }
    refreshPreviousWeek();
    renderAll();
    closeModal();
    toast({
      type: 'success',
      title: '上一周排班已导入',
      message: `已从 CSV 读取 ${matched} 名医师，日期 ${id}；下次排班会据此衔接周一“下夜班”。`
    });
  }

  function loadRosterProfiles() {
    const raw = readJsonStorage(ROSTER_LIBRARY_KEY, []);
    return (Array.isArray(raw) ? raw : [])
      .filter(profile => profile && profile.id && Array.isArray(profile.staff) && profile.staff.length)
      .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
  }

  function writeRosterProfiles(profiles) {
    return writeJsonStorage(ROSTER_LIBRARY_KEY, profiles || []);
  }

  function setupEls() {
    [
      'weekLabel', 'saveState', 'undoBtn', 'redoBtn', 'rulesBtn', 'restOpeningBtn', 'requirementBtn', 'archiveBtn', 'exportBtn', 'printBtn',
      'prevWeekBtn', 'nextWeekBtn', 'generateBtn', 'generateBtnText', 'addStaffBtn', 'rosterSub', 'roleSummary', 'staffList',
      'resetBtn', 'rosterProfilesBtn', 'notesBtn', 'notesSummary', 'previousWeekNote', 'weekdayStandards', 'satStandards', 'sunStandards', 'slotBadge', 'lockSummary', 'lockCount',
      'statCoverage', 'statCoverageSub', 'coverageTrend', 'statStaff', 'statStaffSub',
      'statPins', 'statPinsSub', 'statIssues', 'statIssuesSub', 'healthTrend', 'healthStat',
      'coverageStat', 'tableVersionBadge', 'scheduleSub', 'scheduleHost', 'scheduleEmpty',
      'emptyGenerateBtn', 'loadingLayer', 'loadingTitle', 'loadingText', 'scheduleFootMeta',
      'coverageHost', 'coveragePill', 'checksHost', 'checksPill', 'repairBtn', 'checksFootText',
      'rulesLinkBtn', 'toastRoot', 'modalRoot', 'modalCard', 'printTitle', 'printNotes', 'tableScroll'
    ].forEach(id => { els[id] = $(id); });
  }

  async function init() {
    setupEls();
    loadState();
    renderWeekMeta();
    renderStandards();
    bindEvents();
    const description = $('storageDescription');
    if (description) description.textContent = `排班工作台 · ${desktop ? '桌面版 · 数据保存在本地文件' : '网页版 · 数据保存在当前浏览器'}`;
    renderAll();
    updateHistoryButtons();

    const validation = S.validate(state.staff, state.schedule, state.pins, { previousWeek: state.previousWeek });
    if (!state.waitingForSchedule && (!hasCompleteTable() || !validation.ok)) {
      await bootSchedule();
    }
    state.hasLoaded = true;
    if (!state.storageOk) {
      toast({
        type: 'warn',
        title: '本地存储不可用',
        message: `无法写入${storageLabel}，请及时通过“数据备份”导出数据，并检查保存位置。`
      });
    }
    if (desktop) {
      const info = desktop.info();
      if (info.notice) toast({ type: 'warn', title: '数据已从备份恢复', message: info.notice });
    }
  }

  async function bootSchedule() {
    if (!state.staff.length) return;
    const before = capture();
    const result = await runEngine({
      mode: hasAnyWork(before.schedule) ? 'repair' : 'generate',
      preferSchedule: before.schedule,
      pins: state.pins,
      seed: state.seed,
      loadingTitle: hasAnyWork(before.schedule) ? '正在修复排班' : '正在生成第一张排班表',
      loadingText: '校验岗位覆盖、夜班衔接与人员类型…'
    });
    if (!result) return;
    if (!result.ok) {
      state.lastError = result.error;
      renderAll();
      if (state.staff.length > 0) {
        toast({
          type: 'error',
          title: '暂时无法生成排班',
          message: result.error.message || '请检查人员配置。',
          action: { label: '查看建议', run: () => showErrorModal(result.error) }
        });
      }
      return;
    }
    state.schedule = result.schedule;
    state.restTracked = true;
    state.waitingForSchedule = false;
    state.pins = result.pins;
    state.lastError = null;
    renderAll();
    saveState(true);
    if (result.releasedPins && result.releasedPins.length) {
      toast({
        type: 'warn',
        title: '已调整部分旧锁定',
        message: `为满足规则，释放了 ${result.releasedPins.length} 处手动锁定。`,
        action: { label: '查看', run: () => showReleasedModal(result.releasedPins) }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                               */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    const validation = S.validate(state.staff, state.schedule, state.pins, { previousWeek: state.previousWeek });
    const opening = restOpening();
    const hasWork = hasCompleteTable();
    const closing = hasWork && validation.ok ? Rest.closeWeek(state.staff, state.schedule, state.workloads, opening) : {};
    state.view = { validation, hasWork, opening, closing };
    renderWeekMeta();
    renderStandards();
    renderPreviousWeekNote();
    renderRoleSummary(validation);
    renderStaffList();
    renderSchedule(validation);
    renderNotes();
    renderCoverage(validation);
    renderChecks(validation);
    renderStats(validation);
    renderLockSummary();
    updateGenerateButton();
    updateHistoryButtons();
  }

  function renderWeekMeta() {
    if (!els.weekLabel) return;
    els.weekLabel.textContent = weekRangeLabel();
    if (els.printTitle) {
      els.printTitle.dataset.week = weekRangeLabel();
      els.printTitle.dataset.printWorkload = `岗位工分合计 ${S.weeklyWorkload(state.workloads)}`;
      els.printTitle.textContent = '本周排班表';
    }
    if (els.saveState) {
      els.saveState.textContent = state.savedAt ? `已保存 ${formatClock(new Date(state.savedAt))}` : '已在本机保存';
      els.saveState.title = `人员与排班保存在${storageLabel}`;
    }
  }

  function renderStandards() {
    const render = (host, map) => {
      if (!host) return;
      const shifts = Object.keys(map || {}).filter(shift => Number(map[shift]) > 0);
      host.innerHTML = shifts.map(shift => {
        const info = S.SHIFTS[shift];
        const count = Number(map[shift]) || 1;
        return `<span class="standard-chip${shift === 'NIGHT' ? ' night' : ''}${shift === 'WHITE_UP' ? ' white-up' : ''}">${escapeHtml(info.name)}${count > 1 ? ` ×${count}` : ''}</span>`;
      }).join('');
    };
    render(els.weekdayStandards, S.requirementsForDay(0));
    render(els.satStandards, S.requirementsForDay(5));
    render(els.sunStandards, S.requirementsForDay(6));
    if (els.slotBadge) els.slotBadge.textContent = `${S.WEEKLY_SLOT_COUNT} 班/周`;
  }

  function renderPreviousWeekNote() {
    if (!els.previousWeekNote) return;
    if (state.previousWeek) {
      const record = state.previousWeek;
      const sundayNight = (record.schedule && Object.values(record.schedule).some(row => Array.isArray(row) && row[6] === 'NIGHT'));
      els.previousWeekNote.className = 'previous-week-note good';
      els.previousWeekNote.innerHTML = `<svg class="icon"><use href="#i-check-circle"></use></svg>已读取上一周（${escapeHtml(record.weekStart)}）存档${sundayNight ? '，周日夜班将在本周一自动接“下”' : '，上一周周日无夜班'}。`;
      els.previousWeekNote.title = '跨周下夜班依据上一周存档的周日班次计算';
    } else {
      els.previousWeekNote.className = 'previous-week-note warn';
      els.previousWeekNote.innerHTML = `<svg class="icon"><use href="#i-alert"></use></svg>未找到上一周存档，周一“下夜班”暂不自动衔接；可在“历史”中保存上一周后再生成。`;
      els.previousWeekNote.title = '历史存档中需要有上一周的同名单记录';
    }
  }

  function renderNotes() {
    const note = String(state.notes || '').trim();
    const owed = Object.keys(state.owedRest || {}).filter(id => String(state.owedRest[id] || '').trim());
    if (els.notesSummary) {
      const has = note || owed.length;
      els.notesSummary.hidden = !has;
      if (has) {
        const owedText = owed.map(id => {
          const person = findStaff(id);
          return person ? `${person.name}：${state.owedRest[id]}` : '';
        }).filter(Boolean).join('；');
        els.notesSummary.innerHTML = `
          ${note ? `<div class="notes-text"><strong>备注</strong><span>${escapeHtml(note).replace(/\n/g, '<br>')}</span></div>` : ''}
          ${owedText ? `<div class="notes-owed"><strong>旧版欠休备注</strong><span>${escapeHtml(owedText)}</span></div>` : ''}
          <button class="text-btn" type="button" id="notesSummaryEdit">编辑备注</button>`;
      }
    }
    if (els.printNotes) {
      const owedText = owed.map(id => {
        const person = findStaff(id);
        return person ? `${person.name}：${state.owedRest[id]}` : '';
      }).filter(Boolean).join('；');
      els.printNotes.innerHTML = (note || owedText)
        ? `<div class="print-notes-box"><strong>备注</strong>${note ? `<p>${escapeHtml(note)}</p>` : ''}${owedText ? `<p>旧版欠休备注：${escapeHtml(owedText)}</p>` : ''}</div>`
        : '';
    }
  }

  function countRoles() {
    const counts = Object.fromEntries(roleIds().map(role => [role, 0]));
    let active = 0;
    let training = 0;
    state.staff.forEach(person => {
      if (person.training) training += 1;
      else {
        active += 1;
        if (counts[person.role] != null) counts[person.role] += 1;
      }
    });
    return { counts, active, training };
  }

  function renderRoleSummary() {
    const { counts, active, training } = countRoles();
    if (els.rosterSub) {
      els.rosterSub.textContent = `在岗 ${active} 人${training ? ` · ${training} 人进修` : ''}`;
    }
    if (els.roleSummary) {
      els.roleSummary.innerHTML = roleIds().map(role => `
        <div class="role-pill role-${roleColor(role)}">
          <i></i><span>${escapeHtml(roleName(role))}</span><strong>${counts[role]}</strong>
        </div>
      `).join('');
    }
  }

  function renderStaffList() {
    if (!els.staffList) return;
    const staffScroll = els.staffList.scrollTop;
    if (!state.staff.length) {
      els.staffList.innerHTML = `<div class="staff-empty">还没有人员，点击右上角“添加”建立排班名单。</div>`;
      return;
    }
    els.staffList.innerHTML = state.staff.map(person => {
      const role = normalizeRole(person.role);
      return `
        <div class="person-card${person.training ? ' is-training' : ''}" data-person-id="${escapeAttr(person.id)}">
          <div class="avatar role-${roleColor(role)}">${escapeHtml(initials(person.name))}</div>
          <div class="person-main">
            <div class="person-top">
              <input class="person-name-input" type="text" value="${escapeAttr(person.name)}"
                data-name-id="${escapeAttr(person.id)}" aria-label="医师姓名" maxlength="20">
              <button class="person-delete" type="button" data-delete-id="${escapeAttr(person.id)}"${state.busy ? ' disabled' : ''}
                title="删除 ${escapeAttr(person.name)}" aria-label="删除 ${escapeAttr(person.name)}">
                <svg class="icon"><use href="#i-trash"></use></svg>
              </button>
            </div>
            <div class="person-controls">
              <select class="role-select" data-role-id="${escapeAttr(person.id)}" aria-label="${escapeAttr(person.name)}的人员类型"${state.busy ? ' disabled' : ''}>
                ${roleIds().map(r => `<option value="${r}"${r === role ? ' selected' : ''}>${escapeHtml(roleName(r))}</option>`).join('')}
              </select>
              <label class="training-toggle" title="设为进修状态，本周不承担工作">
                <input class="training-input" type="checkbox" data-training-id="${escapeAttr(person.id)}"${person.training ? ' checked' : ''}${state.busy ? ' disabled' : ''}>
                <span class="training-switch"></span>
                <span class="training-label">进修</span>
              </label>
            </div>
          </div>
        </div>
      `;
    }).join('');
    els.staffList.scrollTop = staffScroll;
  }

  function cellContent(person, day, shift, pinned, pin) {
    if (person.training) {
      return `<span class="shift-name">进修</span><span class="shift-extra">1 分</span>`;
    }
    if (shift === 'POST') {
      return `<span class="shift-name">下</span><span class="shift-extra">下夜班</span>`;
    }
    if (shift && S.isStatusShift(shift)) {
      const info = S.SHIFTS[shift];
      return `<span class="shift-name">${escapeHtml(info.name)}</span><span class="shift-extra">${info.workload ? `${info.workload} 分` : '不排班'}</span>`;
    }
    if (!shift) {
      if (pinned && pin && pin.shift === 'OFF') {
        return `<span class="shift-name">休</span><span class="shift-extra">已锁定休息</span>`;
      }
      return `<span class="shift-name">休</span>`;
    }
    const info = S.SHIFTS[shift];
    return `<span class="shift-name">${escapeHtml(info.name)}</span><span class="shift-extra">${info.workload} 分</span>`;
  }

  function renderSchedule(validation) {
    const hasWork = state.view.hasWork;
    if (!els.scheduleHost) return;
    const legend = $('scheduleLegend');
    if (legend) {
      const labels = { writer: '写报告', sign: '签报告', chain: '连班', 'white-up': '白上', night: '夜班', day: '其他工作班', post: '下夜班' };
      const categories = new Set(S.WORKLOAD_KEYS.map(shift => S.SHIFTS[shift].category));
      if (Object.values(state.schedule).some(row => row.includes('POST')) || categories.has('night')) categories.add('post');
      legend.innerHTML = Object.entries(labels).filter(([category]) => categories.has(category)).map(([category, name]) =>
        `<span><i class="legend-dot cat-${category}"></i>${escapeHtml(name)}</span>`).join('');
    }

    if (els.tableScroll) els.tableScroll.hidden = !hasWork;
    if (els.scheduleEmpty) els.scheduleEmpty.hidden = hasWork;

    if (!hasWork) {
      els.scheduleHost.innerHTML = '';
      if (els.scheduleEmpty) {
        let errorBox = $('emptyError');
        if (state.lastError) {
          if (!errorBox) {
            errorBox = document.createElement('div');
            errorBox.id = 'emptyError';
            errorBox.className = 'form-error show empty-error';
            els.scheduleEmpty.insertBefore(errorBox, els.emptyGenerateBtn);
          }
          errorBox.innerHTML = `<strong>${escapeHtml(state.lastError.message || '暂时无法生成')}</strong>`;
        } else if (errorBox) {
          errorBox.remove();
        }
        const h3 = els.scheduleEmpty.querySelector('h3');
        const p = els.scheduleEmpty.querySelector('p');
        if (h3) h3.textContent = state.staff.length
          ? (state.lastError ? '这次没有排出来' : state.waitingForSchedule ? '本周待重新排班' : '还没有本周排班')
          : '请先添加医师';
        if (p) {
          p.textContent = state.staff.length
            ? (state.lastError ? '根据提示调整人员配置后重试，已有的手动调整会继续保留。' : '先确认左侧人员配置，然后让规则引擎生成一张完整排班表。')
            : '在「人员配置」中添加医师，然后返回生成排班。';
        }
      }
      if (els.scheduleSub) els.scheduleSub.textContent = '点击任意格子调整该医师当天的班次';
      if (els.tableVersionBadge) els.tableVersionBadge.textContent = '待生成';
      if (els.scheduleFootMeta) els.scheduleFootMeta.textContent = '—';
      return;
    }

    const dates = weekDates();
    const coverageMap = {};
    validation.coverage.forEach(day => {
      coverageMap[day.day] = day;
    });

    const head = `
      <thead>
        <tr>
          <th class="corner-head" scope="col"><strong>医师 / 日期</strong></th>
          <th class="rest-head" scope="col"><strong>上周末欠休</strong><small>期初 · 可设置</small></th>
          ${S.DAYS.map((day, d) => {
            const isWeekend = d >= 5;
            return `<th scope="col" class="day-head${isWeekend ? ' weekend' : ''}">
              <span class="day-name">${day.label}</span>
              <span class="day-date">${formatShortDate(dates[d])}</span>
            </th>`;
          }).join('')}
          <th class="rest-head" scope="col"><strong>本周末欠休</strong><small>期末 · 自动计算</small></th>
        </tr>
      </thead>
    `;

    const body = state.staff.map(person => {
      const row = state.schedule[person.id] || Array(7).fill(null);
      const info = validation.byStaff[person.id] || { workCount: 0, workload: 0 };
      const role = normalizeRole(person.role);
      const cells = row.map((shift, d) => {
        const key = `${person.id}|${d}`;
        const pin = state.pins[key];
        const pinned = !!pin;
        const readonly = person.training || shift === 'POST';
        let cls = 'shift-btn';
        if (person.training) cls += ' cat-training';
        else if (shift === 'POST') cls += ' cat-post';
        else if (!shift) cls += ' is-empty';
        else cls += ` cat-${S.SHIFTS[shift].category} shift-${shift}`;
        if (pinned) cls += ' is-pinned';
        const title = person.training
          ? `${person.name} · ${S.DAYS[d].label} · 进修`
          : shift === 'POST'
            ? `${person.name} · ${S.DAYS[d].label} · 下夜班（由前一日夜班自动生成）`
            : `${person.name} · ${S.DAYS[d].label} · ${shift ? S.SHIFTS[shift].name : '休息'}${pinned ? ' · 已手动锁定' : ' · 点击调整'}`;
        const pinIcon = pinned ? `<svg class="pin-icon" aria-hidden="true"><use href="#i-lock"></use></svg>` : '';
        return `<td class="shift-td${d >= 5 ? ' weekend' : ''}">
          <button type="button" class="${cls}" data-staff-id="${escapeAttr(person.id)}" data-day="${d}"
            ${readonly || state.busy ? 'disabled' : ''} aria-label="${escapeAttr(title)}" title="${escapeAttr(title)}">
            ${pinIcon}${cellContent(person, d, shift, pinned, pin)}
          </button>
        </td>`;
      }).join('');

      const start = Rest.valueFor(state.view.opening, person.id);
      const end = Rest.valueFor(state.view.closing, person.id);
      const exempt = Rest.exempt(person);
      const openingCell = exempt ? '—' : `<button type="button" class="rest-value${start > 0 ? ' is-owed' : ''}" data-rest-person="${escapeAttr(person.id)}" ${state.busy ? 'disabled' : ''} title="${escapeAttr('设置' + person.name + '的期初欠休')}" aria-label="${escapeAttr(`${person.name}的期初欠休 ${start}，点击设置`)}"><span>${start}</span><span class="rest-pencil" aria-hidden="true">✎</span></button>`;
      const closingCell = exempt ? '—' : end == null ? '待计算' : `<span class="rest-value${end > 0 ? ' is-owed' : ''}" title="${escapeAttr('较期初 ' + (end - start > 0 ? '+' : '') + (end - start))}">${end}</span>`;
      return `<tr data-row-id="${escapeAttr(person.id)}" class="${person.training ? 'is-training-row' : ''}">
        <th class="person-col" scope="row">
          <div class="person-row-head">
            <div class="avatar role-${roleColor(role)}">${escapeHtml(initials(person.name))}</div>
            <div class="person-row-info">
              <div class="person-row-name"><span class="person-row-name-text">${escapeHtml(person.name)}</span>${person.training ? '<span class="training-tag">进修</span>' : ''}</div>
              <div class="person-row-meta">
                <span class="role-tag role-${roleColor(role)}">${escapeHtml(roleName(role))}</span>
                <span class="load-tag"><strong>${info.workCount}</strong> 班 · ${info.workload} 分</span>
              </div>
            </div>
          </div>
        </th>
        <td class="rest-cell rest-opening">${openingCell}</td>
        ${cells}
        <td class="rest-cell rest-closing">${closingCell}</td>
      </tr>`;
    }).join('');

    const foot = `<tfoot><tr>
      <th>每日覆盖</th><td class="rest-cell"></td>
      ${S.DAYS.map((day, d) => {
        const cov = coverageMap[d] || { filled: 0, total: 5, ok: false };
        return `<td><span class="day-coverage-foot${cov.ok ? '' : ' bad'}">${cov.filled}/${cov.total}</span></td>`;
      }).join('')}
      <td class="rest-cell"></td>
    </tr></tfoot>`;

    const tableScrollLeft = els.tableScroll ? els.tableScroll.scrollLeft : 0;
    const tableScrollTop = els.tableScroll ? els.tableScroll.scrollTop : 0;
    els.scheduleHost.innerHTML = `<table class="schedule-table" aria-label="周排班表">${head}<tbody>${body}</tbody>${foot}</table>`;
    if (els.tableScroll) els.tableScroll.scrollTo(tableScrollLeft, tableScrollTop);

    if (els.scheduleSub) {
      els.scheduleSub.textContent = pinCount()
        ? `点击任意格子调整 · 已锁定 ${pinCount()} 处，重排时优先保留`
        : !state.restTracked && !state.previousWeek?.restTracked
          ? '首次使用可设置期初欠休 · 点击班次可调整'
          : '点击班次可调整 · 保存后自动重排全周';
    }
    if (els.tableVersionBadge) els.tableVersionBadge.textContent = pinCount() ? `含 ${pinCount()} 处手动调整` : '自动生成';
    if (els.scheduleFootMeta) {
      const totals = validation.totals;
      const workload = Object.values(validation.byStaff).reduce((sum, item) => sum + item.workload, 0);
      els.scheduleFootMeta.textContent = `${totals.activeStaff} 人 · ${totals.nights} 个夜班 · 合计 ${workload} 工分`;
    }
  }

  function renderCoverage(validation) {
    if (!els.coverageHost) return;
    const hasWork = hasAnyWork();
    if (!hasWork) {
      els.coverageHost.innerHTML = `<div class="coverage-empty">生成排班后，这里会按天列出每个规定岗位的实际负责人。</div>`;
      if (els.coveragePill) {
        els.coveragePill.className = 'status-pill';
        els.coveragePill.textContent = '待生成';
      }
      return;
    }
    const dates = weekDates();
    els.coverageHost.innerHTML = validation.coverage.map(day => `
      <div class="coverage-day${day.day >= 5 ? ' weekend' : ''}">
        <div class="coverage-day-head">
          <div><strong>${day.label}</strong><small>${formatShortDate(dates[day.day])} · ${day.kind}</small></div>
          <span class="coverage-count${day.ok ? '' : ' bad'}">${day.filled}/${day.total}</span>
        </div>
        <div class="coverage-list">
          ${day.requirements.map(req => {
            const names = req.staff.map(s => s.name);
            const label = names.length ? names.join(' / ') : '待补位';
            return `<div class="coverage-item" title="${escapeAttr(req.name + '：' + label)}">
              <i class="coverage-dot cat-${S.SHIFTS[req.shift].category}"></i>
              <span class="coverage-shift">${escapeHtml(req.name)}</span>
              <span class="coverage-person${names.length ? '' : ' missing'}">${escapeHtml(label)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('');
    if (els.coveragePill) {
      const ok = validation.totals.filled === validation.totals.total;
      els.coveragePill.className = `status-pill ${ok ? 'good' : 'bad'}`;
      els.coveragePill.textContent = ok ? '岗位已排满' : `缺 ${validation.totals.total - validation.totals.filled} 岗`;
    }
  }

  function renderChecks(validation) {
    if (!els.checksHost) return;
    const hasWork = hasAnyWork();
    if (!hasWork) {
      els.checksHost.innerHTML = [
        '每日岗位数量', '职位每周总班次范围', '夜班后接下夜班', '跨周下夜班衔接',
        '职位单班次每周范围', '人员类型与班次匹配', '进修/状态人员不排班'
      ].map(label => `
        <div class="check-item pending">
          <span class="check-icon"><svg class="icon"><use href="#i-info"></use></svg></span>
          <div class="check-copy"><strong>${label}</strong><span>等待生成排班</span></div>
        </div>
      `).join('');
      if (els.checksPill) {
        els.checksPill.className = 'status-pill';
        els.checksPill.textContent = '待生成';
      }
      if (els.repairBtn) els.repairBtn.hidden = true;
      if (els.checksFootText) els.checksFootText.textContent = '生成排班后自动执行新版规则校验。';
      return;
    }

    els.checksHost.innerHTML = validation.checks.map(check => `
      <div class="check-item${check.ok ? '' : ' bad'}">
        <span class="check-icon"><svg class="icon"><use href="#${check.ok ? 'i-check' : 'i-alert'}"></use></svg></span>
        <div class="check-copy"><strong>${escapeHtml(check.label)}</strong><span title="${escapeAttr(check.detail)}">${escapeHtml(check.detail)}</span></div>
      </div>
    `).join('');

    const passed = validation.checks.filter(c => c.ok).length;
    const allOk = passed === validation.checks.length;
    if (els.checksPill) {
      els.checksPill.className = `status-pill ${allOk ? 'good' : 'bad'}`;
      els.checksPill.textContent = allOk ? '全部通过' : `${validation.checks.length - passed} 项待处理`;
    }
    if (els.repairBtn) els.repairBtn.hidden = allOk;
    if (els.checksFootText) {
      els.checksFootText.textContent = allOk
        ? '全部规则检查通过。手动调整会锁定该格，并在全周重排时优先保留。'
        : '发现不符合规则的地方，可尝试智能修复或取消部分手动锁定。';
    }
  }

  function renderStats(validation) {
    const hasWork = hasAnyWork();
    const { counts, active, training } = countRoles();
    if (els.statStaff) els.statStaff.innerHTML = `${active}<small>人</small>`;
    if (els.statStaffSub) {
      els.statStaffSub.textContent = roleIds().filter(role => counts[role]).map(role => `${counts[role]} ${roleName(role)}`).join(' · ') + (training ? ` · ${training} 进修` : '');
    }
    if (els.statPins) els.statPins.innerHTML = `${pinCount()}<small>处</small>`;
    if (els.statPinsSub) els.statPinsSub.textContent = pinCount() ? '已锁定，重排时优先保留' : '点击排班格可调整';

    if (!hasWork) {
      if (els.statCoverage) els.statCoverage.textContent = '—';
      if (els.statCoverageSub) els.statCoverageSub.textContent = '生成排班后显示';
      if (els.coverageTrend) { els.coverageTrend.textContent = '—'; els.coverageTrend.className = 'stat-trend neutral'; }
      if (els.statIssues) els.statIssues.textContent = '—';
      if (els.statIssuesSub) els.statIssuesSub.textContent = '等待排班生成';
      if (els.healthTrend) { els.healthTrend.textContent = '—'; els.healthTrend.className = 'stat-trend neutral'; }
      if (els.healthStat) els.healthStat.classList.remove('bad');
      return;
    }

    const totals = validation.totals;
    const percent = totals.total ? Math.round(totals.filled / totals.total * 100) : 0;
    if (els.statCoverage) els.statCoverage.innerHTML = `${totals.filled}<small>/${totals.total}</small>`;
    if (els.statCoverageSub) els.statCoverageSub.textContent = totals.filled === totals.total ? '全部岗位已排满' : `${totals.total - totals.filled} 个岗位待补位`;
    if (els.coverageTrend) {
      els.coverageTrend.textContent = `${percent}%`;
      els.coverageTrend.className = `stat-trend${percent === 100 ? '' : ' bad'}`;
    }

    const passed = validation.checks.filter(c => c.ok).length;
    const issues = validation.checks.length - passed;
    if (els.statIssues) els.statIssues.innerHTML = `${issues}<small>项</small>`;
    if (els.statIssuesSub) els.statIssuesSub.textContent = issues ? '建议执行智能修复' : `${passed}/${validation.checks.length} 项检查全部通过`;
    if (els.healthTrend) {
      els.healthTrend.textContent = issues ? '待处理' : '全部通过';
      els.healthTrend.className = `stat-trend${issues ? ' bad' : ''}`;
    }
    if (els.healthStat) els.healthStat.classList.toggle('bad', issues > 0);
  }

  function renderLockSummary() {
    const n = pinCount();
    if (els.lockCount) els.lockCount.textContent = `${n} 处手动调整`;
    if (els.lockSummary) {
      els.lockSummary.classList.toggle('has-pins', n > 0);
      const small = els.lockSummary.querySelector('small');
      if (small) small.textContent = n ? '已锁定 · 点击管理' : '点击查看与清除';
    }
  }

  function updateGenerateButton() {
    const hasWork = hasCompleteTable();
    if (els.generateBtnText) els.generateBtnText.textContent = hasWork ? '重新排班' : '智能排班';
    if (els.generateBtn) {
      els.generateBtn.disabled = state.busy;
      els.generateBtn.title = hasWork
        ? (pinCount() ? '清除手动锁定并重新生成整周排班' : '按当前人员配置重新生成整周排班')
        : '按当前人员配置生成整周排班';
    }
    if (els.emptyGenerateBtn) els.emptyGenerateBtn.disabled = state.busy;
    if (els.restOpeningBtn) els.restOpeningBtn.disabled = state.busy || !state.staff.some(person => !Rest.exempt(person));
    if (els.exportBtn) els.exportBtn.disabled = !hasWork || state.busy;
    if (els.printBtn) els.printBtn.disabled = !hasWork || state.busy;
    if (els.undoBtn) els.undoBtn.disabled = !state.history.length || state.busy;
    if (els.redoBtn) els.redoBtn.disabled = !state.future.length || state.busy;
    if (els.repairBtn && hasWork) {
      // 由 renderChecks 控制显隐，这里只同步禁用状态。
      els.repairBtn.disabled = state.busy;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 历史记录                                                           */
  /* ------------------------------------------------------------------ */

  function updateNamesInHistory(personId, name) {
    [state.history, state.future].forEach(list => {
      list.forEach(snapshot => {
        const person = (snapshot.staff || []).find(p => p.id === personId);
        if (person) person.name = name;
      });
    });
  }

  function capture() {
    return clone({
      staff: state.staff,
      ruleConfig: S.getRuleConfig(),
      schedule: state.schedule,
      waitingForSchedule: state.waitingForSchedule,
      pins: state.pins,
      workloads: state.workloads,
      requirements: state.requirements || S.getRequirements(),
      weekStart: isoDate(state.weekStart),
      notes: state.notes || '',
      owedRest: clone(state.owedRest || {}),
      restOpenings: state.restOpenings,
      restTracked: state.restTracked,
      seed: state.seed
    });
  }

  function pushHistory(snapshot) {
    state.history.push(snapshot || capture());
    if (state.history.length > 30) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function applySnapshot(snapshot) {
    S.setRuleConfig(snapshot.ruleConfig);
    state.staff = clone(snapshot.staff);
    state.schedule = clone(snapshot.schedule);
    state.waitingForSchedule = !!snapshot.waitingForSchedule;
    state.pins = clone(snapshot.pins);
    if (snapshot.workloads) state.workloads = S.setWorkloads(snapshot.workloads);
    if (snapshot.requirements) state.requirements = S.setRequirements(snapshot.requirements);
    if (snapshot.weekStart) state.weekStart = parseIsoDate(snapshot.weekStart) || state.weekStart;
    state.notes = typeof snapshot.notes === 'string' ? snapshot.notes : state.notes;
    state.owedRest = normalizeOwedRest(snapshot.owedRest, state.staff);
    state.restOpenings = normalizeRestDrafts(snapshot.restOpenings);
    state.restTracked = snapshot.restTracked === true;
    state.seed = snapshot.seed;
    refreshPreviousWeek();
    recalcPinSeq();
  }

  function undo() {
    if (!state.history.length || state.busy) return;
    const current = capture();
    const previous = state.history.pop();
    state.future.push(current);
    applySnapshot(previous);
    state.lastError = null;
    renderAll();
    saveState(true);
    updateHistoryButtons();
    toast({ type: 'info', title: '已撤销', message: '已恢复到上一次排班状态。' });
  }

  function redo() {
    if (!state.future.length || state.busy) return;
    const current = capture();
    const next = state.future.pop();
    state.history.push(current);
    if (state.history.length > 30) state.history.shift();
    applySnapshot(next);
    state.lastError = null;
    renderAll();
    saveState(true);
    updateHistoryButtons();
    toast({ type: 'info', title: '已重做', message: '已恢复刚才的排班状态。' });
  }

  function updateHistoryButtons() {
    if (els.undoBtn) els.undoBtn.disabled = !state.history.length || state.busy;
    if (els.redoBtn) els.redoBtn.disabled = !state.future.length || state.busy;
  }

  /* ------------------------------------------------------------------ */
  /* 求解与提交                                                         */
  /* ------------------------------------------------------------------ */

  async function withBusy(title, text, task) {
    if (state.busy) return null;
    state.busy = true;
    setLoading(true, title, text);
    updateGenerateButton();
    await nextPaint();
    try {
      return task();
    } catch (err) {
      return {
        ok: false,
        error: { message: err && err.message ? err.message : '排班求解发生未知错误', hints: [] }
      };
    } finally {
      state.busy = false;
      setLoading(false);
      updateGenerateButton();
    }
  }

  function setLoading(on, title, text) {
    if (!els.loadingLayer) return;
    els.loadingLayer.hidden = !on;
    if (on) {
      if (els.loadingTitle) els.loadingTitle.textContent = title || '正在平衡全周排班';
      if (els.loadingText) els.loadingText.textContent = text || '校验岗位覆盖、夜班衔接与手动锁定…';
    }
    document.querySelectorAll('.role-select, .training-input, .person-delete, #addStaffBtn, #resetBtn, #rosterProfilesBtn, #lockSummary, #ruleConfigBtn, #restOpeningBtn, #requirementBtn, #archiveBtn, #notesBtn, #prevWeekBtn, #nextWeekBtn').forEach(el => {
      el.disabled = on;
    });
  }

  async function runEngine(opts) {
    return withBusy(
      opts.loadingTitle || '正在平衡全周排班',
      opts.loadingText || '校验岗位覆盖、夜班衔接与手动锁定，兼顾期初欠休…',
      () => S.generate(state.staff, {
        mode: opts.mode || 'repair',
        preferSchedule: opts.preferSchedule,
        pins: opts.pins || {},
        previousWeek: state.previousWeek,
        restOpening: restOpening(),
        diversify: opts.diversify !== false,
        seed: typeof opts.seed === 'number' ? opts.seed : state.seed
      })
    );
  }

  function applyGenerationSuccess(result, snapshot, successOpts) {
    state.history.push(snapshot);
    if (state.history.length > 30) state.history.shift();
    state.future = [];
    state.schedule = result.schedule;
    state.restTracked = true;
    state.waitingForSchedule = false;
    state.pins = result.pins;
    state.lastError = null;
    state.seed = (state.seed + 1) % 2147483647;
    renderAll();
    saveState(true);
    updateHistoryButtons();

    const options = successOpts || {};
    const newPinReleased = options.newPinKey && (result.releasedPins || []).some(item => item.key === options.newPinKey);
    if (newPinReleased) {
      toast({
        type: 'warn',
        title: '这次手动调整未能保留',
        message: '它与当前人员配置或其它锁定冲突，系统已生成一张合规排班。',
        action: { label: '查看原因', run: () => showReleasedModal(result.releasedPins) }
      });
    } else if (result.releasedPins && result.releasedPins.length) {
      toast({
        type: 'warn',
        title: '已释放部分冲突锁定',
        message: `为保证整周合规，释放了 ${result.releasedPins.length} 处较早的锁定。`,
        action: { label: '查看', run: () => showReleasedModal(result.releasedPins) }
      });
    } else {
      toast({
        type: 'success',
        title: options.title || '排班已更新',
        message: options.message || '全周岗位已按规则重新平衡。'
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 生成 / 修复 / 手动调整                                              */
  /* ------------------------------------------------------------------ */

  async function generateFresh(clearPins) {
    if (state.busy) return;
    if (hasAnyWork()) {
      const n = pinCount();
      confirmModal({
        title: '重新生成整周排班？',
        message: n
          ? `本次会清除 <strong>${n} 处</strong>手动锁定，并根据当前人员重新生成。清除后仍可通过撤销恢复。`
          : '系统会按当前人员配置重新生成一张完整排班表。',
        confirmLabel: '重新排班',
        onConfirm: () => doGenerateFresh(clearPins)
      });
      return;
    }
    doGenerateFresh(false);
  }

  async function doGenerateFresh(clearPins) {
    if (state.busy) return;
    const before = capture();
    const pins = clearPins ? {} : state.pins;
    const result = await runEngine({
      mode: 'generate',
      preferSchedule: null,
      pins,
      seed: state.seed,
      loadingTitle: '正在生成整周排班',
      loadingText: `覆盖 ${S.WEEKLY_SLOT_COUNT} 个岗位，检查夜班衔接与每周班次上限…`
    });
    if (!result) return;
    if (!result.ok) {
      state.lastError = result.error;
      renderAll();
      showErrorModal(result.error);
      return;
    }
    applyGenerationSuccess(result, before, {
      title: '新的排班已生成',
      message: clearPins ? '已按当前人员配置重新生成，手动锁定已清除。' : '已按当前人员配置重新生成。'
    });
  }

  async function repairCurrent() {
    if (state.busy || !state.view || !hasAnyWork()) return;
    if (state.view.validation.ok) {
      toast({ type: 'success', title: '当前排班已合规', message: '全部规则检查通过，无需修复。' });
      return;
    }
    const before = capture();
    const result = await runEngine({
      mode: 'repair',
      preferSchedule: state.schedule,
      pins: state.pins,
      seed: state.seed,
      loadingTitle: '正在修复排班',
      loadingText: '尽量保留现有安排，同时修正不合规的岗位…'
    });
    if (!result) return;
    if (!result.ok) {
      showErrorModal(result.error);
      return;
    }
    applyGenerationSuccess(result, before, {
      title: '排班已修复',
      message: '规则冲突已消除，原有安排尽量保留。'
    });
  }

  async function applyManualEdit(staffId, day, selectedShift) {
    if (state.busy) return;
    const person = findStaff(staffId);
    if (!person) return;
    const key = `${staffId}|${day}`;
    const before = capture();
    const current = (state.schedule[staffId] || [])[day] || null;
    const currentPin = state.pins[key];
    const isSame = selectedShift === 'OFF'
      ? (!current && currentPin && currentPin.shift === 'OFF')
      : current === selectedShift;

    if (isSame && currentPin) {
      closeModal();
      toast({ type: 'info', title: '没有变化', message: '这个格子已经是当前安排。' });
      return;
    }

    const nextPins = clone(state.pins);
    nextPins[key] = { shift: selectedShift, at: pinAt() };

    closeModal();
    const result = await runEngine({
      mode: 'repair',
      preferSchedule: state.schedule,
      pins: nextPins,
      seed: state.seed,
      loadingTitle: '正在重排全周',
      loadingText: `保留 ${person.name} 周${['一', '二', '三', '四', '五', '六', '日'][day]} 的调整，并重新平衡其他岗位…`
    });
    if (!result) return;
    if (!result.ok) {
      showErrorModal(result.error);
      return;
    }

    applyGenerationSuccess(result, before, {
      newPinKey: key,
      title: '已应用手动调整',
      message: `已锁定 ${person.name} 周${['一', '二', '三', '四', '五', '六', '日'][day]} 的安排，并完成全周重排。`
    });
  }

  async function reflowAfterRosterChange(before, successMessage, { keepRosterOnFailure = false, changeTitle = '人员' } = {}) {
    if (!hasAnyWork(before.schedule, before.staff)) {
      pushHistory(before);
      state.lastError = null;
      renderAll();
      saveState(true);
      if (successMessage) toast({ type: 'success', title: `${changeTitle}已更新`, message: successMessage });
      return true;
    }

    const result = await runEngine({
      mode: 'reflow',
      preferSchedule: before.schedule,
      pins: state.pins,
      seed: state.seed,
      loadingTitle: '人员有变动，正在重排',
      loadingText: '先保留原有安排，再为新的人员配置补位…'
    });
    if (!result) {
      applySnapshot(before);
      renderAll();
      saveState(true);
      return false;
    }
    if (!result.ok) {
      if (keepRosterOnFailure) {
        pushHistory(before);
        state.schedule = {};
        state.lastError = result.error;
        renderAll();
        saveState(true);
        toast({
          type: 'warn',
          title: state.storageOk ? `${changeTitle}修改已保存` : `${changeTitle}修改暂未写入文件`,
          message: `${successMessage} 暂未生成新班表，可继续调整人员后再排班。`,
          action: { label: '查看原因', run: () => showErrorModal(result.error) }
        });
        return true;
      }
      applySnapshot(before);
      renderAll();
      saveState(true);
      showErrorModal(result.error);
      return false;
    }
    applyGenerationSuccess(result, before, {
      title: `${changeTitle}已更新`,
      message: successMessage || '全周排班已根据新的配置重新平衡。'
    });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 人员操作                                                           */
  /* ------------------------------------------------------------------ */

  async function addStaff(data) {
    if (state.busy) return;
    const before = capture();
    const person = {
      id: S.createId('p'),
      name: String(data.name || '').trim(),
      role: normalizeRole(data.role),
      training: !!data.training
    };
    state.staff.push(person);
    state.schedule[person.id] = Array(7).fill(person.training ? 'TRAINING' : null);
    const ok = await reflowAfterRosterChange(before, `${person.name} 已加入名单。`, { keepRosterOnFailure: true });
    if (ok) {
      requestAnimationFrame(() => {
        const input = document.querySelector(`.person-name-input[data-name-id="${cssEscape(person.id)}"]`);
        if (input) input.focus();
      });
    }
  }

  async function updateRole(personId, newRole) {
    if (state.busy) return;
    const person = findStaff(personId);
    if (!person || person.role === newRole) return;
    const before = capture();
    person.role = newRole;
    Object.keys(state.pins).forEach(key => {
      if (key.startsWith(`${personId}|`)) delete state.pins[key];
    });
    await reflowAfterRosterChange(before, `${person.name} 已改为${roleName(newRole)}。`, { keepRosterOnFailure: true });
  }

  async function updateTraining(personId, training) {
    if (state.busy) return;
    const person = findStaff(personId);
    if (!person || person.training === training) return;
    const before = capture();
    person.training = !!training;
    Object.keys(state.pins).forEach(key => {
      if (key.startsWith(`${personId}|`)) delete state.pins[key];
    });
    if (training) {
      state.schedule[personId] = Array(7).fill('TRAINING');
    } else {
      state.schedule[personId] = Array(7).fill(null);
    }
    await reflowAfterRosterChange(before, training ? `${person.name} 已设为进修。` : `${person.name} 已结束进修。`, { keepRosterOnFailure: true });
  }

  async function deleteStaff(personId) {
    if (state.busy) return;
    const person = findStaff(personId);
    if (!person) return;
    const before = capture();
    state.staff = state.staff.filter(p => p.id !== personId);
    delete state.schedule[personId];
    Object.keys(state.pins).forEach(key => {
      if (key.startsWith(`${personId}|`)) delete state.pins[key];
    });
    await reflowAfterRosterChange(before, `${person.name} 已从名单移除。`, { keepRosterOnFailure: true });
  }

  async function resetSample() {
    if (state.busy) return;
    const before = capture();
    state.staff = clone(DEFAULT_STAFF);
    state.schedule = {};
    state.pins = {};
    state.seed = (state.seed + 1) % 2147483647;
    const result = await runEngine({
      mode: 'generate',
      pins: {},
      seed: state.seed,
      loadingTitle: '正在恢复科室名单并排班',
      loadingText: '载入 16 名科室医师，生成一张完整排班表…'
    });
    if (!result || !result.ok) {
      applySnapshot(before);
      renderAll();
      saveState(true);
      showErrorModal(result && result.error ? result.error : { message: '初始化排班生成失败', hints: [] });
      return;
    }
    state.history.push(before);
    if (state.history.length > 30) state.history.shift();
    state.future = [];
    state.schedule = result.schedule;
    state.restTracked = true;
    state.waitingForSchedule = false;
    state.pins = result.pins;
    state.lastError = null;
    renderAll();
    saveState(true);
    toast({ type: 'success', title: '已恢复科室名单', message: '16 人科室名单与排班已重新载入。' });
  }

  function clearAllPins() {
    if (state.busy || !pinCount()) return;
    const before = capture();
    const count = pinCount();
    pushHistory(before);
    state.pins = {};
    renderAll();
    saveState(true);
    toast({
      type: 'success',
      title: '已清除手动锁定',
      message: `${count} 处调整已解锁，当前排班仍然有效。`,
      action: { label: '撤销', run: () => undo() }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 弹窗                                                               */
  /* ------------------------------------------------------------------ */

  function openModal(html, opts) {
    const options = opts || {};
    modalReturnFocus = document.activeElement;
    els.modalCard.className = `modal-card${options.wide ? ' wide' : ''}${options.narrow ? ' narrow' : ''}`;
    els.modalCard.innerHTML = html;
    els.modalRoot.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => {
      const focusTarget = options.focus || els.modalCard.querySelector('[data-autofocus]') || els.modalCard.querySelector('.modal-close') || els.modalCard.querySelector('button');
      if (focusTarget) focusTarget.focus();
    });
  }

  function closeModal() {
    if (positionWindow) { desktop.finishPositionRules(null); return; }
    if (!els.modalRoot || els.modalRoot.hidden) return;
    els.modalRoot.hidden = true;
    document.body.classList.remove('modal-open');
    els.modalCard.innerHTML = '';
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') {
      try { modalReturnFocus.focus(); } catch (err) { /* noop */ }
    }
    modalReturnFocus = null;
  }

  function modalHeader(title, subtitle, kicker, avatarHtml) {
    return `<div class="modal-head">
      ${avatarHtml || ''}
      <div class="modal-title-wrap">
        ${kicker ? `<div class="modal-kicker">${escapeHtml(kicker)}</div>` : ''}
        <h2 id="modalTitle">${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <button class="modal-close" type="button" data-modal-close aria-label="关闭">
        <svg class="icon"><use href="#i-close"></use></svg>
      </button>
    </div>`;
  }

  function confirmModal(opts) {
    openModal(`${modalHeader(opts.title, '', '', '')}
      <div class="modal-body">
        <div class="confirm-copy">${opts.message}</div>
        ${opts.details ? `<div class="confirm-list">${opts.details}</div>` : ''}
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" type="button" data-modal-close>取消</button>
        <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" type="button" id="confirmGo" data-autofocus>${escapeHtml(opts.confirmLabel || '确认')}</button>
      </div>`, { narrow: true });
    const go = $('confirmGo');
    if (go) {
      go.addEventListener('click', async () => {
        closeModal();
        await opts.onConfirm();
      });
    }
  }

  function openCellEditor(staffId, day) {
    if (state.busy) return;
    const person = findStaff(staffId);
    if (!person) return;
    if (person.training) {
      toast({ type: 'info', title: '进修人员不排班', message: '请先结束该医师的进修状态。' });
      return;
    }
    const current = (state.schedule[staffId] || [])[day] || null;
    if (current === 'POST') {
      toast({ type: 'info', title: '下夜班由夜班衔接', message: '如需调整，请先修改前一日的「夜+白上」。' });
      return;
    }
    const prevNight = day > 0 && (state.schedule[staffId] || [])[day - 1] === 'NIGHT';
    if (prevNight) {
      toast({ type: 'info', title: '夜班后必须下夜班', message: '这一格由前一日的夜班自动锁定，不能安排其他班次。' });
      return;
    }

    const rule = S.ROLES[person.role];
    const options = S.allowedShifts(person.role, day).filter(shift =>
      S.requirementCount(day, shift) && rule.max > 0 && (rule.limits[shift]?.max ?? 7) > 0
    );
    if (!options.length) {
      toast({ type: 'warn', title: '当天没有可排班次', message: `${person.name} 的类型在${S.DAYS[day].label}没有可排岗位。` });
      return;
    }

    const currentPin = state.pins[`${staffId}|${day}`];
    const pinned = !!currentPin;
    const role = person.role;
    const date = dayDate(day);
    const key = `${staffId}|${day}`;
    const nextPin = state.pins[`${staffId}|${day + 1}`];
    const prevPin = day > 0 ? state.pins[`${staffId}|${day - 1}`] : null;

    const holders = {};
    state.staff.forEach(p => {
      const val = (state.schedule[p.id] || [])[day];
      if (val && S.isWorkShift(val)) {
        if (!holders[val]) holders[val] = [];
        holders[val].push(p.name);
      }
    });

    const shiftOptions = options.map(shift => {
      const info = S.SHIFTS[shift];
      const checked = current === shift;
      const names = (holders[shift] || []).filter(name => name !== person.name);
      const holder = names.join(' / ');
      return `<label class="shift-option${shift === 'NIGHT' ? ' is-night' : ''}">
        <input type="radio" name="shiftChoice" value="${shift}"${checked ? ' checked' : ''} data-holder="${escapeAttr(holder)}" data-shift="${shift}">
        <span class="option-inner">
          <span class="option-top">
            <span class="option-name">${escapeHtml(info.name)}</span>
            <span class="option-load">${info.workload} 分</span>
          </span>
          <span class="option-meta">${escapeHtml(info.desc)}${holder ? ` · 当前由 ${escapeHtml(holder)} 负责` : ''}${checked ? ' · 当前安排' : ''}</span>
        </span>
      </label>`;
    }).join('');

    const statusOptions = S.STATUS_KEYS.map(key => {
      const info = S.SHIFTS[key];
      const checked = current === key;
      return `<label class="shift-option is-status">
        <input type="radio" name="shiftChoice" value="${key}"${checked ? ' checked' : ''} data-holder="" data-shift="${key}">
        <span class="option-inner">
          <span class="option-top"><span class="option-name">${escapeHtml(info.name)}</span><span class="option-load">0 分</span></span>
          <span class="option-meta">${escapeHtml(info.desc)}，当天不承担岗位</span>
        </span>
      </label>`;
    }).join('');

    const offChecked = !current;
    const restOption = `<label class="shift-option is-rest">
      <input type="radio" name="shiftChoice" value="OFF"${offChecked ? ' checked' : ''} data-holder="" data-shift="OFF">
      <span class="option-inner">
        <span class="option-top"><span class="option-name">休息</span><span class="option-load">0 分</span></span>
        <span class="option-meta">该日不排班，由其他医师补位</span>
      </span>
    </label>`;

    let warning = '';
    if (prevPin && prevPin.shift === 'NIGHT') {
      warning = '前一天已锁定夜班，本日必须为下夜班。';
    } else if (nextPin && nextPin.shift && nextPin.shift !== 'POST') {
      warning = '次日已有手动锁定；若选择夜+白上，次日的下夜班要求可能会优先于该锁定。';
    }

    openModal(`${modalHeader(
      `调整 ${person.name} 的排班`,
      `${S.DAYS[day].label} · ${formatDate(date, true)} · ${S.DAYS[day].weekday}`,
      'MANUAL ADJUSTMENT',
      `<div class="modal-avatar role-${roleColor(role)}">${escapeHtml(initials(person.name))}</div>`
    )}
      <div class="modal-body">
        <div class="edit-summary">
          <span>当前：</span><strong>${escapeHtml(current ? S.shiftName(current) : '休息')}</strong>
          <span class="selected-shift-preview" id="selectedPreview"></span>
        </div>
        <div class="editor-label"><span>选择该医师当天的新班次</span><span>保存后锁定此格</span></div>
        <div class="shift-options" id="shiftOptions">
          ${shiftOptions}
          ${restOption}
        </div>
        <div class="editor-label"><span>或标记为状态（不承担岗位）</span><span>同样会锁定</span></div>
        <div class="shift-options status-options" id="statusOptions">
          ${statusOptions}
        </div>
        <div class="edit-hint" id="editHint">
          <svg class="icon"><use href="#i-info"></use></svg>
          <span>保存后，系统会保留其他手动锁定，并对整周重新求解。其他医师的排班可能随之变化。</span>
        </div>
        ${warning ? `<div class="edit-hint warn"><svg class="icon"><use href="#i-alert"></use></svg><span>${escapeHtml(warning)}</span></div>` : ''}
      </div>
      <div class="modal-foot">
        <span class="foot-hint">${pinned ? '此格已有手动锁定，保存后会更新锁定。' : '手动调整将标为锁定。'}</span>
        <span class="spacer"></span>
        <button class="btn btn-quiet" type="button" data-modal-close>取消</button>
        <button class="btn btn-primary" type="button" id="saveEditBtn">
          <svg class="icon"><use href="#i-sparkles"></use></svg>保存并重排
        </button>
      </div>`, { narrow: false });

    const updatePreview = () => {
      const selected = document.querySelector('input[name="shiftChoice"]:checked');
      const preview = $('selectedPreview');
      const hint = $('editHint');
      if (!selected || !preview) return;
      const value = selected.value;
      if (value === 'OFF') {
        preview.innerHTML = `<span class="mini-shift cat-rest">休息</span>`;
        hint.className = 'edit-hint';
        hint.innerHTML = `<svg class="icon"><use href="#i-info"></use></svg><span>该日改为休息，原岗位会由其他医师补位；整周排班将自动重排。</span>`;
      } else {
        const info = S.SHIFTS[value];
        preview.innerHTML = `<span class="mini-shift cat-${info.category}">${escapeHtml(info.name)}</span>`;
        const holder = selected.dataset.holder;
        let text = '';
        if (value === 'NIGHT') {
          text = day === 6
            ? '选择「夜+白上」后，下周一为「下夜班」（不在本周表内）；本周日仍只计 1 个班。'
            : '选择「夜+白上」后，次日会自动安排「下夜班」，且次日不能再排其他班。';
        } else if (holder) {
          text = `「${info.name}」当前由 ${holder} 负责。保存后会重新安排，并保持当天该岗位为 ${S.requirementCount(day, value)} 人。`;
        } else {
          text = `将 ${person.name} 的${S.DAYS[day].label}改为「${info.name}」。保存后会对整周进行合规重排。`;
        }
        hint.className = `edit-hint${value === 'NIGHT' ? ' warn' : ''}`;
        hint.innerHTML = `<svg class="icon"><use href="#${value === 'NIGHT' ? 'i-alert' : 'i-info'}"></use></svg><span>${escapeHtml(text)}</span>`;
      }
    };

    document.querySelectorAll('input[name="shiftChoice"]').forEach(input => {
      input.addEventListener('change', updatePreview);
    });
    updatePreview();

    const saveBtn = $('saveEditBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const selected = document.querySelector('input[name="shiftChoice"]:checked');
        if (!selected) return;
        applyManualEdit(staffId, day, selected.value);
      });
    }
    // 存一下 key，便于调试与后续扩展。
    els.modalCard.dataset.editKey = key;
  }

  function ensureRosterEditable() {
    state.busy = false;
    setLoading(false);
    showWorkspace('people');
    document.querySelectorAll('.role-select, .training-input, .person-delete, #addStaffBtn, #resetBtn, #rosterProfilesBtn').forEach(el => {
      el.disabled = false;
    });
    if (els.generateBtn) els.generateBtn.disabled = false;
    renderStaffList();
    if (els.rosterSub) els.rosterSub.textContent = `${countRoles().active} 人在岗，可直接修改名单后重新排班`;
  }

  function showErrorModal(error) {
    if (!error) return;
    const hints = error.hints && error.hints.length
      ? `<ul class="error-list">${error.hints.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
      : '';
    openModal(`${modalHeader('暂时无法生成排班', '人员配置或手动锁定之间存在冲突', 'SOLVER MESSAGE', '')}
      <div class="modal-body">
        <div class="confirm-copy">${escapeHtml(error.message || '未找到符合规则的排班。')}</div>
        ${hints}
        <div class="edit-hint" style="margin-top:13px">
          <svg class="icon"><use href="#i-info"></use></svg>
          <span>可以尝试：增加签报告/写报告/夜班报告医师、减少进修人员、取消部分手动锁定，或恢复科室名单后重新生成。</span>
        </div>
        <div class="edit-hint">
          <svg class="icon"><use href="#i-info"></use></svg>
          <span>关闭弹窗后可在「人员配置」继续编辑名单，调整完成后重新排班。</span>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" type="button" data-modal-close>关闭</button>
        <button class="btn btn-primary" type="button" id="errorAdjustBtn">去调整人员</button>
      </div>`, { narrow: true });
    const btn = $('errorAdjustBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        closeModal();
        ensureRosterEditable();
        if (els.staffList) els.staffList.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (els.addStaffBtn) els.addStaffBtn.focus();
      });
    }
  }

  function showReleasedModal(released) {
    if (!released || !released.length) return;
    const items = released.map(item => {
      const person = findStaff(item.staffId);
      const who = person ? person.name : (item.staffId || '未知人员');
      const day = Number.isInteger(item.day) ? S.DAYS[item.day].label : '';
      const shift = item.shift && item.shift !== 'OFF' ? (S.SHIFTS[item.shift] ? S.SHIFTS[item.shift].name : item.shift) : (item.shift === 'OFF' ? '休息' : '');
      return `<div class="pin-item">
        <span class="pin-who">${escapeHtml(who)}</span>
        <span class="pin-when">${escapeHtml(day)} ${escapeHtml(shift)}</span>
        <span class="pin-shift" title="${escapeAttr(item.reason || '')}">${escapeHtml(item.reason || '冲突释放')}</span>
      </div>`;
    }).join('');
    openModal(`${modalHeader('被释放的手动锁定', '系统优先保留较新的调整，并保证整周排班符合规则', 'LOCK RELEASE', '')}
      <div class="modal-body">
        <div class="confirm-copy">以下锁定与人员配置或其它锁定冲突，已自动释放。当前排班已通过全部规则校验。</div>
        <div class="pin-list">${items}</div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" type="button" data-modal-close>知道了</button></div>`,
      { narrow: false });
  }

  function openPinManager() {
    const pins = sortPins(state.pins);
    const items = pins.length ? pins.map(pin => {
      const person = findStaff(pin.staffId);
      const shiftName = pin.shift === 'OFF' ? '休息' : (S.SHIFTS[pin.shift] ? S.SHIFTS[pin.shift].name : pin.shift);
      return `<div class="pin-item">
        <span class="pin-who">${escapeHtml(person ? person.name : '已移除人员')}</span>
        <span class="pin-when">${S.DAYS[pin.day] ? S.DAYS[pin.day].label : ''} · ${escapeHtml(shiftName)}</span>
        <span class="pin-shift"></span>
        <button type="button" data-unpin="${escapeAttr(pin.key)}" title="解除此锁定">
          <svg class="icon"><use href="#i-unlock"></use></svg>
        </button>
      </div>`;
    }).join('') : `<div class="coverage-empty" style="padding:20px">当前没有手动锁定的格子。点击排班表中任意格子即可调整。</div>`;

    openModal(`${modalHeader('手动调整与锁定', `共 ${pins.length} 处。锁定会在全周重排时优先保留。`, 'LOCKED CELLS', '')}
      <div class="modal-body">
        <div class="confirm-copy">手动调整会锁定对应格子。若与规则或其它锁定冲突，系统会优先释放较早的锁定，并在生成后提示。</div>
        <div class="pin-list">${items}</div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" type="button" id="clearPinsBtn"${pins.length ? '' : ' disabled'}>清除全部锁定</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" type="button" data-modal-close>关闭</button>
      </div>`, { narrow: false });

    els.modalCard.querySelectorAll('[data-unpin]').forEach(button => {
      button.addEventListener('click', () => {
        if (state.busy) return;
        const key = button.dataset.unpin;
        const before = capture();
        delete state.pins[key];
        pushHistory(before);
        renderAll();
        saveState(true);
        closeModal();
        toast({ type: 'success', title: '已解除锁定', message: '该格仍是当前排班，但后续重排可以调整它。' });
      });
    });
    const clearBtn = $('clearPinsBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!pinCount()) return;
        closeModal();
        clearAllPins();
      });
    }
  }

  function openRulesModal() {
    const roles = roleIds();
    const rows = [];
    for (const [label, day] of [['工作日', 0], ['周六', 5], ['周日', 6]]) {
      rows.push(`<tr class="row-group"><td colspan="${roles.length + 2}">${label}</td></tr>`);
      for (const shift of S.WORKLOAD_KEYS) {
        const info = S.SHIFTS[shift];
        rows.push(`<tr><td class="shift-cell-name">${escapeHtml(info.name)}</td><td>${info.workload}</td>
          ${roles.map(role => {
            const eligible = S.isEligible(role, day, shift) && S.ROLES[role].max > 0 && (S.ROLES[role].limits[shift]?.max ?? 7) > 0;
            return `<td class="${eligible ? 'yes' : 'no'}">${eligible ? '●' : '—'}</td>`;
          }).join('')}</tr>`);
      }
    }

    const reqText = (day) => Object.keys(S.requirementsForDay(day)).filter(k => Number(S.requirementsForDay(day)[k]) > 0)
      .map(k => `${S.SHIFTS[k].name}×${S.requirementsForDay(day)[k]}`).join('、');

    openModal(`${modalHeader('排班规则与计算口径', '显示本周正在使用的职位、班次和岗位设置', 'RULEBOOK', '')}
      <div class="modal-body">
        <p class="rules-lead">系统按周一至周日为一个周期生成排班。每个岗位由一个符合类型的人员承担；岗位数量可在「岗位数量」中调整，手动调整会被锁定并参与整周求解。</p>

        <div class="rule-block">
          <h3><span class="num">01</span>周期与岗位</h3>
          <ul>
            <li>工作日：${escapeHtml(reqText(0))}。</li>
            <li>周六：${escapeHtml(reqText(5))}。</li>
            <li>周日：${escapeHtml(reqText(6))}。</li>
            <li>当前一周合计 <strong>${S.WEEKLY_SLOT_COUNT} 个岗位</strong>。求解器保证每个岗位按设置数量排满，不会缺岗或重复占岗。</li>
          </ul>
        </div>

        <div class="rule-block">
          <h3><span class="num">02</span>班次与人员类型</h3>
          <div class="matrix-wrap">
            <table class="rules-matrix">
              <thead><tr><th>班次</th><th>工分</th>${roles.map(role => `<th>${escapeHtml(roleName(role))}</th>`).join('')}</tr></thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          </div>
          <p class="workload-note">上表为当前工分。点击顶部「工作量」或下方按钮，可按班次调整工分；调整只影响统计、导出和打印，不改变排班约束。</p>
        </div>

        <div class="rule-block">
          <h3><span class="num">03</span>每周班次与夜班衔接</h3>
          <ul>
            <li>每人需符合所在职位的总班次和单种班次上下限。整周进修人员免除下限。</li>
            <li>「下夜班」「进修」「下乡」「休假」「出差」「休息」不计入实际班次。</li>
            ${S.isWorkShift('NIGHT') ? `<li>每次「${escapeHtml(S.shiftName('NIGHT'))}」后的次日必须为「下夜班」，且当天不能再排其它班；周日夜间后落到下周一。</li>` : ''}
            <li>生成本周时会读取上一周存档：上周日有夜班的人，本周一必须排「下」；上周日无夜班的人，本周一不能排「下」。没有上一周存档时会提示无法自动衔接。</li>
            
            <li>同一人重复同一班次会被轻微扣分，优先让白A/B/C/H 轮换；这是软目标，不改变硬规则的可解性。</li>
          </ul>
        </div>

        <div class="rule-block">
          <h3><span class="num">04</span>各职位每人每周总班次</h3>
          <ul>${roles.map(key => {
            const role = S.ROLES[key];
            return `<li>${escapeHtml(role.label)}：${role.min}–${role.max} 班</li>`;
          }).join('')}</ul>
        </div>

        <div class="rule-block">
          <h3><span class="num">05</span>状态与手动调整</h3>
          <ul>
            <li>点击表格任意格子，可改班、标记为进修/下乡/休假/出差，或改为休息；保存后该格会被锁定并重新求解。</li>
            <li>重排会尽量保留现有安排，优先保留手动锁定；如锁定之间冲突，会从<strong>较早的锁定</strong>开始释放，并展示释放原因。</li>
            <li>状态格不承担岗位，但仍会显示在排班表、CSV 和打印表中。</li>
          </ul>
        </div>

        <div class="rule-block">
          <h3><span class="num">06</span>计算口径与假设</h3>
          <div class="assumption-list">
            <div class="assumption"><strong>岗位数量：</strong>工作日/周六/周日分别设置；白签在周六默认为 2 个、周日为 1 个。修改数量后会自动重新检查人员容量。</div>
            <div class="assumption"><strong>班次工作量：</strong>用于统计和计算欠休，分值可在「职位规则 → 班次工作量与欠休」中按半分调整。</div>
            <div class="assumption"><strong>人员不足：</strong>可核对「职位规则」的资格与上下限，以及「岗位数量」。</div>
            <div class="assumption"><strong>历史与跨周：</strong>历史排班保存在${storageLabel}，长期保留；可读取、删除，也可导入上一周 CSV。上一周没有记录时，跨周下夜班不会被猜测。</div>
            <div class="assumption"><strong>求解方式：</strong>使用 SAT 约束求解。所有硬规则同时满足后才会输出排班；无解时会给出人员配置建议，而不是生成一张“看起来差不多”的表。</div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" type="button" id="rulesWorkloadBtn">
          <svg class="icon"><use href="#i-scale"></use></svg>调整工作量
        </button>
        <button class="btn btn-quiet" type="button" id="rulesRequirementBtn">
          <svg class="icon"><use href="#i-grid"></use></svg>调整岗位数量
        </button>
        <span class="spacer"></span>
        <button class="btn btn-primary" type="button" data-modal-close>知道了</button>
      </div>`,
      { wide: true });

    const workloadBtn = $('rulesWorkloadBtn');
    if (workloadBtn) {
      workloadBtn.addEventListener('click', () => {
        closeModal();
        openPositionRules('workload');
      });
    }
    const requirementBtn = $('rulesRequirementBtn');
    if (requirementBtn) {
      requirementBtn.addEventListener('click', () => {
        closeModal();
        openRequirementModal();
      });
    }
  }

  async function openPositionRules(initialTab = 'roles') {
    if (state.busy) return;
    if (!desktop?.editPositionRules) { openRuleConfigModal(initialTab); return; }
    try {
      const response = await desktop.editPositionRules({ config: S.getRuleConfig(), workloads: S.getWorkloads(), initialTab });
      if (response) await applyRuleConfig(window.PaibanRules.read(response.config), response.workloads);
    } catch (error) {
      toast({ type: 'error', title: '无法修改职位规则', message: error.message });
    }
  }

  function openRuleConfigModal(initialTab = 'roles') {
    if (state.busy) return;
    const draft = S.getRuleConfig();
    let selected = draft.roles[0].id;
    const shiftsOnly = initialTab === 'shifts';
    const weights = S.getWorkloads();
    let tab = initialTab;
    let pendingDelete = null;
    const rangeInput = (value, label, attr) =>
      `<input type="number" min="0" max="7" step="1" required value="${Number.isFinite(value) ? value : ''}" aria-label="${escapeAttr(label)}" ${attr}>`;

    openModal(`${modalHeader(shiftsOnly ? '班次管理' : '职位规则', shiftsOnly ? '新增、改名或删除班次' : '设置可排班次、每周班次范围与欠休计算的工作量', '', '')}
      ${shiftsOnly ? '' : `<div class="rule-settings-tabs" aria-label="设置类别">
        <button type="button" data-rule-tab="roles">可排班次与上下限</button>
        <button type="button" data-rule-tab="workload">班次工作量与欠休</button>
      </div>`}
      <form id="ruleConfigForm" class="modal-body" novalidate>
        <div id="ruleConfigEditor"></div>
        <div class="form-error" id="ruleConfigError" role="alert"></div>
      </form>
      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="btn btn-quiet" type="button" data-modal-close>取消</button>
        <button class="btn btn-primary" type="submit" form="ruleConfigForm">保存设置</button>
      </div>`, { wide: true });
    const editor = $('ruleConfigEditor');
    const form = $('ruleConfigForm');
    const errorHost = $('ruleConfigError');
    const activeRole = () => draft.roles.find(role => role.id === selected);
    const readNumber = input => input.value === '' ? NaN : Number(input.value);

    function readEditor() {
      if (tab === 'workload') {
        for (const input of editor.querySelectorAll('[data-rule-workload]')) weights[input.dataset.ruleWorkload] = readNumber(input);
        return;
      }
      if (tab === 'shifts') {
        for (const shift of draft.shifts) {
          shift.name = editor.querySelector(`[data-rule-shift-name="${shift.id}"]`).value.trim();
        }
        return;
      }
      const role = activeRole();
      role.name = $('ruleRoleName').value.trim();
      role.min = readNumber($('ruleTotalMin'));
      role.max = readNumber($('ruleTotalMax'));
      for (const type of S.DAY_TYPES) {
        role.allowed[type.key] = [...editor.querySelectorAll(`[data-rule-day="${type.key}"]:checked`)].map(input => input.value);
      }
      role.limits = {};
      for (const shift of draft.shifts) {
        const min = readNumber(editor.querySelector(`[data-rule-min="${shift.id}"]`));
        const max = readNumber(editor.querySelector(`[data-rule-max="${shift.id}"]`));
        if (min !== 0 || max !== 7) role.limits[shift.id] = { min, max };
      }
    }

    function renderEditor() {
      els.modalCard.querySelectorAll('[data-rule-tab]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.ruleTab === tab));
      });
      if (tab === 'workload') {
        renderRuleWorkloads();
        return;
      }
      if (tab === 'shifts') {
        renderShiftCatalog();
        return;
      }
      const role = activeRole();
      editor.innerHTML = `
        <div class="rule-catalog-controls">
          <label>选择职位<select id="ruleRoleSelect">
            ${draft.roles.map(entry => `<option value="${entry.id}"${entry.id === selected ? ' selected' : ''}>${escapeHtml(entry.name || '未命名职位')}</option>`).join('')}
          </select></label>
          <button class="btn btn-quiet" id="ruleAddRole" type="button">新增职位</button>
        </div>
        <div class="rule-catalog-controls">
          <label>职位名称<input id="ruleRoleName" type="text" maxlength="24" value="${escapeAttr(role.name)}"></label>
          <label>每人每周总下限${rangeInput(role.min, '每人每周总下限', 'id="ruleTotalMin"')}</label>
          <label>每人每周总上限${rangeInput(role.max, '每人每周总上限', 'id="ruleTotalMax"')}</label>
        </div>
        <p class="workload-note"><strong>${Rest.exempt({ role: role.id }) ? '本职位不计欠休，没有每周工作量要求。' : '本职位按每周 5 工作量计算欠休。'}</strong> 勾选可排的日期。单种班次默认可排 0–7 次，同时受总班次上限和岗位数量限制。整周进修人员不计入这些范围。</p>
        <div class="matrix-wrap">
          <table class="rules-matrix rule-catalog-matrix">
            <thead><tr><th>班次</th>${S.DAY_TYPES.map(day => `<th>${day.label}</th>`).join('')}<th>每周下限</th><th>每周上限</th></tr></thead>
            <tbody>${draft.shifts.length ? draft.shifts.map(shift => {
              const limit = role.limits[shift.id] || { min: 0, max: 7 };
              const label = shift.name || '未命名班次';
              return `<tr>
                <th scope="row" class="shift-cell-name" data-rule-shift-label="${shift.id}">${escapeHtml(label)}</th>
                ${S.DAY_TYPES.map(day => `<td><input type="checkbox" data-rule-day="${day.key}" value="${shift.id}" aria-label="${escapeAttr(day.label + '可排' + label)}"${role.allowed[day.key].includes(shift.id) ? ' checked' : ''}></td>`).join('')}
                <td>${rangeInput(Number.isFinite(limit.min) ? limit.min : '', label + '每周下限', `data-rule-min="${shift.id}"`)}</td>
                <td>${rangeInput(Number.isFinite(limit.max) ? limit.max : '', label + '每周上限', `data-rule-max="${shift.id}"`)}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="6">暂无班次。可到「班次管理」新增。</td></tr>'}</tbody>
          </table>
        </div>`;
    }

    function renderRuleWorkloads() {
      const defaults = S.DEFAULT_WORKLOADS;
      editor.innerHTML = `
        <div class="rest-rule-summary">
          <strong>每周标准：5 工作量 · 主任不计欠休</strong>
          <p>超过 5 的部分增加欠休；低于 5 时抵扣已有欠休，每周最多抵扣 2，余额最低为 0。进修、下乡、出差每天计 1，周合计达到或超过 5 时不抵扣。</p>
        </div>
        <div class="rule-catalog-controls workload-controls">
          <span>以下分值对所有职位生效，可按 0.5 调整。</span>
          <button class="btn btn-quiet" id="ruleResetWorkloads" type="button">恢复默认工作量</button>
        </div>
        <div class="workload-table-wrap"><table class="workload-table">
          <thead><tr><th>班次或状态</th><th>默认</th><th>工作量</th></tr></thead>
          <tbody>${draft.shifts.map(shift => `<tr><td>${escapeHtml(shift.name)}</td><td>${defaults[shift.id] ?? 0}</td>
            <td class="workload-input-wrap"><input type="number" min="0" max="${S.MAX_WORKLOAD}" step="0.5" inputmode="decimal"
              value="${Number.isFinite(weights[shift.id]) ? weights[shift.id] : ''}" data-rule-workload="${shift.id}" aria-label="${escapeAttr(shift.name + '工作量')}"></td></tr>`).join('')}
          ${S.STATUS_KEYS.filter(shift => shift !== 'VACATION').concat('VACATION', 'POST').map(shift =>
            `<tr><td>${escapeHtml(S.shiftName(shift))}</td><td>${S.workloadOf(shift)}</td><td>${S.workloadOf(shift)}（固定）</td></tr>`).join('')}</tbody>
        </table></div>`;
    }

    function renderShiftCatalog() {
      const removing = draft.shifts.find(shift => shift.id === pendingDelete);
      editor.innerHTML = `
        <div class="shift-catalog-head">
          <p>直接修改下方的班次名称，点击「保存设置」生效。</p>
          <button class="btn btn-quiet" id="ruleAddShift" type="button"><svg class="icon"><use href="#i-plus"></use></svg>新增班次</button>
        </div>
        ${removing ? `<div class="shift-delete-confirm" id="ruleShiftConfirm" role="group" aria-label="确认删除班次">
          <strong>删除「${escapeHtml(removing.name || '未命名班次')}」？</strong>
          <p>保存后会一并移除此班次的岗位人数、工分、职位资格和上下限。已存档的排班仍可读取；涉及此班次的当前排班需要重新生成。</p>
          <button class="btn btn-quiet" type="button" id="ruleCancelShiftDelete">保留班次</button>
          <button class="btn btn-danger" type="button" id="ruleConfirmShiftDelete">确认删除</button>
        </div>` : ''}
        ${draft.shifts.length ? `<table class="shift-catalog-table">
          <thead><tr><th scope="col">班次名称（可编辑）</th><th scope="col">班次规则</th><th scope="col">操作</th></tr></thead>
          <tbody>${draft.shifts.map(shift => `<tr>
            <td><input type="text" maxlength="24" value="${escapeAttr(shift.name)}" data-rule-shift-name="${shift.id}"
              aria-label="${escapeAttr((shift.name || '未命名') + ' 的班次名称')}" placeholder="输入班次名称"></td>
            <td>${shift.id === 'NIGHT' ? '次日自动下夜班' : '普通班次'}</td>
            <td><button class="text-btn danger" type="button" data-rule-delete-shift="${shift.id}"
              aria-label="${escapeAttr('删除 ' + (shift.name || '未命名班次'))}"${removing ? ' disabled' : ''}>删除</button></td>
          </tr>`).join('')}</tbody>
        </table>` : '<p class="workload-note">暂无班次，点击「新增班次」开始设置。</p>'}
        <p class="workload-note">新增班次的岗位数默认为 0，可在「岗位数量」中调整。</p>`;
    }

    function nextName(items, prefix) {
      let number = 1;
      while (items.some(item => item.name === `${prefix}${number}`)) number++;
      return `${prefix}${number}`;
    }

    els.modalCard.querySelectorAll('[data-rule-tab]').forEach(button => button.addEventListener('click', () => {
      if (tab === button.dataset.ruleTab) return;
      readEditor();
      tab = button.dataset.ruleTab;
      pendingDelete = null;
      renderEditor();
      form.scrollTop = 0;
    }));
    editor.addEventListener('change', event => {
      if (event.target.id !== 'ruleRoleSelect') return;
      const next = event.target.value;
      readEditor();
      selected = next;
      renderEditor();
      $('ruleRoleSelect').focus();
    });
    const newId = kind => `${kind}_${S.createId('new').slice(4).replaceAll('_', '-').toLowerCase()}`;
    editor.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      readEditor();
      if (button.id === 'ruleResetWorkloads') {
        Object.assign(weights, S.DEFAULT_WORKLOADS);
        renderEditor();
        $('ruleResetWorkloads').focus();
      } else if (button.id === 'ruleAddRole') {
        selected = newId('role');
        draft.roles.push({ id: selected, name: nextName(draft.roles, '新职位'), min: 0, max: 5,
          allowed: Object.fromEntries(S.DAY_TYPES.map(day => [day.key, []])), limits: {} });
        renderEditor();
        $('ruleRoleName').focus();
        $('ruleRoleName').select();
      } else if (button.id === 'ruleAddShift') {
        const id = newId('shift');
        weights[id] = 0;
        draft.shifts.push({ id, name: nextName(draft.shifts, '新班次') });
        pendingDelete = null;
        renderEditor();
        const input = editor.querySelector(`[data-rule-shift-name="${id}"]`);
        input.focus();
        input.select();
      } else if (button.dataset.ruleDeleteShift) {
        pendingDelete = button.dataset.ruleDeleteShift;
        renderEditor();
        $('ruleCancelShiftDelete').focus();
      } else if (button.id === 'ruleConfirmShiftDelete' || button.id === 'ruleCancelShiftDelete') {
        if (button.id === 'ruleConfirmShiftDelete' && pendingDelete) {
          draft.shifts = draft.shifts.filter(shift => shift.id !== pendingDelete);
          delete weights[pendingDelete];
          for (const role of draft.roles) {
            for (const day of S.DAY_TYPES) role.allowed[day.key] = role.allowed[day.key].filter(shift => shift !== pendingDelete);
            delete role.limits[pendingDelete];
          }
        }
        pendingDelete = null;
        renderEditor();
        $('ruleAddShift').focus();
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy) return;
      if (pendingDelete) { $('ruleCancelShiftDelete').focus(); return; }
      readEditor();
      let config;
      try { config = window.PaibanRules.read(draft); } catch (error) {
        errorHost.textContent = error.message;
        errorHost.classList.add('show');
        errorHost.scrollIntoView({ block: 'nearest' });
        return;
      }
      const invalid = draft.shifts.find(shift => !Rest.validBalance(weights[shift.id]) || weights[shift.id] > S.MAX_WORKLOAD);
      if (invalid) {
        tab = 'workload';
        renderEditor();
        errorHost.textContent = `「${invalid.name}」的工作量须在 0–${S.MAX_WORKLOAD} 之间，并按 0.5 递增。`;
        errorHost.classList.add('show');
        editor.querySelector(`[data-rule-workload="${invalid.id}"]`)?.focus();
        return;
      }
      if (positionWindow) desktop.finishPositionRules({ config, workloads: weights });
      else await applyRuleConfig(config, weights);
    });
    renderEditor();
  }

  async function applyRuleConfig(config, workloads) {
    const before = capture();
    if (JSON.stringify(config) === JSON.stringify(before.ruleConfig)
        && JSON.stringify(workloads) === JSON.stringify(before.workloads)) { closeModal(); return; }
    const remaining = new Set(config.shifts.map(shift => shift.id));
    const deleted = new Set(before.ruleConfig.shifts.filter(shift => !remaining.has(shift.id)).map(shift => shift.id));
    const needsNewSchedule = Object.values(before.schedule).some(row => row.some(shift => deleted.has(shift)))
      || (hasAnyWork(before.schedule) && Object.values(before.requirements).some(group =>
        [...deleted].some(shift => group[shift] > 0)
      ));
    S.setRuleConfig(config);
    state.requirements = S.getRequirements();
    state.workloads = S.setWorkloads(workloads);
    if (deleted.size) state.pins = normalizePins(state.pins, state.staff);
    if (needsNewSchedule) {
      state.schedule = {};
      state.waitingForSchedule = true;
    }
    closeModal();
    const validation = S.validate(state.staff, state.schedule, state.pins, { previousWeek: state.previousWeek });
    if (hasAnyWork() && !validation.ok) {
      await reflowAfterRosterChange(before, '已应用职位与班次规则。', { keepRosterOnFailure: true, changeTitle: '职位与班次' });
    } else {
      pushHistory(before);
      state.lastError = null;
      renderAll();
      saveState(true);
      if (state.storageOk) toast({ type: 'success', title: '职位与班次已保存',
        message: needsNewSchedule ? '原有历史记录仍可读取，请重新生成本周排班。' : '下次排班将使用这些设置。' });
    }
  }

  function openRequirementModal() {
    if (state.busy) return;
    const groups = S.DAY_TYPES.map(day => ({ ...day, shifts: S.WORKLOAD_KEYS }));
    const current = S.getRequirements();

    const section = (group) => `
      <div class="requirement-group">
        <h4>${escapeHtml(group.label)}</h4>
        <div class="requirement-grid">
          ${group.shifts.map(shift => {
            const info = S.SHIFTS[shift];
            const value = current[group.key] && current[group.key][shift] != null ? current[group.key][shift] : 0;
            return `<label class="requirement-item">
              <span class="requirement-name"><i class="legend-dot cat-${info.category}"></i>${escapeHtml(info.name)}</span>
              <input type="number" min="0" max="20" step="1" value="${value}"
                data-req-type="${group.key}" data-req-shift="${shift}" aria-label="${escapeAttr(group.label)} ${escapeAttr(info.name)}数量">
            </label>`;
          }).join('')}
        </div>
      </div>`;

    openModal(`${modalHeader('岗位数量设置', '按工作日、周六、周日分别设置每个班次每天需要的人数', 'SHIFT CAPACITY', '')}
      <div class="modal-body">
        <p class="rules-lead">数量为 0 表示该岗位不排；修改后会立即检查人员容量。当前一周合计 <strong id="requirementTotal">${S.WEEKLY_SLOT_COUNT}</strong> 个岗位。</p>
        ${groups.map(section).join('')}
        <div class="form-error" id="requirementError"></div>
        <div class="edit-hint">
          <svg class="icon"><use href="#i-info"></use></svg>
          <span>白签周六默认 2 人、周日默认 1 人；工作日 4 人。若把岗位数调高，系统会提示需要增加相应类型的人员。</span>
        </div>
      </div>
      <div class="modal-foot">
        <span class="foot-hint">调整后会对整周重新求解</span>
        <span class="spacer"></span>
        <button class="btn btn-quiet" type="button" data-modal-close>取消</button>
        <button class="btn btn-primary" type="button" id="saveRequirementsBtn">
          <svg class="icon"><use href="#i-sparkles"></use></svg>保存并重排
        </button>
      </div>`, { wide: true });

    const totalEl = $('requirementTotal');
    const inputs = [...document.querySelectorAll('[data-req-type]')];
    const readValues = () => {
      const values = { weekday: {}, sat: {}, sun: {} };
      inputs.forEach(input => {
        values[input.dataset.reqType][input.dataset.reqShift] = Math.max(0, Math.min(20, Math.round(Number(input.value) || 0)));
      });
      return values;
    };
    const updateTotal = () => {
      const values = readValues();
      let total = 0;
      const dayFactor = { weekday: 5, sat: 1, sun: 1 };
      ['weekday', 'sat', 'sun'].forEach(type => {
        Object.values(values[type] || {}).forEach(v => { total += (Number(v) || 0) * dayFactor[type]; });
      });
      if (totalEl) totalEl.textContent = total;
    };
    inputs.forEach(input => input.addEventListener('input', updateTotal));

    const saveBtn = $('saveRequirementsBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const values = readValues();
        const before = capture();
        const previous = S.getRequirements();
        state.requirements = S.setRequirements(values);
        const roster = S.validateRoster(state.staff);
        if (hasAnyWork(before.schedule) && !roster.ok) {
          state.requirements = S.setRequirements(previous);
          const error = $('requirementError');
          if (error) {
            error.textContent = roster.errors.slice(0, 3).join('；');
            error.classList.add('show');
          }
          return;
        }
        closeModal();
        if (!hasAnyWork(before.schedule)) {
          pushHistory(before);
          renderAll();
          saveState(true);
          toast({ type: 'success', title: '岗位数量已保存', message: `当前一周共 ${S.WEEKLY_SLOT_COUNT} 个岗位。` });
          return;
        }
        const ok = await reflowAfterRosterChange(before, '岗位数量已更新，整周排班已重新平衡。');
        if (!ok) {
          state.requirements = S.setRequirements(previous);
          renderAll();
        }
      });
    }
  }

  function switchWeek(offset) {
    if (state.busy) return;
    const before = capture();
    archiveCurrentWeek();
    const nextStart = addDays(state.weekStart, offset * 7);
    state.weekStart = nextStart;
    state.waitingForSchedule = false;
    const record = findArchiveRecord(nextStart);
    if (record) {
      S.setRuleConfig(record.ruleConfig);
      const staff = normalizeStaffList(record.staff, { promoteNight: !record.version || Number(record.version) < 3 });
      if (staff.length) state.staff = staff;
      state.schedule = normalizeSchedule(record.schedule, state.staff);
      state.pins = normalizePins(record.pins, state.staff);
      state.notes = typeof record.notes === 'string' ? record.notes : '';
      state.owedRest = normalizeOwedRest(record.owedRest, state.staff);
      state.requirements = S.setRequirements(record.requirements);
      state.workloads = S.setWorkloads(workloadsForRecord(record));
    } else {
      state.schedule = {};
      state.pins = {};
      state.notes = '';
      state.owedRest = {};
    }
    readArchiveRest(record);
    state.lastError = null;
    pushHistory(before);
    refreshPreviousWeek();
    renderAll();
    saveState(true);
    toast({
      type: 'info',
      title: record ? '已读取该周存档' : '已切换到空白周',
      message: `${weekRangeLabel()}${record ? '已载入' : '暂无存档，可直接生成'}。`
    });
  }

  function loadArchiveRecord(record) {
    if (!record || state.busy) return;
    const before = capture();
    S.setRuleConfig(record.ruleConfig);
    const staff = normalizeStaffList(record.staff, { promoteNight: !record.version || Number(record.version) < 3 });
    if (!staff.length) {
      S.setRuleConfig(before.ruleConfig);
      toast({ type: 'error', title: '存档没有有效人员', message: '这条记录无法读取。' });
      return;
    }
    state.staff = staff;
    state.weekStart = parseIsoDate(record.weekStart) || state.weekStart;
    state.schedule = normalizeSchedule(record.schedule, staff);
    state.waitingForSchedule = false;
    state.pins = normalizePins(record.pins, staff);
    state.notes = typeof record.notes === 'string' ? record.notes : '';
    state.owedRest = normalizeOwedRest(record.owedRest, staff);
    state.requirements = S.setRequirements(record.requirements);
    state.workloads = S.setWorkloads(workloadsForRecord(record));
    readArchiveRest(record);
    state.lastError = null;
    pushHistory(before);
    refreshPreviousWeek();
    renderAll();
    saveState(true);
    showWorkspace('schedule');
    toast({ type: 'success', title: '已读取历史排班', message: `${record.weekStart} 的人员、排班、备注已恢复。` });
  }

  function deleteArchiveRecord(record) {
    if (!record) return;
    const records = loadArchive().filter(item => item.weekStart !== record.weekStart);
    if (!writeArchive(records)) {
      toast({ type: 'error', title: '删除未保存', message: '无法写入本地存档，请检查保存位置。' });
      return;
    }
    refreshPreviousWeek();
    toast({ type: 'success', title: '已删除历史排班', message: `已删除 ${record.weekStart} 的存档；当前编辑内容不受影响。` });
    renderAll();
  }

  function openArchiveModal() {
    if (state.busy) return;
    const records = loadArchive();
    const rows = records.length ? records.map(record => {
      const totals = record.totals || {};
      const staffCount = Array.isArray(record.staff) ? record.staff.length : 0;
      return `<div class="archive-item">
        <div class="archive-main">
          <strong>${escapeHtml(record.weekStart)} 至 ${escapeHtml(record.weekEnd || '')}</strong>
          <span>${escapeHtml(record.weekLabel || '')}</span>
          <small>${staffCount} 人 · ${totals.filled != null ? `${totals.filled}/${totals.total} 岗位` : '岗位未统计'} · ${totals.nights != null ? `${totals.nights} 个夜班` : '夜班未统计'} · ${record.savedAt ? formatClock(new Date(record.savedAt)) : '未记录时间'}</small>
        </div>
        <div class="archive-actions">
          <button class="text-btn" type="button" data-archive-load="${escapeAttr(record.weekStart)}">读取</button>
          <button class="text-btn danger" type="button" data-archive-delete="${escapeAttr(record.weekStart)}">删除</button>
        </div>
      </div>`;
    }).join('') : '<div class="archive-empty">还没有历史排班。生成排班后会自动保存本周，也可以先点击“保存本周”。</div>';

    openModal(`${modalHeader('历史排班', '读取、删除以前的周排班；下一周会自动读取上周的下夜班与欠休结转记录', 'SCHEDULE ARCHIVE', '')}
      <div class="modal-body">
        <p class="rules-lead">存档按周保存，包含人员名单、排班、手动锁定、备注和欠休。历史记录长期保留，不会因超过周数自动删除。${desktop ? '数据写入本地文件，可在“数据备份”中打开保存目录。' : '数据保存在当前浏览器，请通过“数据备份”定期导出。'}</p>
        <div class="archive-import">
          <label>导入上一周 CSV
            <input type="date" id="archiveImportWeek" value="${escapeAttr(isoDate(addDays(state.weekStart, -7)))}">
          </label>
          <input type="file" id="archiveImportFile" accept=".csv,text/csv" hidden>
          <button class="btn btn-quiet" type="button" id="archiveImportBtn">选择 CSV</button>
        </div>
        <p class="import-hint">可导入本软件“导出”的 CSV；系统按姓名匹配当前名单，并把所选日期作为该周周一。</p>
        <div class="archive-list">${rows}</div>
        <div class="form-error" id="archiveError"></div>
      </div>
      <div class="modal-foot">
        <span class="foot-hint">当前：${escapeHtml(isoDate(state.weekStart))}</span>
        <span class="spacer"></span>
        <button class="btn btn-quiet" type="button" data-modal-close>关闭</button>
        <button class="btn btn-primary" type="button" id="archiveNowBtn">
          <svg class="icon"><use href="#i-calendar"></use></svg>保存本周
        </button>
      </div>`, { wide: true });

    document.querySelectorAll('[data-archive-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const record = findArchiveRecord(btn.dataset.archiveLoad);
        if (!record) return;
        closeModal();
        confirmModal({
          title: '读取这一周的排班？',
          message: `将载入 ${escapeHtml(record.weekStart)} 的人员、排班、备注和欠休。当前内容可撤销。`,
          confirmLabel: '读取',
          onConfirm: () => loadArchiveRecord(record)
        });
      });
    });
    document.querySelectorAll('[data-archive-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const record = findArchiveRecord(btn.dataset.archiveDelete);
        if (!record) return;
        closeModal();
        confirmModal({
          title: '删除历史排班？',
          message: `删除 ${escapeHtml(record.weekStart)} 的存档后，跨周读取将不再使用这条记录。当前编辑中的排班不受影响。`,
          confirmLabel: '删除',
          danger: true,
          onConfirm: () => deleteArchiveRecord(record)
        });
      });
    });
    const saveBtn = $('archiveNowBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const record = archiveCurrentWeek();
        if (record) {
          toast({ type: 'success', title: '本周已存档', message: `${record.weekStart} 的排班已写入历史。` });
          openArchiveModal();
        } else {
          const error = $('archiveError');
          if (error) {
            error.textContent = state.storageOk
              ? '请先生成一份通过规则检查的排班，再保存为历史。'
              : '无法写入本地存档，请检查保存位置。';
            error.classList.add('show');
          }
        }
      });
    }
    const importBtn = $('archiveImportBtn');
    const importFile = $('archiveImportFile');
    const importWeek = $('archiveImportWeek');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        const weekStart = importWeek ? importWeek.value : isoDate(addDays(state.weekStart, -7));
        importScheduleCsv(file, weekStart);
      });
    }
  }

  function openRosterProfilesModal() {
    if (state.busy) return;
    const profiles = loadRosterProfiles();
    const rows = profiles.length ? profiles.map(profile => `
      <div class="roster-profile-item">
        <div class="archive-main">
          <strong>${escapeHtml(profile.name)}</strong>
          <span>${profile.staff.length} 人 · ${escapeHtml([...new Set(profile.staff.map(person => profile.ruleConfig?.roles.find(role => role.id === person.role)?.name || roleName(person.role)))].join(' / '))}</span>
          <small>保存于 ${profile.savedAt ? new Date(profile.savedAt).toLocaleString('zh-CN', { hour12: false }) : '未记录时间'}</small>
        </div>
        <div class="archive-actions">
          <button class="text-btn" type="button" data-profile-load="${escapeAttr(profile.id)}">载入</button>
          <button class="text-btn danger" type="button" data-profile-delete="${escapeAttr(profile.id)}">删除</button>
        </div>
      </div>`).join('') : '<div class="archive-empty">还没有保存过名单方案。可以在下方给当前名单起个名字保存。</div>';

    openModal(`${modalHeader('人员配置方案', `保存当前人员名单，供以后快速载入；当前名单也会自动保存在${storageLabel}`, 'ROSTER LIBRARY', '')}
      <div class="modal-body">
        <div class="profile-save-row">
          <input type="text" id="profileNameInput" maxlength="40" placeholder="例如：2026 年 11 月名单 / 夜班组" aria-label="名单方案名称">
          <button class="btn btn-primary" type="button" id="saveProfileBtn"><svg class="icon"><use href="#i-plus"></use></svg>保存当前名单</button>
        </div>
        <div class="roster-profile-list">${rows}</div>
        <div class="form-error" id="profileError"></div>
      </div>
      <div class="modal-foot">
        <span class="foot-hint">当前 ${state.staff.length} 人；载入方案会清空当前排班并等待重新生成</span>
        <span class="spacer"></span>
        <button class="btn btn-quiet" type="button" data-modal-close>关闭</button>
      </div>`, { wide: true });

    const saveProfileBtn = $('saveProfileBtn');
    if (saveProfileBtn) {
      saveProfileBtn.addEventListener('click', () => {
        const input = $('profileNameInput');
        const name = String(input && input.value || '').trim();
        if (!name) {
          const error = $('profileError');
          if (error) { error.textContent = '请先填写方案名称。'; error.classList.add('show'); }
          return;
        }
        const profilesList = loadRosterProfiles();
        const profile = {
          id: S.createId('roster'),
          version: 3,
          name,
          staff: clone(state.staff),
          ruleConfig: S.getRuleConfig(),
          savedAt: Date.now()
        };
        const existing = profilesList.findIndex(item => item.name === name);
        if (existing >= 0) profilesList[existing] = profile;
        else profilesList.unshift(profile);
        writeRosterProfiles(profilesList);
        toast({ type: 'success', title: '名单方案已保存', message: `已保存“${name}”，可在名单方案中载入。` });
        openRosterProfilesModal();
      });
    }
    document.querySelectorAll('[data-profile-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const profile = loadRosterProfiles().find(item => item.id === btn.dataset.profileLoad);
        if (!profile) return;
        closeModal();
        confirmModal({
          title: '载入名单方案？',
          message: `将用“${escapeHtml(profile.name)}”替换当前人员名单，并清空当前排班；人员配置可撤销。`,
          confirmLabel: '载入',
          onConfirm: () => {
            const before = capture();
            if (profile.staff.some(person => !S.ROLES[person.role])) {
              S.setRuleConfig(profile.ruleConfig);
              state.requirements = S.getRequirements();
              state.workloads = S.getWorkloads();
            }
            state.staff = normalizeStaffList(profile.staff, { promoteNight: !profile.version || Number(profile.version) < 3 });
            state.schedule = {};
            state.waitingForSchedule = false;
            state.pins = {};
            state.lastError = null;
            pushHistory(before);
            refreshPreviousWeek();
            renderAll();
            saveState(true);
            toast({ type: 'success', title: '名单已载入', message: '请点击“重新排班”按新名单生成整周排班。' });
          }
        });
      });
    });
    document.querySelectorAll('[data-profile-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const profile = loadRosterProfiles().find(item => item.id === btn.dataset.profileDelete);
        if (!profile) return;
        closeModal();
        confirmModal({
          title: '删除名单方案？',
          message: `删除“${escapeHtml(profile.name)}”后无法恢复，当前使用中的名单不受影响。`,
          confirmLabel: '删除',
          danger: true,
          onConfirm: () => {
            writeRosterProfiles(loadRosterProfiles().filter(item => item.id !== profile.id));
            toast({ type: 'success', title: '名单方案已删除', message: `已删除“${profile.name}”。` });
            openRosterProfilesModal();
          }
        });
      });
    });
  }

  function openNotesModal() {
    if (state.busy) return;
    openModal(`${modalHeader('本周备注', '记录特殊安排，随本周排班一起保存', '', '')}
      <div class="modal-body">
        <label class="notes-field"><span>本周排班备注</span>
          <textarea id="notesText" maxlength="2000" rows="5" data-autofocus>${escapeHtml(state.notes || '')}</textarea>
        </label>
      </div>
      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="btn btn-quiet" type="button" data-modal-close>取消</button>
        <button class="btn btn-primary" type="button" id="saveNotesBtn">保存备注</button>
      </div>`, { wide: true });
    $('saveNotesBtn').addEventListener('click', () => {
      const before = capture();
      state.notes = $('notesText').value.trim();
      pushHistory(before);
      closeModal();
      renderAll();
      saveState(true);
    });
  }

  function openRestOpeningModal(personId) {
    if (state.busy) return;
    const staff = state.staff.filter(person => !Rest.exempt(person));
    if (!staff.length) return;
    const overrides = currentRestOverrides();
    openModal(`${modalHeader('设置上周末欠休', weekRangeLabel(), '', '')}
      <form class="modal-body" id="restOpeningForm" novalidate>
        <p class="rules-lead">首次使用或上周没有可结转的记录时，可以手动填写期初欠休，支持半分。留空则自动接续上周余额；没有记录的人员按 0 计算。</p>
        <div class="owed-list rest-editor">${staff.map(person => {
          const carry = Rest.valueFor(state.restInherited, person.id);
          const value = Rest.valueFor(overrides, person.id);
          return `<label class="owed-row"><span><strong>${escapeHtml(person.name)}</strong><small>${carry == null ? '无上周余额 · 默认 0' : '从上周结转 ' + carry}</small></span>
            <input type="number" min="0" step="0.5" inputmode="decimal" value="${value ?? ''}" placeholder="${carry ?? 0}" data-rest-input="${escapeAttr(person.id)}" aria-label="${escapeAttr(person.name + '的期初欠休')}" ${person.id === personId ? 'data-autofocus' : ''}></label>`;
        }).join('')}</div>
        <div class="form-error" id="restOpeningError" role="alert"></div>
      </form>
      <div class="modal-foot"><span class="foot-hint">保存后立即更新期末余额；下次排班会使用新余额。</span><span class="spacer"></span>
        <button class="btn btn-quiet" type="button" data-modal-close>取消</button>
        <button class="btn btn-primary" type="submit" form="restOpeningForm">保存期初</button>
      </div>`, { wide: true });
    $('restOpeningForm').addEventListener('submit', event => {
      event.preventDefault();
      const values = {};
      for (const input of event.currentTarget.querySelectorAll('[data-rest-input]')) {
        const value = input.valueAsNumber;
        if (input.validity.badInput || (input.value !== '' && !Rest.validBalance(value))) {
          $('restOpeningError').textContent = '欠休量须为非负数字，并按 0.5 递增。';
          $('restOpeningError').classList.add('show');
          input.focus();
          return;
        }
        if (input.value !== '') Object.defineProperty(values, input.dataset.restInput, { value, enumerable: true });
      }
      const before = capture();
      state.restOpenings[archiveIdFor()] = values;
      state.restTracked = true;
      pushHistory(before);
      closeModal();
      renderAll();
      saveState(true);
    });
  }

  function openAddStaffModal() {
    if (state.busy) return;
    openModal(`${modalHeader('添加医师', '设置姓名与人员类型', 'NEW PHYSICIAN', '')}
      <div class="modal-body">
        <form id="addStaffForm" autocomplete="off">
          <div class="form-field">
            <label for="newStaffName">姓名</label>
            <input type="text" id="newStaffName" name="name" maxlength="20" placeholder="例如：林晓" data-autofocus>
            <p class="form-help">姓名用于排班表展示，可以随时在左侧名单中修改。</p>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label for="newStaffRole">人员类型</label>
              <select id="newStaffRole" name="role">
                ${roleIds().map(role => `<option value="${role}"${role === 'writer' ? ' selected' : ''}>${escapeHtml(roleName(role))}</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <label>初始状态</label>
              <div class="form-check">
                <input type="checkbox" id="newStaffTraining" name="training">
                <label for="newStaffTraining">本周进修，不承担工作</label>
              </div>
            </div>
          </div>
          <div class="form-error" id="addStaffError"></div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" type="button" data-modal-close>取消</button>
        <button class="btn btn-primary" type="submit" form="addStaffForm">添加医师</button>
      </div>`, { narrow: true });

    const form = $('addStaffForm');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = $('newStaffName').value.trim();
      const role = $('newStaffRole').value;
      const training = $('newStaffTraining').checked;
      const error = $('addStaffError');
      if (!name) {
        error.textContent = '请填写医师姓名。';
        error.classList.add('show');
        $('newStaffName').focus();
        return;
      }
      if (state.staff.some(p => p.name.trim() === name)) {
        error.textContent = '已有同名医师，请使用可区分的姓名。';
        error.classList.add('show');
        $('newStaffName').focus();
        return;
      }
      closeModal();
      await addStaff({ name, role, training });
    });
    setTimeout(() => { const input = $('newStaffName'); if (input) input.focus(); }, 40);
  }

  /* ------------------------------------------------------------------ */
  /* 导出 / 打印                                                        */
  /* ------------------------------------------------------------------ */

  async function openExportWindow() {
    if (!state.view?.hasWork || state.busy) return;
    const draft = {
      weekStart: isoDate(state.weekStart), staff: clone(state.staff), schedule: clone(state.schedule),
      shifts: clone(S.SHIFTS), closing: clone(state.view.closing),
      notes: state.notes, balancesValid: state.view.validation.ok, csv: csvContent()
    };
    try {
      if (desktop) await desktop.openExport(draft);
      else {
        const child = window.open('desktop/export.html', '_blank', 'width=1420,height=980');
        if (!child) throw new Error('请允许打开导出预览窗口后重试');
        const onReady = event => {
          if (event.source !== child || event.data?.type !== 'paiban-export-ready') return;
          child.postMessage({ type: 'paiban-export-data', draft }, '*');
          window.removeEventListener('message', onReady);
        };
        window.addEventListener('message', onReady);
        setTimeout(() => window.removeEventListener('message', onReady), 30000);
      }
    } catch (err) { toast({ type: 'error', title: '无法打开导出窗口', message: err.message }); }
  }

  function csvContent() {
    const dates = weekDates();
    const header = ['姓名', '类型', '上周末欠休', ...S.DAYS.map((day, d) => `${day.label}(${formatShortDate(dates[d])})`), '本周末欠休', '班次数', '工作量'];
    const rows = [header];
    state.staff.forEach(person => {
      const row = state.schedule[person.id] || [];
      const info = state.view.validation.byStaff[person.id] || { workCount: 0, workload: 0 };
      rows.push([
        person.name,
        roleName(person.role),
        Rest.valueFor(state.view.opening, person.id) ?? '',
        ...row.map(shift => {
          if (!shift) return '休息';
          if (shift === 'POST') return '下';
          if (S.isStatusShift(shift)) return S.SHIFTS[shift] ? S.SHIFTS[shift].name : shift;
          return S.SHIFTS[shift] ? S.SHIFTS[shift].name : shift;
        }),
        Rest.valueFor(state.view.closing, person.id) ?? '',
        info.workCount,
        info.workload
      ]);
    });
    rows.push([]);
    rows.push(['规则检查', state.view.validation.ok ? '全部通过' : `${state.view.validation.violations.length} 项待处理`]);
    rows.push(['岗位覆盖', `${state.view.validation.totals.filled}/${state.view.validation.totals.total}`]);
    rows.push(['本周岗位工分合计', S.weeklyWorkload(state.workloads)]);
    rows.push(['导出时间', new Date().toLocaleString('zh-CN')]);

    const csv = '\uFEFF' + rows.map(row => row.map(cell => {
      const text = String(cell == null ? '' : cell);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',')).join('\r\n');

    const first = dates[0];
    const filename = `排班表_${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}.csv`;
    return { filename, text: csv };
  }

  function printSchedule() {
    if (!state.view?.hasWork) return;
    if (!els.printTitle) return;
    els.printTitle.dataset.week = weekRangeLabel();
    els.printTitle.dataset.printWorkload = `岗位工分合计 ${S.weeklyWorkload(state.workloads)}`;
    if (desktop) desktop.print().catch(err => toast({ type: 'error', title: '打印失败', message: err.message }));
    else window.print();
  }

  function collectBackup() {
    const values = {};
    window.PaibanBackup.KEYS.forEach(key => {
      const value = storage.getItem(key);
      if (value != null) values[key] = value;
    });
    return window.PaibanBackup.makeBackup(values);
  }

  function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openDataModal() {
    if (state.busy) return;
    const info = desktop ? desktop.info() : null;
    openModal(`${modalHeader('本地数据与备份', '保存全部历史，或把数据迁移到另一台电脑', 'LOCAL DATA', '')}
      <div class="modal-body">
        <p class="rules-lead">${desktop ? '排班自动保存到电脑上的数据文件，关闭软件后仍会保留。' : '当前为网页版，数据保存在这个浏览器中。可导出完整备份，再到桌面版恢复。'}</p>
        ${info ? `<div class="assumption"><strong>数据目录</strong><p class="data-path">${escapeHtml(info.directory)}</p><button class="btn btn-quiet" id="openDataFolderBtn" type="button">打开数据文件夹</button></div>` : ''}
        <p>已保存 <strong>${loadArchive().length}</strong> 周排班、<strong>${loadRosterProfiles().length}</strong> 个名单方案。完整备份包含当前工作区、历史排班、名单方案、岗位数量、工分、备注和欠休。</p>
        <div class="data-actions">
          <button class="btn btn-primary" id="backupAllBtn" type="button">备份全部数据</button>
          <button class="btn btn-quiet" id="restoreAllBtn" type="button">从备份恢复 / 导入旧版数据</button>
          <input id="restoreAllFile" type="file" accept=".json,application/json" hidden>
        </div>
        <p class="import-hint">恢复会替换当前全部数据。${desktop ? '桌面版会先自动保存一份“恢复前备份”。' : '恢复前请先导出当前备份。'} CSV 仅用于表格留档；完整迁移请使用 JSON 备份。</p>
        <div class="form-error" id="dataError"></div>
      </div>
      <div class="modal-foot"><span class="foot-hint">${desktop ? '独立桌面程序 · 无需联网' : '旧版迁移：在原浏览器中打开此页面后导出备份'}</span><span class="spacer"></span><button class="btn btn-quiet" type="button" data-modal-close>关闭</button></div>`, { wide: true });
    const reportError = err => {
      const host = $('dataError');
      if (host) { host.textContent = err.message || String(err); host.classList.add('show'); }
      else toast({ type: 'error', title: '操作失败', message: err.message || String(err) });
    };
    if (info) $('openDataFolderBtn').addEventListener('click', () => desktop.openDataFolder().catch(reportError));
    $('backupAllBtn').addEventListener('click', async () => {
      try {
        saveState(true);
        if (!state.storageOk) throw new Error('当前内容尚未保存成功，请检查数据目录后重试。');
        if (desktop) {
          const result = await desktop.exportBackup();
          if (result.error) throw new Error(result.error);
          if (!result.canceled) toast({ type: 'success', title: '完整备份已保存', message: result.filePath });
        } else {
          downloadText(`排班完整备份-${isoDate(new Date())}.json`, JSON.stringify(collectBackup(), null, 2), 'application/json;charset=utf-8');
          toast({ type: 'success', title: '已生成完整备份', message: '请保留下载的 JSON 文件，可在桌面版中恢复。' });
        }
      } catch (err) { reportError(err); }
    });
    const input = $('restoreAllFile');
    $('restoreAllBtn').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        if (file.size > 100 * 1024 * 1024) throw new Error('备份文件超过 100 MB，请核对所选文件。');
        const backup = window.PaibanBackup.parseBackup(await file.text());
        const count = backup.storage[ARCHIVE_KEY] ? JSON.parse(backup.storage[ARCHIVE_KEY]).length : 0;
        closeModal();
        confirmModal({
          title: '从备份恢复全部数据？',
          message: `文件：${escapeHtml(file.name)}，包含 ${count} 周历史排班。恢复会替换当前工作区、全部历史和名单方案。${desktop ? '操作前会自动保存当前数据的安全备份。' : '请确认已备份当前内容。'}`,
          confirmLabel: '恢复数据', danger: true,
          onConfirm: () => {
            try {
              clearTimeout(saveTimer);
              saveState(true);
              if (!state.storageOk) throw new Error('无法保存当前数据，已取消恢复。');
              if (desktop) desktop.restore(backup);
              else {
                const original = collectBackup();
                try {
                  window.PaibanBackup.KEYS.forEach(key => {
                    if (backup.storage[key] != null) storage.setItem(key, backup.storage[key]);
                    else storage.removeItem(key);
                  });
                } catch (err) {
                  window.PaibanBackup.KEYS.forEach(key => {
                    if (original.storage[key] != null) storage.setItem(key, original.storage[key]);
                    else storage.removeItem(key);
                  });
                  throw err;
                }
              }
              restoringData = true;
              window.location.reload();
            } catch (err) { toast({ type: 'error', title: '恢复失败', message: err.message }); }
          }
        });
      } catch (err) { reportError(err); }
      input.value = '';
    });
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                              */
  /* ------------------------------------------------------------------ */

  function toast(opts) {
    if (!els.toastRoot) return;
    const id = ++toastSeq;
    const node = document.createElement('div');
    node.className = `toast ${opts.type || 'info'}`;
    node.dataset.toastId = id;
    const icon = opts.type === 'error' ? 'i-alert' : opts.type === 'warn' ? 'i-alert' : opts.type === 'success' ? 'i-check-circle' : 'i-info';
    node.innerHTML = `
      <span class="toast-icon"><svg class="icon"><use href="#${icon}"></use></svg></span>
      <div class="toast-copy">
        <strong>${escapeHtml(opts.title || '')}</strong>
        ${opts.message ? `<p>${escapeHtml(opts.message)}</p>` : ''}
      </div>
      ${opts.action ? `<button class="toast-action" type="button">${escapeHtml(opts.action.label)}</button>` : ''}
      <button class="toast-close" type="button" aria-label="关闭提示"><svg class="icon"><use href="#i-close"></use></svg></button>
    `;
    els.toastRoot.appendChild(node);
    const remove = () => {
      if (!node.isConnected) return;
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 230);
    };
    node.querySelector('.toast-close').addEventListener('click', remove);
    if (opts.action) {
      node.querySelector('.toast-action').addEventListener('click', () => {
        remove();
        try { opts.action.run(); } catch (err) { /* noop */ }
      });
    }
    const duration = opts.duration || (opts.type === 'error' ? 6500 : 4300);
    setTimeout(remove, duration);
    while (els.toastRoot.children.length > 3) {
      els.toastRoot.firstElementChild.remove();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 事件绑定                                                           */
  /* ------------------------------------------------------------------ */

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function showWorkspace(view) {
    document.querySelectorAll('[data-view-panel]').forEach(panel => { panel.hidden = panel.dataset.viewPanel !== view; });
    document.querySelectorAll('.workspace-nav [data-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    window.scrollTo(0, 0);
  }

  function bindEvents() {
    document.querySelectorAll('.workspace-nav [data-view]').forEach(button => {
      button.addEventListener('click', () => showWorkspace(button.dataset.view));
    });
    els.generateBtn.addEventListener('click', () => { showWorkspace('schedule'); generateFresh(true); });
    els.emptyGenerateBtn.addEventListener('click', () => generateFresh(true));
    els.addStaffBtn.addEventListener('click', openAddStaffModal);
    els.rulesBtn.addEventListener('click', openRulesModal);
    $('ruleConfigBtn').addEventListener('click', () => openPositionRules());
    $('shiftCatalogBtn').addEventListener('click', () => openRuleConfigModal('shifts'));
    els.rulesLinkBtn.addEventListener('click', openRulesModal);
    els.restOpeningBtn.addEventListener('click', () => openRestOpeningModal());
    els.scheduleHost.addEventListener('click', event => {
      const control = event.target.closest('[data-rest-person]');
      if (control) openRestOpeningModal(control.dataset.restPerson);
    });
    if (els.requirementBtn) els.requirementBtn.addEventListener('click', openRequirementModal);
    if (els.archiveBtn) els.archiveBtn.addEventListener('click', openArchiveModal);
    if ($('dataBtn')) $('dataBtn').addEventListener('click', openDataModal);
    if (els.prevWeekBtn) els.prevWeekBtn.addEventListener('click', () => switchWeek(-1));
    if (els.nextWeekBtn) els.nextWeekBtn.addEventListener('click', () => switchWeek(1));
    if (els.rosterProfilesBtn) els.rosterProfilesBtn.addEventListener('click', openRosterProfilesModal);
    if (els.notesBtn) els.notesBtn.addEventListener('click', openNotesModal);
    if (els.notesSummary) els.notesSummary.addEventListener('click', event => {
      if (event.target.closest('#notesSummaryEdit')) openNotesModal();
    });
    els.exportBtn.addEventListener('click', openExportWindow);
    els.printBtn.addEventListener('click', printSchedule);
    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);
    els.lockSummary.addEventListener('click', openPinManager);
    els.repairBtn.addEventListener('click', repairCurrent);
    els.resetBtn.addEventListener('click', () => {
      confirmModal({
        title: '恢复科室名单？',
        message: '当前名单、排班和手动锁定都会被替换为 16 人科室名单。这个操作可以通过撤销恢复。',
        confirmLabel: '恢复名单',
        onConfirm: resetSample
      });
    });

    els.staffList.addEventListener('input', event => {
      const input = event.target.closest('.person-name-input');
      if (!input) return;
      const person = findStaff(input.dataset.nameId);
      if (!person) return;
      person.name = input.value;
      updateNamesInHistory(person.id, person.name);
      saveState();
    });
    els.staffList.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.closest('.person-name-input')) {
        event.preventDefault();
        event.target.blur();
      }
    });
    els.staffList.addEventListener('change', event => {
      const nameInput = event.target.closest('.person-name-input');
      if (nameInput) {
        const person = findStaff(nameInput.dataset.nameId);
        if (person) {
          person.name = nameInput.value.trim() || '未命名医师';
          nameInput.value = person.name;
          updateNamesInHistory(person.id, person.name);
          renderAll();
          saveState(true);
        }
        return;
      }
      const roleSelect = event.target.closest('.role-select');
      if (roleSelect) {
        updateRole(roleSelect.dataset.roleId, roleSelect.value);
        return;
      }
      const training = event.target.closest('.training-input');
      if (training) {
        updateTraining(training.dataset.trainingId, training.checked);
      }
    });
    els.staffList.addEventListener('click', event => {
      const del = event.target.closest('[data-delete-id]');
      if (!del) return;
      const person = findStaff(del.dataset.deleteId);
      if (!person) return;
      confirmModal({
        title: `删除 ${person.name}？`,
        message: '该医师会从名单中移除，其排班和手动锁定一并清除。人员不足时可继续调整名单后再排班。',
        confirmLabel: '删除',
        danger: true,
        onConfirm: () => deleteStaff(person.id)
      });
    });

    els.scheduleHost.addEventListener('click', event => {
      const cell = event.target.closest('.shift-btn[data-staff-id]');
      if (!cell || cell.disabled) return;
      openCellEditor(cell.dataset.staffId, Number(cell.dataset.day));
    });

    els.modalRoot.addEventListener('click', event => {
      if (event.target.closest('[data-modal-close]')) closeModal();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !els.modalRoot.hidden) {
        closeModal();
        return;
      }
      if (event.key === 'Tab' && !els.modalRoot.hidden) {
        const focusables = [...els.modalCard.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter(el => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || !els.modalCard.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !els.modalCard.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && els.modalRoot.hidden) {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
    });

    window.addEventListener('beforeunload', () => {
      if (restoringData) return;
      try { saveState(true); } catch (err) { /* noop */ }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 启动                                                               */
  /* ------------------------------------------------------------------ */

  if (positionWindow) {
    setupEls();
    document.body.classList.add('position-window');
    document.querySelector('.roster-shell').hidden = true;
    const draft = desktop.positionRulesDraft();
    S.setRuleConfig(draft.config);
    S.setWorkloads(draft.workloads);
    openRuleConfigModal(draft.initialTab === 'workload' ? 'workload' : 'roles');
    els.modalCard.addEventListener('click', event => {
      if (event.target.closest('[data-modal-close]')) closeModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeModal();
    });
    return;
  }

  init().catch(err => {
    console.error(err);
    toast({
      type: 'error',
      title: '应用初始化失败',
      message: err && err.message ? err.message : '请刷新页面重试。'
    });
  });
})();
