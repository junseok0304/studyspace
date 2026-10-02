import {createPracticeListItem, renderPracticeList} from './practice-list.js';

/** Flashcard creation, study/review session, and deck/card management. */
export function mountFlashcards({request, byId, getCourse, getEditor, setLocked, emptyState, getAttachmentIds, matchesAiMode = () => true}) {
  const el = byId;
  const typeLabels = {DEFINITION: '정의', MECHANISM: '작동 원리', COMPARISON: '비교', CAUSE_EFFECT: '원인·결과', APPLICATION: '적용', PROCESS: '절차', CUSTOM: '직접 작성'};
  const typeOptions = Object.entries(typeLabels);
  const typeLabel = value => typeLabels[value] || typeLabels.CUSTOM;
  let version = 0;
  let loadedDecks = [];
  const generatingNotes = new Set();
  let studySequence = 0;
  let currentStudy = null;
  const sameSources = row => {
    const current = [...(getAttachmentIds?.() || [])].sort();
    const saved = Array.isArray(row?.sourceAttachmentIds) ? [...row.sourceAttachmentIds].sort() : [];
    return current.length === saved.length && current.every((id,index) => id === saved[index]);
  };

  function resetForContext() {
    studySequence++;
    currentStudy = null;
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
    currentStudy = {deckId: deck.id, noteId, dueOnly};
    const player = el('flashcard-player');
    player.classList.remove('hidden');
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    let cards = [...deck.cards].filter(card => !dueOnly || !card.nextReviewAt || new Date(card.nextReviewAt).getTime() <= todayEnd.getTime());
    if (shuffle) {
      for (let index = cards.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [cards[index], cards[swap]] = [cards[swap], cards[index]];
      }
    }
    let index = 0, flipped = false, reviewPending = false;
    const ratedIds = new Set();
    const retryRatings = new Map();
    const render = () => {
      player.replaceChildren();
      if (index >= cards.length) {
        const remaining = cards.findIndex(card => !ratedIds.has(card.id));
        if (remaining >= 0) { index = remaining; flipped = false; return render(); }
        const done = document.createElement('div'); done.className = 'flashcard-complete';
        const title = document.createElement('h4'); title.textContent = dueOnly ? '오늘 복습을 마쳤어요' : '카드를 모두 복습했어요';
        const restart = document.createElement('button'); restart.type = 'button'; restart.className = 'primary'; restart.textContent = dueOnly ? '전체 카드 학습하기' : '다시 학습하기'; restart.onclick = () => study(deck, shuffle, false);
        done.append(title, restart); player.append(done); return;
      }
      const card = cards[index];
      const header = document.createElement('div'); header.className = 'flashcard-study-head';
      const count = document.createElement('span'); count.textContent = `${cards.length}장 중 ${index + 1}번째 카드`;
      const type = document.createElement('span'); type.className = 'flashcard-type'; type.textContent = typeLabel(card.type);
      const flip = document.createElement('button'); flip.type = 'button'; flip.className = 'quiet-button'; flip.textContent = flipped ? '앞면 보기' : '뒤집기';
      flip.onclick = () => { if (reviewPending) return; flipped = !flipped; render(); };
      const heading = document.createElement('span'); heading.className = 'flashcard-study-kind'; heading.append(count, type);
      header.append(heading, flip); player.append(header);
      const face = document.createElement('button'); face.type = 'button';
      face.className = `flashcard-study-card${flipped ? ' answer' : ''}`;
      face.textContent = flipped ? card.back : card.front;
      face.setAttribute('aria-label', flipped ? '카드 앞면으로 뒤집기' : '카드 뒷면 보기');
      face.onclick = () => { if (reviewPending) return; flipped = !flipped; render(); };
      const meta = document.createElement('p'); meta.className = 'flashcard-meta';
      const provenance = [card.explanation, card.source].map(value => String(value || '').trim()).filter(Boolean);
      const uniqueProvenance = provenance.filter((value, position) => !provenance.some((other, otherPosition) => otherPosition !== position && other.length >= value.length + 6 && other.includes(value)));
      meta.textContent = flipped ? uniqueProvenance.join(' · ') : `${typeLabel(card.type)} · 눌러서 답 보기`;
      player.append(face, meta);
      const pageActions = document.createElement('div'); pageActions.className = 'flashcard-page-actions';
      const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'secondary'; previous.textContent = '‹ 이전'; previous.disabled = index === 0;
      previous.onclick = () => { if (reviewPending) return; index--; flipped = false; render(); };
      const next = document.createElement('button'); next.type = 'button'; next.className = 'secondary'; next.textContent = '다음 ›'; next.disabled = index >= cards.length - 1;
      next.onclick = () => { if (reviewPending) return; index++; flipped = false; render(); };
      pageActions.append(previous, next); player.append(pageActions);
      if (!flipped) return;
      if (ratedIds.has(card.id)) {
        const reviewed = document.createElement('p'); reviewed.className = 'flashcard-meta'; reviewed.textContent = '이번 학습에서 복습을 기록했습니다.';
        player.append(reviewed); return;
      }
      const actions = document.createElement('div'); actions.className = 'flashcard-review-actions';
      for (const [rating, label] of [['AGAIN', '다시 보기'], ['KNOWN', '알고 있음']]) {
        const button = document.createElement('button'); button.type = 'button';
        const retry = retryRatings.get(card.id);
        button.className = rating === 'KNOWN' ? 'primary' : 'secondary';
        button.textContent = retry?.rating === rating ? `${label} 재시도` : label;
        button.disabled = Boolean(retry && retry.rating !== rating);
        button.onclick = async () => {
          const retry = retryRatings.get(card.id);
          if (reviewPending || ratedIds.has(card.id) || (retry && retry.rating !== rating)) return;
          const requestId = retry?.requestId || crypto.randomUUID();
          retryRatings.set(card.id, {rating, requestId});
          reviewPending = true;
          player.querySelectorAll('button').forEach(control => { control.disabled = true; });
          const answeredIndex = index;
          try {
            await request(`/api/flashcards/${card.id}/reviews`, {method: 'POST', body: JSON.stringify({requestId, rating})});
            if (sequence !== studySequence || getEditor()?.id !== noteId) return;
            ratedIds.add(card.id);
            retryRatings.delete(card.id);
            index = answeredIndex + 1;
            while (index < cards.length && ratedIds.has(cards[index].id)) index++;
            flipped = false; render();
          } catch (error) {
            if (sequence === studySequence && getEditor()?.id === noteId) {
              el('flashcard-message').textContent = `${error.message} 같은 평가를 다시 눌러 저장 상태를 확인해 주세요.`;
              render();
            }
          } finally { reviewPending = false; }
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
    studySequence++;
    currentStudy = null;
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
      const type = document.createElement('select'); type.setAttribute('aria-label', '카드 유형');
      for (const [value, label] of typeOptions) { const option = document.createElement('option'); option.value = value; option.textContent = label; type.append(option); }
      type.value = typeLabels[card.type] ? card.type : 'CUSTOM';
      const actions = document.createElement('div'); actions.className = 'generation-actions';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary'; save.textContent = '수정 저장';
      save.onclick = async () => {
        save.disabled = true;
        try {
          await request(`/api/flashcards/${encodeURIComponent(card.id)}`, {method: 'PATCH', body: JSON.stringify({front: front.value, back: back.value, explanation: explanation.value, type: type.value})});
          await reload(); el('flashcard-message').textContent = '카드를 수정했습니다.';
        } catch (error) { el('flashcard-message').textContent = error.message; save.disabled = false; }
      };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button'; remove.textContent = '카드 삭제';
      remove.onclick = async () => {
        if (!window.confirm('이 카드를 삭제할까요?')) return;
        try { await request(`/api/flashcards/${encodeURIComponent(card.id)}`, {method: 'DELETE'}); await reload(); await loadFlashcardDecks(getCourse()?.id); }
        catch (error) { el('flashcard-message').textContent = error.message; }
      };
      actions.append(save, remove); row.append(type, front, back, explanation, actions); player.append(row);
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
          if (dueOnly && !full.cards.some(card => !card.nextReviewAt || new Date(card.nextReviewAt).getTime() <= todayEnd.getTime())) {
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
      el('flashcard-message').textContent = `${deck.cardCount ?? count}장 플래시카드를 저장했습니다.`;
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
    if (currentStudy?.deckId === deckRow.id && currentStudy.noteId === noteId
        && currentStudy.dueOnly === dueOnly && !el('flashcard-player').classList.contains('hidden')) return deckRow;
    const deck = await loadDeck(deckRow.id);
    if (getEditor().id !== noteId) return null;
    study(deck, false, dueOnly);
    return deck;
  }

  return {loadFlashcardDecks, openForNote, openDueForNote: () => openForNote({dueOnly: true}), createDeck, ensureForNote, resetForContext};
}
