export function stripSummarySourceLabels(markdown) {
  return String(markdown || '')
    .replace(/\$\\(leftarrow|rightarrow|Rightarrow|leftrightarrow)\$/g, (_, command) => ({leftarrow: '←', rightarrow: '→', Rightarrow: '⇒', leftrightarrow: '↔'})[command])
    .replace(/^\s{0,3}#{1,6}\s*(?:출처|참고\s*자료|sources?|references?)\s*\n(?:\s*[-*+]\s+[^\n]*\n?)*/gim, '')
    .replace(/^\s*(?:\*{1,2})?(?:원문\s*근거|출처|참고\s*자료|sources?|references?)(?:\*{1,2})?\s*[:：][^\n]*$/gim, '')
    .replace(/[ \t]*\(\s*`?(?:노트|자료)\s*:\s*(?:[^()\n]|\([^()\n]*\))*`?\s*\)[ \t]*/gi,
      (match, offset, source) => /\S/.test(source[offset - 1] || '') && /\S/.test(source[offset + match.length] || '') ? ' ' : '')
    .replace(/\s*\[(?:노트|강의자료|출처|참고)[^\]\n]*\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
