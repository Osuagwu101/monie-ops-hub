(function () {
  'use strict';

  const core = globalThis.BRMCore;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function ownText(el) {
    if (!el) return '';
    let text = '';
    for (const node of el.childNodes || []) {
      if (node.nodeType === Node.TEXT_NODE) text += ` ${node.textContent || ''}`;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function bodyText() {
    return (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function isLoginPage() {
    if (document.querySelector('input[type="password"]')) return true;
    const text = core.normalizeName(bodyText());
    return text.includes('FORGOT PASSWORD') && (text.includes('SIGN IN') || text.includes('LOGIN'));
  }

  function pageKind() {
    if (isLoginPage()) return 'login';
    const search = document.querySelector('input[placeholder*="Search Term" i]');
    const text = core.normalizeName(bodyText());
    if (search && text.includes('BUSINESSES')) return 'businesses';
    if (text.includes('ACCOUNT DETAILS') && text.includes('ACCOUNT NUMBER')) return 'business_detail';
    if (text.includes('ACTIONS') && text.includes('BUSINESS DETAIL')) return 'actions';
    if (text.includes('BUSINESS TERMINAL')) return 'business_terminal';
    return 'unknown';
  }

  function smallestExactTextElements(target) {
    const wanted = core.normalizeName(target);
    const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div,a,button,strong,b'));
    return all.filter((el) => {
      const text = core.normalizeName(el.textContent || '');
      if (text !== wanted) return false;
      return !Array.from(el.children || []).some((child) => core.normalizeName(child.textContent || '') === wanted);
    });
  }

  function findClickableText(target) {
    const matches = smallestExactTextElements(target);
    for (const el of matches) {
      if (el.matches('a,button,[role="button"]')) return el;
      const clickable = el.closest('a,button,[role="button"]');
      if (clickable) return clickable;
    }
    return matches[0] || null;
  }

  function clickElement(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.click();
    return true;
  }

  function nativeSetInputValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fieldValueNearLabel(root, label, matcher) {
    const wanted = core.normalizeName(label);
    const elements = Array.from(root.querySelectorAll('*'));
    for (const el of elements) {
      const txt = core.normalizeName(ownText(el) || el.textContent || '');
      if (txt !== wanted) continue;
      const areas = [el.parentElement, el.nextElementSibling, el.parentElement?.parentElement].filter(Boolean);
      for (const area of areas) {
        const text = (area.innerText || area.textContent || '').replace(/\s+/g, ' ');
        const found = matcher(text);
        if (found) return found;
      }
    }
    return '';
  }

  function findBusinessCards(name) {
    const target = core.normalizeName(name);
    const exactNameNodes = smallestExactTextElements(name);
    const cards = [];
    const seen = new Set();

    for (const node of exactNameNodes) {
      let cur = node;
      let chosen = null;
      for (let depth = 0; cur && depth < 9; depth += 1, cur = cur.parentElement) {
        const text = core.normalizeName(cur.innerText || cur.textContent || '');
        if (text.includes('BUSINESS TYPE') && text.includes('PHONE NUMBER') && text.includes(target)) {
          chosen = cur;
          break;
        }
      }
      if (!chosen || seen.has(chosen)) continue;
      seen.add(chosen);

      let phone = fieldValueNearLabel(chosen, 'Phone Number', (text) => {
        const match = text.match(/(?:\+?234|0)[789]\d{9}/);
        return match ? match[0] : '';
      });
      if (!phone) {
        const match = (chosen.innerText || '').match(/(?:\+?234|0)[789]\d{9}/);
        phone = match ? match[0] : '';
      }

      const rect = chosen.getBoundingClientRect();
      cards.push({ node, card: chosen, phone: core.normalizePhone(phone), top: rect.top });
    }

    cards.sort((a, b) => a.top - b.top);
    return cards;
  }

  async function waitUntil(predicate, timeout = 15000, interval = 250) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  async function searchExact(name) {
    if (isLoginPage()) return { status: 'SESSION_REQUIRED' };
    const input = document.querySelector('input[placeholder*="Search Term" i]');
    if (!input) return { status: 'NOT_ON_BUSINESSES' };

    nativeSetInputValue(input, name);
    await sleep(100);

    let clicked = false;
    const form = input.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      try { form.requestSubmit(); clicked = true; } catch (_) {}
    }
    if (!clicked) {
      let scope = input.parentElement;
      for (let depth = 0; scope && depth < 4 && !clicked; depth += 1, scope = scope.parentElement) {
        const buttons = Array.from(scope.querySelectorAll('button,[role="button"]'));
        const candidate = buttons.find((b) => b !== input && !b.disabled);
        if (candidate) clicked = clickElement(candidate);
      }
    }
    if (!clicked) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }

    await sleep(500);
    await waitUntil(() => {
      const cards = findBusinessCards(name);
      if (cards.length) return true;
      const text = core.normalizeName(bodyText());
      return text.includes('NO AGENT FOUND') || text.includes('NO BUSINESS FOUND') || text.includes('NO RECORD') || text.includes('NO RESULT');
    }, 15000, 300);

    const exact = findBusinessCards(name);
    if (!exact.length) return { status: 'NOT_FOUND', exactCount: 0, candidates: [] };
    return {
      status: 'OK',
      exactCount: exact.length,
      candidates: exact.map((c, index) => ({ candidateIndex: index, phone: c.phone }))
    };
  }

  async function openCandidate(name, index) {
    const cards = findBusinessCards(name);
    const target = cards[index];
    if (!target) return { ok: false, error: 'Candidate no longer exists on the search page.' };
    const link = target.node.closest('a') || target.card.querySelector('a,button,[role="button"]') || target.node;
    return { ok: clickElement(link) };
  }

  async function openAction(label) {
    const el = findClickableText(label);
    if (!el) return { ok: false, error: `${label} action was not found.` };
    return { ok: clickElement(el) };
  }

  async function extractPosAccounts() {
    if (isLoginPage()) return { status: 'SESSION_REQUIRED', posAccounts: [] };

    const placeholder = document.querySelector('input[placeholder*="Select Account Number" i]');
    if (placeholder) clickElement(placeholder);
    else {
      const dropdownText = smallestExactTextElements('Select Account Number')[0];
      if (dropdownText) clickElement(dropdownText.closest('[role="button"],button') || dropdownText);
    }
    await sleep(350);

    const pos = new Set();
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const text = ownText(el) || (el.children.length === 0 ? el.textContent || '' : '');
      const digits = core.normalizeAccountNumber(text);
      if (!digits) continue;
      let cur = el;
      for (let depth = 0; cur && depth < 3; depth += 1, cur = cur.parentElement) {
        const rowText = core.normalizeName(cur.innerText || cur.textContent || '');
        if (rowText.includes('POS') && !rowText.includes('WALLET POS')) {
          pos.add(digits);
          break;
        }
        if (rowText.includes('WALLET') && !rowText.includes('POS')) break;
      }
    }

    if (!pos.size) {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const account = text.match(/Account Number\s*:?\s*(\d{10})/i)?.[1] || '';
      const accountName = text.match(/Account Name\s*:?\s*([^\n]{0,120})/i)?.[1] || '';
      if (account && /\bPOS\b/i.test(accountName)) pos.add(account);
    }

    return { status: 'OK', posAccounts: Array.from(pos) };
  }

  function inspectTerminal(terminalId, terminalSerial) {
    const text = core.normalizeName(bodyText()).replace(/\s/g, '');
    const tid = core.normalizeName(terminalId).replace(/\s/g, '');
    const serial = core.normalizeName(terminalSerial).replace(/\s/g, '');
    return {
      terminalIdMatched: Boolean(tid && text.includes(tid)),
      serialMatched: Boolean(serial && text.includes(serial))
    };
  }

  async function goToBusinesses() {
    if (pageKind() === 'businesses') return { ok: true, alreadyThere: true };
    if (isLoginPage()) return { ok: false, status: 'SESSION_REQUIRED' };

    let businesses = findClickableText('Businesses');
    if (businesses) return { ok: clickElement(businesses), navigating: true };

    let account = findClickableText('Account Management');
    if (!account) {
      const menuCandidates = Array.from(document.querySelectorAll('button,[role="button"],svg')).filter((el) => {
        const aria = core.normalizeName(el.getAttribute?.('aria-label') || '');
        return aria.includes('MENU') || aria.includes('NAVIGATION');
      });
      if (menuCandidates[0]) clickElement(menuCandidates[0].closest('button,[role="button"]') || menuCandidates[0]);
      await sleep(300);
      account = findClickableText('Account Management');
    }
    if (account) {
      clickElement(account);
      await sleep(450);
      businesses = findClickableText('Businesses');
      if (businesses) return { ok: clickElement(businesses), navigating: true };
    }

    return { ok: false, status: 'NEEDS_MANUAL_BUSINESSES_PAGE' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message?.type === 'HISTORY_BACK') {
          history.back();
          sendResponse({ ok: true });
          return;
        }
        switch (message?.type) {
          case 'PING': sendResponse({ ok: true, pageKind: pageKind(), url: location.href }); break;
          case 'GO_TO_BUSINESSES': sendResponse(await goToBusinesses()); break;
          case 'SEARCH_EXACT': sendResponse(await searchExact(message.name)); break;
          case 'OPEN_CANDIDATE': sendResponse(await openCandidate(message.name, message.index)); break;
          case 'OPEN_ACTION': sendResponse(await openAction(message.label)); break;
          case 'EXTRACT_POS': sendResponse(await extractPosAccounts()); break;
          case 'INSPECT_TERMINAL': sendResponse({ ok: true, evidence: inspectTerminal(message.terminalId, message.terminalSerial) }); break;
          default: sendResponse({ ok: false, error: 'Unknown content-script message.' });
        }
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  });
})();
