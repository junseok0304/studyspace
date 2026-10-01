/** Split a generated infographic into readable, navigable pages. */
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

  let page = 0;
  const show = () => {
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
const ICON_PATHS = {
  data: ['M3 5c0-2 14-2 14 0s-14 2-14 0v10c0 2 14 2 14 0V5', 'M3 10c0 2 14 2 14 0'],
  shield: ['M10 2 17 5v5c0 4-3 7-7 9-4-2-7-5-7-9V5z', 'm7 10 2 2 4-4'],
  lock: ['M5 9V6a5 5 0 0 1 10 0v3', 'M4 9h12v9H4z', 'M10 12v3'],
  network: ['M10 4 5 14h10z', 'M10 4v11', 'M5 14h10'],
  history: ['M3 5v5h5', 'M4.5 9a6 6 0 1 1-.2 3', 'M10 6v5l3 2'],
  person: ['M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M3 18c.5-4 13.5-4 14 0'],
  key: ['M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'm11 10 6 6m-2-2 2-2m-4 0 2-2'],
  server: ['M3 3h14v5H3zM3 12h14v5H3z', 'M6 5.5h.1M6 14.5h.1M10 5.5h4M10 14.5h4'],
  mobile: ['M5 2h10v16H5z', 'M9 15h2'],
  gear: ['M10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M10 2v2m0 12v2M2 10h2m12 0h2M4.3 4.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4m-8.6 8.6-1.4 1.4'],
  globe: ['M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16', 'M2 10h16M10 2c4 4 4 12 0 16M10 2c-4 4-4 12 0 16'],
  warning: ['m10 2 8 15H2z', 'M10 7v4m0 3h.1'],
  check: ['M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16', 'm6 10 3 3 5-6'],
  book: ['M3 4h5a3 3 0 0 1 3 3v10a3 3 0 0 0-3-3H3z', 'M17 4h-3a3 3 0 0 0-3 3v10a3 3 0 0 1 3-3h3z'],
  money: ['M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16', 'M12.5 7.5c-.5-1-4-1-4 1s4 1 4 3-3.5 2-5 1', 'M10 5v10'],
  idea: ['M7 13c0-2-2-3-2-6a5 5 0 0 1 10 0c0 3-2 4-2 6z', 'M7 15h6m-5 2h4']
};

function normalizeInfographicPages(content, fallbackTitle) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.pages) && parsed.pages.length) return parsed.pages.slice(0, 3).map(page => {
      const rawRelation = cleanText(page.relation);
      const subtitle = cleanCaption(cleanText(page.subtitle).replace(new RegExp(`\\s*${escapeRegex(rawRelation)}$`), '').trim());
      const nodes = (page.nodes || []).slice(0, 4).map(node => ({
        label: cleanText(node.label).slice(0, 50), detail: cleanText(node.detail).slice(0, 60),
        icon: Object.hasOwn(ICON_PATHS, node.icon) ? node.icon : 'idea'
      })).filter(node => node.label && node.detail);
      const distinctNodes = nodes.filter(node => node.detail !== node.label);
      return {
        title: cleanText(page.title) || fallbackTitle || '핵심 개념',
        subtitle, relation: cleanCaption(rawRelation),
        layout: ['flow', 'compare', 'cycle', 'hub'].includes(page.layout) ? page.layout : 'flow',
        nodes: distinctNodes.length >= 2 ? distinctNodes : nodes
      };
    }).filter(page => page.nodes.length >= 1);
  } catch { /* Legacy saved Markdown is converted below. */ }

  return paginateInfographic(content, 1800).slice(0, 3).map((markdown, index) => markdownPage(markdown, fallbackTitle, index)).filter(page => page.nodes.length >= 1);
}

function markdownPage(markdown, fallbackTitle, index) {
  const lines = String(markdown).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headings = lines.filter(line => /^#{1,3}\s/.test(line)).map(line => line.replace(/^#{1,3}\s*/, ''));
  const bullets = lines.filter(line => /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)).map(line => line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ''));
  const prose = lines.filter(line => !/^#{1,6}\s/.test(line) && !/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line) && !/^---PAGE---$/.test(line) && cleanText(line) !== cleanText(fallbackTitle));
  const candidates = bullets.length ? bullets : prose;
  const chosen = [...new Set(candidates.map(cleanText).filter(Boolean))].slice(0, 4);
  const pageTitle = cleanText(headings.find(Boolean) || (index ? `${fallbackTitle || '핵심 내용'} · ${index + 1}` : fallbackTitle || '핵심 내용'));
  const layout = /비교|차이|반면|대조/.test(markdown) ? 'compare' : /순환|반복|주기/.test(markdown) ? 'cycle' : /구성|요소|종류/.test(markdown) ? 'hub' : 'flow';
  const nodes = chosen.map((detail, nodeIndex) => ({label: inferLabel(detail, nodeIndex), detail: detail.slice(0, 180), icon: inferIcon(detail)}));
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
  const defs = svgNode(document, 'defs');
  const marker = svgNode(document, 'marker', {id, markerWidth: 10, markerHeight: 10, refX: 8, refY: 5, orient: 'auto', markerUnits: 'strokeWidth'});
  marker.append(svgNode(document, 'path', {d: 'M0 0 10 5 0 10z', fill: '#90a5bd'})); defs.append(marker); svg.append(defs);
  svg.append(svgNode(document, 'rect', {x: 0, y: 0, width: 1120, height: 620, rx: 24, fill: '#f6f8fc'}));
  svg.append(svgNode(document, 'circle', {cx: 1010, cy: 70, r: 102, fill: '#eaf2fb'}));
  svg.append(svgNode(document, 'circle', {cx: 70, cy: 585, r: 110, fill: '#eaf6f4'}));
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
    } else if (index < nodes.length - 1) svg.append(svgNode(document, 'path', {d: `M${x + width + 5} ${y + 126} H${x + width + gap - 7}`, stroke: '#91a5ba', 'stroke-width': 3, 'marker-end': `url(#${arrowId})`}));
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
  const nodes = page.nodes, centerX = 560, centerY = 405 + verticalOffset;
  const cardW = nodes.length === 2 ? 350 : nodes.length === 3 ? 310 : 330;
  const cardH = nodes.length === 2 ? 210 : 176;
  const basePositions = nodes.length === 2 ? [[285, 405], [835, 405]] : nodes.length === 3 ? [[270, 295], [850, 295], [560, 510]] : [[270, 295], [850, 295], [270, 510], [850, 510]];
  const positions = basePositions.map(([x,y]) => [x,y+verticalOffset]);
  positions.forEach(([x, y]) => svg.append(svgNode(document, 'path', {d: `M${centerX} ${centerY} L${x} ${y}`, stroke: '#9aacc2', 'stroke-width': 3, 'marker-end': `url(#${arrowId})`})));
  svg.append(svgNode(document, 'circle', {cx: centerX, cy: centerY, r: nodes.length === 2 ? 58 : 62, fill: '#405f95', stroke: '#fff', 'stroke-width': 8}));
  svg.append(svgText(document, null, wrap(page.title, 15).slice(0, 2), centerX, centerY - 3, 'hub-label', 'middle'));
  positions.forEach(([x, y], index) => drawCard(document, svg, nodes[index], x - cardW / 2, y - cardH / 2, cardW, cardH, PALETTE[index % PALETTE.length], index + 1, true));
}

function drawCard(document, svg, node, x, y, width, height, color, number, compact = false) {
  const card = svgNode(document, 'g', {class: 'infographic-node'});
  card.append(svgNode(document, 'rect', {x, y, width, height, rx: 20, fill: '#fff', stroke: '#e0e7f0', 'stroke-width': 2, filter: 'drop-shadow(0 8px 14px rgba(51,74,104,.09))'}));
  card.append(svgNode(document, 'path', {d: `M${x + 20} ${y} H${x + width - 20} Q${x + width} ${y} ${x + width} ${y + 20} V${y + 11} H${x} V${y + 20} Q${x} ${y} ${x + 20} ${y}`, fill: color}));
  const compactCycleCard = compact && width <= 220 && height <= 180;
  const iconY = compactCycleCard ? y + 37 : compact ? y + 43 : y + 70;
  const iconR = compactCycleCard ? 20 : compact ? 23 : 32;
  card.append(svgNode(document, 'circle', {cx: x + width / 2, cy: iconY, r: iconR, fill: color}));
  drawIcon(document, card, node.icon, x + width / 2 - 12, iconY - 12);
  const labelY = compactCycleCard ? y + 68 : compact ? y + 82 : y + 132;
  const labelChars = Math.max(9, Math.floor((width - 34) / 18));
  card.append(svgText(document, null, wrap(node.label, labelChars).slice(0, 2), x + width / 2, labelY, 'node-label', 'middle', 21));
  const detailY = compactCycleCard ? y + 105 : compact ? y + 112 : y + 174;
  const detailChars = Math.max(10, Math.floor((width - 38) / 14));
  let detail = cleanText(node.detail);
  const label = cleanText(node.label);
  if (detail === label) detail = '';
  else if (label && detail.startsWith(label)) detail = detail.slice(label.length).replace(/^[\s:：·–—-]+/, '').trim();
  if (detail) card.append(svgText(document, null, wrap(detail, detailChars).slice(0, compactCycleCard ? 5 : compact ? 4 : 6), x + width / 2, detailY, 'node-detail', 'middle', compactCycleCard ? 15 : 18));
  card.append(svgText(document, null, String(number).padStart(2, '0'), x + 17, y + 28, 'node-index'));
  svg.append(card);
}

function drawIcon(document, parent, icon, x, y) {
  const group = svgNode(document, 'g', {transform: `translate(${x} ${y})`, fill: 'none', stroke: '#fff', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
  (ICON_PATHS[icon] || ICON_PATHS.idea).forEach(d => group.append(svgNode(document, 'path', {d})));
  parent.append(group);
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
function cleanCaption(value) {
  const text = cleanText(value);
  const key = text.normalize('NFKC').replace(/[\s.!。]/g, '');
  if (['핵심개념사이의연결','핵심개념과관계','핵심개념과관계를그림으로정리했습니다','핵심내용을그림으로정리했습니다','핵심개념을연결합니다'].includes(key)) return '';
  return text;
}
function escapeRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wrap(text, limit) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
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
function inferLabel(text, index) {
  const match = String(text).match(/^([^:：。,.!?]{2,24})[:：]/);
  return match?.[1]?.trim() || String(text).slice(0, 18).trim() || `핵심 ${index + 1}`;
}
function inferIcon(text) {
  const value = String(text);
  if (/보안|기밀|무결성|접근|권한/.test(value)) return 'shield';
  if (/데이터/.test(value)) return 'data';
  if (/정보|네트워크|공유/.test(value)) return 'network';
  if (/역사|최초|시기/.test(value)) return 'history';
  if (/인증|사용자|사람/.test(value)) return 'person';
  if (/서버|시스템|로그/.test(value)) return 'server';
  if (/모바일|휴대폰/.test(value)) return 'mobile';
  if (/위험|공격|취약/.test(value)) return 'warning';
  if (/정답|허용|가능/.test(value)) return 'check';
  if (/시험|문제|학습/.test(value)) return 'book';
  return 'idea';
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
