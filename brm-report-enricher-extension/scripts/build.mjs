import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

const commonFiles = ['core.js','background.js','content.js','workspace.html','workspace.css','workspace.js'];

function copyDir(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const s = path.join(source, entry.name), d = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function buildTarget(target) {
  const out = path.join(dist, target);
  fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
  commonFiles.forEach((file) => fs.copyFileSync(path.join(src, file), path.join(out, file)));
  fs.copyFileSync(path.join(root, 'node_modules/pdf-lib/dist/pdf-lib.min.js'), path.join(out, 'vendor/pdf-lib.min.js'));
  fs.copyFileSync(path.join(root, 'node_modules/pdfjs-dist/build/pdf.mjs'), path.join(out, 'vendor/pdf.mjs'));
  fs.copyFileSync(path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.mjs'), path.join(out, 'vendor/pdf.worker.mjs'));
  copyDir(path.join(root, 'node_modules/pdfjs-dist/cmaps'), path.join(out, 'vendor/cmaps'));
  copyDir(path.join(root, 'node_modules/pdfjs-dist/standard_fonts'), path.join(out, 'vendor/standard_fonts'));
  copyDir(path.join(root, 'node_modules/pdfjs-dist/wasm'), path.join(out, 'vendor/wasm'));

  const base = {
    name: 'BRM Report Enricher', version: '0.1.0',
    description: 'Enriches BRM Daily Report PDFs with POS account numbers and business-owner phone numbers using the active MonieCRM session.',
    content_scripts: [{ matches: ['https://console.teamapt.com/*'], js: ['core.js','content.js'], run_at: 'document_idle' }]
  };

  const manifest = target === 'chromium' ? {
    ...base,
    manifest_version: 3,
    permissions: ['storage','tabs'],
    host_permissions: ['https://console.teamapt.com/*'],
    background: { service_worker: 'background.js' },
    action: { default_title: 'BRM Report Enricher' },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" }
  } : {
    ...base,
    manifest_version: 2,
    permissions: ['storage','tabs','https://console.teamapt.com/*'],
    background: { scripts: ['core.js','background.js'], persistent: false },
    browser_action: { default_title: 'BRM Report Enricher' },
    content_security_policy: "script-src 'self'; object-src 'self'",
    browser_specific_settings: {
      gecko: { id: 'brm-report-enricher@local', strict_min_version: '121.0' },
      gecko_android: { strict_min_version: '121.0' }
    }
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

buildTarget('chromium');
buildTarget('firefox');
console.log('Built Chromium and Firefox extension directories.');
