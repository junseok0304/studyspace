import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { infographicSvg, mindMapSvg, renderMindMap } from '../src/main/resources/static/artifact-visuals.js';

test('mind map visualization escapes content and exposes accessible structure',()=>{
  const tree={label:'운영체제 <script>',children:[{label:'프로세스',children:[{label:'스케줄링'}]}]};
  const svg=mindMapSvg(tree);assert.match(svg,/&lt;script&gt;/);assert.doesNotMatch(svg,/<script>/);assert.match(svg,/aria-labelledby="title"/);
  const dom=new JSDOM('<div id="map"></div>');const container=dom.window.document.getElementById('map');renderMindMap(dom.window.document,container,tree);
  assert.equal(container.querySelectorAll('li').length,3);container.querySelector('.mind-map-node').click();assert.equal(container.querySelector('ul ul').hidden,true);
});

test('infographic SVG keeps text accessible and strips markdown decoration',()=>{
  const svg=infographicSvg('정리 <보기>','# 핵심\n- **중요 개념**');
  assert.match(svg,/<desc/);assert.match(svg,/정리 &lt;보기&gt;/);assert.match(svg,/중요 개념/);assert.doesNotMatch(svg,/<보기>/);
});
