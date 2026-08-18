# BRM Report Enricher Extension

A private WebExtension for enriching the full Business Relationship Manager Daily Report PDF with two additional columns: **POS Account No.** and **Phone No.**

## Core rules

- Exact owner/business-name order is preserved. Name permutations are different records.
- Only capitalization, Unicode normalization and repeated whitespace are normalized.
- When identical names return multiple MonieCRM records, wallet-only records are ignored.
- A record with a POS account is preferred over an exact-name wallet-only record.
- If more than one exact-name record has a POS account, the report Terminal ID/Serial is used as secondary verification when available.
- If ambiguity remains, the extension writes `REVIEW` instead of guessing.
- The active MonieCRM browser session is used; no Moniepoint password is stored by the extension.
- PDF parsing and PDF generation happen locally in the browser. No report or contact data is sent to an external processing server.

## Targets

`npm run build` creates:

- `dist/chromium` — Manifest V3 for desktop Chromium-family browsers and Android browsers that support compatible Chromium extensions.
- `dist/firefox` — Manifest V2 build for Firefox desktop/Android compatibility. Stable Firefox requires Mozilla signing for permanent installation.

## Build

```bash
npm install
npm test
npm run build
```
