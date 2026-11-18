'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store, migrateLegacyData, softwareRoot } = require('../desktop/store');
const Backup = require('../js/backup');
const [WORKSPACE, ARCHIVE, ROSTERS] = Backup.KEYS;
const person = { id: 'p1', name: '测试医师', role: 'night', training: false };
const record = { version: 3, weekStart: '2026-11-16', staff: [person], schedule: { p1: ['NIGHT', 'POST', 'VACATION', 'VILLAGE', 'TRIP', null, null] }, notes: '备注与欠休', owedRest: { p1: '欠休一天' }, requirements: {}, workloads: { NIGHT: 10 } };
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paiban-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('关闭后重开仍保留工作区、历史、名单和中文状态', t => {
  const directory = temp(t);
  const store = new Store(directory);
  store.set(WORKSPACE, JSON.stringify(record));
  store.set(ARCHIVE, JSON.stringify([record]));
  store.set(ROSTERS, JSON.stringify([{ id: 'roster1', name: '科室方案', staff: [person] }]));
  const reopened = new Store(directory);
  assert.deepEqual(reopened.storage, store.storage);
  assert.equal(JSON.parse(reopened.get(WORKSPACE)).owedRest.p1, '欠休一天');
  assert.ok(fs.existsSync(`${store.file}.bak`));
});
test('历史超过104周仍完整保留', t => {
  const store = new Store(temp(t));
  const records = Array.from({ length: 160 }, (_, i) => {
    const date = new Date('2023-01-02T12:00:00Z'); date.setUTCDate(date.getUTCDate() + i * 7);
    return { ...record, weekStart: date.toISOString().slice(0, 10) };
  });
  store.set(ARCHIVE, JSON.stringify(records));
  assert.equal(JSON.parse(new Store(store.directory).get(ARCHIVE)).length, 160);
});
test('主文件损坏时恢复上个完整版本，并保留损坏文件', t => {
  const store = new Store(temp(t));
  store.set(WORKSPACE, JSON.stringify(record));
  store.set(ARCHIVE, JSON.stringify([record]));
  fs.writeFileSync(store.file, '{broken');
  const reopened = new Store(store.directory);
  assert.match(reopened.notice, /已恢复/);
  assert.deepEqual(JSON.parse(reopened.get(WORKSPACE)), record);
  assert.ok(fs.readdirSync(store.directory).some(name => name.startsWith('损坏数据-')));
});
test('主备份均损坏时拒绝启动且不覆盖原文件', t => {
  const directory = temp(t);
  fs.writeFileSync(path.join(directory, 'data.json'), 'damaged');
  fs.writeFileSync(path.join(directory, 'data.json.bak'), 'also damaged');
  assert.throws(() => new Store(directory), /无法读取/);
  assert.equal(fs.readFileSync(path.join(directory, 'data.json'), 'utf8'), 'damaged');
});
test('备份往返恢复全部数据，恢复前留存安全备份', t => {
  const store = new Store(temp(t));
  store.set(WORKSPACE, JSON.stringify(record));
  store.set(ARCHIVE, JSON.stringify([record]));
  const backup = JSON.parse(JSON.stringify(store.backup()));
  store.set(WORKSPACE, JSON.stringify({ ...record, notes: '新备注' }));
  const result = store.restore(backup);
  assert.deepEqual(store.backup().storage, backup.storage);
  assert.equal(JSON.parse(JSON.parse(fs.readFileSync(result.safetyFile, 'utf8')).storage[WORKSPACE]).notes, '新备注');
  assert.deepEqual(new Store(store.directory).storage, backup.storage);
});
test('无效备份和未知键不会覆盖现有数据', t => {
  const store = new Store(temp(t));
  store.set(WORKSPACE, JSON.stringify(record));
  const original = fs.readFileSync(store.file, 'utf8');
  for (const invalid of [
    { format: 'wrong', version: 1, storage: {} },
    { format: 'paiban-backup', version: 1, storage: { other: '{}' } },
    { format: 'paiban-backup', version: 1, storage: { [WORKSPACE]: JSON.stringify({ ...record, weekStart: '2026-02-31' }) } },
    { format: 'paiban-backup', version: 1, storage: { [WORKSPACE]: JSON.stringify({ ...record, schedule: { p1: ['INVALID'] } }) } }
  ]) assert.throws(() => store.restore(invalid));
  assert.equal(fs.readFileSync(store.file, 'utf8'), original);
  assert.throws(() => store.set('../outside', '{}'));
});
test('写入失败不会错误更新内存', t => {
  const store = new Store(temp(t));
  store.set(WORKSPACE, JSON.stringify(record));
  const original = store.get(WORKSPACE);
  const invalidTarget = path.join(store.directory, 'blocked');
  fs.mkdirSync(invalidTarget);
  store.file = invalidTarget;
  assert.throws(() => store.set(WORKSPACE, JSON.stringify({ ...record, notes: '不应保存' })));
  assert.equal(store.get(WORKSPACE), original);
});
test('项目版和独立免安装版各自使用软件根目录', t => {
  const directory = temp(t);
  fs.writeFileSync(path.join(directory, '启动排班软件.bat'), '');
  const packaged = path.join(directory, 'release', '排班工作台-win32-x64', '排班工作台.exe');
  const portable = path.join(directory, '另一份免安装版', '排班工作台.exe');
  assert.equal(softwareRoot('', packaged, true), directory);
  assert.equal(softwareRoot('', portable, true), path.dirname(portable));
  assert.equal(softwareRoot(directory, portable, false), directory);
});
test('旧版完整数据只迁移一次，后续使用软件目录中的修改', t => {
  const directory = temp(t);
  const legacy = new Store(path.join(directory, 'legacy'));
  const target = path.join(directory, 'data');
  legacy.set(WORKSPACE, JSON.stringify(record));
  legacy.set(ARCHIVE, JSON.stringify([record]));
  legacy.set(ROSTERS, JSON.stringify([{ id: 'roster1', name: '科室方案', staff: [person] }]));
  const original = fs.readFileSync(legacy.file, 'utf8');
  migrateLegacyData(target, legacy.directory);
  const migrated = new Store(target);
  assert.deepEqual(migrated.storage, legacy.storage);
  migrated.set(WORKSPACE, JSON.stringify({ ...record, notes: '新目录中的修改' }));
  migrateLegacyData(target, legacy.directory);
  assert.equal(JSON.parse(new Store(target).get(WORKSPACE)).notes, '新目录中的修改');
  assert.equal(fs.readFileSync(legacy.file, 'utf8'), original);
});
test('旧主文件损坏时迁移旧备份，已有本地备份时优先用本地备份', t => {
  const directory = temp(t);
  const legacy = new Store(path.join(directory, 'legacy'));
  legacy.set(WORKSPACE, JSON.stringify(record));
  legacy.set(ARCHIVE, JSON.stringify([record]));
  fs.writeFileSync(legacy.file, 'broken');
  const target = path.join(directory, 'data');
  migrateLegacyData(target, legacy.directory);
  const migrated = new Store(target);
  assert.deepEqual(JSON.parse(migrated.get(WORKSPACE)), record);
  assert.equal(fs.readFileSync(legacy.file, 'utf8'), 'broken');
  migrated.set(WORKSPACE, JSON.stringify({ ...record, notes: '本地备份中的修改' }));
  fs.renameSync(migrated.file, `${migrated.file}.bak`);
  migrateLegacyData(target, legacy.directory);
  assert.equal(JSON.parse(new Store(target).get(WORKSPACE)).notes, '本地备份中的修改');
});
test('旧数据均无法读取时不会创建空的工作区覆盖历史', t => {
  const directory = temp(t);
  const legacy = new Store(path.join(directory, 'legacy'));
  fs.writeFileSync(legacy.file, 'broken');
  const target = path.join(directory, 'data');
  assert.throws(() => migrateLegacyData(target, legacy.directory), /无法读取旧版排班数据/);
  assert.ok(!fs.existsSync(path.join(target, 'data.json')));
});
