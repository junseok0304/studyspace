const byId = id => document.getElementById(id);
let busy = false;
const say = text => byId('profile-message').textContent = text;
async function api(path,method='GET',payload) {
  const headers={'Content-Type':'application/json'};
  if(method!=='GET') {
    const csrf=await fetch('/api/auth/csrf');
    if(!csrf.ok) throw new Error('다시 로그인해 주세요.');
    headers['X-XSRF-TOKEN']=(await csrf.json()).token;
  }
  const response=await fetch(path,{method,headers,body:payload ? JSON.stringify(payload) : undefined});
  if(response.status===401) { location.assign('/'); throw new Error('다시 로그인해 주세요.'); }
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}
function rows(target,courses) {
  target.replaceChildren();
  for(const course of courses) {
    const p=document.createElement('p'); p.className='schedule-row';
    const title=document.createElement('strong'); title.textContent=course.name;
    const detail=document.createElement('span'); detail.textContent=`${course.semester || ''} ${course.schedule || '시간 미확인'}`;
    p.append(title,document.createElement('br'),detail); target.append(p);
  }
  if(!courses.length) target.textContent='아직 가져온 과목이 없습니다.';
}
async function refresh() {
  const data=await api('/api/school');
  byId('connection-state').textContent=data.linked ? '연동됨 · 저장된 계정으로 동기화할 수 있습니다.' : '아직 학교 계정이 연결되지 않았습니다.';
  byId('disconnect').hidden=!data.saved; byId('sync').disabled=!data.linked;
  rows(byId('saved-courses'),data.courses);
}
async function run(action) {
  if(busy) return; busy=true;
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try { await action(); } catch(e) { say(e.message); }
  finally { busy=false; document.querySelectorAll('button').forEach(b=>b.disabled=false); await refresh().catch(e=>say(e.message)); }
}
byId('school-form').onsubmit=event=>{ event.preventDefault(); run(async()=>{
  say('LMS 로그인을 확인하고 있습니다…');
  await api('/api/school','PUT',{username:byId('school-id').value,password:byId('school-password').value,saveConsent:byId('store-consent').checked});
  byId('school-password').value=''; byId('school-id').value=''; byId('store-consent').checked=false;
  byId('preview').replaceChildren(); byId('confirm-import').hidden=true;
  say('학교 계정을 등록했습니다. 학기를 선택하고 시간표를 동기화하세요.');
}); };
byId('disconnect').onclick=()=>{ if(window.confirm('저장된 학교 로그인 정보를 삭제할까요? 가져온 과목과 노트는 유지됩니다.')) run(async()=>{
  await api('/api/school','DELETE'); byId('preview').replaceChildren(); byId('confirm-import').hidden=true; say('연동을 해제했습니다. 기존 과목과 노트는 유지됩니다.');
}); };
byId('sync-form').onsubmit=event=>{event.preventDefault();run(async()=>{
  byId('preview').replaceChildren(); byId('confirm-import').hidden=true;
  say('저장된 계정으로 시간표를 가져오고 있습니다…');
  const data=await api('/api/school/preview','POST',{year:Number(byId('sync-year').value),semester:byId('sync-semester').value});
  rows(byId('preview'),data.courses); byId('confirm-import').hidden=false; say('시간표를 확인한 후 반영해 주세요. 기존 과목의 노트는 그대로 유지됩니다.');
});};
byId('confirm-import').onclick=()=>run(async()=>{
  const result=await api('/api/school/confirm','POST'); byId('confirm-import').hidden=true; byId('preview').replaceChildren(); say(`${result.count}개 과목을 반영했습니다.`);
});
byId('sync-year').value=new Date().getFullYear();
byId('sync-semester').value=new Date().getMonth()>=7?'2':'1';
refresh().catch(e=>say(e.message));
