const state = { mode: 'login' };
const $ = (selector) => document.querySelector(selector);

function csrfToken() {
  return document.cookie.split('; ').find((row) => row.startsWith('XSRF-TOKEN='))?.split('=')[1];
}

async function ensureCsrf() {
  await fetch('/api/auth/csrf', { credentials: 'same-origin' });
}

function message(text, success = false) {
  const element = $('#message');
  element.textContent = text || '';
  element.classList.toggle('success', success);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
  $('#nickname-label').classList.toggle('hidden', mode !== 'signup');
  $('#nickname').required = mode === 'signup';
  $('#password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#submit-button').textContent = mode === 'signup' ? '회원가입' : '로그인';
  message('');
}

async function request(path, options = {}) {
  await ensureCsrf();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = csrfToken();
  if (token) headers['X-XSRF-TOKEN'] = decodeURIComponent(token);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
}

function showAccount(user) {
  $('#auth-card').classList.add('hidden');
  $('#account-card').classList.remove('hidden');
  $('#welcome').textContent = `${user.nickname}님, 환영합니다.`;
  $('#account-detail').textContent = `${user.email} · ${user.emailVerified ? '이메일 인증 완료' : '이메일 인증 필요'}`;
}

async function loadSession() {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (response.ok) showAccount((await response.json()).user);
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  message('처리 중...', true);
  const payload = { email: $('#email').value, password: $('#password').value };
  if (state.mode === 'signup') payload.nickname = $('#nickname').value;
  try {
    const result = await request(`/api/auth/${state.mode}`, { method: 'POST', body: JSON.stringify(payload) });
    if (state.mode === 'signup' && result.verificationRequired) {
      message('가입되었습니다. 이메일 인증 후 로그인해 주세요.', true);
      if (result.developmentVerificationUrl) console.info('개발용 이메일 인증 링크:', result.developmentVerificationUrl);
      setMode('login');
      $('#email').value = payload.email;
    } else {
      showAccount(result.user);
    }
  } catch (error) {
    message(error.message);
  }
});

$('#logout-button').addEventListener('click', async () => {
  try { await request('/api/auth/logout', { method: 'POST' }); window.location.reload(); }
  catch (error) { message(error.message); }
});

loadSession();

const kakaoResult = new URLSearchParams(window.location.search).get('kakao');
if (kakaoResult === 'success') message('카카오 로그인에 성공했습니다.', true);
