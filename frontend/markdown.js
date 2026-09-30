import { Marked } from 'marked';
import createDOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parser = new Marked({ gfm: true, breaks: false, renderer: {
  code({ text, lang }) {
    const language = (lang || '').split(/\s/)[0].toLowerCase();
    const highlighted = text.length <= 10000 && hljs.getLanguage(language)
      ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escape(text);
    return `<pre><code class="hljs">${highlighted}</code></pre>`;
  },
  image({ text }) { return `<span>[이미지: ${escape(text || '외부 이미지')}]</span>`; }
}});

// No external images, embedded documents, raw styling, or scripts in note previews.
export function renderMarkdown(source, windowObject = window) {
  const purifier = createDOMPurify(windowObject);
  const fragment = purifier.sanitize(parser.parse(source.slice(0, 60000)), {
    ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','strong','em','del','s','blockquote',
      'ul','ol','li','pre','code','span','table','thead','tbody','tr','th','td','a'],
    ALLOWED_ATTR: ['href','title','class','start'],
    RETURN_DOM_FRAGMENT: true
  });
  fragment.querySelectorAll('a').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (!/^(https?:\/\/|mailto:)/i.test(href)) link.removeAttribute('href');
    else { link.setAttribute('target','_blank'); link.setAttribute('rel','noopener noreferrer'); }
  });
  return fragment;
}
