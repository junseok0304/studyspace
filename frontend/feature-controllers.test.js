import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountRecording} from '../src/main/resources/static/recording.js';
import {mountGeneration} from '../src/main/resources/static/generation.js';
import {mountQuiz} from '../src/main/resources/static/quiz.js';
import {mountFlashcards} from '../src/main/resources/static/flashcards.js';
import {mountAttachments} from '../src/main/resources/static/attachments.js';
import {mountDashboard} from '../src/main/resources/static/dashboard.js';

const markup = `<!doctype html><html><body>
  <p id="recording-message"></p><p id="recording-timer"></p><p id="rail-recording-status"></p><span id="rail-recording-clock"></span>
  <button id="start-recording"></button><button id="pause-recording"></button><button id="stop-recording"></button><div id="recordings"></div>
  <span id="learning-mode-badge"></span><p id="quiz-message"></p><p id="flashcard-message"></p>
  <button id="create-speed-quiz"></button><select id="quiz-count"><option value="5">5</option><option value="8">8</option></select><div id="quiz-player"></div><details id="quiz-history"><div id="quiz-sets"></div></details>
  <button id="create-flashcards"></button><select id="flashcard-count"><option value="8">8</option></select><div id="flashcard-player"></div><details id="flashcard-history"><div id="flashcard-decks"></div></details>
  <button id="generate-summary"></button><p id="summary-message"></p><article id="summary-stage"></article>
  <button id="generate-infographic"></button><p id="generation-message"></p><div id="infographic-stage"></div>
  <input id="attachment-input" type="file"><div id="attachment-dropzone"><span id="attachment-selection"></span></div>
  <button id="upload-attachments"></button><span id="attachment-count"></span><p id="attachment-message"></p><div id="attachments"></div>
  <p id="generation-source-summary"></p>
  <input id="note-title" value="HTTP 요청 흐름"><textarea id="note-body">HTTP 요청은 클라이언트가 서버에 요청을 보내고 응답을 받는 과정입니다.</textarea>
</body></html>`;

test('feature controllers keep their request, state, and rendering paths connected', async () => {
  const dom = new JSDOM(markup, {url: 'http://localhost:8091/'});
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousOption = globalThis.Option;
  const previousFormData = globalThis.FormData;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Option = dom.window.Option;
  globalThis.FormData = dom.window.FormData;
  const byId = id => dom.window.document.getElementById(id);
  const emptyState = (message, hint) => {
    const node = dom.window.document.createElement('div'); node.className = 'empty-state'; node.textContent = `${message} ${hint || ''}`; return node;
  };
  const editor = {id: 'note-1', title: '강의노트', version: 3};
  const course = {id: 'course-1', name: '과목'};
  const calls = [];
  let uploadedFile = false;
  let summaryContent = `## 원문 미리보기\n\nHTTP 요청은 클라이언트가 서버에 요청을 보내고 응답을 받는 과정입니다.\n\n## 실제 생성 전 확인\n\n노트 확인`;
  const request = async (path, options = {}) => {
    calls.push({path, options});
    if (path.endsWith('/notes') && options.method !== 'POST') return [{id: 'note-1', title: '강의노트'}];
    if (path.endsWith('/recordings') && options.method !== 'POST') return [{id: 'recording-1', title: '녹음', status: 'READY', durationSeconds: 18, noteId: null, courseId: 'course-1'}];
    if (path.endsWith('/recording-1/note')) return {id: 'recording-1', noteId: 'note-1', noteTitle: '강의노트'};
    if (path === '/api/courses/course-1/quiz-sets' && (!options.method || options.method === 'GET')) return [
      {id: 'quiz-1', noteId: 'note-1', title: '스피드 퀴즈 · HTTP 요청 흐름 확인', questionCount: 1, completedAttempts: 0, sourceNoteVersion: 3, sourceAttachmentIds:['attachment-1'], mockResult: true, activeAttemptId: null},
      {id: 'quiz-other', noteId: 'note-2', title: '다른 노트 퀴즈', questionCount: 3, completedAttempts: 0, sourceNoteVersion: 1, mockResult: true, activeAttemptId: null}
    ];
    if (path === '/api/quiz-sets/quiz-1/attempts' && options.method === 'POST') return {id: 'attempt-1', quizSetId: 'quiz-1', mode: 'NORMAL', status: 'IN_PROGRESS', totalQuestions: 1, questions: [{id: 'question-1', order: 0, prompt: 'HTTP 요청에서 서버가 응답을 돌려주는 단계는?', options: ['응답', '요청 생성', 'DNS 조회', '연결 종료'], hint: '요청 뒤 서버가 돌려주는 결과를 생각해 보세요.', selectedIndex: null}]};
    if (path === '/api/quiz-attempts/attempt-1/answers/question-1') return {id:'attempt-1',quizSetId:'quiz-1',mode:'NORMAL',status:'IN_PROGRESS',totalQuestions:1,questions:[{id:'question-1',order:0,prompt:'HTTP 요청에서 서버가 응답을 돌려주는 단계는?',options:['응답','요청 생성','DNS 조회','연결 종료'],hint:'요청 뒤 서버가 돌려주는 결과를 생각해 보세요.',selectedIndex:1,correct:false,correctIndex:0,explanation:'서버가 요청을 처리한 뒤 응답을 돌려줍니다.',source:'강의노트'}]};
    if (path === '/api/quiz-sets/quiz-1/attempts' && (!options.method || options.method === 'GET')) return [];
    if (path.endsWith('/quiz-sets') && options.method === 'POST') return {id: 'quiz-1', noteId: 'note-1', sourceNoteVersion: 3, mockResult: true};
    if (path === '/api/notes/note-1/attachments' && options.method === 'POST') { uploadedFile = true; return {id: 'ux-upload-1', originalName: 'ux-preview.pdf', size: 24, analysisStatus: 'NOT_ANALYZED'}; }
    if (path === '/api/attachments/ux-upload-1/analysis' && options.method === 'POST') return {id: 'ux-upload-1', analysisStatus: 'ANALYZING'};
    if (path === '/api/attachments/legacy-hwp/analysis' && options.method === 'POST') return {id:'legacy-hwp',analysisStatus:'ANALYZING'};
    if (path === '/api/notes/note-1/attachments') return [
      {id: 'attachment-1', originalName: '수업자료.pdf', size: 2048, analysisStatus: 'TEXT_READY', extractedLength: 500, summaryStatus: 'READY', summaryText: '핵심 내용'},
      {id:'legacy-hwp',originalName:'이전강의자료.hwp',size:46080,analysisStatus:'NOT_ANALYZED',summaryStatus:'NOT_SUMMARIZED'},
      ...(uploadedFile ? [{id: 'ux-upload-1', originalName: 'ux-preview.pdf', size: 24, analysisStatus: 'TEXT_READY', extractedLength: 92, summaryStatus: 'READY', summaryText: 'HTTP 요청은 클라이언트가 서버에 정보를 전달하고 응답을 받는 과정입니다.'}] : [])
    ];
    if (path === '/api/courses/course-1/flashcard-decks' && (!options.method || options.method === 'GET')) return [
      {id: 'deck-1', noteId: 'note-1', title: '복습 카드', cardCount: 8, sourceNoteVersion: 3, sourceAttachmentIds:['attachment-1'], mockResult: true},
      {id: 'deck-other', noteId: 'note-2', title: '다른 노트 카드', cardCount: 4, sourceNoteVersion: 1, mockResult: true}
    ];
    if (path === '/api/flashcard-decks/deck-1') return {id: 'deck-1', title: 'HTTP 복습', sourceNoteVersion: 3, cards: [{id: 'card-1', front: 'HTTP 응답 단계의 역할은?', back: '서버가 요청을 처리한 결과를 클라이언트에 돌려줍니다.', explanation: '원문 근거 · 노트 `강의노트` 버전 3', source: '노트 `강의노트` 버전 3'}]};
    if (path === '/api/notes/note-1/flashcard-decks' && options.method === 'POST') return {id: 'deck-new', noteId: 'note-1', title: '새 플래시카드', cardCount: 8, sourceNoteVersion: 3, mockResult: true, cards: [{id: 'card-new', front: 'HTTP 요청은?', back: '클라이언트가 서버에 정보를 전달합니다.', explanation: '요청 단계', source: '강의노트'}]};
    if (path === '/api/notes/note-1/generations' && options.method === 'POST') { summaryContent = '## 요약\n\nHTTP 요청은 클라이언트와 서버가 정보를 주고받는 과정입니다.'; return {id:'summary-2'}; }
    if (path === '/api/notes/note-1/generations' && (!options.method || options.method === 'GET')) return [
      {id: 'summary-1', kind: 'SUMMARY', status: 'COMPLETED', title: '요점 정리', sourceNoteVersion: 3, mockResult:true, attachmentCount: uploadedFile ? 1 : 0, content: summaryContent},
      {id: 'mindmap-1', kind: 'MIND_MAP', status: 'COMPLETED', title: 'HTTP 흐름', sourceNoteVersion: 3, content: JSON.stringify({label: 'HTTP 요청 흐름', children: [{label: '클라이언트 요청', children: []}, {label: '서버 응답', children: []}]})},
      {id: 'infographic-1', kind: 'INFOGRAPHIC', status: 'COMPLETED', title: 'HTTP 요청 흐름', sourceNoteVersion: 3, mockResult: true, attachmentCount: 1, content: '# HTTP 요청 흐름\n\n## 요청\n\n- 클라이언트가 정보를 전달합니다.'}
    ];
    return {id: 'created'};
  };
  const setLocked = (button, locked) => { button.disabled = locked; };
  try {
    const recording = mountRecording({request, byId, getCourse: () => course, getEditor: () => editor, setLocked, emptyState});
    byId('recording-message').textContent = '연결된 강의노트를 이전 과목의 노트로 변경했습니다.';
    await recording.loadRecordings();
    assert.equal(byId('recording-message').textContent, '');
    assert.equal(byId('recordings').querySelector('audio') !== null, true);
    assert.equal([...byId('recordings').querySelectorAll('select[aria-label="재생 속도"] option')].find(option => option.selected)?.textContent, '1배속');
    const noteSelect = byId('recordings').querySelector('.recording-note-select');
    noteSelect.value = 'note-1';
    await noteSelect.onchange();
    assert.equal(calls.some(call => call.path.endsWith('/recording-1/note') && call.options.method === 'PATCH'), true);

    const quiz = mountQuiz({request, byId, getCourse: () => course, getEditor: () => editor, setLocked, emptyState, getAttachmentIds: () => ['attachment-1'], loadDashboard: async () => {}, updateSourceSummary: () => {}});
    await quiz.loadQuizSets(course.id);
    assert.equal(byId('quiz-sets').querySelector('.quiz-set-row strong').textContent, '퀴즈 · HTTP 요청 흐름 확인');
    assert.equal(byId('quiz-sets').querySelectorAll('.quiz-set-row').length, 1);
    await quiz.openForNote();
    assert.equal(byId('quiz-player').querySelector('.quiz-hint summary').textContent, '힌트 보기');
    assert.match(byId('quiz-player').textContent, /HTTP 요청에서 서버가 응답/);
    const wrongAnswer=byId('quiz-player').querySelector('input[type="radio"]');
    wrongAnswer.checked=true;
    await wrongAnswer.onchange();
    assert.match(byId('quiz-player').querySelector('.quiz-explanation').textContent,/오답 · 정답 1번/);
    assert.equal(byId('quiz-message').textContent, '');
    assert.equal(byId('quiz-player').querySelectorAll('input[type="radio"]:disabled').length,4);
    const playQuiz = [...byId('quiz-sets').querySelectorAll('button')].find(button => button.textContent === '풀기');
    await playQuiz.onclick();
    assert.match(byId('quiz-player').textContent, /서버가 응답을 돌려주는 단계/);
    byId('quiz-count').value = '8';
    await byId('create-speed-quiz').onclick();
    const quizCreate = calls.find(call => call.path.endsWith('/notes/note-1/quiz-sets') && call.options.method === 'POST');
    assert.deepEqual(JSON.parse(quizCreate.options.body).attachmentIds, ['attachment-1']);
    assert.equal(JSON.parse(quizCreate.options.body).questionCount, 8);
    assert.equal(byId('quiz-player').querySelector('.quiz-prompt') !== null, true);

    const flashcards = mountFlashcards({request, byId, getCourse: () => course, getEditor: () => editor, setLocked, emptyState, getAttachmentIds: () => ['attachment-1']});
    await flashcards.loadFlashcardDecks(course.id);
    assert.equal(byId('flashcard-decks').querySelector('.quiz-set-row strong').textContent, '복습 카드');
    assert.equal(byId('flashcard-decks').querySelectorAll('.quiz-set-row').length, 1);
    await flashcards.openForNote();
    assert.match(byId('flashcard-player').textContent, /1장 중 1번째 카드/);
    const studyDeck = [...byId('flashcard-decks').querySelectorAll('button')].find(button => button.textContent === '학습하기');
    await studyDeck.onclick();
    assert.match(byId('flashcard-player').textContent, /HTTP 응답 단계의 역할은/);
    await byId('flashcard-player').querySelector('.flashcard-study-card').onclick();
    assert.match(byId('flashcard-player').textContent, /서버가 요청을 처리한 결과/);
    assert.equal((byId('flashcard-player').textContent.match(/노트 `강의노트` 버전 3/g) || []).length, 1);
    await byId('create-flashcards').onclick();
    assert.match(byId('flashcard-player').textContent, /HTTP 요청은/);

    let rendered = null;
    const generation = mountGeneration({request, byId, getEditor: () => editor, getAttachmentIds: () => ['attachment-1'], render: (rows, view) => { rendered = {rows, view}; }});
    await generation.load(editor.id);
    assert.equal(byId('generate-summary').disabled,false);
    await generation.openSummary();
    assert.equal(calls.some(call => call.path.endsWith('/notes/note-1/generations') && call.options.method === 'POST' && JSON.parse(call.options.body).kind === 'SUMMARY'), true);
    summaryContent = '## 요약\n\n- 요청은 클라이언트에서 시작합니다.\n- 서버가 요청을 처리합니다.\n- 처리 결과를 응답으로 돌려줍니다.';
    await generation.load(editor.id);
    const summaryRequestsBeforeListRefresh = calls.filter(call => call.path.endsWith('/notes/note-1/generations') && call.options.method === 'POST').length;
    await generation.openSummary();
    assert.equal(calls.filter(call => call.path.endsWith('/notes/note-1/generations') && call.options.method === 'POST').length, summaryRequestsBeforeListRefresh + 1);
    await generation.openInfographic();
    assert.equal(calls.some(call => call.options.method === 'POST' && JSON.parse(call.options.body).kind === 'INFOGRAPHIC'), false);
    assert.equal(rendered.rows.find(row => row.kind === 'INFOGRAPHIC').status, 'COMPLETED');
    const generationCreate = calls.find(call => call.path.endsWith('/notes/note-1/generations') && call.options.method === 'POST');
    assert.equal(JSON.parse(generationCreate.options.body).kind, 'SUMMARY');
    assert.deepEqual(JSON.parse(generationCreate.options.body).attachmentIds, ['attachment-1']);
    assert.match(rendered.rows.find(row => row.kind === 'SUMMARY').content, /HTTP 요청은 클라이언트와 서버가 정보를 주고받는 과정/);
    assert.equal(byId('summary-message').textContent, '');
    assert.match(rendered.rows.find(row => row.kind === 'MIND_MAP').content, /클라이언트 요청/);

    const attachments = mountAttachments({request, byId, getEditor: () => editor, getGenerationFeature: () => generation, emptyState});
    await attachments.loadAttachments(editor.id);
    assert.equal(byId('upload-attachments').disabled, true);
    assert.deepEqual(attachments.selectedAttachmentIds(), ['attachment-1']);
    const legacyAnalyze=[...byId('attachments').querySelectorAll('button')].find(button=>button.textContent==='분석 시작');
    assert.ok(legacyAnalyze);
    await legacyAnalyze.onclick();
    assert.equal(calls.some(call=>call.path==='/api/attachments/legacy-hwp/analysis'&&call.options.method==='POST'),true);
    assert.match(byId('generation-source-summary').textContent, /수업자료\.pdf/);
    assert.equal(byId('attachments').querySelector('.attachment-summary').textContent, '핵심 내용');
    const summaryRequestsBeforeUpload = calls.filter(call => call.path === '/api/notes/note-1/generations' && call.options.method === 'POST').length;
    const droppedFile = new dom.window.File(['drop target'], 'drag-preview.pdf', {type: 'application/pdf'});
    const dropEvent = new dom.window.Event('drop', {bubbles: true, cancelable: true});
    Object.defineProperty(dropEvent, 'dataTransfer', {value: {files: [droppedFile]}});
    byId('attachment-dropzone').dispatchEvent(dropEvent);
    assert.match(byId('attachment-selection').textContent, /drag-preview\.pdf/);
    assert.equal(byId('upload-attachments').disabled, false);
    const sampleFile = new dom.window.File(['%PDF-1.4 HTTP request response flow'], 'ux-preview.pdf', {type: 'application/pdf'});
    Object.defineProperty(byId('attachment-input'), 'files', {configurable: true, value: [sampleFile]});
    byId('attachment-input').dispatchEvent(new dom.window.Event('change'));
    assert.match(byId('attachment-selection').textContent, /ux-preview\.pdf/);
    assert.equal(byId('upload-attachments').disabled, false);
    await byId('upload-attachments').onclick();
    const uploadCall = calls.find(call => call.path === '/api/notes/note-1/attachments' && call.options.method === 'POST');
    assert.equal(uploadCall.options.formData.get('file').name, 'ux-preview.pdf');
    assert.equal(calls.some(call => call.path === '/api/attachments/ux-upload-1/analysis' && call.options.method === 'POST'), true);
    assert.equal(calls.some(call => call.path === '/api/notes/note-1/generations' && call.options.method === 'POST'), true);
    // Upload summarizes the file through its analysis worker, not an invisible extra paid generation.
    assert.equal(calls.filter(call => call.path === '/api/notes/note-1/generations' && call.options.method === 'POST').length, summaryRequestsBeforeUpload);
    assert.match(byId('attachments').textContent, /HTTP 요청은 클라이언트가 서버에 정보를 전달/);
    assert.deepEqual(attachments.selectedAttachmentIds(), ['attachment-1', 'ux-upload-1']);
    editor.id = '';
    await attachments.loadAttachments(editor.id);
    assert.deepEqual(attachments.selectedAttachmentIds(), []);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.Option = previousOption;
    globalThis.FormData = previousFormData;
    dom.window.close();
  }
});

test('saved infographic is rebuilt when analyzed attachment sources have changed', async () => {
  const dom = new JSDOM(markup, {url:'http://localhost:8091/'});
  const byId = id => dom.window.document.getElementById(id);
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({path, options});
    if (options.method === 'POST') return {id:'new-infographic-job'};
    return [{id:'old-infographic',kind:'INFOGRAPHIC',status:'COMPLETED',sourceNoteVersion:3,attachmentCount:2,sourceAttachmentIds:['file-old-a','file-old-b'],content:'old result'}];
  };
  const generation = mountGeneration({request,byId,getEditor:()=>({id:'note-1',version:3}),getAttachmentIds:()=>['attachment-a','attachment-b'],render:()=>{}});

  await generation.openInfographic();

  const created = calls.find(call=>call.options.method==='POST');
  assert.ok(created);
  assert.equal(JSON.parse(created.options.body).kind,'INFOGRAPHIC');
  assert.deepEqual(JSON.parse(created.options.body).attachmentIds,['attachment-a','attachment-b']);
  dom.window.close();
});

test('summary coverage estimate excludes hidden AI metadata from the note length', async () => {
  const dom=new JSDOM(markup,{url:'http://localhost:8091/'});
  const byId=id=>dom.window.document.getElementById(id);
  const calls=[];
  const summary='핵심 내용을 설명합니다. '.repeat(60);
  const editor={id:'note-1',version:1,title:'강의노트',body:`<!-- AI 전용 메타데이터 ${'hidden '.repeat(800)} -->\n## 짧은 내용\n실제 노트는 짧습니다.`};
  const request=async(path,options={})=>{
    calls.push({path,options});
    if(path==='/api/notes/note-1/generations') {
      if(options.method==='POST') return {id:'unexpected-refresh'};
      return [{id:'summary-existing',kind:'SUMMARY',status:'COMPLETED',sourceNoteVersion:1,sourceAttachmentIds:[],content:summary}];
    }
    return [];
  };
  const generation=mountGeneration({request,byId,getEditor:()=>editor,getAttachmentIds:()=>[],render:()=>{}});

  await generation.openSummary();

  assert.equal(calls.some(call=>call.options.method==='POST'),false);
  dom.window.close();
});

test('quiz and flashcard sets are refreshed when the attached file set changes', async () => {
  const dom=new JSDOM(markup,{url:'http://localhost:8091/'});
  const previousDocument=globalThis.document,previousWindow=globalThis.window;
  globalThis.document=dom.window.document;globalThis.window=dom.window;
  const byId=id=>dom.window.document.getElementById(id), editor={id:'note-1',title:'강의노트',version:3}, course={id:'course-1',name:'과목'};
  const calls=[]; let quizRows=[{id:'quiz-old',noteId:'note-1',title:'이전 퀴즈',sourceNoteVersion:3,sourceAttachmentIds:['file-old'],mockResult:true}];
  let deckRows=[{id:'deck-old',noteId:'note-1',title:'이전 카드',sourceNoteVersion:3,sourceAttachmentIds:['file-old'],mockResult:true}];
  const request=async(path,options={})=>{
    calls.push({path,options});
    if(path==='/api/courses/course-1/quiz-sets') return quizRows;
    if(path==='/api/courses/course-1/flashcard-decks') return deckRows;
    if(path==='/api/notes/note-1/quiz-sets'&&options.method==='POST') {quizRows=[{id:'quiz-new',noteId:'note-1',title:'새 퀴즈',sourceNoteVersion:3,sourceAttachmentIds:['file-new'],mockResult:true}];return quizRows[0];}
    if(path==='/api/notes/note-1/flashcard-decks'&&options.method==='POST') {deckRows=[{id:'deck-new',noteId:'note-1',title:'새 카드',sourceNoteVersion:3,sourceAttachmentIds:['file-new'],mockResult:true,cards:[]}];return deckRows[0];}
    return {};
  };
  const setLocked=(button,locked)=>{button.disabled=locked;};
  const quiz=mountQuiz({request,byId,getCourse:()=>course,getEditor:()=>editor,setLocked,emptyState:()=>dom.window.document.createElement('div'),getAttachmentIds:()=>['file-new'],loadDashboard:async()=>{},updateSourceSummary:()=>{}});
  const flashcards=mountFlashcards({request,byId,getCourse:()=>course,getEditor:()=>editor,setLocked,emptyState:()=>dom.window.document.createElement('div'),getAttachmentIds:()=>['file-new']});

  try {
    await quiz.ensureForNote();
    await flashcards.ensureForNote();
    assert.deepEqual(JSON.parse(calls.find(call=>call.options.method==='POST'&&call.path.endsWith('/quiz-sets')).options.body).attachmentIds,['file-new']);
    assert.deepEqual(JSON.parse(calls.find(call=>call.options.method==='POST'&&call.path.endsWith('/flashcard-decks')).options.body).attachmentIds,['file-new']);
  } finally {
    globalThis.document=previousDocument;globalThis.window=previousWindow;dom.window.close();
  }
});

test('dashboard controller loads backend course stats and routes course actions', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <select id="dashboard-semester"></select><input id="show-archived" type="checkbox"><div id="courses"></div><span id="course-count"></span><select id="course-semester"></select>
    <button id="dashboard-retry"></button><p id="dashboard-message"></p><div id="dashboard-summary"></div><span id="metric-flashcards-due"></span><p id="metric-flashcards-breakdown"></p><p id="metric-flashcards-target"></p>
    <button id="dashboard-review-button"></button><button id="dashboard-quiz-button"></button><div id="quiz-stats"></div><div id="activity-chart"></div>
    <div id="recent-notes"></div><div id="today-classes"></div><div id="course-progress"></div>
  </body></html>`, {url: 'http://localhost:8091/'});
  const previous = {document: globalThis.document, Option: globalThis.Option, CustomEvent: globalThis.CustomEvent};
  globalThis.document = dom.window.document;
  globalThis.Option = dom.window.Option;
  globalThis.CustomEvent = dom.window.CustomEvent;
  const byId = id => dom.window.document.getElementById(id);
  const calls = [];
  const request = async path => {
    calls.push(path);
    if (path === '/api/courses') return [{id: 'course-1', name: '프로그래밍', semester: '2026년 2학기', archived: false}];
    if (path === '/api/semesters') return [{name: '2026년 2학기'}];
    if (path.startsWith('/api/dashboard')) return {
      notes: 1, viewed: 1, activeDays: 2, courses: 1, quizAccuracy: 100, quizAttempts: 1, flashcardsDue: 7, newFlashcards: 5, reviewFlashcards: 2, wrongAnswers: 0,
      days: [{date: '2026-09-25', count: 1}], recent: [{title: '강의노트', courseName: '프로그래밍', courseId: 'course-1'}],
      quizTarget: {id: 'note-1', courseId: 'course-1'}, reviewTarget: {id: 'note-1', courseId: 'course-1',title:'강의노트',courseName:'프로그래밍'},
      todayClasses: [{start: '10:00', end: '11:00', name: '프로그래밍', room: 'B101', courseId: 'course-1'}],
      courseStats: [{id: 'course-1', name: '프로그래밍', viewed: 1, notes: 1}]
    };
    throw new Error(`Unexpected endpoint ${path}`);
  };
  const selected = [];
  const routedViews = [];
  dom.window.document.addEventListener('studyspace:select-tool', event => routedViews.push({view:event.detail.view,dueOnly:event.detail.dueOnly}));
  const dashboard = mountDashboard({
    request, byId, getCourse: () => null,
    selectCourse: async (course, noteId) => selected.push({course, noteId}),
    button: (label, action) => { const node = dom.window.document.createElement('button'); node.textContent = label; node.onclick = action; return node; },
    emptyState: message => { const node = dom.window.document.createElement('p'); node.textContent = message; return node; },
    tell: () => {}
  });
  try {
    await dashboard.loadCourses();
    await dashboard.loadDashboard();
    assert.deepEqual(calls, ['/api/courses', '/api/semesters', '/api/dashboard?semester=2026%EB%85%84%202%ED%95%99%EA%B8%B0']);
    assert.equal(byId('courses').querySelector('.course-tab strong').textContent, '프로그래밍');
    assert.deepEqual([...byId('dashboard-summary').querySelectorAll('.study-stat-label')].map(node => node.textContent), ['노트 열람률', '최근 7일', '수강 과목', '쌓아온 노트']);
    assert.equal(byId('today-classes').querySelector('table tbody tr td').textContent, '프로그래밍');
    assert.equal(byId('course-progress').querySelector('progress').value, 1);
    assert.equal(byId('metric-flashcards-breakdown').textContent, '이번 학기 전체 · 새 카드 5장 · 오늘 복습 2장');
    assert.equal(byId('metric-flashcards-target').textContent, '바로 시작할 노트: 강의노트 · 프로그래밍');
    byId('dashboard-review-button').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(selected[0].course.id, 'course-1');
    assert.equal(selected[0].noteId, 'note-1');
    assert.deepEqual(routedViews[0], {view:'flashcards',dueOnly:true});
    byId('dashboard-quiz-button').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(routedViews[1], {view:'quiz',dueOnly:false});
    assert.equal(dom.window.document.querySelector('.course-tab[aria-pressed="false"]') !== null, true);
  } finally {
    globalThis.document = previous.document;
    globalThis.Option = previous.Option;
    globalThis.CustomEvent = previous.CustomEvent;
    dom.window.close();
  }
});
