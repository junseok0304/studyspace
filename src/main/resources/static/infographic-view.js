/** Split a generated infographic into readable, navigable pages. */
const infographicViewerStates = new WeakMap();

export function paginateInfographic(markdown, maxChars = 1400) {
  const source = stripInfographicSources(markdown).trim();
  if (!source) return [];
  const explicit = source.split(/^\s*(?:---PAGE---|<!--\s*PAGE\s*-->)\s*$/m).map(page => page.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;

  const sections = source.split(/(?=^#{2,3}\s)/m).map(section => section.trim()).filter(Boolean);
  const blocks = sections.length > 1 ? sections : source.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  const pages = [];
  let current = '';
  for (const block of blocks) {
    if (block.length > maxChars) {
      const lines = block.split(/\n/);
      let part = '';
      for (const line of lines) {
        if (part && part.length + line.length + 1 > maxChars) {
          if (current) { pages.push(current); current = ''; }
          pages.push(part.trim());
          part = '';
        }
        part += `${part ? '\n' : ''}${line}`;
      }
      if (part.trim()) {
        if (current && current.length + part.length + 2 <= maxChars) current += `\n\n${part.trim()}`;
        else { if (current) pages.push(current); current = part.trim(); }
      }
      continue;
    }
    if (current && current.length + block.length + 2 > maxChars) {
      pages.push(current);
      current = block;
    } else current += `${current ? '\n\n' : ''}${block}`;
  }
  if (current) pages.push(current);
  return pages.length ? pages : [source];
}

/** Remove citation-only sections and markers, including from older saved results. */
export function stripInfographicSources(markdown) {
  const lines = String(markdown || '').split('\n');
  const kept = [];
  let droppingSection = false;
  for (const line of lines) {
    if (/^\s*---PAGE---\s*$/.test(line)) { droppingSection = false; kept.push(line); continue; }
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      droppingSection = /^\s{0,3}#{1,6}\s*.*(?:출처|참고|근거|reference|citation)/i.test(line);
      if (!droppingSection) kept.push(line);
      continue;
    }
    const sourceReferenceLine = /^\s*(?:[-*+]\s*)?(?:출처|참고(?:\s*자료|문헌)?|자료\s*출처|근거(?:\s*자료)?|references?|citations?)\s*[:：]/i.test(line)
      || /^\s*(?:[-*+]\s*)?[^\n]*\.(?:pdf|pptx?|hwp|png)(?:\s*(?:,|·|\s)*(?:p(?:age)?\.?\s*\d+|페이지\s*\d+|슬라이드\s*\d+|구역\s*\d+))?\s*$/i.test(line);
    if (droppingSection || sourceReferenceLine) continue;
    if (/^\s*\[\^?\d+\]:/.test(line)) continue;
    kept.push(line.replace(/\[\^?\d+\]/g, '')
      .replace(/\s*\[(?:출처|참고|자료|근거)[^\]]*\]/gi, '')
      .replace(/\s*\((?:출처|참고|자료|근거)[^)]*\)/gi, '')
      .replace(/\s*\[[^\]]+\.(?:pdf|pptx?|hwp|png)[^\]]*\]\([^)]*\)/gi, '')
      .replace(/\s*\[[^\]]*\.(?:pdf|pptx?|hwp|png)[^\]]*\]/gi, '')
      .replace(/\s*\([^)]*\.(?:pdf|pptx?|hwp|png)[^)]*\)/gi, '')
      .replace(/\s*\([^)]*(?:\.pdf|\.pptx?|\.hwp|\.png)[^)]*(?:p(?:age)?\.?\s*\d+|페이지\s*\d+|슬라이드\s*\d+)[^)]*\)/gi, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function renderInfographicPages(document, container, {title, content, renderMarkdown}) {
  const pages = normalizeInfographicPages(removeRepeatedCoverTitle(content, title), title);
  const pageKey = `${title || ''}\u0000${content || ''}`;
  const previousState = infographicViewerStates.get(container);
  let page = previousState?.pageKey === pageKey ? Math.max(0, Math.min(previousState.page, pages.length - 1)) : 0;
  infographicViewerStates.set(container, {pageKey, page});
  container.replaceChildren();
  if (!pages.length) return 0;

  const viewer = document.createElement('div');
  viewer.className = 'infographic-viewer';
  const topbar = document.createElement('div');
  topbar.className = 'infographic-page-controls';
  const previous = document.createElement('button');
  previous.type = 'button'; previous.className = 'infographic-arrow'; previous.textContent = '‹';
  previous.setAttribute('aria-label', '이전 인포그래픽 페이지');
  const progressTrack = document.createElement('div');
  progressTrack.className = 'infographic-progress-track';
  progressTrack.setAttribute('role', 'progressbar');
  progressTrack.setAttribute('aria-label', '인포그래픽 페이지 진행');
  progressTrack.setAttribute('aria-valuemin', '1');
  progressTrack.setAttribute('aria-valuemax', String(pages.length));
  const progressFill = document.createElement('span');
  progressTrack.append(progressFill);
  const pageNumber = document.createElement('span');
  pageNumber.className = 'infographic-page-number';
  pageNumber.setAttribute('aria-live', 'polite');
  const next = document.createElement('button');
  next.type = 'button'; next.className = 'infographic-arrow'; next.textContent = '›';
  next.setAttribute('aria-label', '다음 인포그래픽 페이지');
  topbar.append(previous, progressTrack, pageNumber, next);
  const sheet = document.createElement('article');
  sheet.className = 'infographic-page infographic-graphic-page';
  sheet.setAttribute('aria-label', '인포그래픽 페이지');
  viewer.append(topbar, sheet);
  container.append(viewer);

  const show = () => {
    infographicViewerStates.set(container, {pageKey, page});
    previous.disabled = page === 0;
    next.disabled = page === pages.length - 1;
    pageNumber.textContent = `${page + 1} / ${pages.length}`;
    progressTrack.setAttribute('aria-valuenow', String(page + 1));
    progressFill.style.width = `${((page + 1) / pages.length) * 100}%`;
    const pageContent = pages[page];
    sheet.replaceChildren(renderInfographicGraphic(document, pageContent, page));
    const semantic = document.createElement('div');
    semantic.className = 'infographic-semantic-content';
    const titleAlreadyShown = cleanText(pageContent.title) === cleanText(title);
    const semanticParts = titleAlreadyShown ? [] : [`# ${title || pageContent.title}`, `## ${pageContent.title}`];
    const rawRelation = cleanText(pageContent.relation);
    const semanticSubtitle = cleanCaption(cleanText(pageContent.subtitle).replace(new RegExp(`\\s*${escapeRegex(rawRelation)}$`), '').trim());
    if (semanticSubtitle) semanticParts.push(semanticSubtitle);
    if (rawRelation) semanticParts.push(`> ${rawRelation}`);
    semanticParts.push(...pageContent.nodes.map(node => `### ${node.label}\n\n${node.detail}`));
    semantic.append(renderMarkdown(semanticParts.join('\n\n')));
    sheet.append(semantic);
    sheet.scrollTop = 0;
  };
  previous.onclick = () => { if (page > 0) { page--; show(); } };
  next.onclick = () => { if (page < pages.length - 1) { page++; show(); } };
  show();
  return pages.length;
}

let infographicId = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#4f78be', '#1d9690', '#8a6fc0', '#df8d45'];

function normalizeInfographicPages(content, fallbackTitle) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.pages) && parsed.pages.length) return parsed.pages.slice(0, 6).map(page => {
      const rawRelation = cleanText(page.relation);
      const subtitle = cleanCaption(cleanText(page.subtitle).replace(new RegExp(`\\s*${escapeRegex(rawRelation)}$`), '').trim());
      const nodes = (page.nodes || []).slice(0, 4).map(node => ({
        label: cleanText(node.label).slice(0, 50), detail: cleanText(node.detail).slice(0, 180)
      })).filter(node => node.label && node.detail);
      const distinctNodes = nodes.filter(node => node.detail !== node.label);
      const requestedLayout=['flow','compare','cycle','hub','group'].includes(page.layout)?page.layout:'group';
      const sequenceText=[page.title,page.subtitle,page.relation].join(' ');
      return {
        title: cleanInfographicTitle(page.title) || fallbackTitle || '핵심 개념',
        subtitle, relation: cleanCaption(rawRelation),
        layout: requestedLayout==='flow'&&!hasExplicitSequence(sequenceText)&&!hasOrderedTimeNodes(nodes)?'group':requestedLayout,
        nodes: distinctNodes.length >= 2 ? distinctNodes : nodes
      };
    }).filter(page => page.nodes.length >= 1);
  } catch { /* Legacy saved Markdown is converted below. */ }

  return paginateInfographic(content, 1800).slice(0, 6).map((markdown, index) => markdownPage(markdown, fallbackTitle, index)).filter(page => page.nodes.length >= 1);
}

function markdownPage(markdown, fallbackTitle, index) {
  const lines = String(markdown).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headings = lines.filter(line => /^#{1,3}\s/.test(line)).map(line => line.replace(/^#{1,3}\s*/, ''));
  const bullets = lines.filter(line => /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)).map(line => line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ''));
  const prose = lines.filter(line => !/^#{1,6}\s/.test(line) && !/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line) && !/^---PAGE---$/.test(line) && cleanText(line) !== cleanText(fallbackTitle));
  const candidates = bullets.length ? bullets : prose;
  const chosen = [...new Set(candidates.map(cleanText).filter(Boolean))].slice(0, 4);
  const pageTitle = cleanInfographicTitle(headings.find(Boolean) || (index ? `${fallbackTitle || '핵심 내용'} · ${index + 1}` : fallbackTitle || '핵심 내용'));
  const nodes = chosen.map((detail, nodeIndex) => ({label: inferLabel(detail, nodeIndex), detail: detail.slice(0, 180)}));
  const diagramContext=`${headings.join(' ')} ${prose[0]||''}`;
  const layout = /비교|차이|반면|대조/.test(markdown) ? 'compare' : /순환|반복|주기/.test(markdown) ? 'cycle' : /중심|하위|구성요소/.test(markdown) ? 'hub' : hasExplicitSequence(diagramContext)||hasOrderedTimeNodes(nodes) ? 'flow' : 'group';
  const distinctNodes = nodes.filter(node => cleanText(node.detail) !== cleanText(node.label));
  return {
    title: pageTitle, subtitle: cleanCaption(prose[0] ? cleanText(prose[0]).slice(0, 120) : ''),
    relation: layout === 'compare' ? '두 관점을 나란히 살펴봅니다' : layout === 'cycle' ? '각 요소가 서로 이어집니다' : layout === 'hub' ? '중심 개념과 주요 요소' : '', layout,
    nodes: distinctNodes.length >= 2 ? distinctNodes : nodes
  };
}

function renderInfographicGraphic(document, page, pageIndex) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `infographic-visual infographic-layout-${page.layout}`);
  svg.setAttribute('viewBox', '0 0 1120 620');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-labelledby', `infographic-title-${pageIndex} infographic-desc-${pageIndex}`);
  svg.setAttribute('focusable', 'false');
  const id = `infographic-arrow-${++infographicId}`;
  const backgroundClipId = `${id}-background`;
  const defs = svgNode(document, 'defs');
  const marker = svgNode(document, 'marker', {id, markerWidth: 10, markerHeight: 10, refX: 8, refY: 5, orient: 'auto', markerUnits: 'strokeWidth'});
  marker.append(svgNode(document, 'path', {d: 'M0 0 10 5 0 10z', fill: '#90a5bd'}));
  const backgroundClip = svgNode(document, 'clipPath', {id: backgroundClipId, clipPathUnits: 'userSpaceOnUse'});
  backgroundClip.append(svgNode(document, 'rect', {x: 0, y: 0, width: 1120, height: 620, rx: 24}));
  defs.append(marker, backgroundClip); svg.append(defs);
  svg.append(svgNode(document, 'rect', {x: 0, y: 0, width: 1120, height: 620, rx: 24, fill: '#f6f8fc'}));
  const decoration = svgNode(document, 'g', {class: 'infographic-background-decoration', 'clip-path': `url(#${backgroundClipId})`});
  decoration.append(svgNode(document, 'circle', {cx: 1010, cy: 70, r: 102, fill: '#eaf2fb'}));
  decoration.append(svgNode(document, 'circle', {cx: 70, cy: 585, r: 110, fill: '#eaf6f4'}));
  svg.append(decoration);
  svg.append(svgText(document, `infographic-title-${pageIndex}`, page.title, 58, 75, 'title'));
  const rawRelation = cleanText(page.relation);
  const relationText = cleanCaption(rawRelation);
  const subtitle = cleanCaption(cleanText(page.subtitle).replace(new RegExp(`\\s*${escapeRegex(rawRelation)}$`), '').trim());
  if (subtitle) svg.append(svgText(document, `infographic-desc-${pageIndex}`, subtitle, 60, 112, 'subtitle'));
  if (relationText) {
    const relation = svgNode(document, 'g');
    relation.append(svgNode(document, 'rect', {x: 60, y: 145, width: 1000, height: 42, rx: 21, fill: '#e9eef8'}));
    relation.append(svgText(document, null, relationText, 560, 172, 'relation', 'middle'));
    svg.append(relation);
  }
  const diagramOffset = relationText ? 0 : subtitle ? -35 : -58;
  if (page.layout === 'cycle') drawCycle(document, svg, page, id, diagramOffset);
  else if (page.layout === 'hub') drawHub(document, svg, page, id, diagramOffset);
  else drawFlow(document, svg, page, id, diagramOffset);
  svg.append(svgText(document, null, `${pageIndex + 1} · 시각 학습 자료`, 1050, 594, 'page-tag', 'end'));
  return svg;
}

function drawFlow(document, svg, page, arrowId, verticalOffset = 0) {
  const nodes = page.nodes, gap = 34, width = Math.min(994 / nodes.length - gap, 270), total = nodes.length * width + (nodes.length - 1) * gap;
  const start = (1120 - total) / 2, y = 258 + verticalOffset, height = 272;
  nodes.forEach((node, index) => {
    const x = start + index * (width + gap), color = PALETTE[index % PALETTE.length];
    if (index < nodes.length - 1 && page.layout === 'compare') {
      const centerX = x + width + gap / 2;
      svg.append(svgNode(document, 'circle', {cx: centerX, cy: y + 126, r: 19, fill: '#fff', stroke: '#dbe4ef', 'stroke-width': 2}));
      svg.append(svgText(document, null, '↔', centerX, y + 132, 'compare-mark', 'middle'));
    } else if (page.layout === 'flow' && index < nodes.length - 1) svg.append(svgNode(document, 'path', {d: `M${x + width + 5} ${y + 126} H${x + width + gap - 7}`, stroke: '#91a5ba', 'stroke-width': 3, 'marker-end': `url(#${arrowId})`}));
    drawCard(document, svg, node, x, y, width, height, color, index + 1);
  });
}

function drawCycle(document, svg, page, arrowId, verticalOffset = 0) {
  const nodes = page.nodes;
  const fourNodeLayout = nodes.length === 4;
  const center = {x: 560, y: (fourNodeLayout ? 402 : nodes.length === 2 ? 405 : 436) + verticalOffset};
  const radius = nodes.length === 2 ? 210 : fourNodeLayout ? 122 : 147;
  const cardW = nodes.length === 2 ? 300 : fourNodeLayout ? 212 : 252;
  const cardH = 178;
  const points = nodes.length === 2 ? [{x: 335, y: center.y}, {x: 785, y: center.y}] : nodes.map((_, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / nodes.length; return {x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius}; });
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next.x - point.x, dy = next.y - point.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    svg.append(svgNode(document, 'path', {d: `M${point.x + ux * (cardW * .44)} ${point.y + uy * (cardH * .32)} Q${center.x} ${center.y} ${next.x - ux * (cardW * .44)} ${next.y - uy * (cardH * .32)}`, fill: 'none', stroke: '#91a5ba', 'stroke-width': 3, 'marker-end': `url(#${arrowId})`}));
  });
  points.forEach((point, index) => drawCard(document, svg, nodes[index], point.x - cardW / 2, point.y - cardH / 2, cardW, cardH, PALETTE[index % PALETTE.length], index + 1, true));
}

function drawHub(document, svg, page, arrowId, verticalOffset = 0) {
  const nodes = page.nodes, centerX = 560;
  const threeNodeHub = nodes.length === 3;
  const centerY = (threeNodeHub ? 365 : 405) + verticalOffset;
  const cardW = nodes.length === 2 ? 350 : threeNodeHub ? 280 : 330;
  const cardH = nodes.length === 2 ? 210 : 176;
  const basePositions = nodes.length === 2 ? [[285, 405], [835, 405]] : threeNodeHub ? [[270, 385], [850, 385], [560, 525]] : [[270, 295], [850, 295], [270, 510], [850, 510]];
  const positions = basePositions.map(([x,y]) => [x,y+verticalOffset]);
  positions.forEach(([x, y]) => svg.append(svgNode(document, 'path', {d: `M${centerX} ${centerY} L${x} ${y}`, stroke: '#9aacc2', 'stroke-width': 3, 'marker-end': `url(#${arrowId})`})));
  svg.append(svgNode(document, 'circle', {cx: centerX, cy: centerY, r: nodes.length === 2 ? 58 : 62, fill: '#405f95', stroke: '#fff', 'stroke-width': 8}));
  svg.append(svgText(document, null, wrap(page.title, 7).slice(0, 2), centerX, centerY - 3, 'hub-label', 'middle'));
  positions.forEach(([x, y], index) => drawCard(document, svg, nodes[index], x - cardW / 2, y - cardH / 2, cardW, cardH, PALETTE[index % PALETTE.length], index + 1, true));
}

function drawCard(document, svg, node, x, y, width, height, color, number, compact = false) {
  const card = svgNode(document, 'g', {class: 'infographic-node'});
  card.append(svgNode(document, 'rect', {x, y, width, height, rx: 20, fill: '#fff', stroke: '#e0e7f0', 'stroke-width': 2, filter: 'drop-shadow(0 8px 14px rgba(51,74,104,.09))'}));
  card.append(svgNode(document, 'path', {d: `M${x + 20} ${y} H${x + width - 20} Q${x + width} ${y} ${x + width} ${y + 20} V${y + 11} H${x} V${y + 20} Q${x} ${y} ${x + 20} ${y}`, fill: color}));
  const compactCycleCard = compact && width <= 252 && height <= 180;
  const labelY = compactCycleCard ? y + 43 : compact ? y + 55 : y + 78;
  const labelChars = Math.max(9, Math.floor((width - 34) / 18));
  const labelLayout=wrapLabel(node.label,labelChars);
  const labelGroup = svgText(document, null, labelLayout.lines.slice(0, 2), x + width / 2, labelY, compactCycleCard ? 'node-label node-label-cycle' : 'node-label', 'middle', compactCycleCard ? 18 : 21);
  if (compactCycleCard) labelGroup.querySelectorAll('text').forEach(line => line.setAttribute('font-size', '16'));
  else if(labelLayout.compact) labelGroup.querySelectorAll('text').forEach(line=>line.setAttribute('font-size','15'));
  card.append(labelGroup);
  const detailY = compactCycleCard ? y + 82 : compact ? y + 98 : y + 126;
  const detailChars = Math.max(10, Math.floor((width - 38) / 14));
  let detail = cleanText(node.detail);
  const label = cleanText(node.label);
  if (detail === label) detail = '';
  else if (label && detail.startsWith(label)) detail = detail.slice(label.length).replace(/^[\s:：·–—-]+/, '').trim();
  if (detail) card.append(svgText(document, null, wrap(detail, detailChars).slice(0, compactCycleCard ? 6 : compact ? 5 : 8), x + width / 2, detailY, 'node-detail', 'middle', compactCycleCard ? 15 : 18));
  card.append(svgText(document, null, String(number).padStart(2, '0'), x + 17, y + 28, 'node-index'));
  svg.append(card);
}

function svgNode(document, name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function svgText(document, id, text, x, y, className, anchor = 'start', lineHeight = 23) {
  const outer = svgNode(document, 'g', {'text-anchor': anchor, class: className});
  if (id) outer.setAttribute('id', id);
  const lines = Array.isArray(text) ? text : [String(text || '')];
  lines.forEach((line, index) => {
    const textNode = svgNode(document, 'text', {x, y: y + index * lineHeight});
    textNode.textContent = line;
    outer.append(textNode);
  });
  return outer;
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ')
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '').replace(/^\d+[.)]\s*/, '')
    .replace(/\*\*|__|\*|_|`|~~/g, '').trim();
}
function cleanInfographicTitle(value) {
  return cleanText(value).replace(/\s*\((?:overview|summary)\)\s*$/i, '').trim();
}
function cleanCaption(value) {
  const text = cleanText(value);
  const key = text.normalize('NFKC').replace(/[\s.!。]/g, '');
  if (['핵심개념사이의연결','핵심개념과관계','핵심개념과관계를그림으로정리했습니다','핵심내용을그림으로정리했습니다','핵심개념을연결합니다','서로다른핵심주제를따로살펴봅니다','노트의핵심주제를간결하게정리했습니다'].includes(key)) return '';
  return text;
}
function escapeRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wrap(text, limit) {
  const words = String(text || '').match(/\S*\([^)]*\)\S*|\S+/g) || [];
  const tokens=[];
  for(const word of words) {
    const parenthetical=word.match(/^([^()]*)\(([^()]*)\)(.*)$/);
    const phrase=parenthetical?`(${parenthetical[2]})${parenthetical[3]}`:'';
    if(parenthetical&&parenthetical[1]&&phrase.length<=limit) tokens.push(parenthetical[1],phrase);
    else tokens.push(word);
  }
  const lines = [];
  let line = '';
  for (const word of tokens) {
    let remainder = word;
    while (remainder.length) {
      const available = limit - line.length - (line ? 1 : 0);
      if (remainder.length <= available) { line += `${line ? ' ' : ''}${remainder}`; remainder = ''; }
      else if (line) { lines.push(line); line = ''; }
      else { lines.push(remainder.slice(0, limit)); remainder = remainder.slice(limit); }
    }
  }
  if (line) lines.push(line);
  return lines;
}
function wrapLabel(text,limit) {
  const lines=wrap(text,limit);
  const technical=String(text||'').match(/^(.*?)\s*\(([^)]*)\)(.*)$/);
  if(lines.length>2&&technical&&technical[1].trim()&&/[A-Za-z]/.test(technical[2])) {
    const first=technical[1].trim(),second=`(${technical[2]})${technical[3]}`.trim();
    if(first.length<=limit&&second.length<=limit+10) return {lines:[first,second],compact:true};
  }
  return {lines,compact:false};
}
function inferLabel(text, index) {
  const match = String(text).match(/^([^:：。,.!?]{2,24})[:：]/);
  return match?.[1]?.trim() || String(text).slice(0, 18).trim() || `핵심 ${index + 1}`;
}
function hasExplicitSequence(text) {
  return /(?:단계별|순서|먼저|그다음|다음 단계|이후|마지막으로|전(?:체|반)|후(?:반|속)|거쳐|부터.{0,30}까지|원인.{0,24}결과|요청.{0,32}응답|입력.{0,32}출력|전달.{0,24}반환|흐름|순환|반복|주기|→|->)/i.test(String(text||''));
}

function hasOrderedTimeNodes(nodes) {
  const ranges=(nodes||[]).map(node=>String(node.label||'').match(/(\d+)\s*(?:~|–|-)\s*(\d+)\s*(?:주차?|일|개월)/)).filter(Boolean).map(match=>[Number(match[1]),Number(match[2])]);
  return ranges.length>=2&&ranges.length===nodes.length&&ranges.every((range,index)=>index===0||range[0]>ranges[index-1][0]);
}

function hasInfographicBody(markdown) {
  return String(markdown || '').split('\n').some(line => {
    const value = line.trim();
    return value && !/^#{1,6}\s/.test(value) && !/^(?:---PAGE---|---+)$/.test(value);
  });
}

function removeRepeatedCoverTitle(markdown, title) {
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const expected = normalize(title);
  if (!expected) return String(markdown || '');
  const lines = String(markdown || '').split('\n');
  let coverTitleFound = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const h1 = line.match(/^#\s+(.+)$/);
    if (!coverTitleFound && h1 && normalize(h1[1]) === expected) {
      coverTitleFound = true;
      continue;
    }
    if (coverTitleFound && !/^#{1,6}\s/.test(line) && normalize(line) === expected) {
      lines[index] = '';
      break;
    }
  }
  return lines.join('\n');
}
