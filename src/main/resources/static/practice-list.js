/** Shared structure for the quiz and flashcard collection lists. */
export function createPracticeListItem({title, metadata, actions = []}) {
  const item = document.createElement('article');
  item.className = 'quiz-set-row';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const detail = document.createElement('span');
  detail.className = 'fine-print';
  detail.textContent = metadata;
  item.append(heading, detail, ...actions);
  return item;
}

export function renderPracticeList(target, rows, renderRow, emptyState) {
  target.replaceChildren(...rows.map(renderRow));
  if (!rows.length) target.replaceChildren(emptyState);
}
