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
  const content = '## 표준 출력\n\n호출 흐름은 A $\\rightarrow$ B입니다. cout은 표준 출력 스트림 객체입니다. (노트: 0902 2차시 (버전 1))\n\n참조(reference)는 별칭입니다. (Call-by-Reference)\n\n출처: 강의자료.pdf';
  const clean = stripSummarySourceLabels(content);
  assert.match(clean, /A → B/);
  assert.doesNotMatch(clean, /\\rightarrow/);
  assert.match(clean, /cout은 표준 출력 스트림 객체입니다\./);
  assert.match(clean, /참조\(reference\)는 별칭입니다\. \(Call-by-Reference\)/);
  assert.match(clean, /cout은 표준 출력 스트림 객체입니다\.\n\n참조/);
  assert.doesNotMatch(clean, /노트:|강의자료\.pdf|^출처:/m);
});

test('summary view hides old inline code citations while keeping technical code', () => {
  const content = '## 핵심\n\nPython의 `argparse`로 명령을 처리합니다. (`자료: 수업자료.pdf PDF 페이지 2`)\n\n- CSS 주석은 `/* ... */`입니다. (`노트: 8-31 1차시`)\n\n**원문 근거:** `자료: 수업자료.pdf PDF 페이지 2`';
  const clean = stripSummarySourceLabels(content);
  assert.match(clean, /`argparse`/);
  assert.match(clean, /`\/\* \.\.\. \*\/`/);
  assert.doesNotMatch(clean, /자료:|노트:|원문 근거/);
  assert.match(clean, /Python의 `argparse`로 명령을 처리합니다\./);
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

test('infographic keeps its current page when unchanged content is rendered again', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const document=dom.window.document;
  const container=document.getElementById('stage');
  const content='# 수업 개요\n\n## 1. 첫째\n\n첫 페이지 내용입니다.\n\n---PAGE---\n\n## 2. 둘째\n\n두 번째 페이지 내용입니다.';
  const options={title:'강의노트',content,renderMarkdown:value=>{
    const node=document.createElement('div');node.textContent=value;return node;
  }};
  renderInfographicPages(document,container,options);
  container.querySelector('[aria-label="다음 인포그래픽 페이지"]').click();
  assert.equal(container.querySelector('.infographic-page-number').textContent,'2 / 2');

  renderInfographicPages(document,container,options);
  assert.equal(container.querySelector('.infographic-page-number').textContent,'2 / 2');

  renderInfographicPages(document,container,{...options,content:'# 새 첫 장\n\n첫 페이지\n\n---PAGE---\n\n# 새 둘째 장\n\n두 번째 페이지'});
  assert.equal(container.querySelector('.infographic-page-number').textContent,'1 / 2');

  renderInfographicPages(document,container,{...options,content:'# 새 결과\n\n## 새 내용\n\n새 결과의 첫 페이지입니다.'});
  assert.equal(container.querySelector('.infographic-page-number').textContent,'1 / 1');
  dom.window.close();
});

test('infographic keeps all six generated pages navigable', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const document = dom.window.document;
  const stage = document.getElementById('stage');
  const content = JSON.stringify({pages: Array.from({length: 6}, (_, index) => ({
    title: `주제 ${index + 1}`, subtitle: '', relation: '', layout: 'group',
    nodes: [{label: '개념 A', detail: '첫 번째 핵심 내용입니다.', icon: 'idea'}, {label: '개념 B', detail: '두 번째 핵심 내용입니다.', icon: 'book'}]
  }))});
  assert.equal(renderInfographicPages(document, stage, {title: '긴 강의노트', content, renderMarkdown: value => {
    const node = document.createElement('div'); node.textContent = value; return node;
  }}), 6);
  const next = stage.querySelector('[aria-label="다음 인포그래픽 페이지"]');
  for (let index = 0; index < 5; index++) next.click();
  assert.equal(stage.querySelector('.infographic-page-number').textContent, '6 / 6');
  assert.match(stage.querySelector('.infographic-visual').textContent, /주제 6/);
  assert.equal(next.disabled, true);
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
  renderInfographicPages(document,container,{title:'정보보호개론',content,renderMarkdown:value=>renderMarkdown(value,document.defaultView)});
  const svg=container.querySelector('.infographic-visual');
  assert.ok(svg);
  const decoration=svg.querySelector('.infographic-background-decoration');
  const decorationClipId=decoration.getAttribute('clip-path').slice(5,-1);
  assert.equal(svg.querySelector(`#${decorationClipId} rect`).getAttribute('rx'),'24');
  assert.equal(svg.querySelectorAll('.infographic-node').length,3);
  assert.equal(svg.querySelectorAll('path[marker-end]').length,2);
  assert.match(svg.textContent,/사실에서 정보까지/);
  assert.equal(container.querySelector('.infographic-semantic-content blockquote')?.textContent.trim(),'객관적 사실 → 기호로 표현 → 해석된 정보');
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

test('infographic titles remove generic English labels after Korean headings', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const container = dom.window.document.getElementById('stage');
  const content = JSON.stringify({pages:[{title:'핵심 요약 (Overview)',subtitle:'수업의 주요 내용을 정리합니다.',relation:'주요 내용을 순서대로 봅니다.',layout:'flow',nodes:[
    {label:'개요',detail:'수업 도구와 과정을 간단히 살펴봅니다.',icon:'idea'},
    {label:'환경',detail:'개발을 위한 기본 프로그램을 설치합니다.',icon:'gear'}
  ]}]});
  renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=dom.window.document.createElement('div');node.textContent=value;return node;
  }});
  assert.match(container.querySelector('.infographic-visual .title').textContent,/핵심 요약/);
  assert.doesNotMatch(container.querySelector('.infographic-visual .title').textContent,/Overview/);
  dom.window.close();
});

test('infographic keeps unrelated concepts parallel and selects relevant icons', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const document=dom.window.document;
  const container=document.getElementById('stage');
  const content=JSON.stringify({pages:[{title:'수업 개요',subtitle:'수업에서 다룬 핵심 내용입니다.',relation:'주요 개념을 정리했습니다.',layout:'flow',nodes:[
    {label:'출석 방법',detail:'호명으로 직접 출석을 확인합니다.',icon:'idea'},
    {label:'개발 환경',detail:'Python과 JavaScript를 설치해 실습합니다.',icon:'idea'},
    {label:'학습 단계',detail:'1~4주에는 Copilot 기초를 익힙니다.',icon:'idea'}
  ]}]});
  renderInfographicPages(document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=document.createElement('div');node.textContent=value;return node;
  }});
  const svg=container.querySelector('.infographic-visual');
  assert.ok(svg.classList.contains('infographic-layout-group'));
  assert.equal(svg.querySelectorAll('path[marker-end]').length,0);
  assert.deepEqual([...svg.querySelectorAll('.infographic-icon')].map(icon=>icon.dataset.icon),['book','gear','history']);
  assert.ok(svg.querySelector('.infographic-icon[aria-label="수업·학습"] title'));
  dom.window.close();
});

test('infographic omits generic captions from older grouped results', () => {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>');
  const container = dom.window.document.getElementById('stage');
  const content = JSON.stringify({pages:[{title:'실습 환경',subtitle:'노트의 핵심 주제를 간결하게 정리했습니다.',relation:'서로 다른 핵심 주제를 따로 살펴봅니다.',layout:'group',nodes:[
    {label:'Python',detail:'코드를 실행하려면 Python을 설치합니다.',icon:'gear'},
    {label:'JavaScript',detail:'Node.js를 설치해 코드를 실행합니다.',icon:'gear'}
  ]}]});
  renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=dom.window.document.createElement('div'); node.textContent=value; return node;
  }});
  assert.equal(container.querySelector('.infographic-visual .relation'),null);
  assert.doesNotMatch(container.querySelector('.infographic-semantic-content').textContent,/서로 다른 핵심 주제|간결하게 정리/);
  dom.window.close();
});

test('infographic titles keep parenthetical English terms together when wrapping', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const document=dom.window.document;
  const container=document.getElementById('stage');
  const content=JSON.stringify({pages:[{title:'자료 복사',subtitle:'',relation:'',layout:'group',nodes:[
    {label:'깊은 복사(Deep Copy)의 필요성',detail:'중첩된 객체까지 별도로 복사합니다.',icon:'data'},
    {label:'얕은 복사(Shallow Copy)',detail:'바깥 객체만 복사하고 내부 참조를 공유합니다.',icon:'data'}
  ]}]});
  renderInfographicPages(document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=document.createElement('div');node.textContent=value;return node;
  }});
  const lines=[...container.querySelectorAll('.infographic-node .node-label')][0].querySelectorAll('text');
  assert.deepEqual([...lines].map(line=>line.textContent),['깊은 복사','(Deep Copy)의 필요성']);
  assert.equal(lines[1].getAttribute('font-size'),'15');
  dom.window.close();
});

test('infographic draws arrows when a flow has an explicit sequence', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const document=dom.window.document;
  const container=document.getElementById('stage');
  const content=JSON.stringify({pages:[{title:'요청 처리 흐름',subtitle:'입력을 처리해 결과를 반환합니다.',relation:'먼저 입력을 받고 다음 단계에서 출력을 반환합니다.',layout:'flow',nodes:[
    {label:'입력',detail:'자료를 입력합니다.',icon:'data'},
    {label:'출력',detail:'결과를 출력합니다.',icon:'data'}
  ]}]});
  renderInfographicPages(document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=document.createElement('div');node.textContent=value;return node;
  }});
  const svg=container.querySelector('.infographic-visual');
  assert.ok(svg.classList.contains('infographic-layout-flow'));
  assert.equal(svg.querySelectorAll('path[marker-end]').length,1);
  dom.window.close();
});

test('infographic recognizes an ordered set of time ranges as a real sequence', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const document=dom.window.document;
  const container=document.getElementById('stage');
  const content=JSON.stringify({pages:[{title:'학기 계획',subtitle:'',relation:'주차별 학습 내용',layout:'flow',nodes:[
    {label:'1~4주',detail:'코파일럿 기초를 익힙니다.',icon:'history'},
    {label:'5~10주',detail:'언어별 실습을 합니다.',icon:'history'},
    {label:'11~13주',detail:'테스트와 리팩토링을 연습합니다.',icon:'history'}
  ]}]});
  renderInfographicPages(document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=document.createElement('div');node.textContent=value;return node;
  }});
  const svg=container.querySelector('.infographic-visual');
  assert.ok(svg.classList.contains('infographic-layout-flow'));
  assert.equal(svg.querySelectorAll('path[marker-end]').length,2);
  dom.window.close();
});

test('legacy infographic does not connect unrelated facts just because a detail mentions stages', () => {
  const dom=new JSDOM('<!doctype html><div id="stage"></div>');
  const document=dom.window.document;
  const container=document.getElementById('stage');
  const content='## 핵심 요약\n\n- GitHub Copilot으로 Python 실습을 합니다.\n- VS Code와 Node.js를 설치합니다.\n- 1~4주에는 도구 기초를 단계별로 배웁니다.';
  renderInfographicPages(document,container,{title:'강의노트',content,renderMarkdown:value=>{
    const node=document.createElement('div');node.textContent=value;return node;
  }});
  const svg=container.querySelector('.infographic-visual');
  assert.ok(svg.classList.contains('infographic-layout-group'));
  assert.equal(svg.querySelectorAll('path[marker-end]').length,0);
  dom.window.close();
});

test('all infographic layouts keep cards and their full detail text inside the canvas', () => {
  const cases=[['flow',2],['flow',4],['group',2],['group',4],['compare',2],['cycle',2],['cycle',3],['cycle',4],['hub',2],['hub',3],['hub',4]];
  for (const [layout,count] of cases) {
    const dom = new JSDOM('<!doctype html><div id="stage"></div>');
    const container = dom.window.document.getElementById('stage');
    const detail='인증된 사용자의 요청만 검증한 후 처리하여 데이터의 무결성을 지키고 불필요한 변경과 서비스 중단을 방지합니다';
    const content = JSON.stringify({pages:[{title:'학습 개념의 연결',subtitle:'네 가지 요소의 관계',relation:'각 요소가 서로 이어집니다',layout,nodes:[
      ...Array.from({length:count},(_,index)=>({label:`개념 ${index+1}의 핵심 용어`,detail,icon:'idea'}))
    ]}]});
    renderInfographicPages(dom.window.document,container,{title:'강의노트',content,renderMarkdown:value=>{
      const node=dom.window.document.createElement('div');node.textContent=value;return node;
    }});
    const svg=container.querySelector('.infographic-visual');
    const cards=[...svg.querySelectorAll('.infographic-node')];
    const hubCircle=layout==='hub'?svg.querySelector('circle[fill="#405f95"]'):null;
    if (hubCircle) assert.ok([...svg.querySelectorAll('.hub-label text')].every(line=>line.textContent.length<=7),'hub title does not fit inside its circle');
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
      if (hubCircle) {
        const cx=Number(hubCircle.getAttribute('cx')),cy=Number(hubCircle.getAttribute('cy'));
        const nearestX=Math.max(x,Math.min(cx,x+width)),nearestY=Math.max(y,Math.min(cy,y+height));
        assert.ok(Math.hypot(cx-nearestX,cy-nearestY)>=Number(hubCircle.getAttribute('r'))+4,`${layout}/${count} card overlaps its hub`);
      }
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
