export function removeDuplicateLeadingTitle(markdown, title) {
  const source = String(markdown || '');
  const heading = source.match(/^(?:[ \t]*\r?\n)*[ \t]*#\s+([^\r\n]+)[ \t]*(?:\r?\n|$)/);
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!heading || !normalize(title) || normalize(heading[1]) !== normalize(title)) return source;
  return source.slice(heading[0].length).replace(/^(?:[ \t]*\r?\n)+/, '');
}
