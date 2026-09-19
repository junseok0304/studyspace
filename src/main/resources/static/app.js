const state = { mode: 'login' };
const $ = (selector) => document.querySelector(selector);

async function ensureCsrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('보안 토큰을 발급받지 못했습니다.');
  const body = await response.json();
  return body.token;
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
  const csrf = await ensureCsrf();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (csrf) headers['X-XSRF-TOKEN'] = csrf;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
}

function showAccount(user) {
  document.querySelector('.shell').classList.add('workspace-shell');
  $('#auth-card').classList.add('hidden');
  $('#account-card').classList.remove('hidden');
  $('#welcome').textContent = `${user.nickname}님, 환영합니다.`;
  $('#account-detail').textContent = `${user.email} · ${user.emailVerified ? '이메일 인증 완료' : '이메일 인증 필요'}`;
  import('/study.js').then(module => module.start(request)).catch(() => message('학습 공간을 열지 못했습니다. 새로고침해 주세요.'));
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
    if (state.mode === 'signup') {
      if (result.developmentVerificationUrl) console.info('개발용 이메일 인증 링크:', result.developmentVerificationUrl);
      setMode('login');
      $('#email').value = payload.email;
      message(result.verificationRequired ? '이메일 인증 후 로그인해 주세요.' : '가입되었습니다. 로그인해 주세요.', true);
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
if (new URLSearchParams(location.search).get('registered') === 'true') message('가입되었습니다. 이메일로 로그인해 주세요.', true);

const kakaoResult = new URLSearchParams(window.location.search).get('kakao');
if (kakaoResult === 'success') message('카카오 로그인에 성공했습니다.', true);
