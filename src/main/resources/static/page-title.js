let baseTitle = null;
let timerTitle = null;

function applyTitle(targetDocument = globalThis.document) {
  if (!targetDocument) return;
  baseTitle ??= targetDocument.title;
  targetDocument.title = timerTitle || baseTitle;
}

export function setBaseTitle(title, targetDocument = globalThis.document) {
  baseTitle = title;
  applyTitle(targetDocument);
}

export function setTimerTitle(title) {
  baseTitle ??= globalThis.document?.title || '';
  timerTitle = title ? `${title} · ${baseTitle}` : null;
  applyTitle();
}
