/* 排班规则引擎：新版 CT-MRI 周排班规则，支持岗位数量设置。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root.Logic || require('logic-solver'), require('./rule-config'), require('./rest-balance'));
  } else {
    root.PaibanScheduler = factory(root.Logic, root.PaibanRules, root.PaibanRest);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Logic, Rules, Rest) {
  'use strict';

  if (!Logic) throw new Error('排班求解器未加载：请先引入 logic-solver。');

  const DAYS = [
    { index: 0, label: '周一', short: '一', weekday: '工作日' },
    { index: 1, label: '周二', short: '二', weekday: '工作日' },
    { index: 2, label: '周三', short: '三', weekday: '工作日' },
    { index: 3, label: '周四', short: '四', weekday: '工作日' },
    { index: 4, label: '周五', short: '五', weekday: '工作日' },
    { index: 5, label: '周六', short: '六', weekday: '周末' },
    { index: 6, label: '周日', short: '日', weekday: '周末' }
  ];

  const ROLES = Object.create(null);
  const ROLE_COLORS = { director: 'teal', signer: 'violet', writer: 'amber', night: 'sky' };

  const DEFAULT_WORKLOADS = Rest.DEFAULT_WORKLOADS;
  const BASE_WORKLOAD_KEYS = Object.freeze(['A', 'B', 'C', 'H', 'S1', 'S2', 'S3', 'S4', 'WHITE_UP', 'CHAIN', 'NIGHT', 'SIGN', 'DAY']);
  const MIN_WORKLOAD = 0;
  const MAX_WORKLOAD = 99;

  const BASE_SHIFTS = {
    A: { key: 'A', name: '白A', category: 'writer', workload: DEFAULT_WORKLOADS.A, desc: '写报告 · 尾号1、6' },
    B: { key: 'B', name: '白B', category: 'writer', workload: DEFAULT_WORKLOADS.B, desc: '写报告 · 尾号2、7' },
    C: { key: 'C', name: '白C', category: 'writer', workload: DEFAULT_WORKLOADS.C, desc: '写报告 · 尾号3、8' },
    H: { key: 'H', name: '白H', category: 'writer', workload: DEFAULT_WORKLOADS.H, desc: '写报告 · 尾号4、9' },
    S1: { key: 'S1', name: '白签1', category: 'sign', workload: DEFAULT_WORKLOADS.S1, desc: '审核尾号0、1' },
    S2: { key: 'S2', name: '白签2', category: 'sign', workload: DEFAULT_WORKLOADS.S2, desc: '审核尾号2、3' },
    S3: { key: 'S3', name: '白签3', category: 'sign', workload: DEFAULT_WORKLOADS.S3, desc: '审核尾号4、5、6' },
    S4: { key: 'S4', name: '白签4', category: 'sign', workload: DEFAULT_WORKLOADS.S4, desc: '审核尾号7、8、9' },
    SIGN: { key: 'SIGN', name: '白签', category: 'sign', workload: DEFAULT_WORKLOADS.SIGN, desc: '周末签报告' },
    WHITE_UP: { key: 'WHITE_UP', name: '白上', category: 'white-up', workload: DEFAULT_WORKLOADS.WHITE_UP, desc: '周末上午 · 尾号0、5' },
    CHAIN: { key: 'CHAIN', name: '连班', category: 'chain', workload: DEFAULT_WORKLOADS.CHAIN, desc: '中午及下午连续班' },
    NIGHT: { key: 'NIGHT', name: '夜+白上', category: 'night', workload: DEFAULT_WORKLOADS.NIGHT, desc: '夜班 + 次晨白上' },
    DAY: { key: 'DAY', name: '白班', category: 'day', workload: DEFAULT_WORKLOADS.DAY, desc: '常规白班' },
    POST: { key: 'POST', name: '下夜班', shortName: '下', category: 'post', workload: 0, desc: '夜班后休息，不计班次' },
    TRAINING: { key: 'TRAINING', name: '进修', category: 'status', workload: Rest.STATUS_WORKLOADS.TRAINING, desc: '进修，不承担工作' },
    VILLAGE: { key: 'VILLAGE', name: '下乡', category: 'status', workload: Rest.STATUS_WORKLOADS.VILLAGE, desc: '下乡，不承担工作' },
    VACATION: { key: 'VACATION', name: '休假', category: 'status', workload: 0, desc: '休假，不承担工作' },
    TRIP: { key: 'TRIP', name: '出差', category: 'status', workload: Rest.STATUS_WORKLOADS.TRIP, desc: '出差，不承担工作' }
  };

  const SHIFTS = Object.create(null);
  let ruleConfig = Rules.defaults();
  let workShiftKeys = [];

  const STATUS_KEYS = Object.freeze(['TRAINING', 'VILLAGE', 'VACATION', 'TRIP']);
  const STATUS_LABELS = Object.freeze({
    TRAINING: '进修', VILLAGE: '下乡', VACATION: '休假', TRIP: '出差'
  });
  const POST_LABEL = '下';

  // 岗位数量：可按工作日、周六、周日分别调整；数量为 0 表示该岗位不排。
  const DEFAULT_REQUIREMENTS = Object.freeze({
    weekday: Object.freeze({ A: 1, B: 1, C: 1, H: 1, S1: 1, S2: 1, S3: 1, S4: 1, CHAIN: 1, NIGHT: 1 }),
    sat: Object.freeze({ SIGN: 2, DAY: 1, WHITE_UP: 1, CHAIN: 1, NIGHT: 1 }),
    sun: Object.freeze({ SIGN: 1, DAY: 1, CHAIN: 1, NIGHT: 1 })
  });

  let requirements = cloneRequirements(DEFAULT_REQUIREMENTS);

  function cloneRequirements(source) {
    return {
      weekday: Object.assign({}, source.weekday || {}),
      sat: Object.assign({}, source.sat || {}),
      sun: Object.assign({}, source.sun || {})
    };
  }

  function requirementType(day) {
    const d = Number(day);
    if (d < 5) return 'weekday';
    return d === 5 ? 'sat' : 'sun';
  }

  function normalizeCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(20, Math.round(n)));
  }

  function normalizeRequirements(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = cloneRequirements({});
    ['weekday', 'sat', 'sun'].forEach(type => {
      const candidate = { ...DEFAULT_REQUIREMENTS[type], ...source[type] };
      for (const [shift, count] of Object.entries(candidate)) {
        if (isWorkShift(shift)) result[type][shift] = normalizeCount(count);
      }
    });
    return result;
  }

  function setRequirements(raw) {
    requirements = normalizeRequirements(raw);
    return getRequirements();
  }

  function getRequirements() {
    return cloneRequirements(requirements);
  }

  function resetRequirements() {
    return setRequirements();
  }

  function requirementsForDay(day) {
    return Object.assign({}, requirements[requirementType(day)] || {});
  }

  function requirementCount(day, shift) {
    const map = requirements[requirementType(day)] || {};
    return normalizeCount(map[shift]);
  }

  function requiredForDay(day) {
    const map = requirementsForDay(day);
    const result = [];
    Object.keys(map).forEach(shift => {
      const count = normalizeCount(map[shift]);
      for (let i = 0; i < count; i++) result.push(shift);
    });
    return result;
  }

  function weeklySlotCount() {
    let total = 0;
    for (let d = 0; d < 7; d++) total += requiredForDay(d).length;
    return total;
  }

  function shiftName(shift) {
    return SHIFTS[shift] ? SHIFTS[shift].name : String(shift || '');
  }

  function displayName(shift) {
    if (shift === 'POST') return POST_LABEL;
    return shiftName(shift);
  }

  function isWorkShift(shift) {
    return !!shift && !!SHIFTS[shift] && shift !== 'POST' && STATUS_KEYS.indexOf(shift) === -1;
  }

  function isStatusShift(shift) {
    return STATUS_KEYS.indexOf(shift) !== -1;
  }

  function isUnavailable(person) {
    return !!(person && person.training);
  }

  function isEligible(role, day, shift) {
    const d = Number(day);
    if (!Number.isInteger(d) || d < 0 || d > 6) return false;
    return ROLES[role]?.allowed[requirementType(d)].includes(shift) || false;
  }

  function allowedShifts(role, day) {
    const order = ['S1', 'S2', 'S3', 'S4', 'SIGN', 'A', 'B', 'C', 'H', 'WHITE_UP', 'CHAIN', 'NIGHT', 'DAY'];
    return order.concat(workShiftKeys.filter(shift => !order.includes(shift))).filter(shift => isEligible(role, day, shift));
  }

  function shiftBounds(role, shift) {
    return role.limits[shift] || { min: 0, max: Rules.DAYS_PER_WEEK };
  }

  function getRuleConfig() {
    return JSON.parse(JSON.stringify(ruleConfig));
  }

  function setRuleConfig(raw) {
    const next = Rules.read(raw);
    const previousWorkloads = getWorkloads();
    for (const role of Object.keys(ROLES)) delete ROLES[role];
    for (const shift of Object.keys(SHIFTS)) delete SHIFTS[shift];
    next.roles.forEach(item => {
      ROLES[item.id] = { ...item, key: item.id, label: item.name, color: ROLE_COLORS[item.id] || 'sky' };
    });
    next.shifts.forEach(item => {
      const base = Object.hasOwn(BASE_SHIFTS, item.id) ? BASE_SHIFTS[item.id] : null;
      SHIFTS[item.id] = { category: 'day', desc: '自定义班次', ...base, key: item.id, name: item.name };
    });
    for (const key of Rules.STATUS_KEYS) SHIFTS[key] = { ...BASE_SHIFTS[key] };
    workShiftKeys = next.shifts.map(item => item.id);
    ruleConfig = next;
    setRequirements(requirements);
    setWorkloads(previousWorkloads);
    return getRuleConfig();
  }

  function defaultWorkloads() {
    return Object.fromEntries(workShiftKeys.map(shift => [shift, DEFAULT_WORKLOADS[shift] ?? 0]));
  }

  function emptySchedule(staff) {
    const schedule = {};
    (staff || []).forEach(person => {
      schedule[person.id] = Array(7).fill(isUnavailable(person) ? 'TRAINING' : null);
    });
    return schedule;
  }

  function createId(prefix) {
    const p = prefix || 'p';
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return p + '_' + crypto.randomUUID();
    }
    return p + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function workloadOf(shift) {
    return SHIFTS[shift] && typeof SHIFTS[shift].workload === 'number' ? SHIFTS[shift].workload : 0;
  }

  function normalizeWorkloads(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = {};
    workShiftKeys.forEach(shift => {
      const fallback = DEFAULT_WORKLOADS[shift] ?? 0;
      if (source[shift] == null || source[shift] === '') {
        result[shift] = fallback;
        return;
      }
      const value = Number(source[shift]);
      if (!Number.isFinite(value)) {
        result[shift] = fallback;
        return;
      }
      result[shift] = Math.max(MIN_WORKLOAD, Math.min(MAX_WORKLOAD, Math.round(value * 2) / 2));
    });
    return result;
  }

  function setWorkloads(raw) {
    const normalized = normalizeWorkloads(raw);
    workShiftKeys.forEach(shift => {
      if (SHIFTS[shift]) SHIFTS[shift].workload = normalized[shift];
    });
    return normalized;
  }

  function getWorkloads() {
    const result = {};
    workShiftKeys.forEach(shift => { result[shift] = workloadOf(shift); });
    return result;
  }

  function weeklyWorkload(workloads) {
    const source = workloads || getWorkloads();
    let total = 0;
    for (let d = 0; d < 7; d++) {
      const map = requirementsForDay(d);
      Object.keys(map).forEach(shift => {
        const count = normalizeCount(map[shift]);
        const value = source && source[shift] != null ? Number(source[shift]) : workloadOf(shift);
        if (Number.isFinite(value)) total += value * count;
      });
    }
    return total;
  }

  function countWork(row) {
    return (row || []).filter(isWorkShift).length;
  }

  function totalWorkload(row) {
    return (row || []).reduce((sum, shift) => sum + workloadOf(shift), 0);
  }

  function validateRoster(staff) {
    const errors = [];
    const warnings = [];
    const active = (staff || []).filter(person => !isUnavailable(person) && ROLES[person.role]);
    const byRole = Object.fromEntries(Object.keys(ROLES).map(key => [key, 0]));
    active.forEach(person => { byRole[person.role] += 1; });
    if (!staff?.length) return { ok: false, errors: ['还没有人员。请先在左侧添加医师。'], warnings, activeCount: 0, byRole };
    if (staff.every(isUnavailable)) errors.push('所有医师都处于进修状态，没有人可以承担岗位。');

    const names = new Set();
    for (const person of staff) {
      const name = String(person.name || '').trim();
      if (!name) errors.push('存在未填写姓名的医师。');
      if (names.has(name)) warnings.push(`姓名「${name}」重复，建议区分。`);
      names.add(name);
      if (!ROLES[person.role]) errors.push(`「${name || '未命名'}」的职位无效。`);
    }

    const demand = Object.fromEntries(workShiftKeys.map(shift => [shift, 0]));
    const activeEligible = {};
    for (let day = 0; day < 7; day++) {
      for (const [shift, count] of Object.entries(requirementsForDay(day))) {
        if (!count) continue;
        demand[shift] += count;
        const candidates = active.filter(person => {
          const role = ROLES[person.role];
          return role.max > 0 && shiftBounds(role, shift).max > 0 && isEligible(role.id, day, shift);
        }).length;
        activeEligible[`${day}|${shift}`] = candidates;
        if (candidates < count) {
          errors.push(`${DAYS[day].label}「${shiftName(shift)}」需要 ${count} 人，只有 ${candidates} 名符合职位和班次上限的在岗人员。`);
        }
      }
    }

    const capacity = Object.fromEntries(workShiftKeys.map(shift => [shift, 0]));
    const minimum = Object.fromEntries(workShiftKeys.map(shift => [shift, 0]));
    let overallMax = 0;
    let overallMin = 0;
    for (const role of Object.values(ROLES)) {
      const number = byRole[role.id];
      if (!number) continue;
      let minTotal = 0;
      for (const shift of workShiftKeys) {
        const bounds = shiftBounds(role, shift);
        const days = DAYS.filter(day => requirementCount(day.index, shift) && isEligible(role.id, day.index, shift)).length;
        capacity[shift] += number * Math.min(days, role.max, bounds.max);
        minimum[shift] += number * bounds.min;
        minTotal += bounds.min;
        if (bounds.min > days) errors.push(`「${role.label}」每人至少排 ${bounds.min} 个「${shiftName(shift)}」，本周只有 ${days} 天可排。`);
      }
      const possibleDays = DAYS.filter(day => workShiftKeys.some(shift =>
        requirementCount(day.index, shift) && isEligible(role.id, day.index, shift) && shiftBounds(role, shift).max > 0
      )).length;
      const personMinimum = Math.max(role.min, minTotal);
      if (personMinimum > possibleDays) errors.push(`「${role.label}」每人至少排 ${personMinimum} 班，本周只有 ${possibleDays} 天可排。`);
      overallMax += number * Math.min(role.max, possibleDays);
      overallMin += number * personMinimum;
    }
    const slots = weeklySlotCount();
    if (slots > overallMax) errors.push(`每周需要 ${slots} 个岗位，在岗人员按职位和上限最多可承担 ${overallMax} 个。`);
    if (slots < overallMin) errors.push(`每周共有 ${slots} 个岗位，按当前职位下限至少要排 ${overallMin} 班。`);
    for (const shift of workShiftKeys) {
      if (demand[shift] > capacity[shift]) errors.push(`「${shiftName(shift)}」本周需要 ${demand[shift]} 班，符合条件的人员最多能排 ${capacity[shift]} 班。`);
      if (demand[shift] < minimum[shift]) errors.push(`「${shiftName(shift)}」本周只有 ${demand[shift]} 班，按职位下限至少要排 ${minimum[shift]} 班。`);
    }
    return { ok: errors.length === 0, errors, warnings, activeCount: active.length, byRole, activeEligible };
  }

  function pickQuota(activeCount) {
    const slots = weeklySlotCount();
    if (activeCount <= 14) return Math.max(1, Math.min(5, Math.floor(slots / activeCount)));
    if (activeCount <= 23) return 2;
    return 1;
  }

  function postKey(si, d) {
    return `post_${si}_${d}`;
  }

  function workKey(si, d, shift) {
    return `work_${si}_${d}_${shift}`;
  }

  function addCoverage(solver, candidates, count, name) {
    if (!count) return;
    if (candidates.length < count) {
      const err = new Error(`「${name}」需要 ${count} 人，但只有 ${candidates.length} 名符合条件的人员。`);
      err.code = 'NO_CANDIDATE';
      throw err;
    }
    if (count === 1) {
      solver.require(Logic.exactlyOne(candidates));
    } else {
      solver.require(Logic.greaterThanOrEqual(Logic.sum(candidates), Logic.constantBits(count)));
      solver.require(Logic.lessThanOrEqual(Logic.sum(candidates), Logic.constantBits(count)));
    }
  }

  function previousWeekRow(previousWeek, personId) {
    const source = previousWeek && previousWeek.schedule ? previousWeek.schedule : previousWeek;
    if (!source || typeof source !== 'object') return null;
    return Array.isArray(source[personId]) ? source[personId] : null;
  }

  function requireRange(solver, vars, min, max) {
    if (min > vars.length) solver.require(Logic.FALSE);
    else if (min > 0) solver.require(Logic.greaterThanOrEqual(Logic.sum(vars), Logic.constantBits(min)));
    if (max < vars.length) solver.require(Logic.lessThanOrEqual(Logic.sum(vars), Logic.constantBits(max)));
  }

  function buildProblem(staff, options) {
    options = options || {};
    const solver = new Logic.Solver();
    const quota = typeof options.quota === 'number' ? options.quota : 0;
    const pins = options.pins || {};
    const previousWeek = options.previousWeek || null;
    const active = [];

    staff.forEach((person, si) => {
      if (!isUnavailable(person)) active.push({ person, si });
    });

    const vars = {};
    const postVars = {};
    const pinnedStatus = {};
    const allWork = {};
    const spreadTerms = [];
    const spreadWeights = [];

    staff.forEach(person => {
      vars[person.id] = Array.from({ length: 7 }, () => ({}));
      postVars[person.id] = Array(7).fill(null);
      pinnedStatus[person.id] = Array(7).fill(null);
    });

    // 1. 变量域、每日状态互斥
    active.forEach(({ person, si }) => {
      const role = ROLES[person.role];
      const shiftVars = Object.fromEntries(workShiftKeys.map(shift => [shift, []]));
      allWork[person.id] = [];
      const prevRow = previousWeekRow(previousWeek, person.id);
      const prevSundayNight = !!(prevRow && prevRow[6] === 'NIGHT');
      for (let d = 0; d < 7; d++) {
        const dayVars = [];
        allowedShifts(person.role, d).forEach(shift => {
          if (!requirementCount(d, shift) || !shiftBounds(role, shift).max) return;
          const key = workKey(si, d, shift);
          vars[person.id][d][shift] = key;
          dayVars.push(key);
          allWork[person.id].push(key);
          shiftVars[shift].push(key);
        });
        if (d === 0 && prevSundayNight) {
          // 跨周衔接：上一周周日为夜班时，本周一必须是“下”，且不能再排工作班。
          const pk = postKey(si, 0);
          postVars[person.id][0] = pk;
          dayVars.push(pk);
          solver.require(pk);
        } else if (d > 0) {
          const pk = postKey(si, d);
          postVars[person.id][d] = pk;
          dayVars.push(pk);
        }
        if (dayVars.length) solver.require(Logic.atMostOne(dayVars));
      }

      // 职位总班次和各班次范围是硬约束，公平性下界仍可在无解时放宽。
      requireRange(solver, allWork[person.id], Math.max(role.min, Math.min(quota, role.max, allWork[person.id].length)), role.max);
      for (const shift of workShiftKeys) {
        const bounds = shiftBounds(role, shift);
        requireRange(solver, shiftVars[shift], bounds.min, bounds.max);
      }

      // 4. 夜班 -> 次日下夜班；下夜班 -> 前一日夜班
      for (let d = 1; d < 7; d++) {
        const pk = postVars[person.id][d];
        const prevNight = vars[person.id][d - 1].NIGHT;
        if (prevNight) {
          solver.require(Logic.implies(pk, prevNight));
          solver.require(Logic.implies(prevNight, pk));
        } else {
          solver.require(Logic.not(pk));
        }
      }

      // 5.1 班次分散的软目标：同一人一周重复同一班次会产生惩罚。
      //     A/B/C/H 权重更高，优先让白A、白B、白C、白H轮换。
      const shiftsForPerson = new Set();
      for (let d = 0; d < 7; d++) Object.keys(vars[person.id][d]).forEach(shift => shiftsForPerson.add(shift));
      shiftsForPerson.forEach(shift => {
        const days = [];
        for (let d = 0; d < 7; d++) {
          if (vars[person.id][d][shift]) days.push({ day: d, key: vars[person.id][d][shift] });
        }
        if (days.length < 2) return;
        const weight = shift === 'A' || shift === 'B' || shift === 'C' || shift === 'H' ? 3 : 1;
        for (let i = 0; i < days.length; i++) {
          for (let j = i + 1; j < days.length; j++) {
            const y = `spread_${si}_${shift}_${days[i].day}_${days[j].day}`;
            solver.require(Logic.implies(y, days[i].key));
            solver.require(Logic.implies(y, days[j].key));
            solver.require(Logic.or(Logic.not(days[i].key), Logic.not(days[j].key), y));
            spreadTerms.push(y);
            spreadWeights.push(weight);
          }
        }
      });
    });

    // 6. 每日岗位数量
    for (let d = 0; d < 7; d++) {
      const map = requirementsForDay(d);
      Object.keys(map).forEach(shift => {
        const count = normalizeCount(map[shift]);
        if (!count) return;
        const candidates = active
          .filter(({ person }) => isEligible(person.role, d, shift))
          .map(({ person }) => vars[person.id][d][shift])
          .filter(Boolean);
        addCoverage(solver, candidates, count, `${DAYS[d].label} ${shiftName(shift)}`);
      });
    }

    // 7. 手动锁定；状态格不参与求解，但会在结果中保留
    Object.keys(pins).forEach(key => {
      const parts = key.split('|');
      const person = staff.find(s => s.id === parts[0]);
      const d = Number(parts[1]);
      const pin = pins[key];
      if (!person || !pin || !Number.isInteger(d) || d < 0 || d > 6) return;
      if (isUnavailable(person)) return;
      if (pin.shift === 'OFF') {
        const workVars = Object.values(vars[person.id][d]);
        if (workVars.length) solver.require(Logic.not(Logic.or(workVars)));
        if (postVars[person.id][d]) solver.require(Logic.not(postVars[person.id][d]));
        return;
      }
      if (isStatusShift(pin.shift)) {
        pinnedStatus[person.id][d] = pin.shift;
        const workVars = Object.values(vars[person.id][d]);
        if (workVars.length) solver.require(Logic.not(Logic.or(workVars)));
        if (postVars[person.id][d]) solver.require(Logic.not(postVars[person.id][d]));
        return;
      }
      if (pin.shift === 'POST') return;
      const v = vars[person.id][d][pin.shift];
      if (v) solver.require(v);
    });

    // 8. 目标偏好
    const preferenceTerms = [];
    const preferenceWeights = [];
    if (options.preferSchedule) {
      staff.forEach(person => {
        const row = options.preferSchedule[person.id];
        if (!row) return;
        for (let d = 0; d < 7; d++) {
          const shift = row[d];
          if (isWorkShift(shift) && vars[person.id][d][shift]) {
            preferenceTerms.push(vars[person.id][d][shift]);
            preferenceWeights.push(20);
          }
        }
      });
    }

    return {
      solver, vars, postVars, pinnedStatus, allWork, active, preferenceTerms, preferenceWeights,
      spreadTerms, spreadWeights, quota
    };
  }

  function seededRandom(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function extractSchedule(staff, problem, solution) {
    const truth = new Set(solution.getTrueVars());
    const schedule = {};
    staff.forEach(person => {
      const row = Array(7).fill(null);
      if (isUnavailable(person)) {
        for (let d = 0; d < 7; d++) row[d] = 'TRAINING';
      } else {
        for (let d = 0; d < 7; d++) {
          const status = problem.pinnedStatus[person.id] && problem.pinnedStatus[person.id][d];
          if (status) { row[d] = status; continue; }
          let found = null;
          for (const shift of Object.keys(problem.vars[person.id][d])) {
            if (truth.has(problem.vars[person.id][d][shift])) { found = shift; break; }
          }
          if (found) row[d] = found;
          else if (problem.postVars[person.id][d] && truth.has(problem.postVars[person.id][d])) row[d] = 'POST';
        }
      }
      schedule[person.id] = row;
    });
    return schedule;
  }

  // 在可行班表上交换同日岗位（可同时交换两天）。每次减少总欠休，或在总量相同的情况下多偿还旧欠休。
  function favorRest(problem, staff, opening, schedule, pins, previousWeek) {
    if (!opening) return schedule;
    const active = staff.filter(p => !isUnavailable(p));
    const balances = new Map(active.map(p => [p.id, Rest.exempt(p) ? null : Rest.valueFor(opening, p.id) ?? 0]));
    const evaluate = (person, row) => {
      const start = balances.get(person.id);
      if (start == null) return { end: 0, paid: 0 };
      const end = Rest.closing(start, totalWorkload(row));
      return { end, paid: Math.max(0, start - end) };
    };
    const replace = (person, from, other, days) => {
      const row = from.slice();
      for (const day of days) row[day] = other[day];
      const previous = previousWeekRow(previousWeek, person.id);
      for (let day = 0; day < 7; day++) {
        const post = day ? row[day - 1] === 'NIGHT' : previous?.[6] === 'NIGHT';
        if (post) {
          if (row[day] && row[day] !== 'POST') return null;
          row[day] = 'POST';
        } else if (row[day] === 'POST') row[day] = null;
        if (pins[`${person.id}|${day}`] && row[day] !== from[day]) return null;
        if (isWorkShift(row[day]) && !problem.vars[person.id][day][row[day]]) return null;
      }
      const role = ROLES[person.role];
      const count = countWork(row);
      const min = Math.max(role.min, Math.min(problem.quota, role.max, problem.allWork[person.id].length));
      if (count < min || count > role.max) return null;
      for (const [shift, bounds] of Object.entries(role.limits)) {
        const times = row.filter(item => item === shift).length;
        if (times < bounds.min || times > bounds.max) return null;
      }
      return row;
    };
    // 有欠休时优先比较总额，再比较已经偿还的欠休。只接受严格改善，避免反复换回。
    for (let pass = 0; pass < 32; pass++) {
      const baseline = new Map(active.map(p => [p.id, evaluate(p, schedule[p.id])]));
      let best = null;
      for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        const ar = schedule[a.id], br = schedule[b.id];
        const days = [];
        for (let day = 0; day < 7; day++) {
          const x = ar[day], y = br[day];
          if (x === y || pins[`${a.id}|${day}`] || pins[`${b.id}|${day}`]) continue;
          if ((x && !isWorkShift(x)) || (y && !isWorkShift(y))) continue;
          if ((y && !problem.vars[a.id][day][y]) || (x && !problem.vars[b.id][day][x])) continue;
          days.push(day);
        }
        const al = baseline.get(a.id), bl = baseline.get(b.id);
        for (let d = 0; d < days.length; d++) for (let e = d; e < days.length; e++) {
          const swap = d === e ? [days[d]] : [days[d], days[e]];
          const nextA = replace(a, ar, br, swap);
          if (!nextA) continue;
          const nextB = replace(b, br, ar, swap);
          if (!nextB) continue;
          const ae = evaluate(a, nextA), be = evaluate(b, nextB);
          const reduced = al.end + bl.end - ae.end - be.end;
          const paid = ae.paid + be.paid - al.paid - bl.paid;
          if (reduced < 0 || (reduced === 0 && paid <= 0)) continue;
          if (!best || reduced > best.reduced || (reduced === best.reduced && paid > best.paid)) {
            best = { a, b, nextA, nextB, reduced, paid };
          }
        }
      }
      if (!best) break;
      schedule[best.a.id] = best.nextA;
      schedule[best.b.id] = best.nextB;
    }
    return schedule;
  }

  function solveAttempt(staff, pins, quota, preferSchedule, previousWeek, diversify, seed, restOpening) {
    const problem = buildProblem(staff, { pins, quota, preferSchedule, previousWeek, diversify, seed });
    let solution = problem.solver.solve();
    if (!solution) return { ok: false, problem };

    // 手动修复优先保留原表，再尝试分散重复班次。
    if (problem.preferenceTerms.length) {
      solution = problem.solver.maximizeWeightedSum(solution, problem.preferenceTerms, problem.preferenceWeights);
    }
    if (diversify !== false && problem.spreadTerms.length) {
      solution = problem.solver.minimizeWeightedSum(solution, problem.spreadTerms, problem.spreadWeights);
    }

    const schedule = favorRest(problem, staff, restOpening, extractSchedule(staff, problem, solution), pins, previousWeek);
    return { ok: true, problem, solution, schedule };
  }

  function sanitizePins(staff, rawPins) {
    const removed = [];
    const byId = {};
    staff.forEach(s => { byId[s.id] = s; });
    const entries = [];

    Object.keys(rawPins || {}).forEach(key => {
      const [staffId, dayRaw] = key.split('|');
      const person = byId[staffId];
      const day = Number(dayRaw);
      const pin = rawPins[key];
      if (!person || !pin || !Number.isInteger(day) || day < 0 || day > 6) {
        removed.push({ key, reason: '人员或日期已失效' });
        return;
      }
      if (isUnavailable(person)) {
        removed.push({ key, staffId, day, shift: pin.shift, reason: '该医师处于进修状态' });
        return;
      }
      if (pin.shift === 'POST') {
        removed.push({ key, staffId, day, shift: pin.shift, reason: '下夜班由夜班自动衔接，不能单独锁定' });
        return;
      }
      if (pin.shift !== 'OFF' && !isStatusShift(pin.shift) && (!isEligible(person.role, day, pin.shift) || !requirementCount(day, pin.shift))) {
        removed.push({ key, staffId, day, shift: pin.shift, reason: '该班次与人员类型或日期不匹配' });
        return;
      }
      entries.push({ key, staffId, day, shift: pin.shift, at: Number(pin.at) || 0 });
    });

    // 同一人同一天只保留最新的一条
    const active = new Set();
    const byPersonDay = new Map();
    entries.slice().sort((a, b) => b.at - a.at).forEach(e => {
      const k = `${e.staffId}|${e.day}`;
      if (byPersonDay.has(k)) {
        removed.push({ ...e, reason: '同一人员同一天存在多条锁定，保留最新一条' });
      } else {
        byPersonDay.set(k, e);
        active.add(e.key);
      }
    });

    // 同一日同一岗位按设置数量保留锁定
    const byDayShift = new Map();
    entries.filter(e => e.shift !== 'OFF' && !isStatusShift(e.shift)).slice().sort((a, b) => b.at - a.at).forEach(e => {
      const k = `${e.day}|${e.shift}`;
      const list = byDayShift.get(k) || [];
      const limit = requirementCount(e.day, e.shift);
      if (list.length >= limit) {
        removed.push({ ...e, reason: `同日「${shiftName(e.shift)}」已锁定 ${limit} 人` });
        active.delete(e.key);
      } else {
        list.push(e);
        byDayShift.set(k, list);
      }
    });

    // 夜班次日必须下夜班：两条锁定中保留较新的那条
    entries.filter(e => e.shift === 'NIGHT' && e.day < 6).slice().sort((a, b) => b.at - a.at).forEach(nightPin => {
      if (!active.has(nightPin.key)) return;
      const nextKey = `${nightPin.staffId}|${nightPin.day + 1}`;
      const conflict = byPersonDay.get(nextKey);
      if (!conflict || !active.has(conflict.key)) return;
      const loser = conflict.at >= nightPin.at ? nightPin : conflict;
      if (loser === nightPin) {
        active.delete(nightPin.key);
        removed.push({ ...nightPin, reason: '与次日已锁定的安排冲突' });
      } else {
        active.delete(conflict.key);
        removed.push({ ...conflict, reason: '夜班后的次日必须为下夜班' });
      }
    });

    // 按时间优先保留未超过总上限和单班次上限的工作锁定。
    staff.forEach(person => {
      const role = ROLES[person.role];
      if (!role) return;
      let count = 0;
      const kept = new Map();
      const candidates = [...byPersonDay.values()]
        .filter(pin => pin.staffId === person.id && isWorkShift(pin.shift) && active.has(pin.key))
        .sort((left, right) => right.at - left.at);
      for (const pin of candidates) {
        const used = kept.get(pin.shift) || 0;
        const max = shiftBounds(role, pin.shift).max;
        if (count >= role.max || used >= max) {
          active.delete(pin.key);
          const limit = count >= role.max ? `每周总班次上限 ${role.max}` : `「${shiftName(pin.shift)}」每周上限 ${max}`;
          removed.push({ ...pin, reason: `锁定班次超过${limit}` });
        } else {
          count++;
          kept.set(pin.shift, used + 1);
        }
      }
    });

    const clean = {};
    [...byPersonDay.values()].forEach(e => {
      if (active.has(e.key)) clean[`${e.staffId}|${e.day}`] = { shift: e.shift, at: e.at };
    });

    const seen = new Set();
    const uniqueRemoved = [];
    removed.forEach(r => {
      const k = `${r.key}|${r.reason}`;
      if (!seen.has(k)) { seen.add(k); uniqueRemoved.push(r); }
    });
    return { pins: clean, removed: uniqueRemoved };
  }

  function solveWithPinFallback(staff, initialPins, baseQuota, preferSchedule, previousWeek, diversify, seed, restOpening) {
    const sanitized = sanitizePins(staff, initialPins || {});
    let pins = sanitized.pins;
    const released = sanitized.removed.map(r => ({ ...r, source: 'sanitize' }));

    const quotas = [];
    const pushQ = q => { if (q >= 0 && !quotas.includes(q)) quotas.push(q); };
    pushQ(baseQuota);
    if (baseQuota > 1) pushQ(1);
    pushQ(0);

    for (const q of quotas) {
      const attempt = solveAttempt(staff, pins, q, preferSchedule, previousWeek, diversify, seed, restOpening);
      if (attempt.ok) return { ok: true, ...attempt, pins, released, quota: q };
    }

    // 锁定互相冲突时，从最旧的锁定开始释放，优先保留用户最新的调整。
    const ordered = Object.keys(pins).map(key => {
      const [staffId, day] = key.split('|');
      return { key, staffId, day: Number(day), shift: pins[key].shift, at: Number(pins[key].at) || 0 };
    }).sort((a, b) => a.at - b.at);
    if (ordered.length) {
      for (const entry of ordered) {
        const removedPin = pins[entry.key];
        delete pins[entry.key];
        released.push({
          key: entry.key, staffId: entry.staffId, day: entry.day,
          shift: removedPin.shift, at: removedPin.at,
          reason: '为满足排班规则，释放了较早的手动锁定', source: 'fallback'
        });
        const attempt = solveAttempt(staff, pins, 0, preferSchedule, previousWeek, diversify, seed, restOpening);
        if (attempt.ok) return { ok: true, ...attempt, pins, released, quota: 0 };
      }
    }
    return { ok: false, error: '在现有人员与手动锁定下无解', released };
  }

  function generate(staff, options) {
    options = options || {};
    const started = Date.now();
    const roster = validateRoster(staff);
    if (!roster.ok) {
      return {
        ok: false,
        error: { message: '当前人员配置无法生成排班', hints: roster.errors, warnings: roster.warnings },
        roster,
        durationMs: Date.now() - started
      };
    }

    const activeCount = roster.activeCount;
    const baseQuota = typeof options.quota === 'number' ? options.quota : pickQuota(activeCount);
    const mode = options.mode || 'generate';
    const preferSchedule = mode === 'repair' || mode === 'reflow' ? options.preferSchedule : null;
    const previousWeek = options.previousWeek || null;
    const diversify = options.diversify !== false;
    const seed = typeof options.seed === 'number' ? options.seed : (Date.now() & 0x7fffffff);

    let result;
    try {
      result = solveWithPinFallback(staff, options.pins || {}, baseQuota, preferSchedule, previousWeek, diversify, seed, options.restOpening);
    } catch (err) {
      return {
        ok: false,
        error: { message: err.message || '排班求解发生错误', hints: [] },
        roster,
        durationMs: Date.now() - started
      };
    }

    if (!result.ok) {
      const hints = roster.errors.slice();
      hints.push('尝试取消部分手动锁定，或减少进修/状态人员。');
      hints.push('核对各职位可排的日期、周班次上下限、岗位数量和夜班衔接是否冲突。');
      return {
        ok: false,
        error: { message: result.error || '未找到符合规则的排班', hints },
        roster,
        releasedPins: result.released || [],
        durationMs: Date.now() - started
      };
    }

    const validation = validate(staff, result.schedule, result.pins, { previousWeek });
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          message: '求解结果未通过规则校验',
          hints: validation.violations.slice(0, 8).map(v => v.message)
        },
        roster,
        releasedPins: result.released || [],
        durationMs: Date.now() - started
      };
    }
    return {
      ok: true,
      schedule: result.schedule,
      pins: result.pins,
      releasedPins: result.released || [],
      quota: result.quota,
      validation,
      roster,
      durationMs: Date.now() - started
    };
  }

  function validate(staff, schedule, pins, options) {
    options = options || {};
    const violations = [];
    const coverage = [];
    const byStaff = {};
    let filled = 0;
    let total = 0;
    let nightCount = 0;
    let maxWork = 0;

    const addViolation = (type, message, meta) => {
      violations.push(Object.assign({ type, message }, meta || {}));
    };

    (staff || []).forEach(person => {
      const row = (schedule && schedule[person.id]) || Array(7).fill(null);
      const work = row.filter(isWorkShift);
      const workload = row.reduce((sum, s) => sum + workloadOf(s), 0);
      byStaff[person.id] = {
        workCount: work.length,
        workload,
        nightCount: row.filter(s => s === 'NIGHT').length,
        shifts: row.slice()
      };
      const rule = ROLES[person.role];
      if (!rule) {
        addViolation('role', `${person.name} 的职位未定义。`, { staffId: person.id });
      } else if (!isUnavailable(person)) {
        if (work.length < rule.min || work.length > rule.max) {
          addViolation('weeklyTotal', `${person.name} 本周排了 ${work.length} 班，职位要求 ${rule.min}–${rule.max} 班。`, { staffId: person.id });
        }
        for (const [shift, bounds] of Object.entries(rule.limits)) {
          const count = work.filter(item => item === shift).length;
          if (count < bounds.min || count > bounds.max) {
            addViolation('weeklyShift', `${person.name} 的「${shiftName(shift)}」排了 ${count} 班，职位要求 ${bounds.min}–${bounds.max} 班。`, { staffId: person.id, shift });
          }
        }
      }
      if (isUnavailable(person)) {
        const bad = row.some(s => isWorkShift(s) || s === 'POST');
        if (bad) addViolation('training', `${person.name} 处于进修状态，但仍被安排了工作。`, { staffId: person.id });
      } else if (row.some(s => s === 'TRAINING')) {
        addViolation('training', `${person.name} 未处于进修状态，但排班中出现了“进修”。`, { staffId: person.id });
      }
      row.forEach((shift, d) => {
        if (shift && !SHIFTS[shift]) {
          addViolation('role', `${person.name} 在${DAYS[d].label}的班次已删除。`, { staffId: person.id, day: d, shift });
          return;
        }
        if (isWorkShift(shift)) {
          if (!isEligible(person.role, d, shift)) {
            addViolation('role', `${person.name} 在${DAYS[d].label}被安排了不符合其类型的「${shiftName(shift)}」。`, { staffId: person.id, day: d, shift });
          }
          if (shift === 'NIGHT') nightCount += 1;
        }
      });
      for (let d = 1; d < 7; d++) {
        if (row[d] === 'POST' && row[d - 1] !== 'NIGHT') {
          addViolation('postNight', `${person.name} 在${DAYS[d].label}是下夜班，但前一天不是夜班。`, { staffId: person.id, day: d });
        }
        if (row[d - 1] === 'NIGHT' && row[d] !== 'POST') {
          addViolation('postNight', `${person.name} 在${DAYS[d - 1].label}上夜班后，${DAYS[d].label}必须排下夜班。`, { staffId: person.id, day: d - 1 });
        }
      }
      const prevRow = previousWeekRow(options.previousWeek, person.id);
      if (prevRow) {
        const prevSundayNight = prevRow[6] === 'NIGHT';
        if (prevSundayNight && row[0] !== 'POST') {
          addViolation('crossWeekPost', `${person.name} 上周日为夜班，本周一必须排下夜班。`, { staffId: person.id, day: 0 });
        }
        if (!prevSundayNight && row[0] === 'POST') {
          addViolation('crossWeekPost', `${person.name} 上周日不是夜班，本周一不能排下夜班。`, { staffId: person.id, day: 0 });
        }
      }
    });

    for (let d = 0; d < 7; d++) {
      const map = requirementsForDay(d);
      const requirements = [];
      let dayTotal = 0;
      let dayFilled = 0;
      Object.keys(map).forEach(shift => {
        const count = normalizeCount(map[shift]);
        if (!count) return;
        dayTotal += count;
        const holders = (staff || []).filter(person => {
          const row = (schedule && schedule[person.id]) || [];
          return row[d] === shift;
        });
        dayFilled += Math.min(holders.length, count);
        requirements.push({
          shift,
          name: shiftName(shift),
          count,
          staff: holders.map(p => ({ id: p.id, name: p.name }))
        });
        if (holders.length !== count) {
          addViolation(
            'coverage',
            `${DAYS[d].label}「${shiftName(shift)}」需要 ${count} 人，实际排了 ${holders.length} 人。`,
            { day: d, shift }
          );
        }
      });
      total += dayTotal;
      filled += dayFilled;
      coverage.push({
        day: d,
        label: DAYS[d].label,
        kind: DAYS[d].weekday,
        filled: dayFilled,
        total: dayTotal,
        ok: dayFilled === dayTotal,
        requirements
      });
    }

    (staff || []).forEach(person => {
      maxWork = Math.max(maxWork, byStaff[person.id].workCount);
    });

    const checkDefs = [
      { id: 'coverage', label: '每日岗位数量', types: ['coverage'] },
      { id: 'weeklyTotal', label: '职位每周总班次范围', types: ['weeklyTotal'] },
      { id: 'postNight', label: '夜班后接下夜班', types: ['postNight'] },
      { id: 'crossWeekPost', label: '跨周下夜班衔接', types: ['crossWeekPost'] },
      { id: 'weeklyShift', label: '职位单班次每周范围', types: ['weeklyShift'] },
      { id: 'role', label: '人员类型与班次匹配', types: ['role'] },
      { id: 'status', label: '进修/状态人员不排班', types: ['training'] }
    ];
    const checks = checkDefs.map(def => {
      const hits = violations.filter(v => def.types.indexOf(v.type) !== -1);
      return {
        id: def.id,
        label: def.label,
        ok: hits.length === 0,
        detail: hits.length ? hits.slice(0, 2).map(v => v.message).join('；') : '通过'
      };
    });

    return {
      ok: violations.length === 0,
      checks,
      coverage,
      byStaff,
      violations,
      totals: {
        filled,
        total,
        nights: nightCount,
        activeStaff: (staff || []).filter(p => !isUnavailable(p)).length,
        maxWork,
        manualPins: Object.keys(pins || {}).length
      }
    };
  }

  function stats(staff, schedule) {
    const validation = validate(staff, schedule, {});
    const totals = { workSlots: 0, workload: 0, nights: 0, activeStaff: 0, trainingStaff: 0 };
    (staff || []).forEach(p => {
      if (isUnavailable(p)) totals.trainingStaff += 1; else totals.activeStaff += 1;
      const info = validation.byStaff[p.id];
      if (info) {
        totals.workSlots += info.workCount;
        totals.workload += info.workload;
        totals.nights += info.nightCount;
      }
    });
    return { totals, validation };
  }

  setRuleConfig();

  return {
    DAYS,
    DAY_TYPES: Rules.DAY_TYPES,
    getRuleConfig,
    setRuleConfig,
    ROLES,
    SHIFTS,
    STATUS_KEYS,
    STATUS_LABELS,
    POST_LABEL,
    DEFAULT_REQUIREMENTS,
    getRequirements,
    setRequirements,
    resetRequirements,
    requirementsForDay,
    requirementCount,
    requiredForDay,
    weeklySlotCount,
    get WEEKDAY_REQUIREMENTS() { return Object.keys(requirements.weekday).filter(k => requirements.weekday[k] > 0); },
    get WEEKEND_REQUIREMENTS() { return Object.keys(requirements.sat).filter(k => requirements.sat[k] > 0); },
    get WEEKLY_SLOT_COUNT() { return weeklySlotCount(); },
    get DEFAULT_WORKLOADS() { return defaultWorkloads(); },
    get WORKLOAD_KEYS() { return [...BASE_WORKLOAD_KEYS.filter(isWorkShift), ...workShiftKeys.filter(shift => !BASE_WORKLOAD_KEYS.includes(shift))]; },
    MIN_WORKLOAD,
    MAX_WORKLOAD,
    normalizeWorkloads,
    setWorkloads,
    getWorkloads,
    weeklyWorkload,
    isWorkShift,
    isStatusShift,
    isUnavailable,
    isEligible,
    allowedShifts,
    emptySchedule,
    createId,
    workloadOf,
    countWork,
    totalWorkload,
    validateRoster,
    validate,
    stats,
    generate,
    sanitizePins,
    pickQuota,
    shiftName,
    displayName
  };
});
