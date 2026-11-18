'use strict';
// Reuse the existing offline Electron runtime and create a standard ASAR archive.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '排班工作台');
const target = path.join(root, 'release', '排班工作台-win32-x64');
if (fs.existsSync(path.join(target, 'data'))) throw new Error('输出目录含 data，请先保留该目录，避免覆盖存档。');
const files = [];
let offset = 0;
function entry(absolute) {
  if (fs.statSync(absolute).isDirectory()) {
    return { files: Object.fromEntries(fs.readdirSync(absolute).sort().map(name => [name, entry(path.join(absolute, name))])) };
  }
  const bytes = fs.readFileSync(absolute);
  const item = { size: bytes.length, offset: String(offset) };
  offset += bytes.length; files.push(bytes); return item;
}
const header = { files: Object.fromEntries(['assets', 'desktop', 'js', 'vendor', 'index.html', 'package.json'].map(name => [name, entry(path.join(root, name))])) };
const json = Buffer.from(JSON.stringify(header));
const padded = Math.ceil((4 + json.length) / 4) * 4;
const headerPickle = Buffer.alloc(4 + padded);
headerPickle.writeUInt32LE(padded, 0);
headerPickle.writeUInt32LE(json.length, 4);
json.copy(headerPickle, 8);
const sizePickle = Buffer.alloc(8);
sizePickle.writeUInt32LE(4, 0); sizePickle.writeUInt32LE(headerPickle.length, 4);
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(runtime)) {
  if (['data', 'resources', '使用说明.txt'].includes(name)) continue;
  fs.cpSync(path.join(runtime, name), path.join(target, name), { recursive: true });
}
fs.mkdirSync(path.join(target, 'resources'), { recursive: true });
for (const name of fs.readdirSync(path.join(runtime, 'resources'))) {
  if (name === 'app.asar') continue;
  fs.cpSync(path.join(runtime, 'resources', name), path.join(target, 'resources', name), { recursive: true });
}
fs.writeFileSync(path.join(target, 'resources', 'app.asar'), Buffer.concat([sizePickle, headerPickle, ...files]));
const version = require('../package.json').version;
fs.writeFileSync(path.join(target, '使用说明.txt'), '\uFEFF' + fs.readFileSync(path.join(runtime, '使用说明.txt'), 'utf8').replace(/^\uFEFF/, '').replace(/桌面版 [\d.]+/, `桌面版 ${version}`).replace(/^导出(?: Word|与预览)：.*\r?\n/gm, '')
  + '\r\n导出与预览：打开独立窗口，修改标题、注释、本周备注，在预览中填写带教；备注列自动填写本周末欠休（含欠0，主任显示—）。窗口中可导出 Word 或 CSV 明细。修改按周保存在本机，不改变实际排班。\r\n', 'utf8');
console.log(target);
for (const name of ['完整使用手册.pdf', '完整使用手册.docx']) {
  const manual = path.join(root, 'docs', '使用手册', name);
  if (!fs.existsSync(manual)) throw new Error(`缺少 ${manual}，请先生成并校验完整手册。`);
  fs.copyFileSync(manual, path.join(target, name));
}
