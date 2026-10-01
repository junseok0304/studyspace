import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountGeneration} from '../src/main/resources/static/generation.js';
import {mountQuiz} from '../src/main/resources/static/quiz.js';
import {mountFlashcards} from '../src/main/resources/static/flashcards.js';

function view(markup) {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, {url: 'http://localhost:8091/'});
  const previous = {document: globalThis.document, window: globalThis.window};
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  return {byId: id => dom.window.document.getElementById(id), document: dom.window.document,
    close() { globalThis.document = previous.document; globalThis.window = previous.window; dom.window.close(); }};
}

test('old generation responses cannot replace the next note and duplicate starts share one request', async () => {
  const page = view('<button id="generate-summary"></button><button id="generate-infographic"></button><p id="summary-message"></p><p id="generation-message"></p>');
  const editor = {id: 'note-a', version: 1};
  let resolveOld, resolvePost;
  let postCalls = 0;
  const request = (path, options = {}) => {
    if (options.method === 'POST') { postCalls++; return new Promise(resolve => { resolvePost = resolve; }); }
    if (path.endsWith('/note-a/generations')) return new Promise(resolve => { resolveOld = resolve; });
    if (path.endsWith('/note-b/generations')) return Promise.resolve([]);
    throw new Error(path);
  };
  const generation = mountGeneration({request, byId: page.byId, getEditor: () => editor, getAttachmentIds: () => [], render: () => {}});
  try {
    const oldLoad = generation.load('note-a');
    editor.id = 'note-b';
    generation.resetForNote();
    resolveOld([{id: 'old-summary', kind: 'SUMMARY', status: 'COMPLETED'}]);
    await oldLoad;
    assert.deepEqual(generation.rows, []);

    const first = generation.start('SUMMARY');
    const second = generation.start('SUMMARY');
    assert.equal(first, second);
    assert.equal(postCalls, 1);
    resolvePost({id: 'new-summary'});
    assert.equal(await first, true);
    assert.equal(page.byId('generate-summary').disabled, false);
  } finally { generation.pausePolling(); page.close(); }
});

test('a short saved infographic for a long note is expanded from its saved job', async () => {
  const page = view('<button id="generate-summary"></button><button id="generate-infographic"></button><p id="summary-message"></p><p id="generation-message"></p>');
  const editor = {id: 'note-1', version: 2, body: '학습 내용 '.repeat(650)};
  const old = {id: 'old-job', kind: 'INFOGRAPHIC', status: 'COMPLETED', content: JSON.stringify({pages: [
    {title: '첫째', nodes: [{label: '개념', detail: '설명'}]}, {title: '둘째', nodes: [{label: '원리', detail: '설명'}]}
  ]}), sourceNoteVersion: 2, sourceAttachmentIds: [], mockResult: true};
  const posts = [];
  const request = async (path, options = {}) => {
    if (options.method === 'POST') { posts.push(JSON.parse(options.body)); return {id: 'new-job'}; }
    if (path === '/api/notes/note-1/generations') return [old];
    throw new Error(path);
  };
  const generation = mountGeneration({request, byId: page.byId, getEditor: () => editor, getAttachmentIds: () => [], render: () => {}});
  try {
    await generation.openInfographic();
    await generation.openInfographic();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].regenerateFromJobId, 'old-job');
  } finally { generation.pausePolling(); page.close(); }
});

test('quiz checks the saved answer after a lost response and avoids duplicate attempt starts', async () => {
  const page = view('<span id="learning-mode-badge"></span><p id="quiz-message"></p><button id="create-speed-quiz"></button><select id="quiz-count"><option value="3">3</option></select><div id="quiz-sets"></div><div id="quiz-player"></div><details id="quiz-history"></details>');
  const question = {id: 'q-1', prompt: '개념을 설명하세요', options: ['정답', '오답 1', '오답 2', '오답 3'], selectedIndex: null, correctIndex: 0, explanation: '해설', source: '강의노트'};
  const attempt = selectedIndex => ({id: 'attempt-1', quizSetId: 'set-1', status: 'IN_PROGRESS', totalQuestions: 1,
    questions: [{...question, selectedIndex, correct: selectedIndex === 0}]});
  let resolveStart, startCalls = 0, answerCalls = 0;
  const request = async (path, options = {}) => {
    if (path === '/api/courses/course-1/quiz-sets') return [{id: 'set-1', noteId: 'note-1', sourceNoteVersion: 1, sourceAttachmentIds: [], title: '퀴즈', questionCount: 1, completedAttempts: 0}];
    if (path === '/api/quiz-sets/set-1/attempts' && options.method === 'POST') { startCalls++; return new Promise(resolve => { resolveStart = resolve; }); }
    if (path === '/api/quiz-sets/set-1/attempts') return [];
    if (path.includes('/answers/')) { answerCalls++; throw new Error('연결이 끊어졌습니다.'); }
    if (path === '/api/quiz-attempts/attempt-1') return attempt(0);
    throw new Error(path);
  };
  try {
    const quiz = mountQuiz({request, byId: page.byId, getCourse: () => ({id: 'course-1'}), getEditor: () => ({id: 'note-1', version: 1}), setLocked: () => {}, emptyState: () => page.document.createElement('div'), getAttachmentIds: () => [], loadDashboard: async () => {}});
    await quiz.loadQuizSets('course-1');
    const play = page.byId('quiz-sets').querySelector('button');
    play.click(); play.click();
    assert.equal(startCalls, 1);
    resolveStart(attempt(null));
    await new Promise(resolve => setTimeout(resolve, 0));
    await page.byId('quiz-player').querySelector('input[type="radio"]').onchange();
    assert.equal(answerCalls, 1);
    assert.match(page.byId('quiz-message').textContent, /저장된 답안을 확인/);
    assert.equal(page.byId('quiz-player').querySelectorAll('input[type="radio"]:disabled').length, 4);
  } finally { page.close(); }
});

test('today review uses the server nextReviewAt field', async () => {
  const page = view('<span id="learning-mode-badge"></span><p id="flashcard-message"></p><button id="create-flashcards"></button><select id="flashcard-count"><option value="8">8</option></select><div id="flashcard-decks"></div><div id="flashcard-player"></div>');
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  const request = async path => {
    if (path === '/api/courses/course-1/flashcard-decks') return [{id: 'deck-1', noteId: 'note-1', sourceNoteVersion: 1, sourceAttachmentIds: [], title: '카드', cardCount: 2}];
    if (path === '/api/flashcard-decks/deck-1') return {id: 'deck-1', noteId: 'note-1', cards: [
      {id: 'due', front: '오늘 카드', back: '답', nextReviewAt: null},
      {id: 'later', front: '나중 카드', back: '답', nextReviewAt: future}
    ]};
    throw new Error(path);
  };
  try {
    const flashcards = mountFlashcards({request, byId: page.byId, getCourse: () => ({id: 'course-1'}), getEditor: () => ({id: 'note-1', version: 1}), setLocked: () => {}, emptyState: () => page.document.createElement('div'), getAttachmentIds: () => []});
    await flashcards.openDueForNote();
    assert.match(page.byId('flashcard-player').textContent, /1장 중 1번째 카드/);
    assert.doesNotMatch(page.byId('flashcard-player').textContent, /나중 카드/);
  } finally { page.close(); }
});
