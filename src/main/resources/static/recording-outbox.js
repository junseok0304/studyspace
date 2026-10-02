const DATABASE = 'studyspace-recording-outbox';
const VERSION = 1;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('이 브라우저의 임시 녹음 저장소를 사용할 수 없습니다.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', {keyPath: 'id'});
      if (!database.objectStoreNames.contains('chunks')) database.createObjectStore('chunks', {keyPath: ['recordingId', 'sequence']});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('임시 녹음 저장소를 열지 못했습니다.'));
    request.onblocked = () => reject(new Error('다른 창에서 임시 녹음 저장소를 사용 중입니다. 다른 StudySpace 창을 닫고 다시 시도해 주세요.'));
  });
}

function transact(storeName, mode, action) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try { result = action(store); }
    catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error || result?.error || new Error('임시 녹음 데이터를 저장하지 못했습니다.'));
    transaction.onabort = () => reject(transaction.error || new Error('임시 녹음 저장이 취소됐습니다.'));
  }));
}

export const recordingOutbox = {
  ready: () => openDatabase(),
  async persist() {
    try { await navigator.storage?.persist?.(); } catch {}
  },
  saveSession(session) {
    const {id, courseId, noteId, title, mimeType, ownerUserId, elapsedSeconds = 0} = session;
    return transact('sessions', 'readwrite', store => store.put({id, courseId, noteId, title, mimeType, ownerUserId, elapsedSeconds, savedAt: Date.now()}));
  },
  getSession(id) {
    return transact('sessions', 'readonly', store => store.get(id));
  },
  deleteSession(id) {
    return transact('sessions', 'readwrite', store => store.delete(id));
  },
  saveChunk(recordingId, sequence, blob) {
    return transact('chunks', 'readwrite', store => store.put({recordingId, sequence, blob, savedAt: Date.now()}));
  },
  async getChunks(recordingId) {
    const chunks = await transact('chunks', 'readonly', store => store.getAll());
    return (chunks || []).filter(chunk => chunk.recordingId === recordingId).sort((a, b) => a.sequence - b.sequence);
  },
  deleteChunk(recordingId, sequence) {
    return transact('chunks', 'readwrite', store => store.delete([recordingId, sequence]));
  },
  async deleteRecording(id) {
    const chunks = await this.getChunks(id);
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['sessions', 'chunks'], 'readwrite');
      transaction.objectStore('sessions').delete(id);
      const store = transaction.objectStore('chunks');
      chunks.forEach(chunk => store.delete([id, chunk.sequence]));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('임시 녹음 데이터를 정리하지 못했습니다.'));
      transaction.onabort = () => reject(transaction.error || new Error('임시 녹음 데이터 정리가 취소됐습니다.'));
    });
  }
};
