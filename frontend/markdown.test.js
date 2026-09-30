import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown } from './markdown.js';
import { removeDuplicateLeadingTitle } from '../src/main/resources/static/note-markdown.js';

test('hides only a matching first note heading in read view', () => {
  const source = '# 0902 2차시\n\n## 수업 내용\n\n내용\n\n# 다음 주제';
  assert.equal(removeDuplicateLeadingTitle(source, '0902 2차시'), '## 수업 내용\n\n내용\n\n# 다음 주제');
  assert.equal(removeDuplicateLeadingTitle(source, '다른 노트'), source);
  assert.equal(removeDuplicateLeadingTitle('## 다른 제목\n\n내용', '다른 제목'), '## 다른 제목\n\n내용');
});

test('renders headings, tables and language-aware code without changing Markdown', () => {
  const dom = new JSDOM('');
  const source = '# 강의노트\n\n| 개념 | 설명 |\n|---|---|\n| 스택 | LIFO |\n\n```javascript\nconst answer = 42;\n```';
  const result = renderMarkdown(source, dom.window);
  assert.equal(result.querySelector('h1').textContent,'강의노트');
  assert.equal(result.querySelector('td').textContent,'스택');
  assert.ok(result.querySelector('code .hljs-keyword'));
  assert.equal(result.querySelector('code').textContent,'const answer = 42;');
});

test('blocks scripts, remote images, unsafe links, styles and DOM clobbering', () => {
  const dom = new JSDOM('');
  const result = renderMarkdown('<script>alert(1)</script>\n<img src="https://invalid.example/tracker" onerror="alert(1)">\n' +
    '<svg onload="alert(1)"></svg><iframe src="/api/auth/logout"></iframe>' +
    '<p id="note-form" style="position:fixed" onclick="alert(1)">안전</p>\n\n' +
    '[bad](javascript:alert%281%29) [relative](/api/auth/logout) [good](https://example.com)\n\n![diagram](https://invalid.example/a.png)',dom.window);
  assert.equal(result.querySelector('script,img,svg,iframe,[id],[style],[onclick],[onerror]'),null);
  const links = [...result.querySelectorAll('a')];
  assert.equal(links[0].hasAttribute('href'),false);
  assert.equal(links[1].hasAttribute('href'),false);
  assert.equal(links[2].getAttribute('rel'),'noopener noreferrer');
  assert.ok(result.textContent.includes('[이미지: diagram]'));
});

test('unknown code language stays escaped plain text', () => {
  const dom = new JSDOM('');
  const result = renderMarkdown('```unknown-language\n<img src=x onerror=alert(1)>\n```',dom.window);
  assert.equal(result.querySelector('img'),null);
  assert.equal(result.querySelector('code').textContent,'<img src=x onerror=alert(1)>');
});
