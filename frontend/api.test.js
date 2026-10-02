import test from 'node:test';
import assert from 'node:assert/strict';
import {apiFetch} from '../src/main/resources/static/api.js';

test('generation requests explain when the local server is unreachable', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  globalThis.location = {hostname: 'localhost'};
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
    await assert.rejects(apiFetch('/api/notes/note-1/generations', {method: 'POST', body: '{}'}), /로컬 서버에 연결할 수 없습니다/);
    assert.equal(calls, 1, 'do not send the generation when CSRF could not be fetched');

    globalThis.fetch = async path => path === '/api/auth/csrf'
      ? {ok: true, json: async () => ({token: 'test-token'})}
      : Promise.reject(new TypeError('Failed to fetch'));
    await assert.rejects(apiFetch('/api/notes/note-1/generations', {method: 'POST', body: '{}'}), /로컬 서버에 연결할 수 없습니다/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});

test('recording uploads can handle an expired session without navigating away from local audio buffers', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  let navigated = false;
  globalThis.location = {assign: () => { navigated = true; }};
  globalThis.fetch = async path => path === '/api/auth/csrf'
    ? {ok: true, status: 200, json: async () => ({token: 'test-token'})}
    : {ok: false, status: 401, text: async () => JSON.stringify({error: '로그인이 필요합니다.'})};
  try {
    await assert.rejects(apiFetch('/api/recordings/id/chunks?sequence=0', {method: 'POST', formData: new FormData(), allowUnauthorized: true}), error => {
      assert.equal(error.status, 401);
      assert.match(error.message, /로그인이 필요합니다/);
      return true;
    });
    assert.equal(navigated, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});
