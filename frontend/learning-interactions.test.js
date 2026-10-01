import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountFlashcards} from '../src/main/resources/static/flashcards.js';
import {mountQuiz} from '../src/main/resources/static/quiz.js';

function workspace(markup) {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, {url: 'http://localhost:8091/'});
  const previous = {document: globalThis.document, window: globalThis.window};
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  return {
    document: dom.window.document,
    byId: id => dom.window.document.getElementById(id),
    close() { globalThis.document = previous.document; globalThis.window = previous.window; dom.window.close(); }
  };
}

test('flashcard study keeps its place and records each card only once', async () => {
  const view = workspace('<span id="learning-mode-badge"></span><p id="flashcard-message"></p><button id="create-flashcards"></button><select id="flashcard-count"><option value="2">2</option></select><div id="flashcard-decks"></div><div id="flashcard-player"></div>');
  const {byId} = view;
  const editor = {id: 'note-1', version: 1};
  const cards = [1, 2].map(number => ({id: `card-${number}`, front: `질문 ${number}`, back: `답 ${number}`}));
  let resolveReview;
  const reviewCalls = [];
  const request = async (path, options = {}) => {
    if (path === '/api/courses/course-1/flashcard-decks') return [{id: 'deck-1', noteId: 'note-1', sourceNoteVersion: 1, sourceAttachmentIds: [], title: '복습 카드', cardCount: 2}];
    if (path === '/api/flashcard-decks/deck-1') return {id: 'deck-1', noteId: 'note-1', cards};
    if (path.endsWith('/reviews')) { reviewCalls.push({path, options}); return new Promise(resolve => { resolveReview = resolve; }); }
    throw new Error(path);
  };
  try {
    const flashcards = mountFlashcards({request, byId, getCourse: () => ({id: 'course-1'}), getEditor: () => editor, setLocked: () => {}, emptyState: () => view.document.createElement('div'), getAttachmentIds: () => []});
    await flashcards.openForNote();
    byId('flashcard-player').querySelector('.flashcard-page-actions button:last-child').click();
    assert.match(byId('flashcard-player').textContent, /2번째 카드/);
    await flashcards.openForNote();
    assert.match(byId('flashcard-player').textContent, /2번째 카드/, 'returning to the tab must not reset progress');

    byId('flashcard-player').querySelector('.flashcard-study-card').click();
    const ratings = byId('flashcard-player').querySelectorAll('.flashcard-review-actions button');
    const firstReview = ratings[1].onclick();
    await ratings[0].onclick();
    assert.equal(reviewCalls.length, 1, 'a second rating cannot race the first');
    resolveReview({rating: 'KNOWN'});
    await firstReview;
    assert.match(byId('flashcard-player').textContent, /1번째 카드/, 'skipped cards remain in the session');
    byId('flashcard-player').querySelector('.flashcard-study-card').click();
    const lastReview = byId('flashcard-player').querySelector('.flashcard-review-actions button:last-child').onclick();
    resolveReview({rating: 'KNOWN'});
    await lastReview;
    assert.match(byId('flashcard-player').textContent, /카드를 모두 복습했어요/);
  } finally { view.close(); }
});

test('quiz prevents finishing with unanswered questions and locks choices while grading', async () => {
  const view = workspace('<span id="learning-mode-badge"></span><p id="quiz-message"></p><button id="create-speed-quiz"></button><select id="quiz-count"><option value="2">2</option></select><div id="quiz-sets"></div><div id="quiz-player"></div><details id="quiz-history"></details>');
  const {byId} = view;
  const editor = {id: 'note-1', version: 1};
  const questions = [1, 2].map(number => ({id: `question-${number}`, prompt: `문제 ${number}`, options: ['정답', '오답 1', '오답 2', '오답 3'], selectedIndex: null, correctIndex: 0, explanation: '정답 해설', source: '강의노트'}));
  const attempt = () => ({id: 'attempt-1', quizSetId: 'quiz-1', status: 'IN_PROGRESS', totalQuestions: 2, questions: structuredClone(questions)});
  let resolveAnswer;
  let answerCalls = 0;
  const request = async (path, options = {}) => {
    if (path === '/api/courses/course-1/quiz-sets') return [{id: 'quiz-1', noteId: 'note-1', sourceNoteVersion: 1, sourceAttachmentIds: [], title: '퀴즈', questionCount: 2, completedAttempts: 0}];
    if (path === '/api/quiz-sets/quiz-1/attempts' && options.method === 'POST') return attempt();
    if (path === '/api/quiz-sets/quiz-1/attempts') return [];
    if (path.includes('/answers/')) { answerCalls++; return new Promise(resolve => { resolveAnswer = resolve; }); }
    throw new Error(path);
  };
  try {
    const quiz = mountQuiz({request, byId, getCourse: () => ({id: 'course-1'}), getEditor: () => editor, setLocked: () => {}, emptyState: () => view.document.createElement('div'), getAttachmentIds: () => [], loadDashboard: async () => {}});
    await quiz.openForNote();
    byId('quiz-player').querySelector('.quiz-page-actions .primary').click();
    await byId('quiz-player').querySelector('.quiz-page-actions .primary').onclick();
    assert.match(byId('quiz-message').textContent, /풀지 않은 문제가 2개/);
    assert.match(byId('quiz-player').textContent, /1번 문제/);

    const choices = byId('quiz-player').querySelectorAll('input[type="radio"]');
    const grade = choices[0].onchange();
    await choices[1].onchange();
    assert.equal(answerCalls, 1);
    assert.equal(choices[1].disabled, true);
    questions[0].selectedIndex = 0; questions[0].correct = true;
    resolveAnswer(attempt());
    await grade;
    assert.match(byId('quiz-player').querySelector('.quiz-explanation').textContent, /정답/);
  } finally { view.close(); }
});
