/** Owns persisted AI artifacts, polling, and note-version checks. */
export function mountGeneration({request, byId, getEditor, getAttachmentIds, render, matchesAiMode = () => true}) {
  const el = byId;
  let version = 0;
  let timer = null;
  let rows = [];
  let loadedNoteId = '';
  const startingKeys = new Set();
  const coverageRefreshKeys = new Set();
  const sameSources = row => {
    const current = [...getAttachmentIds()].sort();
    if (Array.isArray(row?.sourceAttachmentIds)) {
      const saved = [...row.sourceAttachmentIds].sort();
      return current.length === saved.length && current.every((id,index) => id === saved[index]);
    }
    return Number(row?.attachmentCount || 0) === current.length;
  };
  const summaryNeedsCoverageRefresh = (content, editor) => {
    const sourceLength = String(editor?.body || '').replace(/<!--[\\s\\S]*?-->/g, '').replace(/^---[\\s\\S]*?---\\s*/m, '').trim().length;
    const summaryLength = String(content || '').replace(/[#>*_`\\-]/g, '').trim().length;
    return sourceLength >= 1800 && summaryLength < Math.max(700, sourceLength * 0.24);
  };
  const needsSummaryRefresh = content => {
    const text = String(content || '');
    const listItems = text.match(/^\s*(?:[-*+]|\d+[.)])\s+/gm) || [];
    return /(?:원문 미리보기|원문 내용의 흐름|실제 생성 전 확인|핵심 개념 · 내용|개발용 미리보기)/i.test(text) || listItems.length >= 3;
  };

  async function load(noteId) {
    clearTimeout(timer);
    const requestVersion = ++version;
    const generateButton = el('generate-infographic');
    if (generateButton) generateButton.disabled = !noteId;
    const summaryButton = el('generate-summary');
    if (summaryButton) summaryButton.disabled = !noteId;
    if (!noteId) {
      rows = [];
      loadedNoteId = '';
      el('generation-message').textContent = '노트를 저장하면 인포그래픽을 만들 수 있습니다.';
      if (el('summary-message')) el('summary-message').textContent = '노트를 저장하면 요약을 준비할 수 있습니다.';
      render(rows);
      return rows;
    }
    const result = await request(`/api/notes/${encodeURIComponent(noteId)}/generations`);
    if (requestVersion !== version) return rows;
    loadedNoteId = noteId;
    rows = result;
    render(rows);
    const latestSummary = rows.find(row => row.kind === 'SUMMARY' && row.sourceNoteVersion === getEditor().version && sameSources(row) && matchesAiMode(row));
    const summaryMessage = el('summary-message');
    if (summaryMessage) {
      if (latestSummary?.status === 'PENDING' || latestSummary?.status === 'RUNNING') summaryMessage.textContent = '현재 노트 내용을 글로 요약하고 있습니다.';
      else if (latestSummary?.status === 'FAILED') summaryMessage.textContent = '요약을 만들지 못했습니다. 다시 생성해 주세요.';
      else summaryMessage.textContent = '';
    }
    const latestInfographic = rows.find(row => row.kind === 'INFOGRAPHIC' && row.sourceNoteVersion === getEditor().version && sameSources(row));
    if (latestInfographic?.status === 'PENDING' || latestInfographic?.status === 'RUNNING') {
      el('generation-message').textContent = '현재 노트의 인포그래픽을 만들고 있습니다.';
    } else if (latestInfographic?.status === 'FAILED') {
      el('generation-message').textContent = '인포그래픽을 만들지 못했습니다. 다시 생성해 주세요.';
    } else if (!latestInfographic) {
      el('generation-message').textContent = '';
    }
    if (result.some(row => row.status === 'PENDING' || row.status === 'RUNNING')) {
      timer = setTimeout(() => load(noteId).catch(error => { el('generation-message').textContent = error.message; }), 1500);
    }
    return rows;
  }

  async function start(kind, regenerateFromJobId = null, attachmentIds = getAttachmentIds()) {
    const editor = getEditor();
    if (!editor.id) return false;
    const noteId = editor.id;
    const button = kind === 'INFOGRAPHIC' ? el('generate-infographic') : kind === 'SUMMARY' ? el('generate-summary') : null;
    const message = kind === 'SUMMARY' ? el('summary-message') : el('generation-message');
    if (button) button.disabled = true;
    try {
      await request(`/api/notes/${encodeURIComponent(editor.id)}/generations`, {
        method: 'POST',
        body: JSON.stringify({kind, requestId: crypto.randomUUID(), attachmentIds, regenerateFromJobId})
      });
      if (getEditor().id === noteId) await load(noteId);
      return true;
    } catch (error) {
      if (getEditor().id === noteId) message.textContent = error.message;
      return false;
    } finally {
      if (button && getEditor().id) button.disabled = false;
    }
  }

  async function openInfographic() {
    const editor = getEditor();
    if (!editor?.id) {
      el('generation-message').textContent = '저장된 노트를 열면 인포그래픽을 준비할 수 있습니다.';
      return false;
    }
    const noteId = editor.id;
    if (loadedNoteId !== noteId) await load(noteId);
    if (getEditor().id !== noteId) return false;
    const existing = rows.find(row => row.kind === 'INFOGRAPHIC' && row.sourceNoteVersion === editor.version && sameSources(row) && matchesAiMode(row));
    if (existing?.status === 'COMPLETED' && existing.content) {
      el('generation-message').textContent = '';
      return true;
    }
    if (existing?.status === 'PENDING' || existing?.status === 'RUNNING') {
      el('generation-message').textContent = '현재 노트의 인포그래픽을 만들고 있습니다.';
      return true;
    }
    if (existing?.status === 'FAILED') {
      el('generation-message').textContent = '인포그래픽을 만들지 못했습니다. 다시 생성해 주세요.';
      return false;
    }
    const key = `INFOGRAPHIC:${editor.id}:${editor.version}`;
    if (startingKeys.has(key)) return true;
    startingKeys.add(key);
    el('generation-message').textContent = '현재 노트와 분석 완료 자료를 바탕으로 인포그래픽을 만들고 있습니다.';
    try { return await start('INFOGRAPHIC'); }
    finally { startingKeys.delete(key); }
  }

  async function openSummary() {
    const editor = getEditor();
    const message = el('summary-message');
    if (!editor?.id) {
      message.textContent = '저장된 노트를 열면 요약을 준비할 수 있습니다.';
      return false;
    }
    const noteId = editor.id;
    if (loadedNoteId !== noteId) await load(noteId);
    if (getEditor().id !== noteId) return false;
    const existing = rows.find(row => row.kind === 'SUMMARY' && row.sourceNoteVersion === editor.version && sameSources(row) && matchesAiMode(row));
    if (existing?.status === 'COMPLETED' && existing.content && !needsSummaryRefresh(existing.content)) {
      const refreshKey = `SUMMARY:${editor.id}:${editor.version}`;
      if (summaryNeedsCoverageRefresh(existing.content, editor) && !coverageRefreshKeys.has(refreshKey)) {
        coverageRefreshKeys.add(refreshKey);
        message.textContent = '긴 노트의 주요 내용을 더 충실히 담도록 요약을 보완하고 있습니다.';
        const started = await start('SUMMARY', existing.id);
        if (!started) coverageRefreshKeys.delete(refreshKey);
        return started;
      }
      message.textContent = '';
      return true;
    }
    if (existing?.status === 'PENDING' || existing?.status === 'RUNNING') { message.textContent = '현재 노트 내용을 글로 요약하고 있습니다.'; return true; }
    if (existing?.status === 'FAILED') { message.textContent = '요약을 만들지 못했습니다. 다시 생성해 주세요.'; return false; }
    const key = `SUMMARY:${editor.id}:${editor.version}`;
    if (startingKeys.has(key)) return true;
    startingKeys.add(key);
    message.textContent = '현재 노트와 분석 완료 자료를 바탕으로 요약을 만들고 있습니다.';
    try { return await start('SUMMARY'); }
    finally { startingKeys.delete(key); }
  }

  const generateButton = el('generate-infographic');
  if (generateButton) generateButton.onclick = () => {
    generateButton.disabled = true;
    start('INFOGRAPHIC').finally(() => { if (getEditor().id) generateButton.disabled = false; });
  };
  const summaryButton = el('generate-summary');
  if (summaryButton) summaryButton.onclick = () => {
    summaryButton.disabled = true;
    start('SUMMARY').finally(() => { if (getEditor().id) summaryButton.disabled = false; });
  };

  return {
    load,
    start,
    openSummary,
    openInfographic,
    get rows() { return rows; },
    resetForNote() {
      clearTimeout(timer);
      rows = [];
      loadedNoteId = '';
      el('generation-message').textContent = '';
      render(rows);
    },
    pausePolling() { clearTimeout(timer); }
  };
}
