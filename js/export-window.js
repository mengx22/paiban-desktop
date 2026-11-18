(function () {
  'use strict';
  const Export = window.PaibanRosterExport;
  const desktop = window.paibanExportDesktop;
  const $ = id => document.getElementById(id);
  let snapshot, draft, defaults, storageKey, saveTimer, renderTimer, statusTimer, saving = false;
  const widths = [709, 900, 1176, 1725, 1559, 1560, 1559, 1560, 1701, 1559, 1044];
  function text(tag, value, className) {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  function status(message, error = false) {
    clearTimeout(statusTimer); $('exportStatus').textContent = message;
    $('exportStatus').classList.toggle('error', error); $('exportStatus').hidden = false;
    statusTimer = setTimeout(() => { $('exportStatus').hidden = true; }, error ? 10000 : 6000);
  }
  function save() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...draft, baseNotes: snapshot.notes || '' }));
      $('draftStatus').textContent = '本周导出修改已保存在本机，不改变排班数据。';
    } catch (_) { $('draftStatus').textContent = '本次修改已用于预览，本机未能保存；关闭后需重新填写。'; }
  }
  function changed() {
    $('draftStatus').textContent = '正在更新预览…';
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 250);
    clearTimeout(renderTimer); renderTimer = setTimeout(render, 100);
  }
  function page(first, data) {
    const paper = document.createElement('article'); paper.className = 'paper';
    if (first) {
      const title = text('h2', data.title, 'paper-title');
      title.contentEditable = 'plaintext-only'; title.setAttribute('aria-label', '预览标题');
      title.addEventListener('input', () => { draft.title = title.innerText; $('titleInput').value = draft.title; save(); });
      title.addEventListener('blur', () => render());
      paper.append(title);
    }
    const table = document.createElement('table'); table.className = 'roster-table';
    const cols = document.createElement('colgroup');
    widths.forEach(width => { const col = document.createElement('col'); col.style.width = `${width / 15052 * 100}%`; cols.append(col); });
    table.append(cols);
    const head = document.createElement('thead'); const row = document.createElement('tr');
    const diagonal = document.createElement('th'); diagonal.colSpan = 2; diagonal.className = 'diagonal';
    diagonal.append(text('span', '日期', 'date-word'), text('span', '姓名', 'name-word')); row.append(diagonal);
    row.append(text('th', '带教'));
    data.dates.forEach((date, day) => row.append(text('th', `${date}\n星期${'一二三四五六日'[day]}`)));
    row.append(text('th', '备注')); head.append(row); table.append(head);
    const body = document.createElement('tbody'); table.append(body); paper.append(table);
    $('measureHost').append(paper);
    return { paper, body };
  }
  function overflow(p) {
    const bottom = p.body.getBoundingClientRect().bottom;
    return bottom > p.paper.getBoundingClientRect().bottom - 10 / 25.4 * 96 + 1;
  }
  function rowElement(row) {
    const tr = document.createElement('tr'); tr.dataset.person = row.id;
    row.cells.forEach((value, index) => {
      const td = text('td', value, ['number', 'name', 'teaching'][index] || (index === 10 ? 'owed' : ''));
      if (index === 2) {
        td.contentEditable = 'plaintext-only'; td.setAttribute('aria-label', `${row.cells[1]}的带教`);
        td.addEventListener('input', () => { draft.teaching[row.id] = td.innerText; save(); });
        td.addEventListener('blur', () => render());
      }
      tr.append(td);
    });
    return tr;
  }
  function annotationRow(lines) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 11; td.className = 'annotation-cell';
    lines.forEach(line => td.append(text('p', line || '\u00a0'))); tr.append(td); return tr;
  }
  function render() {
    if (!snapshot) return;
    try {
      const data = Export.model({ ...snapshot, ...draft });
      $('measureHost').replaceChildren();
      const pages = []; let current = page(true, data); pages.push(current);
      for (const row of data.rows) {
        const tr = rowElement(row); current.body.append(tr);
        if (overflow(current) && current.body.children.length > 1) {
          tr.remove(); current = page(false, data); pages.push(current); current.body.append(tr);
        }
      }
      const lines = data.annotations ? data.annotations.split(/\r\n|\r|\n/) : [];
      if (data.notes.trim()) lines.push(`本周备注：${data.notes.trim()}`);
      if (lines.length) {
        const notes = annotationRow(lines); current.body.append(notes);
        if (overflow(current) && current.body.children.length > 1) {
          notes.remove(); current = page(false, data); pages.push(current); current.body.append(notes);
        }
        // Very long explanations may span several pages.
        if (overflow(current)) {
          notes.remove(); let chunk = [];
          for (const line of lines) {
            chunk.push(line); current.body.replaceChildren(annotationRow(chunk));
            if (overflow(current) && chunk.length > 1) {
              const last = chunk.pop(); current.body.replaceChildren(annotationRow(chunk));
              current = page(false, data); pages.push(current); chunk = [last]; current.body.append(annotationRow(chunk));
            }
            // One long paragraph can itself exceed a page. Split it at a
            // measured character boundary rather than clipping the preview.
            if (overflow(current)) {
              let remaining = Array.from(chunk.pop());
              while (remaining.length) {
                let low = 1, high = remaining.length, fits = 0;
                while (low <= high) {
                  const mid = Math.floor((low + high) / 2);
                  current.body.replaceChildren(annotationRow([...chunk, remaining.slice(0, mid).join('')]));
                  if (overflow(current)) high = mid - 1;
                  else { fits = mid; low = mid + 1; }
                }
                const take = Math.max(1, fits);
                chunk.push(remaining.splice(0, take).join(''));
                current.body.replaceChildren(annotationRow(chunk));
                if (remaining.length) { current = page(false, data); pages.push(current); chunk = []; }
              }
            }
          }
        }
      }
      $('previewPages').replaceChildren();
      pages.forEach((p, index) => {
        const wrapper = document.createElement('div'); wrapper.className = 'sheet-wrap'; wrapper.dataset.page = index + 1;
        p.paper.setAttribute('aria-label', `第${index + 1}页`); wrapper.append(p.paper); $('previewPages').append(wrapper);
      });
      $('pageCount').textContent = `A4 横向 · 共 ${pages.length} 页`;
      scalePages();
    } catch (error) { status(error.message, true); }
  }
  function scalePages() {
    const available = $('previewScroll').clientWidth - 48;
    const selected = $('zoomSelect').value;
    const scale = selected === 'fit' ? Math.min(1, Math.max(0.3, available / (297 / 25.4 * 96))) : Number(selected);
    document.querySelectorAll('.sheet-wrap').forEach(wrapper => {
      wrapper.style.width = `${297 / 25.4 * 96 * scale}px`; wrapper.style.height = `${210 / 25.4 * 96 * scale}px`;
      wrapper.firstElementChild.style.transform = `scale(${scale})`;
    });
  }
  function download(filename, bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function output(kind) {
    if (saving || !snapshot) return;
    saving = true; $('wordBtn').disabled = $('csvBtn').disabled = true;
    $('exportStatus').hidden = true;
    try {
      save();
      let result;
      if (kind === 'word') {
        const file = await Export.create({ ...snapshot, ...draft });
        if (desktop) result = await desktop.exportWord(file.filename, file.bytes);
        else download(file.filename, file.bytes, file.mime);
      } else {
        if (desktop) result = await desktop.exportCsv(snapshot.csv.filename, snapshot.csv.text);
        else download(snapshot.csv.filename, snapshot.csv.text, 'text/csv;charset=utf-8');
      }
      if (result?.error) throw new Error(result.error);
      if (!result?.canceled) status(`已导出 ${kind === 'word' ? 'Word' : 'CSV'}${result?.filePath ? `：${result.filePath}` : ''}`);
    } catch (error) { status(`导出失败：${error.message}`, true); }
    finally { saving = false; $('wordBtn').disabled = false; $('csvBtn').disabled = !snapshot.csv; }
  }
  function init(data) {
    if (snapshot) return;
    snapshot = data;
    try {
      const model = Export.model(snapshot);
      defaults = { title: model.title, annotations: model.annotations, notes: model.notes, teaching: {} };
      draft = structuredClone(defaults); storageKey = `paiban.export-draft.v1:${snapshot.weekStart}`;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved && typeof saved === 'object') {
          for (const key of ['title', 'annotations']) if (typeof saved[key] === 'string') draft[key] = saved[key];
          if (saved.baseNotes === (snapshot.notes || '') && typeof saved.notes === 'string') draft.notes = saved.notes;
          if (saved.teaching && typeof saved.teaching === 'object' && !Array.isArray(saved.teaching)) draft.teaching = saved.teaching;
        }
      } catch (_) { /* Start with current-week defaults if browser storage is unavailable. */ }
      $('weekInfo').textContent = `${snapshot.weekStart} 起 · ${snapshot.staff.length} 人`;
      for (const [id, key] of [['titleInput', 'title'], ['annotationsInput', 'annotations'], ['notesInput', 'notes']]) {
        $(id).value = draft[key];
        $(id).addEventListener('input', () => { draft[key] = $(id).value; changed(); });
      }
      $('resetBtn').addEventListener('click', () => {
        draft = structuredClone(defaults);
        $('titleInput').value = draft.title; $('annotationsInput').value = draft.annotations; $('notesInput').value = draft.notes;
        save(); render();
      });
      $('wordBtn').disabled = false; $('csvBtn').disabled = !snapshot.csv; render();
    } catch (error) { status(error.message, true); }
  }
  $('wordBtn').addEventListener('click', () => output('word'));
  $('csvBtn').addEventListener('click', () => output('csv'));
  $('closeBtn').addEventListener('click', () => { if (desktop) desktop.close(); else window.close(); });
  $('zoomSelect').addEventListener('change', scalePages);
  window.addEventListener('resize', scalePages);
  window.addEventListener('beforeunload', () => { if (draft) save(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !saving) { if (desktop) desktop.close(); else window.close(); } });
  if (desktop) init(desktop.draft());
  else if (window.opener) {
    window.addEventListener('message', event => {
      if (event.source === window.opener && event.data?.type === 'paiban-export-data') init(event.data.draft);
    });
    window.opener.postMessage({ type: 'paiban-export-ready' }, '*');
  } else status('请从排班工作台点击“导出与预览”打开此窗口。', true);
})();
