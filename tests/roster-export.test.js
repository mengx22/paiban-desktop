'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../vendor/jszip.min');
const Export = require('../js/roster-export');
const template = require('../assets/roster-template');
function options(count = 2) {
  return {
    weekStart: '2026-12-28',
    staff: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `测试${i}`, role: 'writer' })),
    schedule: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, ['A', null, 'POST', 'CHAIN', 'NIGHT', 'TRIP', 'CUSTOM']])),
    shifts: { A: { name: '白A' }, CHAIN: { name: '连班' }, NIGHT: { name: '夜+白上' }, TRIP: { name: '出差' }, CUSTOM: { name: '自定<&>班' } },
    closing: { p0: 6.5, p1: 0 }, owedRest: { p1: '补休<&>' }, notes: '第一行\n第二行 {{ROWS}}'
  };
}
test('Word uses the reference package and current dates, staff, shifts, balances and notes', async () => {
  const file = await Export.create(options());
  assert.equal(file.filename, '排班表_2026-12-28.docx');
  const zip = await JSZip.loadAsync(file.bytes);
  const xml = await zip.file('word/document.xml').async('string');
  for (const text of ['12月28日', '2027年1月03日', '1月03日', '测试0', '测试1', '欠6.5', '欠0', '自定&lt;&amp;&gt;班', '所有报告实行双签名', '第二行 {{ROWS}}']) assert.ok(xml.includes(text), text);
  assert.ok(xml.includes('<w:br/>'));
  assert.ok(!xml.includes('旧备注'));
  for (const text of ['婚假26', '{{CELL_', '{{DATE_', '{{TITLE}}']) assert.ok(!xml.includes(text), text);
  assert.equal((xml.match(/<w:tr[ >]/g) || []).length, 4);
  const baseline = await JSZip.loadAsync(template.archive, { base64: true });
  for (const name of Object.keys(baseline.files)) {
    if (name === 'word/document.xml' || baseline.files[name].dir) continue;
    assert.deepEqual(await zip.file(name).async('uint8array'), await baseline.file(name).async('uint8array'), name);
  }
});
test('roster expands beyond 16 staff without leaving old rows', async () => {
  const file = await Export.create(options(25));
  const xml = await (await JSZip.loadAsync(file.bytes)).file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:tr[ >]/g) || []).length, 27);
  assert.ok(xml.includes('测试24'));
  assert.ok(xml.includes('<w:tblHeader/>'));
});
test('incomplete schedules fail and invalid balances are marked rather than exported as current', async () => {
  const o = options(); o.schedule.p0 = ['A'];
  await assert.rejects(() => Export.create(o), /排班不完整/);
  o.schedule = options().schedule; o.balancesValid = false; o.closing = {};
  const xml = await (await JSZip.loadAsync((await Export.create(o)).bytes)).file('word/document.xml').async('string');
  assert.ok(xml.includes('待核算'));
  await assert.rejects(() => Export.create({ ...o, weekStart: '2026-02-30' }), /日期无效/);
});
test('preview edits are used by Word and owed-rest amounts stay bound to the correct person', async () => {
  const o = { ...options(3), title: '自定义标题<&> {{TITLE}}', annotations: '新注释<&>\n第二段 {{ROWS}}', notes: '本周补充', teaching: { p0: '带教甲' }, closing: { p0: 6.5, p1: 0 }, staff: [...options().staff, { id: 'p2', name: '主任', role: 'director' }] };
  const view = Export.model(o);
  assert.equal(view.title, o.title);
  assert.deepEqual(view.rows.map(row => row.cells[10]), ['欠6.5', '欠0', '—']);
  const xml = await (await JSZip.loadAsync((await Export.create(o)).bytes)).file('word/document.xml').async('string');
  for (const text of ['自定义标题&lt;&amp;&gt; {{TITLE}}', '新注释&lt;&amp;&gt;', '第二段 {{ROWS}}', '带教甲', '本周补充', '欠0']) assert.ok(xml.includes(text), text);
  assert.ok(!xml.includes('所有报告实行双签名'));
});
