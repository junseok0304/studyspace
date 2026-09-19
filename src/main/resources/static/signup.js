const social = new URLSearchParams(location.search).get('social') === 'kakao';
const find = id => document.getElementById(id);
if (social) {
  find('email-fields').hidden = true;
  find('email-fields').querySelectorAll('input').forEach(input => input.disabled = true);
  find('social-entry').hidden = true;
  find('signup-heading').textContent = '마지막으로, 이용 동의';
  find('signup-intro').textContent = '카카오 인증을 마쳤어요. 약관을 확인하면 가입이 완료됩니다.';
}
find('signup-form').onsubmit = async event => {
  event.preventDefault();
  const submit = find('signup-submit'); if (submit.disabled) return;
  submit.disabled = true;
  find('signup-message').textContent = '가입을 진행하고 있습니다.';
  try {
    const csrf = await fetch('/api/auth/csrf');
    if (!csrf.ok) throw new Error('다시 시도해 주세요.');
    const {token} = await csrf.json();
    const payload = {termsAccepted:find('terms').checked,privacyAccepted:find('privacy').checked};
    if (!social) Object.assign(payload,{email:find('email').value,nickname:find('nickname').value,password:find('password').value});
    const response = await fetch(social ? '/api/auth/kakao/complete' : '/api/auth/signup', {
      method:'POST',headers:{'Content-Type':'application/json','X-XSRF-TOKEN':token},body:JSON.stringify(payload)
    });
    const body = await response.json();
    if(!response.ok) throw new Error(body.error || '가입하지 못했습니다. 다시 시도해 주세요.');
    if (body.verificationRequired) {
      find('signup-message').textContent = '가입되었습니다. 이메일 인증을 완료한 뒤 로그인해 주세요.';
      return;
    }
    location.assign(social ? '/' : '/?registered=true');
  } catch(e) { find('signup-message').textContent = e.message; submit.disabled = false; }
};
