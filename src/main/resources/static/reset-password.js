import { apiFetch } from './api.js';
import { byId } from './dom.js';

const token = new URLSearchParams(location.search).get('token');

async function send(path, payload) {
  return apiFetch(path, {method:'POST', body:payload});
}

function showMessage(text, success=false) {
  byId('reset-message').textContent=text;
  byId('reset-message').classList.toggle('success',success);
}

if (token) {
  byId('request-form').classList.add('hidden');
  byId('confirm-form').classList.remove('hidden');
  byId('reset-heading').textContent='새 비밀번호 설정';
  byId('reset-intro').textContent='다른 서비스에서 사용하지 않는 비밀번호를 입력해 주세요.';
}

byId('request-form').onsubmit=async event=>{
  event.preventDefault(); const button=event.submitter; button.disabled=true; showMessage('');
  try {
    const result=await send('/api/auth/password-reset/request',{email:byId('reset-email').value});
    showMessage(result.message,true);
  } catch(error) { showMessage(error.message); button.disabled=false; }
};

byId('confirm-form').onsubmit=async event=>{
  event.preventDefault(); const button=event.submitter; const password=byId('new-password').value;
  if(password!==byId('confirm-password').value){showMessage('새 비밀번호가 서로 일치하지 않습니다.');return;}
  button.disabled=true; showMessage('');
  try { const result=await send('/api/auth/password-reset/confirm',{token,password}); showMessage(result.message,true); byId('confirm-form').classList.add('hidden'); }
  catch(error){showMessage(error.message);button.disabled=false;}
};
