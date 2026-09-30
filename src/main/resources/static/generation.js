/** Owns persisted AI artifacts, polling, and note-version checks. */
export function mountGeneration({request, byId, getEditor, getAttachmentIds, render, matchesAiMode = () => true}) {
  const el = byId;
  let version = 0;
  let timer = null;
  let rows = [];
  let loadedNoteId = '';
  const startingKeys = new Set();

  async function load(noteId) {
    clearTimeout(timer);
    const requestVersion = ++version;
    const generateButton = el('generate-infographic');
    if (generateButton) generateButton.disabled = !noteId;
    if (!noteId) {
      rows = [];
      loadedNoteId = '';
      el('generation-message').textContent = '노트를 저장하면 인포그래픽을 만들 수 있습니다.';
      render(rows);
      return rows;
    }
    const result = await request(`/api/notes/${encodeURIComponent(noteId)}/generations`);
    if (requestVersion !== version) return rows;
    loadedNoteId = noteId;
    rows = result;
    render(rows);
    const latestInfographic = rows.find(row => row.kind === 'INFOGRAPHIC' && row.sourceNoteVersion === getEditor().version);
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
    const button = kind === 'INFOGRAPHIC' ? el('generate-infographic') : null;
    if (button) button.disabled = true;
    try {
      await request(`/api/notes/${encodeURIComponent(editor.id)}/generations`, {
        method: 'POST',
        body: JSON.stringify({kind, requestId: crypto.randomUUID(), attachmentIds, regenerateFromJobId})
      });
      if (getEditor().id === noteId) await load(noteId);
      return true;
    } catch (error) {
      if (getEditor().id === noteId) el('generation-message').textContent = error.message;
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
    const existing = rows.find(row => row.kind === 'INFOGRAPHIC' && row.sourceNoteVersion === editor.version && matchesAiMode(row));
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

  const generateButton = el('generate-infographic');
  if (generateButton) generateButton.onclick = () => {
    generateButton.disabled = true;
    start('INFOGRAPHIC').finally(() => { if (getEditor().id) generateButton.disabled = false; });
  };

  return {
    load,
    start,
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
