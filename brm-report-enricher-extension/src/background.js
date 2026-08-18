'use strict';

try {
  if (!globalThis.BRMCore && typeof importScripts === 'function') importScripts('core.js');
} catch (_) {}

const core = globalThis.BRMCore;
const CRM_ORIGIN = 'https://console.teamapt.com/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let rememberedBusinessesUrl = '';

function runtimeError() {
  return chrome.runtime.lastError ? new Error(chrome.runtime.lastError.message) : null;
}

function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => chrome.tabs.query(queryInfo, (tabs) => {
    const err = runtimeError();
    if (err) reject(err); else resolve(tabs || []);
  }));
}

function tabsCreate(createProperties) {
  return new Promise((resolve, reject) => chrome.tabs.create(createProperties, (tab) => {
    const err = runtimeError();
    if (err) reject(err); else resolve(tab);
  }));
}

function tabsUpdate(tabId, updateProperties) {
  return new Promise((resolve, reject) => chrome.tabs.update(tabId, updateProperties, (tab) => {
    const err = runtimeError();
    if (err) reject(err); else resolve(tab);
  }));
}

function tabsGoBack(tabId) {
  return new Promise((resolve) => {
    if (chrome.tabs.goBack) chrome.tabs.goBack(tabId, () => resolve());
    else sendToTab(tabId, { type: 'HISTORY_BACK' }).finally(resolve);
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, message, (response) => {
    const err = runtimeError();
    if (err) reject(err); else resolve(response);
  }));
}

async function waitForContent(tabId, predicate, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const ping = await sendToTab(tabId, { type: 'PING' });
      if (ping && predicate(ping)) return ping;
    } catch (_) {}
    await sleep(300);
  }
  return null;
}

async function ensureCrmTab(active = false) {
  let tabs = [];
  try { tabs = await tabsQuery({ url: ['https://console.teamapt.com/*'] }); } catch (_) {}
  let tab = tabs[0];
  if (!tab) tab = await tabsCreate({ url: CRM_ORIGIN, active });
  else if (active) tab = await tabsUpdate(tab.id, { active: true });
  return tab;
}

async function ensureBusinessesPage(tabId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let ping = null;
    try { ping = await sendToTab(tabId, { type: 'PING' }); } catch (_) {}
    if (ping?.pageKind === 'login') return { status: 'SESSION_REQUIRED' };
    if (ping?.pageKind === 'businesses') {
      rememberedBusinessesUrl = ping.url;
      return { status: 'OK', url: ping.url };
    }

    if (rememberedBusinessesUrl) {
      await tabsUpdate(tabId, { url: rememberedBusinessesUrl });
      const ready = await waitForContent(tabId, (x) => x.pageKind === 'businesses' || x.pageKind === 'login', 12000);
      if (ready?.pageKind === 'login') return { status: 'SESSION_REQUIRED' };
      if (ready?.pageKind === 'businesses') return { status: 'OK', url: ready.url };
    }

    try {
      const nav = await sendToTab(tabId, { type: 'GO_TO_BUSINESSES' });
      if (nav?.status === 'SESSION_REQUIRED') return { status: 'SESSION_REQUIRED' };
      if (nav?.status === 'NEEDS_MANUAL_BUSINESSES_PAGE') return { status: 'NEEDS_MANUAL_BUSINESSES_PAGE' };
    } catch (_) {}
    const ready = await waitForContent(tabId, (x) => x.pageKind === 'businesses' || x.pageKind === 'login', 8000);
    if (ready?.pageKind === 'login') return { status: 'SESSION_REQUIRED' };
    if (ready?.pageKind === 'businesses') {
      rememberedBusinessesUrl = ready.url;
      return { status: 'OK', url: ready.url };
    }
  }
  return { status: 'NEEDS_MANUAL_BUSINESSES_PAGE' };
}

async function restoreBusinesses(tabId) {
  if (rememberedBusinessesUrl) {
    await tabsUpdate(tabId, { url: rememberedBusinessesUrl });
    const ready = await waitForContent(tabId, (x) => x.pageKind === 'businesses' || x.pageKind === 'login', 12000);
    if (ready?.pageKind === 'businesses') return true;
    if (ready?.pageKind === 'login') throw new Error('SESSION_REQUIRED');
  }
  const ensured = await ensureBusinessesPage(tabId);
  if (ensured.status !== 'OK') throw new Error(ensured.status);
  return true;
}

async function openCandidateAndWait(tabId, name, index) {
  const opened = await sendToTab(tabId, { type: 'OPEN_CANDIDATE', name, index });
  if (!opened?.ok) throw new Error(opened?.error || 'Could not open the business record.');
  const ready = await waitForContent(tabId, (x) => ['actions', 'login'].includes(x.pageKind), 12000);
  if (ready?.pageKind === 'login') throw new Error('SESSION_REQUIRED');
  if (!ready || ready.pageKind !== 'actions') throw new Error('Business action page did not load.');
}

async function inspectOneCandidate(tabId, payload, candidateIndex, phone, exactCount) {
  await openCandidateAndWait(tabId, payload.name, candidateIndex);

  let terminalEvidence = { terminalIdMatched: false, serialMatched: false };
  if (exactCount > 1 && (payload.terminalId || payload.terminalSerial)) {
    try {
      const openedTerminal = await sendToTab(tabId, { type: 'OPEN_ACTION', label: 'Business Terminal' });
      if (openedTerminal?.ok) {
        await sleep(800);
        const evidence = await sendToTab(tabId, {
          type: 'INSPECT_TERMINAL',
          terminalId: payload.terminalId,
          terminalSerial: payload.terminalSerial
        });
        if (evidence?.evidence) terminalEvidence = evidence.evidence;
        await tabsGoBack(tabId);
        const back = await waitForContent(tabId, (x) => ['actions', 'login'].includes(x.pageKind), 10000);
        if (back?.pageKind === 'login') throw new Error('SESSION_REQUIRED');
      }
    } catch (error) {
      if (error?.message === 'SESSION_REQUIRED') throw error;
    }
  }

  const openedDetail = await sendToTab(tabId, { type: 'OPEN_ACTION', label: 'Business Detail' });
  if (!openedDetail?.ok) throw new Error(openedDetail?.error || 'Business Detail action was not found.');
  const detailReady = await waitForContent(tabId, (x) => ['business_detail', 'login'].includes(x.pageKind), 12000);
  if (detailReady?.pageKind === 'login') throw new Error('SESSION_REQUIRED');
  if (!detailReady || detailReady.pageKind !== 'business_detail') throw new Error('Business Detail page did not load.');

  const pos = await sendToTab(tabId, { type: 'EXTRACT_POS' });
  if (pos?.status === 'SESSION_REQUIRED') throw new Error('SESSION_REQUIRED');
  const posAccounts = Array.from(new Set((pos?.posAccounts || []).map(core.normalizeAccountNumber).filter(Boolean)));
  return { candidateIndex, phone, posAccounts, terminalEvidence };
}

async function lookupBusiness(payload) {
  const tab = await ensureCrmTab(false);
  const page = await ensureBusinessesPage(tab.id);
  if (page.status !== 'OK') return { status: page.status, tabId: tab.id };

  const search = await sendToTab(tab.id, { type: 'SEARCH_EXACT', name: payload.name });
  if (search?.status === 'SESSION_REQUIRED') return { status: 'SESSION_REQUIRED', tabId: tab.id };
  if (search?.status === 'NOT_FOUND' || !search?.exactCount) {
    return { status: 'NOT_FOUND', reason: 'No exact name-order match was found in MonieCRM.' };
  }
  if (search?.status !== 'OK') return { status: 'ERROR', reason: search?.error || 'Could not search MonieCRM.' };

  const inspected = [];
  for (let i = 0; i < search.exactCount; i += 1) {
    if (i > 0) {
      await restoreBusinesses(tab.id);
      const rerun = await sendToTab(tab.id, { type: 'SEARCH_EXACT', name: payload.name });
      if (rerun?.status !== 'OK' || rerun.exactCount <= i) continue;
      search.candidates = rerun.candidates;
    }
    try {
      const phone = search.candidates?.[i]?.phone || '';
      inspected.push(await inspectOneCandidate(tab.id, payload, i, phone, search.exactCount));
    } catch (error) {
      if (error?.message === 'SESSION_REQUIRED') return { status: 'SESSION_REQUIRED', tabId: tab.id };
      inspected.push({ candidateIndex: i, phone: search.candidates?.[i]?.phone || '', posAccounts: [], error: error?.message || String(error) });
    }
  }

  const selected = core.chooseCandidate(inspected, payload.terminalId, payload.terminalSerial);
  return { ...selected, exactCount: search.exactCount, inspectedCount: inspected.length };
}

const actionApi = chrome.action || chrome.browserAction;
if (actionApi?.onClicked) {
  actionApi.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL('workspace.html');
    const tabs = (await tabsQuery({}).catch(() => [])).filter((tab) => tab.url === url || tab.url?.startsWith(`${url}?`) || tab.url?.startsWith(`${url}#`));
    if (tabs[0]) await tabsUpdate(tabs[0].id, { active: true });
    else await tabsCreate({ url, active: true });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'OPEN_CRM') {
        const tab = await ensureCrmTab(true);
        sendResponse({ ok: true, tabId: tab.id });
        return;
      }
      if (message?.type === 'LOOKUP_BUSINESS') {
        sendResponse(await lookupBusiness(message.payload || {}));
        return;
      }
      sendResponse({ ok: false, error: 'Unknown background message.' });
    } catch (error) {
      sendResponse({ status: 'ERROR', reason: error?.message || String(error) });
    }
  })();
  return true;
});
