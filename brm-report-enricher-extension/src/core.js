(function (root) {
  'use strict';

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function sameExactName(a, b) {
    return normalizeName(a) === normalizeName(b);
  }

  function normalizeAccountNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return /^\d{10}$/.test(digits) ? digits : '';
  }

  function normalizePhone(value) {
    const raw = String(value || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (/^0[789]\d{9}$/.test(digits)) return digits;
    if (/^234[789]\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
    return raw;
  }

  function terminalScore(candidate, terminalId, terminalSerial) {
    const targetId = normalizeName(terminalId).replace(/\s/g, '');
    const targetSerial = normalizeName(terminalSerial).replace(/\s/g, '');
    const evidence = candidate && candidate.terminalEvidence ? candidate.terminalEvidence : {};
    let score = 0;
    if (targetId && evidence.terminalIdMatched) score += 2;
    if (targetSerial && evidence.serialMatched) score += 4;
    return score;
  }

  /**
   * Selection rules:
   * 1. Exact-name candidates only are passed in.
   * 2. Wallet-only candidates are ignored because posAccounts will be empty.
   * 3. A single POS-bearing candidate wins.
   * 4. If multiple POS-bearing candidates exist, terminal evidence resolves only a unique best match.
   * 5. Never guess when multiple POS-bearing candidates remain tied.
   */
  function chooseCandidate(candidates, terminalId, terminalSerial) {
    const usable = (candidates || []).filter((c) => Array.isArray(c.posAccounts) && c.posAccounts.length > 0);
    if (usable.length === 0) {
      return { status: 'NO_POS', reason: 'No exact-name record with a POS account was found.' };
    }

    const singlePos = usable.filter((c) => c.posAccounts.length === 1);
    const multiPos = usable.filter((c) => c.posAccounts.length > 1);

    if (singlePos.length === 0 && multiPos.length > 0) {
      return { status: 'AMBIGUOUS', reason: 'The matching business record contains multiple POS account numbers.' };
    }

    if (singlePos.length === 1 && usable.length === 1) {
      const chosen = singlePos[0];
      return {
        status: 'MATCHED',
        posAccount: chosen.posAccounts[0],
        phone: normalizePhone(chosen.phone),
        candidateIndex: chosen.candidateIndex
      };
    }

    const scored = singlePos.map((candidate) => ({
      candidate,
      score: terminalScore(candidate, terminalId, terminalSerial)
    }));
    const maxScore = Math.max(0, ...scored.map((x) => x.score));
    if (maxScore > 0) {
      const winners = scored.filter((x) => x.score === maxScore);
      if (winners.length === 1) {
        const chosen = winners[0].candidate;
        return {
          status: 'MATCHED',
          posAccount: chosen.posAccounts[0],
          phone: normalizePhone(chosen.phone),
          candidateIndex: chosen.candidateIndex,
          verifiedByTerminal: true
        };
      }
    }

    return {
      status: 'AMBIGUOUS',
      reason: 'More than one exact-name record has a POS account and terminal evidence did not uniquely resolve them.'
    };
  }

  function makeGroupKey(name, terminalId, terminalSerial) {
    const n = normalizeName(name);
    const tid = normalizeName(terminalId).replace(/\s/g, '');
    const serial = normalizeName(terminalSerial).replace(/\s/g, '');
    if (serial || tid) return `${n}|${serial || tid}`;
    return `${n}|NO_TERMINAL`;
  }

  root.BRMCore = {
    normalizeName,
    sameExactName,
    normalizeAccountNumber,
    normalizePhone,
    chooseCandidate,
    makeGroupKey
  };
})(globalThis);
