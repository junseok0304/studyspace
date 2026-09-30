export function stripSummarySourceLabels(markdown) {
  return String(markdown || '')
    .replace(/^\s{0,3}#{1,6}\s*(?:출처|참고\s*자료|sources?|references?)\s*\n(?:\s*[-*+]\s+[^\n]*\n?)*/gim, '')
    .replace(/^\s*(?:출처|참고\s*자료|sources?|references?)\s*[:：][^\n]*$/gim, '')
    .replace(/[ \t]*\(노트:\s*(?:[^()\n]|\([^()\n]*\))*\)[ \t]*/gi, '')
    .replace(/\s*\[(?:노트|강의자료|출처|참고)[^\]\n]*\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
