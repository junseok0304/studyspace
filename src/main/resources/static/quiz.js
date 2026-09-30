import {createPracticeListItem, renderPracticeList} from './practice-list.js';

/** Quiz generation, saved attempts, hints, wrong-answer review, and editing. */
export function mountQuiz({request, byId, getCourse, getEditor, setLocked, emptyState, getAttachmentIds, loadDashboard, matchesAiMode = () => true}) {
  const el = byId;
  let listVersion = 0;
  let loadedSets = [];
  const generatingNotes = new Set();
  const activeQuestionByAttempt = new Map();

  function renderAttempt(attempt, requestedIndex = null) {
    const noteId = getEditor().id;
    const player = el('quiz-player');
    player.classList.remove('hidden');
    player.replaceChildren();
    const questions = attempt.questions || [];
    const total = questions.length || attempt.totalQuestions || 0;
    const unanswered = questions.findIndex(question => question.selectedIndex === null || question.selectedIndex === undefined);
    const fallbackIndex = activeQuestionByAttempt.get(attempt.id) ?? (unanswered >= 0 ? unanswered : Math.max(0, total - 1));
    const index = Math.max(0, Math.min(Math.max(0, total - 1), requestedIndex ?? fallbackIndex));
    const question = questions[index];
    const complete = attempt.status === 'COMPLETED';
    const answered = questions.filter(item => item.selectedIndex !== null && item.selectedIndex !== undefined).length;
    const percent = complete ? 100 : Math.round(answered * 100 / Math.max(1, total));
    activeQuestionByAttempt.set(attempt.id, index);

    const progressHead = document.createElement('div'); progressHead.className = 'quiz-progress-head';
    const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'quiz-page-arrow'; previous.textContent = '‹'; previous.setAttribute('aria-label', '이전 문제'); previous.disabled = index === 0;
    previous.onclick = () => renderAttempt(attempt, index - 1);
    const track = document.createElement('div'); track.className = 'quiz-progress-track'; track.setAttribute('role', 'progressbar'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(percent)); track.setAttribute('aria-label', '퀴즈 진행률');
    const fill = document.createElement('span'); fill.style.width = `${percent}%`; track.append(fill);
    const percentLabel = document.createElement('span'); percentLabel.className = 'quiz-progress-percent'; percentLabel.textContent = `${percent}%`;
    const nextArrow = document.createElement('button'); nextArrow.type = 'button'; nextArrow.className = 'quiz-page-arrow'; nextArrow.textContent = '›'; nextArrow.setAttribute('aria-label', '다음 문제'); nextArrow.disabled = index >= total - 1;
    nextArrow.onclick = () => renderAttempt(attempt, index + 1);
    progressHead.append(previous, track, percentLabel, nextArrow); player.append(progressHead);

    if (complete) {
      const score = document.createElement('div'); score.className = 'quiz-completion-score';
      const label = document.createElement('strong'); label.textContent = attempt.mode === 'WRONG' ? '오답 다시 풀기 결과' : '퀴즈 결과';
      const value = document.createElement('span'); value.textContent = `${attempt.correctAnswers || 0} / ${total} 정답`;
      score.append(label, value); player.append(score);
    }
    if (!question) { player.append(emptyState('문제를 불러오지 못했습니다.', '퀴즈 기록에서 다른 세트를 선택해 주세요.')); return; }

    const block = document.createElement('article'); block.className = 'quiz-question';
    const promptRow = document.createElement('div'); promptRow.className = 'quiz-question-head';
    const order = document.createElement('span'); order.className = 'quiz-question-order'; order.textContent = `${index + 1}번 문제`;
    const type = document.createElement('span'); type.className = 'quiz-question-type'; type.textContent = '객관식';
    promptRow.append(order, type); block.append(promptRow);
    const prompt = document.createElement('h4'); prompt.className = 'quiz-prompt'; prompt.textContent = question.prompt; block.append(prompt);
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement('label');
      const correct = complete && optionIndex === question.correctIndex;
      const wrong = complete && optionIndex === question.selectedIndex && question.correct === false;
      label.className = `quiz-option${correct ? ' is-correct' : ''}${wrong ? ' is-wrong' : ''}`;
      const marker = document.createElement('span'); marker.className = 'quiz-option-marker'; marker.textContent = String.fromCharCode(65 + optionIndex);
      const text = document.createElement('span'); text.className = 'quiz-option-text'; text.textContent = option;
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = `question-${question.id}`; radio.value = optionIndex;
      radio.checked = question.selectedIndex === optionIndex; radio.disabled = complete;
      radio.onchange = async () => {
        try {
          const updated = await request(`/api/quiz-attempts/${attempt.id}/answers/${question.id}`, {method: 'PUT', body: JSON.stringify({selectedIndex: optionIndex})});
          if (getEditor().id !== noteId) return;
          el('quiz-message').textContent = '답을 저장했습니다.'; renderAttempt(updated, index);
        } catch (error) { el('quiz-message').textContent = error.message; }
      };
      label.append(marker, text, radio); block.append(label);
    });
    if (!complete) {
      const hint = document.createElement('details'); hint.className = 'quiz-hint';
      const summary = document.createElement('summary'); summary.textContent = '힌트 보기';
      const hintText = document.createElement('p'); hintText.textContent = question.hint || '노트에서 이 개념의 정의와 특징을 설명하는 문장을 찾아보세요.';
      hint.append(summary, hintText); block.append(hint);
    } else {
      const explanation = document.createElement('p'); explanation.className = `quiz-explanation ${question.correct ? 'correct' : 'wrong'}`;
      explanation.textContent = `${question.correct ? '정답' : '오답'} · 정답 ${question.correctIndex + 1}번 · ${question.explanation} · ${question.source}`;
      block.append(explanation);
    }
    player.append(block);

    const actions = document.createElement('div'); actions.className = 'quiz-page-actions';
    if (!complete) {
      const back = document.createElement('button'); back.type = 'button'; back.className = 'secondary'; back.textContent = '이전'; back.disabled = index === 0; back.onclick = () => renderAttempt(attempt, index - 1); actions.append(back);
      if (index < total - 1) {
        const next = document.createElement('button'); next.type = 'button'; next.className = 'primary'; next.textContent = '다음'; next.onclick = () => renderAttempt(attempt, index + 1); actions.append(next);
      } else {
        const submit = document.createElement('button'); submit.type = 'button'; submit.className = 'primary'; submit.textContent = '제출하고 채점하기';
        submit.onclick = async () => {
          submit.disabled = true;
          try { const result = await request(`/api/quiz-attempts/${attempt.id}/submit`, {method: 'POST'}); if (getEditor().id !== noteId) return; renderAttempt(result, index); await Promise.all([loadQuizSets(getCourse()?.id), loadDashboard()]); }
          catch (error) { el('quiz-message').textContent = error.message; submit.disabled = false; }
        };
        actions.append(submit);
      }
    } else {
      const wrongCount = questions.filter(item => item.correct !== true).length;
      const again = document.createElement('button'); again.type = 'button'; again.className = 'primary';
      again.textContent = wrongCount ? `오답 ${wrongCount}개 다시 풀기` : '퀴즈 다시 풀기';
      again.onclick = () => startAttempt(attempt.quizSetId, wrongCount ? attempt.id : null); actions.append(again);
    }
    const history = document.createElement('button'); history.type = 'button'; history.className = 'secondary'; history.textContent = '퀴즈 기록 보기';
    history.onclick = () => { player.classList.add('hidden'); el('quiz-history').open = true; };
    actions.append(history); player.append(actions);
  }

  async function startAttempt(setId, wrongFromAttemptId = null) {
    const noteId = getEditor().id;
    try {
      const attempt = await request(`/api/quiz-sets/${encodeURIComponent(setId)}/attempts`, {
        method: 'POST', body: JSON.stringify({requestId: crypto.randomUUID(), wrongFromAttemptId})
      });
      if (getEditor().id !== noteId) return attempt;
      renderAttempt(attempt);
      el('quiz-message').textContent = '';
      return attempt;
    } catch (error) { el('quiz-message').textContent = error.message; return null; }
  }

  async function manageQuestions(set) {
    const player = el('quiz-player');
    player.classList.remove('hidden'); player.replaceChildren();
    try {
      const questions = await request(`/api/quiz-sets/${encodeURIComponent(set.id)}/questions`);
      const heading = document.createElement('div'); heading.className = 'quiz-manage-heading';
      const title = document.createElement('strong'); title.textContent = '문항 다듬기';
      const help = document.createElement('span'); help.className = 'fine-print'; help.textContent = '풀이를 시작하기 전까지 수정할 수 있어요.';
      heading.append(title, help); player.append(heading);
      questions.forEach((question, questionIndex) => {
        const form = document.createElement('form'); form.className = 'quiz-question-editor';
        const label = document.createElement('label'); label.textContent = `${questionIndex + 1}번 질문`;
        const prompt = document.createElement('textarea'); prompt.rows = 2; prompt.maxLength = 500; prompt.required = true; prompt.value = question.prompt;
        label.append(prompt); form.append(label);
        const optionInputs = question.options.map((option, index) => {
          const row = document.createElement('label'); row.className = 'quiz-option-editor';
          const radio = document.createElement('input'); radio.type = 'radio'; radio.name = `answer-${question.id}`; radio.value = index; radio.checked = index === question.correctIndex;
          const input = document.createElement('input'); input.type = 'text'; input.maxLength = 300; input.required = true; input.value = option;
          row.append(radio, input); form.append(row); return input;
        });
        const explanationLabel = document.createElement('label'); explanationLabel.textContent = '해설';
        const explanation = document.createElement('textarea'); explanation.rows = 2; explanation.maxLength = 1000; explanation.required = true; explanation.value = question.explanation;
        explanationLabel.append(explanation); form.append(explanationLabel);
        const save = document.createElement('button'); save.type = 'submit'; save.className = 'secondary'; save.textContent = '이 문항 저장'; form.append(save);
        form.onsubmit = async event => {
          event.preventDefault();
          const selected = form.querySelector(`input[name="answer-${question.id}"]:checked`);
          if (!selected) { el('quiz-message').textContent = '정답을 선택해 주세요.'; return; }
          save.disabled = true;
          try {
            await request(`/api/quiz-sets/${encodeURIComponent(set.id)}/questions/${encodeURIComponent(question.id)}`, {
              method: 'PUT', body: JSON.stringify({prompt: prompt.value, options: optionInputs.map(input => input.value), correctIndex: Number(selected.value), explanation: explanation.value})
            });
            el('quiz-message').textContent = `${questionIndex + 1}번 문항을 저장했습니다.`;
          } catch (error) { el('quiz-message').textContent = error.message; }
          finally { save.disabled = false; }
        };
        player.append(form);
      });
    } catch (error) { player.classList.add('hidden'); el('quiz-message').textContent = error.message; }
  }

  async function showHistory(set) {
    try {
      const attempts = await request(`/api/quiz-sets/${encodeURIComponent(set.id)}/attempts`);
      const player = el('quiz-player');
      player.classList.remove('hidden'); player.replaceChildren();
      const heading = document.createElement('strong'); heading.textContent = '최근 풀이 기록'; player.append(heading);
      player.append(...attempts.map(attempt => {
        const open = document.createElement('button'); open.type = 'button'; open.className = 'quiz-history-row';
        open.textContent = `${new Date(attempt.completedAt).toLocaleString('ko-KR')} · ${attempt.correctAnswers}/${attempt.totalQuestions} 정답`;
        open.onclick = () => renderAttempt(attempt);
        return open;
      }));
    } catch (error) { el('quiz-message').textContent = error.message; }
  }

  async function deleteSet(set) {
    if (!window.confirm(`이 퀴즈와 풀이 기록 ${set.completedAttempts}개를 모두 삭제할까요?`)) return;
    try {
      await request(`/api/quiz-sets/${encodeURIComponent(set.id)}`, {method: 'DELETE'});
      el('quiz-player').classList.add('hidden');
      await Promise.all([loadQuizSets(getCourse()?.id), loadDashboard()]);
      el('quiz-message').textContent = '퀴즈와 풀이 기록을 삭제했습니다.';
    } catch (error) { el('quiz-message').textContent = error.message; }
  }

  function renderQuizSets(rows) {
    const list = el('quiz-sets');
    const noteId = getEditor()?.id;
    const noteRows = rows.filter(set => noteId && set.noteId === noteId);
    renderPracticeList(list, noteRows, set => {
      const play = document.createElement('button'); play.type = 'button'; play.className = 'secondary';
      play.textContent = set.activeAttemptId ? '이어 풀기' : '풀기';
      play.onclick = async () => {
        if (set.activeAttemptId) {
          try { renderAttempt(await request(`/api/quiz-attempts/${set.activeAttemptId}`)); }
          catch (error) { el('quiz-message').textContent = error.message; }
        } else startAttempt(set.id);
      };
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'quiet-button'; edit.textContent = '문항 편집';
      edit.disabled = Boolean(set.activeAttemptId || set.completedAttempts);
      edit.title = edit.disabled ? '풀이를 시작한 퀴즈는 편집할 수 없어요.' : '';
      edit.onclick = () => manageQuestions(set);
      const history = document.createElement('button'); history.type = 'button'; history.className = 'quiet-button'; history.textContent = '풀이 기록';
      history.disabled = !set.completedAttempts; history.onclick = () => showHistory(set);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button'; remove.textContent = '삭제'; remove.onclick = () => deleteSet(set);
      return createPracticeListItem({
        title: set.title,
        metadata: `${set.questionCount}문제 · ${set.completedAttempts}회 완료${set.bestAccuracy === null ? '' : ` · 최고 ${set.bestAccuracy}%`}`,
        actions: [play, edit, history, remove]
      });
    }, noteId
      ? emptyState('이 노트에 저장된 퀴즈가 없습니다.', '문항 수를 선택해 현재 노트 내용으로 만들어 보세요.')
      : emptyState('저장된 노트를 열어 주세요.', '퀴즈와 풀이 기록은 노트별로 보관됩니다.'));
  }

  async function loadQuizSets(courseId) {
    const editor = getEditor();
    const requestVersion = ++listVersion;
    setLocked(el('create-speed-quiz'), !editor.id, '노트를 저장한 뒤 스피드 퀴즈를 만들 수 있어요.');
    if (el('quiz-count')) el('quiz-count').disabled = !editor.id;
    if (!courseId) { el('quiz-sets').textContent = '과목을 선택하면 퀴즈를 확인할 수 있습니다.'; return; }
    const rows = await request(`/api/courses/${encodeURIComponent(courseId)}/quiz-sets`);
    if (requestVersion === listVersion) {
      loadedSets = rows;
      renderQuizSets(rows);
      return rows;
    }
    return loadedSets;
  }

  async function createQuiz() {
    const editor = getEditor(); if (!editor.id) return;
    const noteId = editor.id;
    if (generatingNotes.has(noteId)) return null;
    generatingNotes.add(noteId);
    const button = el('create-speed-quiz'); button.disabled = true;
    el('quiz-message').textContent = '현재 노트와 자료로 퀴즈를 생성하고 있습니다.';
    const count = Number(el('quiz-count')?.value) || 5;
    try {
      const set = await request(`/api/notes/${encodeURIComponent(editor.id)}/quiz-sets`, {
        method: 'POST',
        body: JSON.stringify({requestId: crypto.randomUUID(), questionCount: count, attachmentIds: getAttachmentIds()})
      });
      if (getEditor().id !== noteId) return set;
      await loadQuizSets(getCourse()?.id);
      if (getEditor().id !== noteId) return set;
      byId('learning-mode-badge').textContent = set.mockResult ? '모의 결과 저장됨' : 'AI 생성 결과 저장됨';
      el('quiz-message').textContent = `${count}문제 퀴즈를 저장했습니다.`;
      await startAttempt(set.id);
      return set;
    } catch (error) { if (getEditor().id === noteId) el('quiz-message').textContent = error.message; return null; }
    finally { generatingNotes.delete(noteId); button.disabled = !getEditor().id || generatingNotes.has(getEditor().id); }
  }

  el('create-speed-quiz').onclick = createQuiz;

  async function openForNote() {
    const editor = getEditor(); const course = getCourse();
    if (!editor?.id || !course?.id) { el('quiz-message').textContent = '저장된 노트를 열면 퀴즈를 준비할 수 있습니다.'; return null; }
    const noteId = editor.id;
    const rows = await loadQuizSets(course.id);
    const sets = (rows || loadedSets).filter(set => set.noteId === editor.id);
    if (getEditor().id !== noteId) return null;
    const set = sets.find(item => item.sourceNoteVersion === editor.version && matchesAiMode(item));
    if (!set) return createQuiz();
    byId('learning-mode-badge').textContent = set.mockResult ? '모의 결과 저장됨' : 'AI 생성 결과 저장됨';
    el('quiz-message').textContent = '';
    if (set.activeAttemptId) {
      const attempt = await request(`/api/quiz-attempts/${encodeURIComponent(set.activeAttemptId)}`);
      if (getEditor().id !== noteId) return null;
      renderAttempt(attempt);
      return set;
    }
    const attempts = await request(`/api/quiz-sets/${encodeURIComponent(set.id)}/attempts`);
    if (getEditor().id !== noteId) return null;
    if (attempts.length) renderAttempt(attempts[0]);
    else await startAttempt(set.id);
    return set;
  }

  return {loadQuizSets, renderAttempt, openForNote, createQuiz};
}
