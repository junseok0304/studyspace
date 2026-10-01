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

test('infographic JSON is rendered as a visual diagram with connected concept cards', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const document = dom.window.document;
  const container = document.getElementById('stage');
  const content = JSON.stringify({pages:[{title:'사실에서 정보까지',subtitle:'표현과 해석을 거쳐 의미가 만들어집니다.',relation:'객관적 사실 → 기호로 표현 → 해석된 정보',layout:'flow',nodes:[
    {label:'사실',detail:'실제로 존재하거나 발생한 객관적인 내용입니다.',icon:'idea'},
    {label:'데이터',detail:'사실을 문자·숫자·기호로 표현한 형태입니다.',icon:'data'},
    {label:'정보',detail:'데이터를 가공하고 해석해 의미와 가치를 부여합니다.',icon:'network'}
  ]},{title:'보안의 3대 요소',subtitle:'정보를 안전하게 다루기 위한 서로 다른 기준입니다.',relation:'기밀성 · 무결성 · 가용성이 함께 보안을 이룹니다.',layout:'hub',nodes:[
    {label:'기밀성',detail:'허가된 사람만 정보에 접근할 수 있습니다.',icon:'lock'},
    {label:'무결성',detail:'정보가 정확하고 온전하게 유지됩니다.',icon:'check'}
  ]}]});
  renderInfographicPages(document,container,{title:'정보보호개론',content,renderMarkdown:value=>{const node=document.createElement('div');node.textContent=value;return node;}});
  const svg=container.querySelector('.infographic-visual');
  assert.ok(svg);
  assert.equal(svg.querySelectorAll('.infographic-node').length,3);
  assert.equal(svg.querySelectorAll('path[marker-end]').length,2);
  assert.match(svg.textContent,/사실에서 정보까지/);
  assert.match(container.querySelector('.infographic-semantic-content').textContent,/데이터를 가공하고 해석/);
  assert.equal(container.querySelector('.infographic-page-number').textContent,'1 / 2');
  container.querySelector('.infographic-page-controls button:last-child').click();
  assert.equal(container.querySelector('.infographic-visual').classList.contains('infographic-layout-hub'),true);
  dom.window.close();
});

test('infographic avoids markdown, numbering, and repeated label text in legacy saved diagrams', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const container = dom.window.document.getElementById('stage');
  const content = JSON.stringify({pages:[{title:'📌 1. **핵심 주제**',subtitle:'핵심 개념을 연결합니다. 핵심 개념 사이의 연결',relation:'핵심 개념 사이의 연결',layout:'flow',nodes:[
    {label:'**핵심 개념**',detail:'핵심 개념',icon:'idea'},
    {label:'데이터',detail:'사실을 문자와 기호로 표현합니다.',icon:'data'}
  ]}]});
  renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=dom.window.document.createElement('div');node.textContent=value;return node;
  }});
  const svg=container.querySelector('.infographic-visual');
  assert.match(svg.textContent,/핵심 주제/);
  assert.doesNotMatch(svg.textContent,/📌|\*\*/);
  assert.equal(svg.querySelectorAll('.node-detail').length,1);
  assert.equal(svg.querySelector('.subtitle'),null);
  assert.equal(svg.querySelector('.relation'),null);
  assert.ok(Number(svg.querySelector('.infographic-node > rect').getAttribute('y'))<258);
  assert.doesNotMatch(container.querySelector('.infographic-semantic-content').textContent,/핵심 개념을 연결합니다|핵심 개념 사이의 연결/);
  dom.window.close();
});

test('infographic strips legacy book emoji and numbering from page titles', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const container = dom.window.document.getElementById('stage');
  const content = JSON.stringify({pages:[{title:'📚 2. 수업 개요 및 학습 환경',subtitle:'학습 환경을 정리합니다.',relation:'환경과 도구',layout:'flow',nodes:[
    {label:'수업 주제',detail:'AI 코딩 도구를 활용해 실습합니다.',icon:'idea'}
  ]}]});
  renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=dom.window.document.createElement('div');node.textContent=value;return node;
  }});
  const svg=container.querySelector('.infographic-visual');
  assert.match(svg.textContent,/수업 개요 및 학습 환경/);
  assert.doesNotMatch(svg.textContent,/📚|2\./);
  dom.window.close();
});

test('all infographic layouts keep cards and their full detail text inside the canvas', () => {
  const cases=[['flow',2],['flow',4],['compare',2],['cycle',2],['cycle',3],['cycle',4],['hub',2],['hub',3],['hub',4]];
  for (const [layout,count] of cases) {
    const dom = new JSDOM('<!doctype html><div id="stage"></div>');
    const container = dom.window.document.getElementById('stage');
    const detail='API 요청은 헤더와 인증을 확인한 뒤 권한이 있는 경우에만 처리하여 잘못된 데이터 변경을 막습니다.';
    const content = JSON.stringify({pages:[{title:'학습 개념의 연결',subtitle:'네 가지 요소의 관계',relation:'각 요소가 서로 이어집니다',layout,nodes:[
      ...Array.from({length:count},(_,index)=>({label:`개념 ${index+1}의 핵심 용어`,detail,icon:'idea'}))
    ]}]});
    renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
      const node=dom.window.document.createElement('div');node.textContent=value;return node;
    }});
    const svg=container.querySelector('.infographic-visual');
    const cards=[...svg.querySelectorAll('.infographic-node')];
    for (const card of cards) {
      const rect=card.querySelector(':scope > rect');
      const x=Number(rect.getAttribute('x')),y=Number(rect.getAttribute('y'));
      const width=Number(rect.getAttribute('width')),height=Number(rect.getAttribute('height'));
      assert.ok(x>=0 && x+width<=1120,`${layout} card extends horizontally beyond the canvas`);
      assert.ok(y>=0 && y+height<=620,`${layout} card extends vertically beyond the canvas`);
      const detailLines=[...card.querySelectorAll('.node-detail text')];
      const labelLines=[...card.querySelectorAll('.node-label text')];
      assert.ok(detailLines.length>0,`${layout} card has no visible detail`);
      assert.ok(Number(detailLines.at(-1).getAttribute('y'))+3<=y+height,`${layout} card detail extends beyond its card`);
      if (layout==='cycle' && count===4) assert.ok(Number(detailLines[0].getAttribute('y'))-Number(labelLines.at(-1).getAttribute('y'))>=14,'four-node cycle label and detail overlap');
      assert.equal(detailLines.map(line=>line.textContent).join('').replace(/\s/g,''),detail.replace(/\s/g,''),`${layout}/${count} card detail was truncated: ${JSON.stringify(detailLines.map(line=>line.textContent))}`);
    }
    assert.equal(cards.length,count);
    dom.window.close();
  }
});

test('infographic cards remove separators repeated between a label and its detail', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const container=dom.window.document.getElementById('stage');
  const content=JSON.stringify({pages:[{title:'수업 흐름',subtitle:'',relation:'',layout:'flow',nodes:[
    {label:'1~4주',detail:'1~4주: 코파일럿 기초 실습',icon:'idea'},
    {label:'5~10주',detail:'5~10주：언어별 실전',icon:'data'}
  ]}]});
  renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=dom.window.document.createElement('div');node.textContent=value;return node;
  }});
  const details=[...container.querySelectorAll('.node-detail')].map(node=>node.textContent.trim());
  assert.deepEqual(details,['코파일럿 기초 실습','언어별 실전']);
  dom.window.close();
});

test('legacy text infographic removes title-only duplicates instead of rendering empty cards', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const container=dom.window.document.getElementById('stage');
  const content='# 📌 1. 핵심 요약 (Overview)\n\n## 핵심 내용\n\n- 수업 및 학습 환경\n- GitHub Copilot을 활용하여 Python 및 JavaScript 기반 실습 진행\n- VS Code, Node.js, Python 환경에서 15주간 단계별 수업 진행\n- 프롬프트 작성 영향력';
  renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=dom.window.document.createElement('div');node.textContent=value;return node;
  }});
  const svg=container.querySelector('.infographic-visual');
  assert.equal(svg.querySelectorAll('.infographic-node').length,2);
  assert.match(svg.textContent,/GitHub/);
  assert.match(svg.textContent,/VS Code/);
  assert.doesNotMatch(svg.textContent,/📌|프롬프트 작성 영향력/);
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
