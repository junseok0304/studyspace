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
    if (droppingSection || /^\s*(?:[-*+]\s*)?(?:출처|참고(?:\s*자료|문헌)?|자료\s*출처|근거(?:\s*자료)?|references?|citations?)\s*[:：]/i.test(line)) continue;
    if (/^\s*\[\^?\d+\]:/.test(line)) continue;
    kept.push(line.replace(/\[\^?\d+\]/g, '')
      .replace(/\s*\[(?:출처|참고|자료|근거)[^\]]*\]/gi, '')
      .replace(/\s*\((?:출처|참고|자료|근거)[^)]*\)/gi, '')
      .replace(/\s*\([^)]*(?:\.pdf|\.pptx?|\.hwp|\.png)[^)]*(?:p(?:age)?\.?\s*\d+|페이지\s*\d+|슬라이드\s*\d+)[^)]*\)/gi, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function renderInfographicPages(document, container, {title, content, renderMarkdown}) {
  const pages = paginateInfographic(content);
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
  sheet.className = 'infographic-page markdown-preview';
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
    const heading = /^#\s/m.test(pageContent) ? '' : `# ${title || '인포그래픽'}${page ? ' · 계속' : ''}\n\n`;
    sheet.replaceChildren(renderMarkdown(`${heading}${pageContent}`));
    sheet.scrollTop = 0;
  };
  previous.onclick = () => { if (page > 0) { page--; show(); } };
  next.onclick = () => { if (page < pages.length - 1) { page++; show(); } };
  show();
  return pages.length;
}
