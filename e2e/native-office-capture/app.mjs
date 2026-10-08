import { capturePaste, serializeCaptureBundle } from './capture.mjs';

const form = document.querySelector('#metadata');
const capture = document.querySelector('#capture');
const cancel = document.querySelector('#cancel');
const download = document.querySelector('#download');
const clear = document.querySelector('#clear');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
let current;
let active;
let generation = 0;
let downloadTimer;
const downloadURLs = new Set();

function metadata() {
  const data = new FormData(form);
  return {
    os: data.get('os'), application: data.get('application'), browser: data.get('browser'),
    scenario: data.get('scenario'), fixtureId: data.get('fixtureId'), fixtureSha256: data.get('fixtureSha256'),
    copyMethod: data.get('copyMethod'), syntheticSourceConfirmed: data.get('syntheticSourceConfirmed') === 'on',
  };
}
function revokeDownloads() {
  clearTimeout(downloadTimer);
  for (const url of downloadURLs) URL.revokeObjectURL(url);
  downloadURLs.clear();
}
function reset() {
  generation++;
  active?.abort();
  active = undefined;
  current = undefined;
  download.disabled = true;
  cancel.disabled = true;
  capture.disabled = !form.checkValidity();
  preview.textContent = '';
  status.textContent = 'No capture. Cleared evidence is no longer available for download.';
  revokeDownloads();
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  reset();
  capture.disabled = false;
  capture.focus();
  status.textContent = 'Ready. Copy from the synthetic source document, then paste once in the capture area.';
});
capture.addEventListener('paste', event => {
  event.preventDefault();
  if (active || !form.reportValidity()) return;
  const operation = ++generation;
  const controller = new AbortController();
  active = controller;
  current = undefined;
  download.disabled = true;
  cancel.disabled = false;
  revokeDownloads();
  status.textContent = 'Reading available clipboard evidence. No content is being inserted.';
  preview.textContent = '';
  // capturePaste snapshots the event synchronously before returning this promise.
  void capturePaste(event, metadata(), { signal: controller.signal }).then(result => {
    if (operation !== generation) return;
    active = undefined;
    cancel.disabled = true;
    current = result;
    download.disabled = false;
    status.textContent = result.status === 'complete'
      ? 'Capture complete within the declared extraction scope. Source qualification remains false.'
      : 'Capture incomplete. The download contains diagnostics only and cannot qualify a source profile.';
    preview.textContent = JSON.stringify({
      status: result.status, provenance: result.provenance, qualification: result.qualification,
      diagnostics: result.diagnostics, availableFormats: result.payload?.availableFormats,
      excludedFormats: result.payload?.omittedFormats, totals: result.payload?.totals,
      items: result.payload?.items.map(item => ({
        itemIndex: item.itemIndex, kind: item.kind, type: item.type,
        file: item.file ? { type: item.file.type, size: item.file.size } : null,
      })),
      files: result.payload?.files.map(file => ({ itemIndex: file.itemIndex, byteLength: file.byteLength, sha256: file.sha256 })),
    }, null, 2);
  });
});
cancel.addEventListener('click', () => { active?.abort(); });
clear.addEventListener('click', reset);
download.addEventListener('click', () => {
  if (!current) return;
  try {
    revokeDownloads();
    const json = serializeCaptureBundle(current);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    downloadURLs.add(url);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `office-clipboard-${current.capturedAt.replaceAll(':', '-')}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    downloadTimer = setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 1000);
  } catch {
    status.textContent = 'Download could not be prepared within the configured limits.';
  }
});
window.addEventListener('pagehide', () => { generation++; active?.abort(); current = undefined; revokeDownloads(); });
