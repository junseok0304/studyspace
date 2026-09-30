const xml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));
const plain = value => String(value ?? '').replace(/[`*_#[\]()>-]/g,' ').replace(/\s+/g,' ').trim();

export function mindMapSvg(tree) {
  const nodes=[];const visit=(node,depth=0,parent=null)=>{const current={label:String(node.label),depth,parent,index:nodes.length};nodes.push(current);(node.children||[]).forEach(child=>visit(child,depth+1,current));};visit(tree);
  const width=Math.max(720,Math.max(...nodes.map(node=>node.depth),0)*230+260);const height=Math.max(180,nodes.length*72+40);
  const positioned=nodes.map((node,index)=>({...node,x:30+node.depth*220,y:24+index*72}));
  const links=positioned.filter(node=>node.parent).map(node=>{const parent=positioned[node.parent.index];return `<path d="M${parent.x+180} ${parent.y+24} C${parent.x+205} ${parent.y+24},${node.x-25} ${node.y+24},${node.x} ${node.y+24}"/>`;}).join('');
  const boxes=positioned.map(node=>`<g><rect x="${node.x}" y="${node.y}" width="180" height="48" rx="12"/><text x="${node.x+12}" y="${node.y+29}">${xml(node.label.length>24?node.label.slice(0,24)+'…':node.label)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title" viewBox="0 0 ${width} ${height}"><title id="title">${xml(tree.label)} 마인드맵</title><style>rect{fill:#f5f9ff;stroke:#83add8;stroke-width:1.5}text{font:14px system-ui,sans-serif;fill:#263f58}path{fill:none;stroke:#aac8e7;stroke-width:2}</style>${links}${boxes}</svg>`;
}

export function infographicSvg(title,markdown) {
  const lines=String(markdown).split(/\n+/).map(plain).filter(Boolean).slice(0,10);const height=Math.max(360,150+lines.length*64);
  const cards=lines.map((line,index)=>`<g><rect x="50" y="${120+index*64}" width="700" height="48" rx="12"/><text x="70" y="${150+index*64}">${xml(line.length>78?line.slice(0,78)+'…':line)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title description" viewBox="0 0 800 ${height}"><title id="title">${xml(title)}</title><desc id="description">AI가 생성한 학습 인포그래픽. 원문과 함께 내용을 확인하세요.</desc><style>svg{background:#f6f9fc}text{font:15px system-ui,sans-serif;fill:#294158}rect{fill:#fff;stroke:#d5e2ef}.heading{font-size:25px;font-weight:700;fill:#245c91}.notice{font-size:12px;fill:#66788a}</style><text class="heading" x="50" y="58">${xml(title)}</text><text class="notice" x="50" y="88">AI 생성 학습 자료 · 원문 근거를 함께 확인하세요</text>${cards}</svg>`;
}

export function renderMindMap(document,container,tree) {
  const controls=document.createElement('div');controls.className='mind-map-controls';const search=document.createElement('input');search.type='search';search.placeholder='노드 검색';search.setAttribute('aria-label','마인드맵 노드 검색');const expand=document.createElement('button');expand.type='button';expand.className='quiet-button';expand.textContent='전체 접기';controls.append(search,expand);
  const root=document.createElement('ul');const branches=[];
  const render=node=>{const item=document.createElement('li');item.dataset.label=String(node.label).toLocaleLowerCase();const label=document.createElement(node.children?.length?'button':'span');label.textContent=node.label;if(node.children?.length){label.type='button';label.className='mind-map-node';label.setAttribute('aria-expanded','true');const children=document.createElement('ul');children.append(...node.children.map(render));label.onclick=()=>{const hidden=!children.hidden;children.hidden=hidden;label.setAttribute('aria-expanded',String(!hidden));};item.append(label,children);branches.push({label,children});}else item.append(label);return item;};root.append(render(tree));
  search.oninput=()=>{const term=search.value.trim().toLocaleLowerCase();root.querySelectorAll('li').forEach(item=>item.classList.toggle('search-match',!!term&&item.dataset.label.includes(term)));branches.forEach(branch=>{if(term){branch.children.hidden=false;branch.label.setAttribute('aria-expanded','true');}});};
  let expanded=true;expand.onclick=()=>{expanded=!expanded;branches.forEach(branch=>{branch.children.hidden=!expanded;branch.label.setAttribute('aria-expanded',String(expanded));});expand.textContent=expanded?'전체 접기':'전체 펼치기';};container.append(controls,root);
}
