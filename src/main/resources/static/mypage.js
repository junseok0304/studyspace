import { apiFetch } from './api.js';
import { byId } from './dom.js';

const settingIds=['school-settings','schedule-settings','data-settings','account-settings'];
function showSettings() {
  const selected=settingIds.includes(location.hash.slice(1))?location.hash.slice(1):'school-settings';
  settingIds.forEach(id=>byId(id).hidden=id!==selected);
  document.querySelectorAll('.profile-nav a').forEach(link=>{
    if(link.hash===`#${selected}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange',showSettings);
showSettings();
let busy = false;
const say = text => byId('profile-message').textContent = text;
async function api(path,method='GET',payload) {
  return apiFetch(path,{method,body:payload});
}
api('/api/auth/me').then(data=>{
  byId('account-nickname').value=data.user.nickname;
  return import('/pomodoro.js').then(module=>module.mountPomodoro(data.user.id));
}).catch(error=>say(error.message));
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
function renderSemesters(semesters) {
  const target=byId('semester-list');
  target.replaceChildren(...semesters.map(item=>{const tag=document.createElement('span');tag.textContent=item.name;return tag;}));
  if(!semesters.length) target.textContent='아직 추가한 학기가 없습니다.';
}
async function refresh() {
  const [data,storage,semesters]=await Promise.all([api('/api/school'),api('/api/account/storage'),api('/api/semesters')]);
  byId('connection-state').textContent=data.linked ? '연동 완료' : '학교 계정을 연결해 시간표를 가져오세요.';
  byId('disconnect').hidden=!data.saved; byId('disconnect').parentElement.hidden=!data.saved; byId('sync').disabled=!data.linked;
  rows(byId('saved-courses'),data.courses);
  renderSemesters(semesters);
  const size=value=>value>=1073741824?`${(value/1073741824).toFixed(1)}GB`:value>=1048576?`${(value/1048576).toFixed(1)}MB`:`${Math.ceil(value/1024)}KB`;
  byId('storage-used').textContent=`${size(storage.usedBytes)} 사용 중`;byId('storage-detail').textContent=`전체 ${size(storage.limitBytes)} · ${size(storage.remainingBytes)} 남음`;byId('storage-progress').value=storage.usedPercent;
}
byId('semester-form').onsubmit=event=>{event.preventDefault();run(async()=>{
  await api('/api/semesters','POST',{name:byId('semester-name').value});
  byId('semester-name').value=''; say('학기를 추가했습니다.');
});};
byId('nickname-form').onsubmit=event=>{event.preventDefault();run(async()=>{
  const data=await api('/api/auth/me/nickname','PUT',{nickname:byId('account-nickname').value});
  byId('account-nickname').value=data.user.nickname;
  byId('nickname-message').textContent='닉네임을 변경했습니다.';
});};
async function run(action) {
  if(busy) return; busy=true;
  say('');
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try { await action(); } catch(e) { say(e.message); }
  finally { busy=false; document.querySelectorAll('button').forEach(b=>b.disabled=false); await refresh().catch(e=>say(e.message)); }
}
byId('school-form').onsubmit=event=>{ event.preventDefault(); run(async()=>{
  await api('/api/school','PUT',{username:byId('school-id').value,password:byId('school-password').value,saveConsent:byId('store-consent').checked});
  byId('school-password').value=''; byId('school-id').value=''; byId('store-consent').checked=false;
  byId('preview').replaceChildren(); byId('confirm-import').hidden=true;
}); };
byId('disconnect').onclick=()=>{ if(window.confirm('저장된 학교 로그인 정보를 삭제할까요? 가져온 과목과 노트는 유지됩니다.')) run(async()=>{
  await api('/api/school','DELETE'); byId('preview').replaceChildren(); byId('confirm-import').hidden=true;
}); };
byId('sync-form').onsubmit=event=>{event.preventDefault();run(async()=>{
  byId('preview').replaceChildren(); byId('confirm-import').hidden=true;
  const data=await api('/api/school/preview','POST',{year:Number(byId('sync-year').value),semester:byId('sync-semester').value});
  rows(byId('preview'),data.courses); byId('confirm-import').hidden=false;
});};
byId('confirm-import').onclick=()=>run(async()=>{
  await api('/api/school/confirm','POST'); byId('confirm-import').hidden=true; byId('preview').replaceChildren();
});
api('/api/account/deletion').then(data=>{
  byId('delete-password-label').hidden=!data.requiresPassword;
  byId('delete-password').required=data.requiresPassword;
}).catch(e=>say(e.message));
byId('delete-account-form').onsubmit=async event=>{
  event.preventDefault(); const button=event.submitter; const message=byId('delete-account-message');
  if(byId('delete-confirmation').value!=='회원탈퇴'){message.textContent='확인란에 회원탈퇴를 정확히 입력해 주세요.';return;}
  if(!window.confirm('계정과 모든 학습 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;
  button.disabled=true;message.textContent='';
  try { await api('/api/account','DELETE',{password:byId('delete-password').value,confirmation:byId('delete-confirmation').value}); location.assign('/?accountDeleted=true'); }
  catch(error){message.textContent=error.message;button.disabled=false;}
};
byId('sync-year').value=new Date().getFullYear();
byId('sync-semester').value=new Date().getMonth()>=7?'2':'1';
refresh().catch(e=>say(e.message));
