'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Backup = require('../js/backup');
const DATA_FILE = 'data.json';

function softwareRoot(appPath, executablePath, isPackaged) {
  if (!isPackaged) return appPath;
  const executableDirectory = path.dirname(executablePath);
  const releaseDirectory = path.dirname(executableDirectory);
  const projectDirectory = path.dirname(releaseDirectory);
  if (path.basename(releaseDirectory) === 'release' && fs.existsSync(path.join(projectDirectory, '启动排班软件.bat'))) {
    return projectDirectory;
  }
  return executableDirectory;
}

function decodeStorage(text) {
  const data = JSON.parse(text);
  if (!data || data.format !== 'paiban-local-data' || data.version !== 1) throw new Error('本地数据版本无效');
  if (!data.storage || typeof data.storage !== 'object' || Array.isArray(data.storage)) throw new Error('本地数据内容无效');
  if (Object.keys(data.storage).length) Backup.validateStorage(data.storage);
  return data.storage;
}

// 仅当软件目录尚无存档时，从旧位置复制一份通过校验的记录。
function migrateLegacyData(directory, legacyDirectory) {
  const target = path.join(directory, DATA_FILE);
  if (fs.existsSync(target) || fs.existsSync(`${target}.bak`)) return;
  const oldFile = path.join(legacyDirectory, DATA_FILE);
  const candidates = [oldFile, `${oldFile}.bak`].filter(file => fs.existsSync(file));
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
      decodeStorage(text);
    } catch { continue; }
    atomicWrite(target, text, false);
    return;
  }
  if (candidates.length) throw new Error(`无法读取旧版排班数据。请检查 ${legacyDirectory} 中的数据文件。`);
}

// 所有写入先写临时文件并刷盘，再原子替换；.bak 保存上一个完整版本。
function atomicWrite(file, text, keepBackup = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(temp, 'w');
    try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (keepBackup && fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.bak.tmp`);
      fs.renameSync(`${file}.bak.tmp`, `${file}.bak`);
    }
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, DATA_FILE);
    this.notice = '';
    fs.mkdirSync(directory, { recursive: true });
    this.storage = {};
    const hasPrimary = fs.existsSync(this.file);
    if (hasPrimary || fs.existsSync(`${this.file}.bak`)) {
      try { this.storage = this.readFile(this.file); }
      catch (original) {
        try {
          this.storage = this.readFile(`${this.file}.bak`);
          const damaged = hasPrimary ? path.join(directory, `损坏数据-${Date.now()}.json`) : null;
          if (damaged) fs.copyFileSync(this.file, damaged);
          atomicWrite(this.file, this.encode(this.storage), false);
          this.notice = damaged ? `主数据文件损坏，已恢复上一个完整版本。原文件保存在：${damaged}` : '主数据文件缺失，已恢复上一个完整版本。';
        } catch (recovery) {
          throw new Error(`本地数据无法读取，请保留原文件并从备份恢复。数据目录：${directory}\n${original.message}`);
        }
      }
    }
  }
  readFile(file) {
    return decodeStorage(fs.readFileSync(file, 'utf8'));
  }
  encode(storage) {
    return JSON.stringify({ format: 'paiban-local-data', version: 1, updatedAt: new Date().toISOString(), storage }, null, 2);
  }
  get(key) {
    if (!Backup.KEYS.includes(key)) throw new Error('未知数据项');
    return this.storage[key] ?? null;
  }
  set(key, value) {
    if (!Backup.KEYS.includes(key) || typeof value !== 'string') throw new Error('无效数据项');
    const next = { ...this.storage, [key]: value };
    Backup.validateStorage(next);
    atomicWrite(this.file, this.encode(next));
    this.storage = next; // 写入成功后才更新内存，失败时保留原数据。
  }
  backup() { return Backup.makeBackup({ ...this.storage }); }
  restore(input) {
    const data = Backup.parseBackup(input);
    let safetyFile = null;
    if (Object.keys(this.storage).length) {
      safetyFile = path.join(this.directory, '恢复前备份', `备份-${Date.now()}.json`);
      atomicWrite(safetyFile, JSON.stringify(this.backup(), null, 2), false);
    }
    const next = { ...data.storage };
    atomicWrite(this.file, this.encode(next));
    this.storage = next;
    return { safetyFile };
  }
}
module.exports = { Store, atomicWrite, migrateLegacyData, softwareRoot };
