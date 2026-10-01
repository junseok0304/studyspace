import { apiFetch } from './api.js';
import { query } from './dom.js';
import { setBaseTitle } from './page-title.js';

const state = { mode: 'login' };
let studySession;
const authChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('studyspace-auth') : null;
function clearDrafts() {
  studySession?.clearDrafts();
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith('studyspace.draft.')) sessionStorage.removeItem(key); } catch { /* Browser storage is optional. */ }
}
if (authChannel) authChannel.onmessage = event => {
  if (event.data === 'logout') { clearDrafts(); location.reload(); }
};
const request = apiFetch;

function message(text, success = false) {
  const element = query('#message');
  element.textContent = text || '';
  element.classList.toggle('success', success);
}

function setMode(mode) {
  state.mode = mode;
  setBaseTitle(`StudySpace | ${mode === 'signup' ? '회원가입' : '로그인'}`);
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
  query('#nickname-label').classList.toggle('hidden', mode !== 'signup');
  query('#nickname').required = mode === 'signup';
  query('#password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  query('#submit-button').textContent = mode === 'signup' ? '회원가입' : '로그인';
  message('');
}

function showAccount(user) {
  setBaseTitle('StudySpace | 학습 현황');
  import('/pomodoro.js').then(module=>module.mountPomodoro(user.id)).catch(()=>{});
  document.querySelector('.shell').classList.add('workspace-shell');
  query('#auth-card').classList.add('hidden');
  query('#account-card').classList.remove('hidden');
  query('#welcome').textContent = `${user.nickname}님, 환영합니다.`;
  query('#account-detail').textContent = `${user.email} · ${user.emailVerified ? '이메일 인증 완료' : '이메일 인증 필요'}`;
  const studyReady = import('/study.js').then(module => module.start(request,user.id)).then(session => { studySession = session; return session; });
  studyReady.catch(error => {
    query('#study').classList.remove('hidden'); query('#dashboard-message').textContent = `학습 공간을 열지 못했습니다. ${error && error.message ? error.message : '새로고침해 주세요.'}`;
  });
  fetch('/api/school/prompt').then(r => r.ok ? r.json() : {}).then(data => {
    if (data.show && !query('#school-prompt').open) query('#school-prompt').showModal();
  }).catch(() => {});
  request('/api/school').then(data => {
    const updateSchoolLinks = () => document.querySelectorAll('.study-nav a[href="/mypage.html"], .course-menu a[href="/mypage.html"], .today-classes-heading a[href="/mypage.html"]').forEach(link => link.classList.toggle('hidden', Boolean(data.linked)));
    updateSchoolLinks();
    return studyReady.then(updateSchoolLinks);
  }).catch(() => {});
}

async function loadSession() {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (response.ok) showAccount((await response.json()).user);
  else if (response.status === 401) clearDrafts();
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
query('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter || query('#submit-button');
  submit.disabled = true;
  message('');
  const payload = { email: query('#email').value, password: query('#password').value };
  if (state.mode === 'signup') payload.nickname = query('#nickname').value;
  try {
    const result = await request(`/api/auth/${state.mode}`, { method: 'POST', body: JSON.stringify(payload), allowUnauthorized: true });
    if (state.mode === 'signup') {
      if (result.developmentVerificationUrl) console.info('개발용 이메일 인증 링크:', result.developmentVerificationUrl);
      setMode('login');
      query('#email').value = payload.email;
      message(result.verificationRequired ? '이메일 인증 후 로그인해 주세요.' : '가입되었습니다. 로그인해 주세요.', true);
    } else {
      showAccount(result.user);
    }
  } catch (error) {
    message(error.message);
  } finally {
    submit.disabled = false;
  }
});

query('#logout-button').addEventListener('click', async () => {
  if (studySession && !studySession.canLeave()) return;
  try { await request('/api/auth/logout', { method: 'POST' }); clearDrafts(); authChannel?.postMessage('logout'); window.location.reload(); }
  catch (error) { message(error.message); }
});

loadSession().catch(error => message(error.message || '로그인 정보를 불러오지 못했습니다. 새로고침해 주세요.'));
if (new URLSearchParams(location.search).get('registered') === 'true') message('가입되었습니다. 이메일로 로그인해 주세요.', true);
if (new URLSearchParams(location.search).get('accountDeleted') === 'true') message('계정과 학습 데이터를 삭제했습니다.', true);

const kakaoResult = new URLSearchParams(location.search).get('kakao');
if (kakaoResult === 'success') message('카카오 로그인에 성공했습니다.', true);
