import {createPracticeListItem, renderPracticeList} from './practice-list.js';

/** Flashcard creation, study/review session, and deck/card management. */
export function mountFlashcards({request, byId, getCourse, getEditor, setLocked, emptyState, getAttachmentIds, matchesAiMode = () => true}) {
  const el = byId;
  let version = 0;
  let loadedDecks = [];
  const generatingNotes = new Set();
  let studySequence = 0;
  const sameSources = row => {
    const current = [...(getAttachmentIds?.() || [])].sort();
    const saved = Array.isArray(row?.sourceAttachmentIds) ? [...row.sourceAttachmentIds].sort() : [];
    return current.length === saved.length && current.every((id,index) => id === saved[index]);
  };

  function resetForContext() {
    studySequence++;
    const player = el('flashcard-player');
    player.classList.add('hidden');
    player.replaceChildren();
    el('flashcard-message').textContent = '';
  }

  function study(deck, shuffle = false, dueOnly = false) {
    const activeNoteId = getEditor()?.id;
    const deckNoteId = deck?.noteId || activeNoteId;
    if (!deckNoteId || activeNoteId !== deckNoteId) return;
    const sequence = ++studySequence;
    const noteId = deckNoteId;
    const player = el('flashcard-player');
    player.classList.remove('hidden');
    const now = Date.now();
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    let cards = [...deck.cards].filter(card => !dueOnly || !card.nextReview || new Date(card.nextReview).getTime() <= todayEnd.getTime());
    if (shuffle) {
      for (let index = cards.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [cards[index], cards[swap]] = [cards[swap], cards[index]];
      }
    }
    let index = 0, flipped = false;
    const render = () => {
      player.replaceChildren();
      if (index >= cards.length) {
        const done = document.createElement('div'); done.className = 'flashcard-complete';
        const title = document.createElement('h4'); title.textContent = dueOnly ? '오늘 복습을 마쳤어요' : '카드를 모두 확인했어요';
        const restart = document.createElement('button'); restart.type = 'button'; restart.className = 'primary'; restart.textContent = '다시 학습하기'; restart.onclick = () => study(deck, shuffle, dueOnly);
        done.append(title, restart); player.append(done); return;
      }
      const card = cards[index];
      const header = document.createElement('div'); header.className = 'flashcard-study-head';
      const count = document.createElement('span'); count.textContent = `${cards.length}장 중 ${index + 1}번째 카드`;
      const flip = document.createElement('button'); flip.type = 'button'; flip.className = 'quiet-button'; flip.textContent = flipped ? '앞면 보기' : '뒤집기';
      flip.onclick = () => { flipped = !flipped; render(); };
      header.append(count, flip); player.append(header);
      const face = document.createElement('button'); face.type = 'button';
      face.className = `flashcard-study-card${flipped ? ' answer' : ''}`;
      face.textContent = flipped ? card.back : card.front;
      face.setAttribute('aria-label', flipped ? '카드 앞면으로 뒤집기' : '카드 뒷면 보기');
      face.onclick = () => { flipped = !flipped; render(); };
      const meta = document.createElement('p'); meta.className = 'flashcard-meta';
      const provenance = [card.explanation, card.source].map(value => String(value || '').trim()).filter(Boolean);
      const uniqueProvenance = provenance.filter((value, position) => !provenance.some((other, otherPosition) => otherPosition !== position && other.length >= value.length + 6 && other.includes(value)));
      meta.textContent = flipped ? uniqueProvenance.join(' · ') : `${index + 1}/${cards.length} · 눌러서 답 보기`;
      player.append(face, meta);
      const pageActions = document.createElement('div'); pageActions.className = 'flashcard-page-actions';
      const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'secondary'; previous.textContent = '‹ 이전'; previous.disabled = index === 0;
      previous.onclick = () => { index--; flipped = false; render(); };
      const next = document.createElement('button'); next.type = 'button'; next.className = 'secondary'; next.textContent = '다음 ›'; next.disabled = index >= cards.length - 1;
      next.onclick = () => { index++; flipped = false; render(); };
      pageActions.append(previous, next); player.append(pageActions);
      if (!flipped) return;
      const actions = document.createElement('div'); actions.className = 'flashcard-review-actions';
      for (const [rating, label] of [['AGAIN', '다시 보기'], ['KNOWN', '알고 있음']]) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = rating === 'KNOWN' ? 'primary' : 'secondary'; button.textContent = label;
        button.onclick = async () => {
          button.disabled = true;
          try {
          await request(`/api/flashcards/${card.id}/reviews`, {method: 'POST', body: JSON.stringify({requestId: crypto.randomUUID(), rating})});
          if (sequence !== studySequence || getEditor()?.id !== noteId) return;
          index++; flipped = false; render();
          } catch (error) { el('flashcard-message').textContent = error.message; button.disabled = false; }
        };
        actions.append(button);
      }
      player.append(actions);
    };
    render();
  }

  async function loadDeck(deckId) {
    return request(`/api/flashcard-decks/${encodeURIComponent(deckId)}`);
  }

  async function manage(deck) {
    const player = el('flashcard-player');
    player.classList.remove('hidden'); player.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'recording-row-head';
    const title = document.createElement('strong'); title.textContent = `${deck.title} 카드 관리`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'quiet-button'; close.textContent = '닫기';
    close.onclick = () => player.classList.add('hidden'); heading.append(title, close); player.append(heading);
    const reload = async () => manage(await loadDeck(deck.id));
    for (const card of deck.cards) {
      const row = document.createElement('section'); row.className = 'flashcard-editor';
      const front = document.createElement('textarea'); front.rows = 2; front.maxLength = 1000; front.value = card.front; front.setAttribute('aria-label', '카드 앞면');
      const back = document.createElement('textarea'); back.rows = 3; back.maxLength = 4000; back.value = card.back; back.setAttribute('aria-label', '카드 뒷면');
      const explanation = document.createElement('textarea'); explanation.rows = 2; explanation.maxLength = 2000; explanation.value = card.explanation; explanation.setAttribute('aria-label', '카드 해설');
      const actions = document.createElement('div'); actions.className = 'generation-actions';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary'; save.textContent = '수정 저장';
      save.onclick = async () => {
        save.disabled = true;
        try {
          await request(`/api/flashcards/${encodeURIComponent(card.id)}`, {method: 'PATCH', body: JSON.stringify({front: front.value, back: back.value, explanation: explanation.value})});
          await reload(); el('flashcard-message').textContent = '카드를 수정했습니다.';
        } catch (error) { el('flashcard-message').textContent = error.message; save.disabled = false; }
      };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button'; remove.textContent = '카드 삭제';
      remove.onclick = async () => {
        if (!window.confirm('이 카드를 삭제할까요?')) return;
        try { await request(`/api/flashcards/${encodeURIComponent(card.id)}`, {method: 'DELETE'}); await reload(); await loadFlashcardDecks(getCourse()?.id); }
        catch (error) { el('flashcard-message').textContent = error.message; }
      };
      actions.append(save, remove); row.append(front, back, explanation, actions); player.append(row);
    }
    const add = document.createElement('button'); add.type = 'button'; add.className = 'primary'; add.textContent = '새 카드 추가';
    add.onclick = async () => {
      add.disabled = true;
      try {
        await request(`/api/flashcard-decks/${encodeURIComponent(deck.id)}/cards`, {method: 'POST', body: JSON.stringify({front: '새 질문', back: '새 답변', explanation: ''})});
        await reload(); await loadFlashcardDecks(getCourse()?.id);
      } catch (error) { el('flashcard-message').textContent = error.message; add.disabled = false; }
    };
    player.append(add);
  }

  function renderDecks(decks) {
    loadedDecks = decks;
    const noteId = getEditor()?.id;
    const noteDecks = decks.filter(deck => noteId && deck.noteId === noteId);
    renderPracticeList(el('flashcard-decks'), noteDecks, deck => {
      const fetchDeck = () => loadDeck(deck.id);
      const open = async (shuffle, dueOnly = false) => {
        const noteId = getEditor()?.id;
        try {
          const full = await fetchDeck();
          if (!noteId || getEditor()?.id !== noteId || full.noteId !== noteId) return;
          const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
          if (dueOnly && !full.cards.some(card => !card.nextReview || new Date(card.nextReview).getTime() <= todayEnd.getTime())) {
            el('flashcard-message').textContent = '오늘 복습할 카드가 없습니다.'; return;
          }
          study(full, shuffle, dueOnly);
        } catch (error) { el('flashcard-message').textContent = error.message; }
      };
      const makeButton = (label, style, action) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = style; button.textContent = label; button.onclick = action; return button;
      };
      const actions = [
        makeButton('학습하기', 'secondary', () => open(false)),
        makeButton('오늘 복습', 'quiet-button', () => open(false, true)),
        makeButton('섞기', 'quiet-button', () => open(true)),
        makeButton('카드 관리', 'quiet-button', async () => {
          try { await manage(await fetchDeck()); } catch (error) { el('flashcard-message').textContent = error.message; }
        })
      ];
      return createPracticeListItem({title: deck.title, metadata: `${deck.cardCount}장 · 노트 버전 ${deck.sourceNoteVersion}`, actions});
    }, noteId
      ? emptyState('이 노트에 저장된 플래시카드가 없습니다.', '현재 노트 내용에서 핵심 개념을 뽑아 카드를 만듭니다.')
      : emptyState('저장된 노트를 열어 주세요.', '플래시카드와 복습 기록은 노트별로 보관됩니다.'));
  }

  async function loadFlashcardDecks(courseId) {
    const requestVersion = ++version;
    setLocked(el('create-flashcards'), !getEditor().id, '노트를 저장한 뒤 플래시카드를 만들 수 있어요.');
    if (el('flashcard-count')) el('flashcard-count').disabled = !getEditor().id;
    if (!courseId) { el('flashcard-decks').textContent = '과목을 선택하면 플래시카드를 확인할 수 있습니다.'; return; }
    const decks = await request(`/api/courses/${encodeURIComponent(courseId)}/flashcard-decks`);
    if (requestVersion === version) { renderDecks(decks); return decks; }
    return loadedDecks;
  }

  async function createDeck({studyAfter = true} = {}) {
    const editor = getEditor(); if (!editor.id) return;
    const noteId = editor.id;
    if (generatingNotes.has(noteId)) return null;
    generatingNotes.add(noteId);
    const button = el('create-flashcards'); button.disabled = true;
    el('flashcard-message').textContent = '현재 노트와 자료로 플래시카드를 생성하고 있습니다.';
    const count = Number(el('flashcard-count')?.value) || 14;
    try {
      const deck = await request(`/api/notes/${encodeURIComponent(editor.id)}/flashcard-decks`, {
        method: 'POST',
        body: JSON.stringify({requestId: crypto.randomUUID(), cardCount: count, attachmentIds: getAttachmentIds()})
      });
      if (getEditor().id !== noteId) return deck;
      await loadFlashcardDecks(getCourse()?.id);
      if (getEditor().id !== noteId) return deck;
      byId('learning-mode-badge').textContent = deck.mockResult ? '모의 결과 저장됨' : 'AI 생성 결과 저장됨';
      el('flashcard-message').textContent = `${count}장 플래시카드를 저장했습니다.`;
      if (studyAfter) study(deck);
      return deck;
    } catch (error) { if (getEditor().id === noteId) el('flashcard-message').textContent = error.message; return null; }
    finally { generatingNotes.delete(noteId); button.disabled = !getEditor().id || generatingNotes.has(getEditor().id); }
  }

  el('create-flashcards').onclick = createDeck;
  document.addEventListener('studyspace:note-opened', resetForContext);
  document.addEventListener('studyspace:course-changing', resetForContext);

  async function ensureForNote() {
    const editor = getEditor(); const course = getCourse();
    if (!editor?.id || !course?.id) return null;
    const noteId = editor.id;
    const decks = await loadFlashcardDecks(course.id);
    if (getEditor()?.id !== noteId) return null;
    const existing = (decks || loadedDecks).find(deck => deck.noteId === noteId && deck.sourceNoteVersion === editor.version && sameSources(deck) && matchesAiMode(deck));
    return existing || createDeck({studyAfter: false});
  }

  async function openForNote({dueOnly = false} = {}) {
    const editor = getEditor(); const course = getCourse();
    if (!editor?.id || !course?.id) { el('flashcard-message').textContent = '저장된 노트를 열면 플래시카드를 준비할 수 있습니다.'; return null; }
    const noteId = editor.id;
    const decks = await loadFlashcardDecks(course.id);
    const noteDecks = (decks || loadedDecks).filter(deck => deck.noteId === editor.id);
    if (getEditor().id !== noteId) return null;
    const deckRow = noteDecks.find(deck => deck.sourceNoteVersion === editor.version && sameSources(deck) && matchesAiMode(deck));
    if (!deckRow) return createDeck();
    byId('learning-mode-badge').textContent = deckRow.mockResult ? '모의 결과 저장됨' : 'AI 생성 결과 저장됨';
    el('flashcard-message').textContent = '';
    const deck = await loadDeck(deckRow.id);
    if (getEditor().id !== noteId) return null;
    study(deck, false, dueOnly);
    return deck;
  }

  return {loadFlashcardDecks, openForNote, openDueForNote: () => openForNote({dueOnly: true}), createDeck, ensureForNote, resetForContext};
}
