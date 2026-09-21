import * as pdfjsLib from './vendor/pdf.mjs';

const core = globalThis.BRMCore;
const { PDFDocument, StandardFonts, degrees, rgb } = globalThis.PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.mjs');

const els = {
  fileInput: document.getElementById('fileInput'), fileMeta: document.getElementById('fileMeta'),
  openCrmBtn: document.getElementById('openCrmBtn'), startBtn: document.getElementById('startBtn'), pauseBtn: document.getElementById('pauseBtn'),
  progressText: document.getElementById('progressText'), progressPct: document.getElementById('progressPct'), progressBar: document.getElementById('progressBar'),
  statMatched: document.getElementById('statMatched'), statNotFound: document.getElementById('statNotFound'), statReview: document.getElementById('statReview'), statErrors: document.getElementById('statErrors'),
  alertBox: document.getElementById('alertBox'), downloadPdfBtn: document.getElementById('downloadPdfBtn'), downloadCsvBtn: document.getElementById('downloadCsvBtn'), platformPill: document.getElementById('platformPill')
};

let state = null;
let paused = false;
let running = false;

const dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open('brm-report-enricher', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('files');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function idbPut(key, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function storageGet(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (v) => resolve(v?.[key])));
}
function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}
function sendRuntime(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(response);
  }));
}

function showAlert(message, error = false) {
  els.alertBox.textContent = message;
  els.alertBox.classList.remove('hidden', 'error');
  if (error) els.alertBox.classList.add('error');
}
function hideAlert() { els.alertBox.classList.add('hidden'); }

function normalizeItem(item) {
  const str = String(item.str || '').replace(/\s+/g, ' ').trim();
  const t = item.transform || [1, 0, 0, 1, 0, 0];
  const scale = Math.hypot(t[0], t[1]) || 1;
  const ux = t[0] / scale;
  const uy = t[1] / scale;
  const width = Number(item.width || 0);
  const cx = t[4] + ux * width / 2;
  const cy = t[5] + uy * width / 2;
  return { text: str, t, ux, uy, cx, cy, width };
}

function projection(item, u, v) {
  return { row: item.cx * v.x + item.cy * v.y, col: item.cx * u.x + item.cy * u.y };
}

function median(values) {
  const a = [...values].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 30;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function findHeader(items, text, headerRow, u, v) {
  const wanted = core.normalizeName(text);
  const candidates = items.filter((it) => core.normalizeName(it.text) === wanted);
  if (headerRow == null) return candidates[0] || null;
  return candidates.sort((a, b) => Math.abs(projection(a, u, v).row - headerRow) - Math.abs(projection(b, u, v).row - headerRow))[0] || null;
}

function getColumnBounds(items, headerItem, headerRow, u, v, minimumGap = 18) {
  const hp = projection(headerItem, u, v);
  const near = items.filter((it) => Math.abs(projection(it, u, v).row - headerRow) <= 14);
  const centers = near.map((it) => projection(it, u, v).col).filter(Number.isFinite).sort((a, b) => a - b);
  const left = centers.filter((c) => c < hp.col - minimumGap).pop();
  const right = centers.find((c) => c > hp.col + minimumGap);
  return {
    left: Number.isFinite(left) ? (left + hp.col) / 2 : hp.col - 90,
    right: Number.isFinite(right) ? (hp.col + right) / 2 : hp.col + 90,
    center: hp.col
  };
}

function extractCell(items, rowAnchor, step, bounds, u, v) {
  const lo = rowAnchor - step * 0.30;
  const hi = rowAnchor + step * 0.65;
  return items
    .map((it) => ({ it, p: projection(it, u, v) }))
    .filter(({ p }) => p.row > lo && p.row < hi && p.col > bounds.left && p.col < bounds.right)
    .sort((a, b) => a.p.row - b.p.row || a.p.col - b.p.col)
    .map(({ it }) => it.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBusinessRowsFromPage(items, pageIndex) {
  const businessHeaders = items.filter((it) => core.normalizeName(it.text) === 'BUSINESS NAME');
  const out = [];
  businessHeaders.forEach((businessHeader, tableIndex) => {
    const u = { x: businessHeader.ux, y: businessHeader.uy };
    const v = { x: -u.y, y: u.x };
    const hp = projection(businessHeader, u, v);
    const headerRow = hp.row;
    const snHeader = findHeader(items, 'S/N', headerRow, u, v);
    if (!snHeader || Math.abs(projection(snHeader, u, v).row - headerRow) > 20) return;
    const snCol = projection(snHeader, u, v).col;

    const laterHeaders = businessHeaders
      .map((x) => projection(x, u, v).row)
      .filter((r) => r > headerRow + 20);
    const maxRow = Math.max(headerRow + 40, ...items.map((it) => projection(it, u, v).row));
    const tableEnd = laterHeaders.length ? Math.min(...laterHeaders) - 7 : maxRow + 5;

    let snItems = items.filter((it) => {
      const p = projection(it, u, v);
      return /^\d{1,3}$/.test(it.text) && Math.abs(p.col - snCol) < 24 && p.row > headerRow + 9 && p.row < tableEnd;
    }).sort((a, b) => projection(a, u, v).row - projection(b, u, v).row);
    snItems = snItems.filter((it, idx, arr) => idx === 0 || Math.abs(projection(it, u, v).row - projection(arr[idx - 1], u, v).row) > 4);
    if (!snItems.length) return;

    const steps = snItems.slice(1).map((it, i) => projection(it, u, v).row - projection(snItems[i], u, v).row).filter((x) => x > 10 && x < 80);
    const rowStep = median(steps);
    const businessBounds = getColumnBounds(items, businessHeader, headerRow, u, v, 25);

    const terminalIdHeader = findHeader(items, 'Terminal ID', headerRow, u, v);
    const terminalSerialHeader = findHeader(items, 'Terminal Serial', headerRow, u, v);
    const terminalIdBounds = terminalIdHeader && Math.abs(projection(terminalIdHeader, u, v).row - headerRow) < 20 ? getColumnBounds(items, terminalIdHeader, headerRow, u, v, 15) : null;
    const terminalSerialBounds = terminalSerialHeader && Math.abs(projection(terminalSerialHeader, u, v).row - headerRow) < 20 ? getColumnBounds(items, terminalSerialHeader, headerRow, u, v, 15) : null;

    snItems.forEach((snItem) => {
      const anchor = projection(snItem, u, v).row;
      const name = extractCell(items, anchor, rowStep, businessBounds, u, v);
      if (!name) return;
      const terminalId = terminalIdBounds ? extractCell(items, anchor, rowStep, terminalIdBounds, u, v).replace(/\s/g, '') : '';
      const terminalSerial = terminalSerialBounds ? extractCell(items, anchor, rowStep, terminalSerialBounds, u, v).replace(/\s/g, '') : '';
      out.push({
        rowId: `p${pageIndex + 1}-t${tableIndex + 1}-n${snItem.text}-${Math.round(anchor)}`,
        pageIndex, tableIndex, sn: snItem.text, name, terminalId, terminalSerial,
        anchorRawX: snItem.t[4], anchorRawY: snItem.t[5], headerRawX: businessHeader.t[4], headerRawY: businessHeader.t[5],
        rowAnchor: anchor, rowStep, tableEndRow: tableEnd
      });
    });
  });
  return out;
}

async function parseReport(bytes) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: chrome.runtime.getURL('vendor/cmaps/'), cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL('vendor/standard_fonts/'),
    wasmUrl: chrome.runtime.getURL('vendor/wasm/')
  });
  const pdf = await loadingTask.promise;
  const rows = [];
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    els.progressText.textContent = `Reading report structure: page ${pageIndex + 1} of ${pdf.numPages}...`;
    const page = await pdf.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const items = content.items.map(normalizeItem).filter((it) => it.text);
    rows.push(...parseBusinessRowsFromPage(items, pageIndex));
  }
  return { pageCount: pdf.numPages, rows };
}

function buildGroups(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = core.makeGroupKey(row.name, row.terminalId, row.terminalSerial);
    if (!map.has(key)) map.set(key, { key, name: row.name, terminalId: row.terminalId, terminalSerial: row.terminalSerial, rowIds: [] });
    map.get(key).rowIds.push(row.rowId);
  });
  return Array.from(map.values()).sort((a, b) => {
    const at = a.terminalSerial || a.terminalId ? 0 : 1;
    const bt = b.terminalSerial || b.terminalId ? 0 : 1;
    return at - bt || a.name.localeCompare(b.name);
  });
}

async function persist() {
  await storageSet({ brmEnricherState: state });
}

function resultCounts() {
  const results = Object.values(state?.results || {});
  return {
    matched: results.filter((r) => r.status === 'MATCHED').length,
    notFound: results.filter((r) => ['NOT_FOUND', 'NO_POS'].includes(r.status)).length,
    review: results.filter((r) => r.status === 'AMBIGUOUS').length,
    errors: results.filter((r) => r.status === 'ERROR').length
  };
}

function updateUI() {
  const groups = state?.groups || [];
  const results = state?.results || {};
  const completed = groups.filter((g) => results[g.key]).length;
  const pct = groups.length ? Math.round(completed / groups.length * 100) : 0;
  const counts = resultCounts();
  els.progressPct.textContent = `${pct}%`;
  els.progressBar.style.width = `${pct}%`;
  els.statMatched.textContent = counts.matched;
  els.statNotFound.textContent = counts.notFound;
  els.statReview.textContent = counts.review;
  els.statErrors.textContent = counts.errors;
  if (state) {
    els.fileMeta.textContent = `${state.fileName} • ${state.pageCount} pages • ${state.rows.length} business rows • ${state.groups.length} unique lookups`;
    els.startBtn.disabled = running || !state.groups.length || completed === groups.length;
    els.startBtn.textContent = completed > 0 && completed < groups.length ? 'Resume enrichment' : 'Start enrichment';
    els.pauseBtn.disabled = !running;
    els.downloadPdfBtn.disabled = completed !== groups.length;
    els.downloadCsvBtn.disabled = completed === 0;
    if (!running) els.progressText.textContent = completed === groups.length ? `Complete: ${completed} of ${groups.length} lookups processed.` : `${completed} of ${groups.length} lookups completed.`;
  } else {
    els.startBtn.disabled = true;
  }
}

function buildNameResolutionCache() {
  const cache = new Map();
  for (const group of state.groups) {
    if (!(group.terminalSerial || group.terminalId)) continue;
    const result = state.results[group.key];
    if (!result || result.status !== 'MATCHED') continue;
    const n = core.normalizeName(group.name);
    if (!cache.has(n)) cache.set(n, new Map());
    cache.get(n).set(`${result.posAccount}|${result.phone}`, result);
  }
  return cache;
}

async function processGroups() {
  if (!state || running) return;
  running = true; paused = false; hideAlert(); updateUI();
  try {
    for (let i = 0; i < state.groups.length; i += 1) {
      if (paused) break;
      const group = state.groups[i];
      if (state.results[group.key]) continue;

      if (!(group.terminalSerial || group.terminalId)) {
        const cache = buildNameResolutionCache().get(core.normalizeName(group.name));
        if (cache?.size === 1) {
          state.results[group.key] = { ...Array.from(cache.values())[0], reusedVerifiedName: true };
          await persist(); updateUI(); continue;
        }
        if (cache?.size > 1) {
          state.results[group.key] = { status: 'AMBIGUOUS', reason: 'This exact name resolves to more than one verified POS account in the same report.' };
          await persist(); updateUI(); continue;
        }
      }

      els.progressText.textContent = `Searching ${i + 1} of ${state.groups.length}: ${group.name}`;
      let result;
      try {
        result = await sendRuntime({ type: 'LOOKUP_BUSINESS', payload: group });
      } catch (error) {
        result = { status: 'ERROR', reason: error?.message || String(error) };
      }
      if (result?.status === 'SESSION_REQUIRED') {
        showAlert('Your MonieCRM session needs attention. Open MonieCRM, sign in normally, then return here and press Resume enrichment.');
        break;
      }
      if (result?.status === 'NEEDS_MANUAL_BUSINESSES_PAGE') {
        showAlert('Open MonieCRM and navigate to Account Management → Businesses once. Then return here and press Resume enrichment.');
        break;
      }
      state.results[group.key] = result || { status: 'ERROR', reason: 'No response was returned.' };
      await persist();
      updateUI();
    }
  } finally {
    running = false;
    updateUI();
  }
}

function resultForRow(row) {
  return state.results[core.makeGroupKey(row.name, row.terminalId, row.terminalSerial)] || { status: 'ERROR' };
}

function printableValues(result) {
  if (result.status === 'MATCHED') return [result.posAccount || '', result.phone || ''];
  if (result.status === 'AMBIGUOUS') return ['REVIEW', ''];
  if (result.status === 'ERROR') return ['ERROR', ''];
  return ['-', '-'];
}

async function generateEnrichedPdf() {
  const bytes = await idbGet('currentPdf');
  if (!bytes) throw new Error('The original PDF is no longer available. Please upload it again.');
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 175;
  const divider = 86;
  const pageRows = new Map();
  state.rows.forEach((row) => {
    if (!pageRows.has(row.pageIndex)) pageRows.set(row.pageIndex, []);
    pageRows.get(row.pageIndex).push(row);
  });

  for (const [pageIndex, rows] of pageRows.entries()) {
    const page = pdfDoc.getPage(pageIndex);
    const rotation = page.getRotation().angle % 360;
    const size = page.getSize();
    if (rotation === 90) {
      page.setMediaBox(0, -margin, size.width, size.height + margin);
      page.setCropBox(0, -margin, size.width, size.height + margin);
    } else if (rotation === 0) {
      page.setSize(size.width + margin, size.height);
    }

    const tables = new Map();
    rows.forEach((row) => {
      if (!tables.has(row.tableIndex)) tables.set(row.tableIndex, []);
      tables.get(row.tableIndex).push(row);
    });

    for (const tableRows of tables.values()) {
      tableRows.sort((a, b) => a.rowAnchor - b.rowAnchor);
      const headerX = tableRows[0].headerRawX;
      const step = median(tableRows.slice(1).map((r, i) => r.rowAnchor - tableRows[i].rowAnchor));
      const endX = Math.min(size.width - 18, tableRows[tableRows.length - 1].anchorRawX + step * 0.75);
      const startX = Math.max(12, headerX - 7);
      const lineColor = rgb(0.72, 0.76, 0.78);

      if (rotation === 90) {
        for (const y of [0, -divider, -margin]) {
          page.drawLine({ start: { x: startX, y }, end: { x: endX, y }, thickness: 0.45, color: lineColor });
        }
        const rowBoundaries = [headerX + step * 0.55, ...tableRows.slice(1).map((r, i) => (tableRows[i].anchorRawX + r.anchorRawX) / 2), endX];
        rowBoundaries.forEach((x) => page.drawLine({ start: { x, y: 0 }, end: { x, y: -margin }, thickness: 0.35, color: lineColor }));
        page.drawText('POS Account No.', { x: headerX + 4, y: -10, size: 7, font: bold, rotate: degrees(-90), color: rgb(0.12, 0.24, 0.28) });
        page.drawText('Phone No.', { x: headerX + 4, y: -(divider + 9), size: 7, font: bold, rotate: degrees(-90), color: rgb(0.12, 0.24, 0.28) });
        tableRows.forEach((row) => {
          const [pos, phone] = printableValues(resultForRow(row));
          page.drawText(String(pos), { x: row.anchorRawX + 3, y: -10, size: 6.7, font, rotate: degrees(-90), color: rgb(0.08, 0.19, 0.23) });
          page.drawText(String(phone), { x: row.anchorRawX + 3, y: -(divider + 9), size: 6.7, font, rotate: degrees(-90), color: rgb(0.08, 0.19, 0.23) });
        });
      } else {
        const xPos = size.width + 8;
        const xPhone = size.width + divider;
        page.drawText('POS Account No.', { x: xPos, y: size.height - headerX, size: 7, font: bold });
        page.drawText('Phone No.', { x: xPhone, y: size.height - headerX, size: 7, font: bold });
        tableRows.forEach((row) => {
          const [pos, phone] = printableValues(resultForRow(row));
          const y = size.height - row.anchorRawX;
          page.drawText(String(pos), { x: xPos, y, size: 6.7, font });
          page.drawText(String(phone), { x: xPhone, y, size: 6.7, font });
        });
      }
    }
  }
  return pdfDoc.save();
}

function downloadBlob(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function handleUpload(file) {
  hideAlert(); running = false; paused = false;
  if (!file || !/\.pdf$/i.test(file.name)) return;
  els.startBtn.disabled = true;
  const bytes = await file.arrayBuffer();
  await idbPut('currentPdf', bytes);
  els.fileMeta.textContent = `${file.name} • reading structure...`;
  try {
    const parsed = await parseReport(bytes);
    if (!parsed.rows.length) throw new Error('No business tables were detected in this PDF.');
    state = {
      version: 1, fileName: file.name, pageCount: parsed.pageCount,
      rows: parsed.rows, groups: buildGroups(parsed.rows), results: {}, createdAt: new Date().toISOString()
    };
    await persist();
    updateUI();
    els.progressText.textContent = `Ready: ${state.rows.length} business rows detected across ${state.pageCount} pages.`;
  } catch (error) {
    state = null; await storageSet({ brmEnricherState: null });
    showAlert(`Could not read the report: ${error?.message || error}`, true);
    updateUI();
  }
}

els.fileInput.addEventListener('change', () => handleUpload(els.fileInput.files?.[0]));
els.openCrmBtn.addEventListener('click', async () => {
  hideAlert();
  try { await sendRuntime({ type: 'OPEN_CRM' }); }
  catch (error) { showAlert(`Could not open MonieCRM: ${error.message}`, true); }
});
els.startBtn.addEventListener('click', processGroups);
els.pauseBtn.addEventListener('click', () => { paused = true; els.progressText.textContent = 'Pausing after the current business...'; });
els.downloadPdfBtn.addEventListener('click', async () => {
  hideAlert(); els.downloadPdfBtn.disabled = true; els.downloadPdfBtn.textContent = 'Building PDF...';
  try {
    const output = await generateEnrichedPdf();
    const base = state.fileName.replace(/\.pdf$/i, '');
    downloadBlob(output, `${base}_Enriched.pdf`, 'application/pdf');
  } catch (error) { showAlert(`Could not build the enriched PDF: ${error.message}`, true); }
  finally { els.downloadPdfBtn.textContent = 'Download enriched PDF'; updateUI(); }
});
els.downloadCsvBtn.addEventListener('click', () => {
  const lines = [['Business Name','Terminal ID','Terminal Serial','Status','POS Account No.','Phone No.','Reason'].join(',')];
  state.rows.forEach((row) => {
    const r = resultForRow(row); const [pos, phone] = printableValues(r);
    lines.push([row.name,row.terminalId,row.terminalSerial,r.status,pos,phone,r.reason || ''].map(csvEscape).join(','));
  });
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), state.fileName.replace(/\.pdf$/i, '_Enrichment_Audit.csv'), 'text/csv');
});

(async function init() {
  els.platformPill.textContent = /Android/i.test(navigator.userAgent) ? 'Android WebExtension' : 'Desktop WebExtension';
  state = await storageGet('brmEnricherState');
  if (state) {
    const bytes = await idbGet('currentPdf');
    if (!bytes) { state = null; await storageSet({ brmEnricherState: null }); }
  }
  updateUI();
})();
