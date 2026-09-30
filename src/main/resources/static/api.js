/* Shared JSON fetch wrapper: CSRF 발급, JSON 파싱, 401 처리, 오류 메시지를
   한곳에서 처리한다. 인증이 필요한 모든 화면에서 동일하게 사용한다. */
export async function apiFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  let payload = options.body;
  if (options.formData) {
    payload = options.formData;
  } else if (payload !== undefined && typeof payload !== 'string') {
    payload = JSON.stringify(payload);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  } else if (payload !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET') {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    if (!csrfResponse.ok) throw new Error('다시 로그인해 주세요.');
    const csrf = await csrfResponse.json().catch(() => ({}));
    if (!csrf.token) throw new Error('보안 정보를 준비하지 못했습니다. 다시 시도해 주세요.');
    headers['X-XSRF-TOKEN'] = csrf.token;
  }
  const response = await fetch(path, { method, headers, credentials: 'same-origin', body: payload });
  if (response.status === 401) {
    location.assign('/');
    throw new Error('다시 로그인해 주세요.');
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.error || data?.message || '요청을 처리하지 못했습니다.');
  return data;
}
