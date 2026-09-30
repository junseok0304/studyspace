import { apiFetch } from './api.js';
import { byId } from './dom.js';

const social = new URLSearchParams(location.search).get('social') === 'kakao';
const consentKey = `studyspace.signup.consent.${social ? 'kakao' : 'email'}`;
const returnPath = social ? '/signup.html?social=kakao' : '/signup.html';
for (const [id,page] of [['terms-link','terms'],['privacy-link','privacy']]) {
  byId(id).href = `/${page}.html?return=${encodeURIComponent(returnPath)}`;
}
try {
  const saved=JSON.parse(sessionStorage.getItem(consentKey) || '{}');
  byId('terms').checked=saved.terms === true; byId('privacy').checked=saved.privacy === true;
} catch { /* Storage may be unavailable; the form still works normally. */ }
const rememberConsent=()=>{try{sessionStorage.setItem(consentKey,JSON.stringify({terms:byId('terms').checked,privacy:byId('privacy').checked}));}catch{/* Optional convenience only. */}};
byId('terms').onchange=rememberConsent; byId('privacy').onchange=rememberConsent;
if (social) {
  byId('email-fields').hidden = true;
  byId('email-fields').querySelectorAll('input').forEach(input => input.disabled = true);
  byId('social-entry').hidden = true;
  byId('signup-heading').textContent = '마지막으로, 이용 동의';
  byId('signup-intro').textContent = '카카오 인증을 마쳤어요. 약관을 확인하면 가입이 완료됩니다.';
}
byId('signup-form').onsubmit = async event => {
  event.preventDefault();
  const submit = byId('signup-submit'); if (submit.disabled) return;
  submit.disabled = true;
  byId('signup-message').textContent = '가입을 진행하고 있습니다.';
  try {
    const payload = {termsAccepted:byId('terms').checked,privacyAccepted:byId('privacy').checked};
    if (!social) Object.assign(payload,{email:byId('email').value,nickname:byId('nickname').value,password:byId('password').value});
    const body = await apiFetch(social ? '/api/auth/kakao/complete' : '/api/auth/signup', {method:'POST',body:payload});
    if (body.verificationRequired) {
      try { sessionStorage.removeItem(consentKey); } catch { /* Optional storage. */ }
      byId('signup-message').textContent = '가입되었습니다. 이메일 인증을 완료한 뒤 로그인해 주세요.';
      return;
    }
    try { sessionStorage.removeItem(consentKey); } catch { /* Optional storage. */ }
    location.assign(social ? '/' : '/?registered=true');
  } catch(e) { byId('signup-message').textContent = e.message; submit.disabled = false; }
};
