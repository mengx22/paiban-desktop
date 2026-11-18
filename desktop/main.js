'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store, atomicWrite, migrateLegacyData, softwareRoot } = require('./store');
let win;
let store;
let positionRules;
let exportWindow;
const entry = path.join(__dirname, '..', 'index.html');
app.setName('排班工作台');
const legacyDirectory = path.join(app.getPath('appData'), 'PaibanDesktop');
const testDirectory = process.env.PAIBAN_DATA_DIR;
// Electron 运行缓存与排班数据分开。测试使用隔离目录。
app.setPath('userData', testDirectory || legacyDirectory);
const root = testDirectory || softwareRoot(app.getAppPath(), app.getPath('exe'), app.isPackaged);
const dataDirectory = path.join(root, 'data');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    try {
      if (!testDirectory) migrateLegacyData(dataDirectory, path.join(legacyDirectory, 'data'));
      store = new Store(dataDirectory);
    } catch (err) {
      dialog.showErrorBox('无法打开排班数据', `${err.message}\n保存位置：${dataDirectory}`);
      app.quit();
      return;
    }
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({
      title: '排班工作台', width: 1540, height: 1000, minWidth: 1050, minHeight: 700,
      icon: path.join(__dirname, '..', 'assets', 'app.ico'),
      show: false, backgroundColor: '#f5f7f8', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false }
    });
    const trusted = event => event.sender === win.webContents && event.senderFrame?.url === pathToFileURL(entry).href;
    const exportEntry = path.join(__dirname, 'export.html');
    const exportUrl = pathToFileURL(exportEntry).href;
    const fromExport = event => exportWindow && event.sender === exportWindow.window.webContents
      && event.senderFrame?.url === exportUrl;
    ipcMain.handle('paiban:export-open', (event, draft) => {
      if (!trusted(event)) throw new Error('无法打开导出预览');
      if (exportWindow) { exportWindow.window.focus(); return null; }
      return new Promise((resolve, reject) => {
        const child = new BrowserWindow({
          parent: win, modal: true, show: false, title: '导出与预览', width: 1420, height: 980, minWidth: 1000, minHeight: 680,
          backgroundColor: '#eef1f3', autoHideMenuBar: true,
          webPreferences: { preload: path.join(__dirname, 'export-preload.js'), nodeIntegration: false,
            contextIsolation: true, sandbox: true, spellcheck: false }
        });
        exportWindow = { window: child, draft };
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        child.webContents.on('will-navigate', (e, url) => { if (url !== exportUrl) e.preventDefault(); });
        child.once('ready-to-show', () => child.show());
        child.once('closed', () => { exportWindow = null; resolve(null); });
        child.loadFile(exportEntry).catch(error => { reject(error); if (!child.isDestroyed()) child.close(); });
      });
    });
    ipcMain.on('paiban:export-draft', event => { event.returnValue = fromExport(event) ? exportWindow.draft : null; });
    ipcMain.on('paiban:export-close', event => { if (fromExport(event)) exportWindow.window.close(); });
    const positionUrl = `${pathToFileURL(entry).href}#position-rules`;
    const fromPositionRules = event => positionRules && event.sender === positionRules.window.webContents
      && event.senderFrame?.url === positionUrl;
    ipcMain.handle('paiban:position-rules-open', (event, draft) => {
      if (!trusted(event)) throw new Error('无法读取职位规则');
      if (positionRules) { positionRules.window.focus(); return null; }
      return new Promise((resolve, reject) => {
        const child = new BrowserWindow({
          parent: win, modal: true, show: false, title: '职位规则', width: 850, height: 770, minWidth: 640, minHeight: 510,
          backgroundColor: '#ffffff', autoHideMenuBar: true,
          webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false,
            contextIsolation: true, sandbox: true, spellcheck: false }
        });
        const editor = { window: child, draft, result: null };
        positionRules = editor;
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        child.webContents.on('will-navigate', (navigateEvent, url) => { if (url !== positionUrl) navigateEvent.preventDefault(); });
        child.once('ready-to-show', () => child.show());
        child.once('closed', () => { positionRules = null; resolve(editor.result); });
        child.loadFile(entry, { hash: 'position-rules' }).catch(error => {
          reject(error);
          if (!child.isDestroyed()) child.close();
        });
      });
    });
    ipcMain.on('paiban:position-rules-draft', event => {
      event.returnValue = fromPositionRules(event) ? positionRules.draft : null;
    });
    ipcMain.on('paiban:position-rules-finish', (event, result) => {
      if (!fromPositionRules(event)) return;
      positionRules.result = result;
      positionRules.window.close();
    });
    ipcMain.on('paiban:storage', (event, action, ...args) => {
      try {
        if (!trusted(event)) throw new Error('不允许访问本地数据');
        let value;
        if (action === 'get') value = store.get(args[0]);
        else if (action === 'set') value = store.set(args[0], args[1]);
        else if (action === 'info') value = { directory: store.directory, notice: store.notice };
        else if (action === 'restore') value = store.restore(args[0]);
        else throw new Error('未知操作');
        event.returnValue = { ok: true, value: value ?? null };
      } catch (err) { event.returnValue = { ok: false, error: err.message }; }
    });
    ipcMain.handle('paiban:export-backup', async event => {
      if (!trusted(event)) throw new Error('不允许访问本地数据');
      try {
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: '备份全部排班数据', defaultPath: `排班完整备份-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: '排班备份', extensions: ['json'] }]
        });
        if (canceled) return { canceled: true };
        atomicWrite(filePath, JSON.stringify(store.backup(), null, 2));
        return { filePath };
      } catch (err) { return { error: err.message }; }
    });
    ipcMain.handle('paiban:open-data', async event => {
      if (!trusted(event)) throw new Error('不允许访问本地数据');
      const error = await shell.openPath(store.directory);
      if (error) throw new Error(error);
    });
    ipcMain.handle('paiban:export-csv', async (event, filename, text) => {
      if (!trusted(event) && !fromExport(event)) throw new Error('不允许导出');
      try {
        if (typeof text !== 'string' || text.length > 16 * 1024 * 1024 || typeof filename !== 'string' || !/^排班表_\d{4}-\d{2}-\d{2}\.csv$/.test(filename)) throw new Error('无效的排班导出数据');
        const { canceled, filePath } = await dialog.showSaveDialog(fromExport(event) ? exportWindow.window : win, {
          title: '导出排班 CSV', defaultPath: filename, filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
        });
        if (canceled) return { canceled: true };
        atomicWrite(filePath, text, false);
        return { filePath };
      } catch (err) { return { error: err.message }; }
    });
    ipcMain.handle('paiban:export-word', async (event, filename, bytes) => {
      if (!trusted(event) && !fromExport(event)) throw new Error('不允许导出');
      try {
        if (typeof filename !== 'string' || !/^排班表_\d{4}-\d{2}-\d{2}\.docx$/.test(filename)
          || !(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > 16 * 1024 * 1024
          || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('无效的 Word 排班数据');
        const { canceled, filePath } = await dialog.showSaveDialog(fromExport(event) ? exportWindow.window : win, {
          title: '导出 Word 排班表', defaultPath: filename, filters: [{ name: 'Word 文档', extensions: ['docx'] }]
        });
        if (canceled) return { canceled: true };
        atomicWrite(filePath, Buffer.from(bytes), false);
        return { filePath };
      } catch (err) { return { error: err.message }; }
    });
    ipcMain.handle('paiban:print', event => {
      if (!trusted(event)) throw new Error('不允许打印');
      win.webContents.print({ silent: false, landscape: true, printBackground: true, pageSize: 'A4' }, (ok, reason) => {
        if (!ok && reason !== 'cancelled') dialog.showErrorBox('打印未完成', reason);
      });
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      // 允许恢复备份后的本地重载，阻止导航到其它页面。
      if (url !== pathToFileURL(entry).href) event.preventDefault();
    });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(file:|blob:|devtools:)/.test(details.url) });
    });
    win.webContents.session.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: '导出排班 CSV', defaultPath: item.getFilename(), filters: [{ name: 'CSV 表格', extensions: ['csv'] }] });
    });
    win.on('unresponsive', () => {
      // 排班求解可能需要时间；保留窗口和已经保存的数据。
    });
    win.once('ready-to-show', () => { win.show(); win.maximize(); });
    win.loadFile(entry);
  }).catch(err => { dialog.showErrorBox('启动失败', err.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
