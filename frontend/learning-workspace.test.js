import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountLearningWorkspace} from '../src/main/resources/static/learning-workspace.js';
import {paginateInfographic, renderInfographicPages} from '../src/main/resources/static/infographic-view.js';
import {renderMarkdown} from '../src/main/resources/static/markdown.js';
import {stripSummarySourceLabels} from '../src/main/resources/static/summary-view.js';

test('learning views switch directly and reuse the current note version', async () => {
  const dom = new JSDOM(`<!doctype html><section id="learning-panel"><nav id="learning-tabs">
    <button data-learning-view="summary"></button><button data-learning-view="infographic"></button><button data-learning-view="quiz"></button><button data-learning-view="flashcards"></button>
  </nav><section id="learning-summary-view"></section><section id="learning-infographic-view"></section><section id="learning-quiz-view" hidden></section><section id="learning-flashcards-view" hidden></section>
  <p id="learning-message"></p></section>`);
  const doc = dom.window.document;
  const byId = id => doc.getElementById(id);
  const calls = [];
  const getEditor = () => ({id:'note-1', version:3});
  const workspace = mountLearningWorkspace({document:doc,byId,getEditor,
    generation:{openSummary:async()=>calls.push('summary'),openInfographic:async()=>calls.push('infographic')},
    quiz:{ensureForNote:async()=>{},openForNote:async()=>calls.push('quiz')},
    flashcards:{ensureForNote:async()=>{},openForNote:async()=>calls.push('flashcards'),openDueForNote:async()=>calls.push('due-flashcards')}});

  await workspace.show('infographic');
  await workspace.show('infographic');
  assert.deepEqual(calls,['summary','infographic','infographic']);
  await workspace.show('quiz');
  assert.deepEqual(calls,['summary','infographic','infographic','summary','infographic','quiz']);
  assert.equal(byId('learning-quiz-view').hidden,false);
  assert.equal(doc.querySelector('#learning-tabs [data-learning-view="quiz"]').getAttribute('aria-pressed'),'true');

  doc.dispatchEvent(new dom.window.CustomEvent('studyspace:tool-selected',{detail:{id:'learning-panel',view:'flashcards'}}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(calls,['summary','infographic','infographic','summary','infographic','quiz','summary','infographic','flashcards']);
  assert.equal(byId('learning-flashcards-view').hidden,false);
  dom.window.close();
});

test('summary view removes repeated note citations without touching prose', () => {
  const content = '## 표준 출력\n\ncout은 표준 출력 스트림 객체입니다. (노트: 0902 2차시 (버전 1))\n\n참조(reference)는 별칭입니다. (Call-by-Reference)\n\n출처: 강의자료.pdf';
  const clean = stripSummarySourceLabels(content);
  assert.match(clean, /cout은 표준 출력 스트림 객체입니다\./);
  assert.match(clean, /참조\(reference\)는 별칭입니다\. \(Call-by-Reference\)/);
  assert.match(clean, /cout은 표준 출력 스트림 객체입니다\.\n\n참조/);
  assert.doesNotMatch(clean, /노트:|강의자료\.pdf|^출처:/m);
});

test('learning waits for source loading and permits retry after failed generation', async () => {
  const dom=new JSDOM('<div id="learning-tabs"><button data-learning-view="quiz"></button></div><div id="learning-panel"></div><div id="learning-message"></div><div id="learning-infographic-view"></div><div id="learning-quiz-view"></div><div id="learning-flashcards-view"></div>');
  const doc=dom.window.document;
  const events=[];
  const workspace=mountLearningWorkspace({document:doc,byId:id=>doc.getElementById(id),getEditor:()=>({id:'note',version:1}),
    beforeOpen:async()=>events.push('sources'),generation:{openSummary:async()=>{},openInfographic:async()=>{}},flashcards:{ensureForNote:async()=>{}},quiz:{ensureForNote:async()=>{},openForNote:async()=>{events.push('quiz');return null;}}});
  await workspace.show('quiz');
  await workspace.show('quiz');
  assert.deepEqual(events,['sources','quiz','sources','quiz']);
  dom.window.close();
});

test('switching notes while sources load does not start generation for the old note', async () => {
  const dom=new JSDOM('<div id="learning-tabs"><button data-learning-view="quiz"></button></div><div id="learning-panel"></div><div id="learning-message"></div><div id="learning-infographic-view"></div><div id="learning-quiz-view"></div><div id="learning-flashcards-view"></div>');
  const doc=dom.window.document;
  const editor={id:'old-note',version:1};
  let release; let generated=0;
  const workspace=mountLearningWorkspace({document:doc,byId:id=>doc.getElementById(id),getEditor:()=>editor,
    beforeOpen:()=>new Promise(resolve=>{release=resolve;}),generation:{openSummary:async()=>{},openInfographic:async()=>{}},flashcards:{ensureForNote:async()=>{}},quiz:{ensureForNote:async()=>{},openForNote:async()=>generated++}});
  const request=workspace.show('quiz');
  await new Promise(resolve=>setTimeout(resolve,0));
  editor.id='new-note';
  workspace.resetForNote();
  release();
  await request;
  assert.equal(generated,0);
  dom.window.close();
});

test('infographic content is paginated with working accessible navigation', () => {
  const markdown = '# 경제 세계화\n\n## 1. 개념\n\n국가 간 상호의존성이 커집니다. [강의자료.pdf, p. 2]\n\n## 출처\n\n- 강의자료.pdf p. 2\n\n---PAGE---\n\n## 2. 흐름\n\n무역과 투자가 확대됩니다. (수업자료.pptx 슬라이드 3)\n\n출처: 수업노트';
  assert.equal(paginateInfographic(markdown).length,2);
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const container = dom.window.document.getElementById('stage');
  renderInfographicPages(dom.window.document,container,{title:'경제 세계화',content:markdown,renderMarkdown:value=>{
    const node=dom.window.document.createElement('div');node.textContent=value;return node;
  }});
  assert.equal(container.querySelector('.infographic-page-number').textContent,'1 / 2');
  const [previous,, ,next]=container.querySelectorAll('.infographic-page-controls > *');
  assert.equal(previous.disabled,true);
  next.click();
  assert.equal(container.querySelector('.infographic-page-number').textContent,'2 / 2');
  assert.match(container.querySelector('.infographic-page').textContent,/무역과 투자가 확대/);
  assert.doesNotMatch(container.textContent,/출처|강의자료\.pdf|수업자료\.pptx|수업노트/);
  assert.equal(next.disabled,true);
  assert.equal(previous.disabled,false);
  previous.click();
  assert.equal(container.querySelector('.infographic-page-number').textContent,'1 / 2');
  dom.window.close();
});

test('infographic cover does not repeat the current note title as body text', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const container = dom.window.document.getElementById('stage');
  renderInfographicPages(dom.window.document, container, {
    title: '강의노트',
    content: '# 강의노트\n\n## 핵심 한눈에 보기\n\n강의노트\n\n실제 핵심 내용입니다.',
    renderMarkdown: value => {
      const fragment = dom.window.document.createDocumentFragment();
      const paragraph = dom.window.document.createElement('p'); paragraph.textContent = value; fragment.append(paragraph);
      return fragment;
    }
  });
  assert.equal(container.querySelector('.infographic-page').textContent.includes('실제 핵심 내용입니다.'), true);
  assert.doesNotMatch(container.querySelector('.infographic-page').textContent.replace('강의노트', ''), /강의노트/);
});

test('infographic skips a title-only cover and starts on the first useful page', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const container = dom.window.document.getElementById('stage');
  renderInfographicPages(dom.window.document, container, {
    title: '강의노트',
    content: '# 강의노트\n\n## 핵심 한눈에 보기\n\n강의노트\n\n---PAGE---\n\n## 핵심 개념 1\n\n실제 핵심 내용입니다.',
    renderMarkdown: value => renderMarkdown(value, dom.window)
  });
  assert.equal(container.querySelector('.infographic-page-number').textContent, '1 / 1');
  assert.equal(container.querySelector('.infographic-page h1').textContent, '강의노트');
  assert.equal(container.querySelector('.infographic-page').textContent.includes('실제 핵심 내용입니다.'), true);
  assert.equal(container.querySelector('.infographic-page h2').textContent, '핵심 개념 1');
});
