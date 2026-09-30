/** Coordinates note-scoped learning views and their lazy generation. */
export function mountLearningWorkspace({document = globalThis.document, byId, getEditor, generation, quiz, flashcards, beforeOpen = async () => {}}) {
  const tabs = [...document.querySelectorAll('#learning-tabs [data-learning-view]')];
  const views = {
    summary: byId('learning-summary-view'),
    infographic: byId('learning-infographic-view'),
    quiz: byId('learning-quiz-view'),
    flashcards: byId('learning-flashcards-view')
  };
  const openers = {
    summary: () => generation.openSummary(),
    infographic: () => generation.openInfographic(),
    quiz: () => quiz.openForNote(),
    flashcards: ({dueOnly = false} = {}) => dueOnly ? flashcards.openDueForNote() : flashcards.openForNote()
  };
  const panel = byId('learning-panel');
  const message = byId('learning-message');
  let activeView = 'summary';
  let lastOpened = '';
  let sequence = 0;
  const pending = new Map();
  const preparations = new Map();

  async function prepareForNote(noteId = getEditor()?.id) {
    const editor = getEditor();
    if (!noteId || !editor?.id || editor.id !== noteId) return null;
    const key = `${noteId}:${editor.version || 0}`;
    if (preparations.has(key)) return preparations.get(key);
    const task = Promise.resolve().then(() => beforeOpen(noteId)).then(async () => {
      if (getEditor()?.id !== noteId) return null;
      const results = await Promise.allSettled([
        (async () => { await generation.openSummary(); return generation.openInfographic(); })(),
        quiz.ensureForNote(),
        flashcards.ensureForNote()
      ]);
      return results;
    }).finally(() => preparations.delete(key));
    preparations.set(key, task);
    return task;
  }

  async function show(view = activeView, {force = false, dueOnly = false} = {}) {
    activeView = Object.hasOwn(views, view) ? view : 'infographic';
    tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.learningView === activeView)));
    Object.entries(views).forEach(([name, node]) => { if (node) node.hidden = name !== activeView; });
    const editor = getEditor();
    if (!editor?.id) {
      message.textContent = '저장된 노트를 열면 요약·인포그래픽·퀴즈·플래시카드가 준비됩니다.';
      return;
    }
    message.textContent = '';
    const key = `${activeView}:${editor.id}:${editor.version || 0}${dueOnly ? ':due' : ''}`;
    const noteId = editor.id;
    const open = openers[activeView];
    if (!force && lastOpened === key) return;
    if (pending.has(key)) return pending.get(key);
    const currentSequence = ++sequence;
    message.textContent = '현재 노트의 학습 자료를 불러오고 있습니다.';
    const request = Promise.resolve().then(() => prepareForNote(noteId)).then(() => {
      if (getEditor()?.id !== noteId || currentSequence !== sequence) return false;
      return open({dueOnly});
    }).then(result => {
      if (currentSequence === sequence) {
        if (result !== false && result !== null) lastOpened = key;
        message.textContent = '';
      }
    }).catch(error => {
      if (currentSequence === sequence) message.textContent = error.message || '학습 자료를 불러오지 못했습니다.';
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  tabs.forEach(tab => tab.addEventListener('click', () => show(tab.dataset.learningView)));
  document.addEventListener('studyspace:tool-selected', event => {
    if (event.detail?.id === 'learning-panel') show(event.detail.view || activeView, {dueOnly:event.detail.dueOnly});
  });
  document.addEventListener('studyspace:note-opened', () => {
    const noteId = getEditor()?.id;
    if (noteId) prepareForNote(noteId).catch(error => { if (getEditor()?.id === noteId) message.textContent = error.message || '노트 학습 자료를 준비하지 못했습니다.'; });
    if (panel.dataset.activeTool === 'learning-panel') {
      lastOpened = '';
      show(activeView, {force: true});
    }
  });
  document.addEventListener('studyspace:learning-refresh', () => {
    lastOpened = '';
    if (panel.dataset.activeTool === 'learning-panel') show(activeView, {force: true});
  });
  return {
    show,
    prepareForNote,
    resetForNote() { sequence++; lastOpened = ''; message.textContent = ''; },
    get activeView() { return activeView; }
  };
}
