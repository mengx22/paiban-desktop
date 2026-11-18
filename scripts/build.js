'use strict';
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const { packager } = await import('@electron/packager');
  const root = path.resolve(__dirname, '..');
  const { version } = require('../package.json');
  const output = path.join(root, 'release');
  const portableData = path.join(output, '排班工作台-win32-x64', 'data');
  if (fs.existsSync(portableData)) throw new Error(`请先备份并移出 ${portableData}，以免重新打包时替换存档。`);
  const stage = path.join(root, '.cache', 'package-source');
  fs.mkdirSync(stage, { recursive: true });
  for (const name of ['desktop', 'js', 'assets', 'vendor', 'index.html', 'package.json']) {
    fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
  }
  const result = await packager({
    dir: stage, out: output, name: '排班工作台',
    platform: 'win32', arch: 'x64', electronVersion: require('../node_modules/electron/package.json').version,
    ...(fs.existsSync(path.join(root, '.cache', 'electron-zip', `electron-v${require('../node_modules/electron/package.json').version}-win32-x64.zip`))
      ? { electronZipDir: path.join(root, '.cache', 'electron-zip') }
      : { download: { cacheRoot: path.join(root, '.cache', 'electron') } }),
    asar: true, overwrite: true, prune: false, executableName: '排班工作台',
    appVersion: version, appCopyright: '排班工作台',
    ...(fs.existsSync(path.join(root, 'assets', 'app.ico')) ? { icon: path.join(root, 'assets', 'app.ico') } : {}),
    win32metadata: { ProductName: '排班工作台', FileDescription: '离线周排班与本地历史存档', CompanyName: '排班工作台' }
  });
  for (const directory of result) {
    const instructions = [
      `排班工作台 · Windows 桌面版 ${version}`,
      '',
      '解压后双击“排班工作台.exe”运行。请保留程序文件夹的完整内容。',
      '软件无需打开浏览器、安装 Node.js 或联网。',
      '',
      '日常使用时，配置和历史排班保存在与 EXE 同级的 data 文件夹。',
      '可点击“数据备份 → 打开数据文件夹”查看实际路径。',
      '首次启动时，如软件目录没有存档，会复制旧版桌面数据。旧文件会保留。',
      '',
      '换电脑时，关闭软件并复制整个程序文件夹，确保 data 在目标电脑的 EXE 同级。',
      '也可以点击“数据备份 → 备份全部数据”导出 JSON，然后在另一台电脑恢复。',
      '从旧网页版迁移时，在原浏览器和原地址打开更新后的网页，导出完整备份再到桌面版恢复。',
      '',
      '点击“历史”可查看、保存和删除往期记录，也可以导入旧 CSV。',
      ''
    ].join('\r\n');
    fs.writeFileSync(path.join(directory, '使用说明.txt'), `\uFEFF${instructions}`, 'utf8');
    for (const name of ['完整使用手册.pdf', '完整使用手册.docx']) {
      const manual = path.join(root, 'docs', '使用手册', name);
      if (!fs.existsSync(manual)) throw new Error(`缺少 ${manual}，请先生成并校验完整手册。`);
      fs.copyFileSync(manual, path.join(directory, name));
    }
    fs.appendFileSync(path.join(directory, '使用说明.txt'), '\r\n完整操作步骤见同目录的“完整使用手册.pdf”，可编辑版本为“完整使用手册.docx”。\r\n', 'utf8');
  }
  console.log(result.join('\n'));
})().catch(err => { console.error(err); process.exitCode = 1; });
