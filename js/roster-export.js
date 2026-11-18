/* Offline Word export, using the department's retained table and styles. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../vendor/jszip.min'), require('../assets/roster-template'));
  } else root.PaibanRosterExport = factory(root.JSZip, root.PaibanRosterTemplate);
})(globalThis, function (JSZip, template) {
  'use strict';
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  function xmlText(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/\r\n|\r|\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  }
  function dateAt(start, offset) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start || '');
    if (!match) throw new Error('排班日期无效');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset);
    if (offset === 0 && (date.getFullYear() !== Number(match[1]) || date.getMonth() + 1 !== Number(match[2]) || date.getDate() !== Number(match[3]))) throw new Error('排班日期无效');
    return date;
  }
  function shiftName(key, shifts) {
    if (!key) return '休';
    if (key === 'POST') return '下';
    const name = shifts?.[key]?.name || String(key);
    return key === 'CHAIN' && name === '连班' ? '连' : name;
  }
  function model(options) {
    const { weekStart, staff, schedule, shifts, closing = {}, notes = '', balancesValid = true, teaching = {} } = options;
    const first = dateAt(weekStart, 0);
    if (first.getDay() !== 1 || !Array.isArray(staff) || !staff.length) throw new Error('请先生成完整周排班');
    const last = dateAt(weekStart, 6);
    const label = d => `${d.getMonth() + 1}月${String(d.getDate()).padStart(2, '0')}日`;
    const end = (first.getFullYear() === last.getFullYear() ? '' : `${last.getFullYear()}年`) + label(last);
    const defaultTitle = `${first.getFullYear()}年 ${label(first)}—${end} 武威市人民医院CT-MRI中心工作人员周工作安排表(医师组)`;
    const title = options.title === undefined ? defaultTitle : String(options.title);
    const annotations = options.annotations === undefined ? template.annotations.join('\n') : String(options.annotations);
    const dates = Array.from({ length: 7 }, (_, day) => label(dateAt(weekStart, day)));
    const rows = staff.map((person, index) => {
      const row = schedule?.[person.id];
      if (!Array.isArray(row) || row.length !== 7) throw new Error(`${person.name}的排班不完整，请先生成完整周排班`);
      const rest = closing[person.id];
      const remarks = person.role === 'director' ? '—' : !balancesValid || typeof rest !== 'number' || !Number.isFinite(rest)
        ? '待核算' : `欠${rest}`;
      return { id: person.id, cells: [index + 1, person.name, teaching[person.id] || '', ...row.map(key => shiftName(key, shifts)), remarks] };
    });
    return { title, defaultTitle, annotations, dates, rows, notes: String(notes) };
  }
  async function create(options) {
    const data = model(options);
    const values = { TITLE: data.title, NOTES: data.notes.trim() ? `本周备注：${data.notes.trim()}` : '' };
    data.dates.forEach((date, day) => { values[`DATE_${day}`] = date; });
    const rows = data.rows.map(({ cells }, index) => {
      const source = template.rows[Math.min(index, template.rows.length - 1)];
      return source.replace(/\{\{CELL_(\d+)\}\}/g, (_, n) => xmlText(cells[Number(n)]));
    }).join('');
    const annotations = data.annotations.split(/\r\n|\r|\n/).map((text, index) => {
      const source = template.annotationTemplates[Math.min(index, template.annotationTemplates.length - 1)];
      return source.replace('{{TEXT}}', () => xmlText(text));
    }).join('');
    const zip = await JSZip.loadAsync(template.archive, { base64: true });
    let document = await zip.file('word/document.xml').async('string');
    // Single pass: user-entered braces are literal text, never template directives.
    document = document.replace(/\{\{(ROWS|ANNOTATIONS|TITLE|NOTES|DATE_[0-6])\}\}/g,
      (_, key) => key === 'ROWS' ? rows : key === 'ANNOTATIONS' ? annotations : xmlText(values[key]));
    zip.file('word/document.xml', document);
    return { filename: `排班表_${options.weekStart}.docx`, mime: MIME,
      bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) };
  }
  return { create, model, shiftName, MIME };
});
