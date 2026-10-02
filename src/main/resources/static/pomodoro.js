const FOCUS=25*60*1000, BREAK=5*60*1000, STEP=5*60*1000, MIN_DURATION=5*60*1000, MAX_DURATION=90*60*1000;
export const remainingAt=(state,now=Date.now())=>state.running?Math.max(0,state.endAt-now):Math.max(0,state.remainingMs);
export const timerState=(phase='focus')=>({phase,durationMs:phase==='focus'?FOCUS:BREAK,remainingMs:phase==='focus'?FOCUS:BREAK,endAt:null,running:false});
export const advanceCompletedPhase=(state,now=Date.now())=>state.phase==='focus'
  ?{...state,phase:'break',focusLeft:0,breakLeft:state.breakMs,remainingMs:state.breakMs,endAt:now+state.breakMs,running:true}
  :{...state,phase:'focus',breakLeft:0,focusLeft:state.focusMs,remainingMs:state.focusMs,endAt:null,running:false};
export const ringProgressFor=(remaining,phase='focus')=>{
  const overflowToMax=(threshold)=>Math.min(1,Math.max(0,(remaining-threshold)/(MAX_DURATION-threshold)));
  if(phase==='break'){
    const tenMinutes=2*BREAK,ratio=Math.max(0,remaining/tenMinutes);
    const raw=ratio<=0.5?0.4*Math.pow(ratio/0.5,1.322):0.4+0.6*((ratio-0.5)/0.5);
    return {progress:Math.min(1,raw),overflow:overflowToMax(tenMinutes)};
  }
  const threshold=FOCUS/0.7,raw=Math.max(0,remaining/FOCUS*0.7);
  return {progress:Math.min(1,raw),overflow:overflowToMax(threshold)};
};

const mixColor=(from,to,amount)=>{
  const parse=value=>value.match(/[\da-f]{2}/gi).map(part=>parseInt(part,16));
  const a=parse(from),b=parse(to),mix=a.map((value,index)=>Math.round(value+(b[index]-value)*amount).toString(16).padStart(2,'0'));
  return `#${mix.join('')}`;
};

const ICONS={
  focus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h11.5v16H7a2.5 2.5 0 0 0-2.5 2.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4.5 5.5v16M8.5 7h6.5M8.5 10h6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  break:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10h11v4.2A4.8 4.8 0 0 1 11.2 19H9.8A4.8 4.8 0 0 1 5 14.2z" fill="currentColor"/><path d="M16 11.2h1.7a2.6 2.6 0 0 1 0 5.2H16" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 5.6c0-1.1 1-1.7 1-2.8M12 5.6c0-1.1 1-1.7 1-2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
};

export function mountPomodoro(userId) {
  if(document.getElementById('pomodoro'))return;
  const key=`studyspace.pomodoro.${userId}`;let state;
  try{state={...timerState(),...JSON.parse(localStorage.getItem(key)||'{}')};}catch{state=timerState();}
  const focusMs = Number.isFinite(state.focusMs) ? state.focusMs : (state.durationMs && state.phase==='focus' ? state.durationMs : FOCUS);
  const breakMs = Number.isFinite(state.breakMs) ? state.breakMs : (state.durationMs && state.phase==='break' ? state.durationMs : BREAK);
  const focusLeft = Number.isFinite(state.focusLeft) ? state.focusLeft : (state.phase==='focus' ? remainingAt(state) : FOCUS);
  const breakLeft = Number.isFinite(state.breakLeft) ? state.breakLeft : (state.phase==='break' ? remainingAt(state) : BREAK);
  state = {...state, focusMs, breakMs, focusLeft, breakLeft};
  const startMinimized = state.minimized !== false;
  const onDashboard = () => !!document.getElementById('dashboard');

  const root=document.createElement('aside');root.id='pomodoro';root.className='pomodoro'+(startMinimized?' minimized':'')+(startMinimized&&onDashboard()?' dashboard-context-compact':'');root.setAttribute('aria-label','집중 타이머');

  const RING_R=49, CIRC=2*Math.PI*RING_R, OVERFLOW_R=43, OVERFLOW_CIRC=2*Math.PI*OVERFLOW_R;
  const ringWrap=document.createElement('button');ringWrap.type='button';ringWrap.className='pomodoro-ring';ringWrap.setAttribute('aria-label',startMinimized?'타이머 펼치기':'타이머 접기');
  const svgNS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(svgNS,'svg');svg.setAttribute('viewBox','0 0 140 140');
  const track=document.createElementNS(svgNS,'circle');track.setAttribute('cx','70');track.setAttribute('cy','70');track.setAttribute('r',String(RING_R));track.setAttribute('class','ring-track');
  const progress=document.createElementNS(svgNS,'circle');progress.setAttribute('cx','70');progress.setAttribute('cy','70');progress.setAttribute('r',String(RING_R));progress.setAttribute('class','ring-progress');progress.setAttribute('stroke-dasharray',String(CIRC));
  const overflow=document.createElementNS(svgNS,'circle');overflow.setAttribute('cx','70');overflow.setAttribute('cy','70');overflow.setAttribute('r',String(OVERFLOW_R));overflow.setAttribute('class','ring-overflow');
  svg.append(track,progress,overflow);
  const center=document.createElement('div');center.className='pomodoro-center';
  const clock=document.createElement('strong');clock.className='pomodoro-clock';clock.setAttribute('role','timer');clock.setAttribute('aria-live','off');
  center.append(clock);ringWrap.append(svg,center);root.append(ringWrap);

  const panel=document.createElement('div');panel.className='pomodoro-panel';
  const modeRow=document.createElement('div');modeRow.className='pomodoro-mode';
  const phase=document.createElement('button');phase.type='button';phase.className='pomodoro-phase';
  const minus=document.createElement('button');minus.type='button';minus.className='pomodoro-step';minus.textContent='−';minus.setAttribute('aria-label','시간 5분 줄이기');
  const plus=document.createElement('button');plus.type='button';plus.className='pomodoro-step';plus.textContent='+';plus.setAttribute('aria-label','시간 5분 늘리기');
  modeRow.append(phase,minus,plus);
  const controls=document.createElement('div');controls.className='pomodoro-actions';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='primary';
  const reset=document.createElement('button');reset.type='button';reset.className='quiet-button';reset.textContent='초기화';
  const minimize=document.createElement('button');minimize.type='button';minimize.className='pomodoro-minimize';minimize.textContent='접기';minimize.setAttribute('aria-label','타이머 접기');
  controls.append(toggle,reset,minimize);panel.append(modeRow,controls);root.append(panel);
  document.body.append(root);

  const save=()=>{try{localStorage.setItem(key,JSON.stringify(state));}catch{}};
  const phaseDuration=()=>state.phase==='focus'?state.focusMs:state.breakMs;
  const phaseLeft=()=>state.phase==='focus'?state.focusLeft:state.breakLeft;
  const setPhaseLeft=value=>{if(state.phase==='focus')state.focusLeft=value;else state.breakLeft=value;};
  const clamp=value=>Math.min(MAX_DURATION,Math.max(MIN_DURATION,value));

  const render=()=>{
    let remaining=remainingAt(state);
    if(state.running&&remaining===0){
      state=advanceCompletedPhase(state);
      save();
      root.classList.remove('finished');
      void root.offsetWidth;
      root.classList.add('finished');
      setTimeout(()=>root.classList.remove('finished'),1200);
      remaining=remainingAt(state);
    }
    const seconds=Math.ceil(remaining/1000),minutes=Math.floor(seconds/60);
    clock.textContent=`${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    setTimerTitle(state.running ? clock.textContent : null);
    const total=phaseDuration()||1, elapsed=1-Math.max(0,Math.min(1,remaining/total));
    const colors=state.phase==='focus'?{start:'#ff5147',end:'#ed8db5',overflow:'#a34d9b',track:'#f7dfe2'}:{start:'#3478e5',end:'#9bc5ff',overflow:'#505fc4',track:'#dceaff'};
    const color=mixColor(colors.start,colors.end,elapsed),ring=ringProgressFor(remaining,state.phase);
    progress.setAttribute('stroke-dashoffset',String(CIRC*(1-ring.progress)));
    progress.setAttribute('stroke',color);
    track.setAttribute('stroke',colors.track);
    overflow.setAttribute('stroke',colors.overflow);
    overflow.setAttribute('stroke-dasharray',`${OVERFLOW_CIRC*ring.overflow} ${OVERFLOW_CIRC*(1-ring.overflow)}`);
    overflow.setAttribute('opacity',ring.overflow>0?'1':'0');
    root.classList.toggle('break-mode',state.phase==='break');
    phase.innerHTML=`<span class="pomodoro-phase-icon">${ICONS[state.phase]}</span><span>${state.phase==='focus'?'집중 모드':'휴식 모드'}</span>`;
    phase.setAttribute('aria-label',state.phase==='focus'?'휴식 모드로 전환':'집중 모드로 전환');
    minus.disabled=state.running;plus.disabled=state.running;phase.disabled=false;
    toggle.textContent=state.running?'일시정지':remaining===0?'다시 시작':'시작';
  };

  const adjust=delta=>{
    if(state.running)return;
    const next=clamp(phaseDuration()+delta);
    if(state.phase==='focus')state.focusMs=next;else state.breakMs=next;
    setPhaseLeft(next);
    state={...state,remainingMs:next};
    save();render();
  };

  const start=()=>{const remaining=remainingAt(state);state={...state,remainingMs:remaining||phaseDuration(),endAt:Date.now()+(remaining||phaseDuration()),running:true};save();render();};
  toggle.onclick=()=>{if(state.running){const left=remainingAt(state);setPhaseLeft(left);state={...state,remainingMs:left,endAt:null,running:false};save();render();}else start();};
  reset.onclick=()=>{state={...state,running:false,endAt:null,focusMs:FOCUS,breakMs:BREAK,focusLeft:FOCUS,breakLeft:BREAK,remainingMs:state.phase==='focus'?FOCUS:BREAK};save();render();};
  phase.onclick=()=>{
    const wasRunning=state.running,currentLeft=remainingAt(state);
    setPhaseLeft(currentLeft);
    const next=state.phase==='focus'?'break':'focus';
    const storedLeft=next==='focus'?state.focusLeft:state.breakLeft;
    const targetLeft=storedLeft>0?storedLeft:(next==='focus'?state.focusMs:state.breakMs);
    state={...state,phase:next,remainingMs:targetLeft,endAt:wasRunning?Date.now()+targetLeft:null,running:wasRunning};
    save();render();
  };
  minus.onclick=()=>adjust(-STEP);
  plus.onclick=()=>adjust(STEP);
  const updateRingAction=()=>ringWrap.setAttribute('aria-label',root.classList.contains('minimized')?'타이머 펼치기':'타이머 접기');
  const togglePanel=()=>{
    const minimized=root.classList.toggle('minimized');
    root.classList.toggle('dashboard-context-compact', minimized&&onDashboard());
    state.minimized=minimized;
    updateRingAction();save();
  };
  ringWrap.onclick=()=>{if(suppressClick){suppressClick=false;return;}togglePanel();};
  minimize.onclick=togglePanel;  ringWrap.addEventListener('wheel',event=>{event.preventDefault();adjust(event.deltaY<0?STEP:-STEP);},{passive:false});  let dragState=null,suppressClick=false;
  ringWrap.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const rect=root.getBoundingClientRect();
    dragState={startX:event.clientX,startY:event.clientY,left:rect.left,top:rect.top,moved:false};
  });
  window.addEventListener('pointermove',event=>{
    if(!dragState)return;
    const dx=event.clientX-dragState.startX,dy=event.clientY-dragState.startY;
    if(Math.abs(dx)+Math.abs(dy)>6)dragState.moved=true;
    if(dragState.moved){
      const margin=8,vw=window.innerWidth,vh=window.innerHeight,width=root.offsetWidth,height=root.offsetHeight;
      root.style.left=`${Math.min(Math.max(margin,dragState.left+dx),vw-width-margin)}px`;
      root.style.top=`${Math.min(Math.max(margin,dragState.top+dy),vh-height-margin)}px`;
      root.style.right='auto';root.style.bottom='auto';
    }
  });
  window.addEventListener('pointerup',()=>{
    if(dragState?.moved){suppressClick=true;setTimeout(()=>{suppressClick=false;},250);}
    dragState=null;
  });
  ringWrap.classList.add('draggable');
  window.addEventListener('storage',event=>{if(event.key!==key||!event.newValue)return;try{state={...timerState(),...JSON.parse(event.newValue)};state.focusMs=Number.isFinite(state.focusMs)?state.focusMs:FOCUS;state.breakMs=Number.isFinite(state.breakMs)?state.breakMs:BREAK;state.focusLeft=Number.isFinite(state.focusLeft)?state.focusLeft:state.focusMs;state.breakLeft=Number.isFinite(state.breakLeft)?state.breakLeft:state.breakMs;render();}catch{/* Ignore malformed external state. */}});
  document.addEventListener('visibilitychange',render);
  setInterval(render,250);
  render();
}
import { setTimerTitle } from './page-title.js';
