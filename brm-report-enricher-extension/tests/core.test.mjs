import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(source, context);
const core = context.globalThis.BRMCore;

test('name order is strict', () => {
  assert.notEqual(core.normalizeName('Osuagwu Solomon Nnaemeka'), core.normalizeName('Nnaemeka Solomon Osuagwu'));
  assert.notEqual(core.normalizeName('Osuagwu Solomon Nnaemeka'), core.normalizeName('Solomon Nnaemeka Osuagwu'));
  assert.equal(core.normalizeName('  Osuagwu   Solomon Nnaemeka '), 'OSUAGWU SOLOMON NNAEMEKA');
});

test('wallet-only duplicate is ignored in favor of POS-bearing exact match', () => {
  const chosen = core.chooseCandidate([
    { candidateIndex: 0, phone: '08011111111', posAccounts: [] },
    { candidateIndex: 1, phone: '08011111111', posAccounts: ['5162702457'] }
  ], '', '');
  assert.equal(chosen.status, 'MATCHED');
  assert.equal(chosen.posAccount, '5162702457');
  assert.equal(chosen.candidateIndex, 1);
});

test('terminal serial resolves two exact-name POS-bearing records', () => {
  const chosen = core.chooseCandidate([
    { candidateIndex: 0, phone: '08011111111', posAccounts: ['5111111111'], terminalEvidence: { terminalIdMatched: false, serialMatched: false } },
    { candidateIndex: 1, phone: '08022222222', posAccounts: ['5222222222'], terminalEvidence: { terminalIdMatched: true, serialMatched: true } }
  ], '2TPTAZQ5', 'C59P008D06550425');
  assert.equal(chosen.status, 'MATCHED');
  assert.equal(chosen.posAccount, '5222222222');
  assert.equal(chosen.verifiedByTerminal, true);
});

test('multiple POS-bearing records remain ambiguous without unique verification', () => {
  const chosen = core.chooseCandidate([
    { candidateIndex: 0, phone: '08011111111', posAccounts: ['5111111111'] },
    { candidateIndex: 1, phone: '08011111111', posAccounts: ['5222222222'] }
  ], '', '');
  assert.equal(chosen.status, 'AMBIGUOUS');
});
