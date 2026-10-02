import {recordingOutbox} from './recording-outbox.js';

/** Recording UI, recorder lifecycle, waveform analysis, and course-level list. */
export function mountRecording({request, byId, getCourse, getEditor, setLocked, emptyState, userId = null}) {
  const el = byId;
  let version = 0;
  let activeRecording = null;
  let recordingTimer = null;
  let heartbeatTimer = null;
  let rows = [];
  let noteRows = [];
  const waveformFailures = new Set();

  const recordingTime = seconds => {
    const value = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  };

  async function uploadChunk(id, sequence, blob) {
    let lastError;
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const form = new FormData();
        form.append('chunk', blob, `chunk-${sequence}.webm`);
        return await request(`/api/recordings/${encodeURIComponent(id)}/chunks?sequence=${sequence}`, {method: 'POST', formData: form, allowUnauthorized: true});
      } catch (error) {
        lastError = error;
        if (error.status === 401) throw error;
        const retryable = !error.status || [408, 425, 429].includes(error.status) || error.status >= 500;
        if (attempt < maxAttempts - 1 && retryable) {
          const delay = Math.min(8000, 750 * (2 ** attempt));
          el('recording-message').textContent = `녹음 구간 ${sequence + 1} 저장을 재시도하고 있습니다… (${attempt + 2}/${maxAttempts})`;
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async function uploadOutbox(recordingId) {
    const chunks = await recordingOutbox.getChunks(recordingId);
    for (const chunk of chunks) {
      await uploadChunk(recordingId, chunk.sequence, chunk.blob);
      await recordingOutbox.deleteChunk(recordingId, chunk.sequence);
    }
  }

  function setAuthExpired(session) {
    if (session.authExpired) return;
    session.authExpired = true;
    el('recording-message').textContent = '로그인이 만료됐습니다. 이 기기에 녹음 구간을 임시 보관하고 있습니다. 녹음을 멈춘 뒤 다시 로그인하면 저장된 구간을 복구할 수 있습니다.';
    if (activeRecording === session) queueMicrotask(() => stopRecording(false));
  }

  function saveQueueError(session, error) {
    session.lastError = error;
    if (error?.status === 401) {
      setAuthExpired(session);
      return;
    }
    el('recording-message').textContent = `연결이 불안정해 저장하지 못한 녹음 구간을 이 기기에 임시 보관했습니다. 네트워크가 복구되면 다시 저장합니다. ${error.message}`;
  }

  function drawWaveform(canvas, peaks, cursor = null, viewStart = 0, viewEnd = 1) {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(300, canvas.clientWidth || 600);
    const height = 92;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#f5f8fb';
    context.fillRect(0, 0, width, height);
    const span = Math.max(0.001, viewEnd - viewStart);
    const screen = value => (value - viewStart) / span;
    context.strokeStyle = '#428df0';
    context.lineWidth = 1;
    context.beginPath();
    peaks.forEach((peak, index) => {
      const relative = index / Math.max(1, peaks.length - 1);
      if (relative < viewStart || relative > viewEnd) return;
      const x = screen(relative) * (width - 1);
      const amplitude = Math.max(1, peak * (height / 2 - 5));
      context.moveTo(x, height / 2 - amplitude);
      context.lineTo(x, height / 2 + amplitude);
    });
    context.stroke();
    if (cursor !== null && cursor >= viewStart && cursor <= viewEnd) {
      context.strokeStyle = '#d92d20';
      context.lineWidth = 2;
      context.beginPath();
      const x = screen(cursor) * (width - 1);
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }

  async function createWaveform(recording) {
    return await request(`/api/recordings/${encodeURIComponent(recording.id)}/waveform/rebuild`, {method: 'POST', body: '{}'});
  }

  function updateRecordingRow(updated) {
    waveformFailures.delete(updated.id);
    rows = rows.map(row => row.id === updated.id ? {...updated, noteId: row.noteId, noteTitle: row.noteTitle} : row);
    renderRecordings(rows, noteRows);
  }

  function renderRecordings(recordings, notes = []) {
    rows = recordings;
    noteRows = notes;
    const list = el('recordings');
    list.replaceChildren(...recordings.map(recording => {
      const item = document.createElement('article');
      item.className = 'recording-row';
      const head = document.createElement('div');
      head.className = 'recording-row-head';
      const identity = document.createElement('div');
      identity.className = 'recording-row-identity';
      const title = document.createElement('strong');
      title.textContent = recording.title;
      const duration = document.createElement('span');
      duration.className = 'fine-print';
      duration.textContent = recording.status === 'READY' ? recordingTime(recording.durationSeconds)
        : recording.status === 'RECORDING' ? `저장된 구간 ${recording.chunkCount}개 · 복구 가능`
          : '저장 중단됨';
      const rename = document.createElement('button');
      rename.type = 'button'; rename.className = 'quiet-button'; rename.textContent = '이름 변경';
      rename.onclick = async () => {
        const value = window.prompt('녹음 이름', recording.title)?.trim();
        if (value) { await request(`/api/recordings/${recording.id}`, {method: 'PATCH', body: JSON.stringify({title: value})}); await loadRecordings(recording.courseId); }
      };
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'quiet-button'; remove.textContent = '삭제';
      remove.onclick = async () => {
        if (window.confirm('이 녹음을 삭제할까요?')) { await request(`/api/recordings/${recording.id}`, {method: 'DELETE'}); await loadRecordings(recording.courseId); }
      };
      identity.append(title, duration, rename);
      head.append(identity);
      if (recording.status === 'READY') {
        const noteSelect = document.createElement('select');
        noteSelect.className = 'recording-note-select';
        noteSelect.setAttribute('aria-label', `${recording.title} 연결할 강의노트`);
        noteSelect.title = '연결할 강의노트';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = recording.noteId ? '현재 연결된 노트' : '연결할 강의노트 선택';
        placeholder.selected = !recording.noteId;
        placeholder.disabled = Boolean(recording.noteId);
        noteSelect.append(placeholder);
        notes.forEach(note => {
          const option = document.createElement('option');
          option.value = note.id; option.textContent = note.title; option.selected = note.id === recording.noteId;
          noteSelect.append(option);
        });
        if (recording.noteId && !notes.some(note => note.id === recording.noteId)) {
          const option = document.createElement('option');
          option.value = recording.noteId; option.textContent = `${recording.noteTitle || '삭제된 노트'} (현재 연결)`; option.selected = true;
          noteSelect.prepend(option);
        }
        noteSelect.disabled = !notes.length || (notes.length === 1 && notes[0].id === recording.noteId);
        noteSelect.onchange = async () => {
          const previous = recording.noteId;
          const requestedNoteId = noteSelect.value;
          noteSelect.disabled = true;
          try {
            const updated = await request(`/api/recordings/${encodeURIComponent(recording.id)}/note`, {method: 'PATCH', body: JSON.stringify({noteId: requestedNoteId})});
            recording.noteId = updated.noteId; recording.noteTitle = updated.noteTitle; noteSelect.value = updated.noteId;
            rows = rows.map(row => row.id === updated.id ? {...row, ...updated} : row);
            el('recording-message').textContent = `연결된 강의노트를 ${updated.noteTitle || '변경'}(으)로 변경했습니다.`;
            noteSelect.disabled = notes.length === 1 && notes[0].id === updated.noteId;
          } catch (error) {
            noteSelect.value = previous || '';
            el('recording-message').textContent = `노트 연결을 저장하지 못했습니다. ${error.message}`;
            noteSelect.disabled = !notes.length;
          }
        };
        head.append(noteSelect);
      } else if (recording.status === 'RECORDING') {
        const lastActivity = Date.parse(recording.lastActivityAt || recording.createdAt || 0);
        const isThisSession = activeRecording?.id === recording.id;
        const isStale = !isThisSession && Number.isFinite(lastActivity) && Date.now() - lastActivity > 45000;
        if (isStale) {
          const recover = document.createElement('button');
          recover.type = 'button'; recover.className = 'quiet-button';
          recover.textContent = '저장된 구간 복구';
          recover.onclick = async () => {
            recover.disabled = true;
            try {
              await recoverRecording(recording);
              await loadRecordings(recording.courseId);
            } catch (error) {
              el('recording-message').textContent = `녹음 구간을 복구하지 못했습니다. ${error.message}`;
              recover.disabled = false;
            }
          };
          head.append(recover);
          if (!recording.chunkCount) {
            const removeIncomplete = document.createElement('button');
            removeIncomplete.type = 'button'; removeIncomplete.className = 'quiet-button danger-text'; removeIncomplete.textContent = '미완성 녹음 삭제';
            removeIncomplete.onclick = async () => {
              if (!window.confirm('저장된 구간을 먼저 복구하지 않고 이 미완성 녹음을 삭제할까요?')) return;
              removeIncomplete.disabled = true;
              try {
                const pending = await recordingOutbox.getChunks(recording.id);
                if (pending.length) throw new Error('이 기기에 미전송 구간이 남아 있습니다. 먼저 저장된 구간 복구를 눌러 주세요.');
                await request(`/api/recordings/${encodeURIComponent(recording.id)}`, {method: 'DELETE'});
                await recordingOutbox.deleteRecording(recording.id);
                await loadRecordings(recording.courseId);
              } catch (error) {
                el('recording-message').textContent = `미완성 녹음을 정리하지 못했습니다. ${error.message}`;
                removeIncomplete.disabled = false;
              }
            };
            head.append(removeIncomplete);
          }
        } else if (!isThisSession) {
          const live = document.createElement('span'); live.className = 'fine-print'; live.textContent = '다른 화면에서 녹음 중';
          head.append(live);
        }
      }
      if (recording.status !== 'RECORDING') head.append(remove);
      item.append(head);
      if (recording.status === 'READY') renderPlayer(item, recording, duration);
      return item;
    }));
    if (!recordings.length) list.replaceChildren(emptyState('이 과목에 녹음이 없습니다.', '녹음은 같은 과목의 모든 강의노트에서 확인할 수 있습니다.'));
  }

  async function recoverRecording(recording) {
    const local = await recordingOutbox.getSession(recording.id);
    if (local?.ownerUserId && userId && String(local.ownerUserId) !== String(userId)) {
      throw new Error('다른 StudySpace 계정에서 만든 임시 녹음이라 이 계정으로 복구할 수 없습니다.');
    }
    await uploadOutbox(recording.id);
    const estimate = Number(local?.elapsedSeconds) || Number(recording.durationSeconds)
      || Math.min(3600, Math.max(0.1, recording.chunkCount * 4));
    const finished = await request(`/api/recordings/${encodeURIComponent(recording.id)}/finish`, {
      method: 'POST', body: JSON.stringify({durationSeconds: Math.min(3600, Math.max(0.1, estimate))})
    });
    await recordingOutbox.deleteRecording(recording.id);
    el('recording-message').textContent = '서버와 이 기기에 저장된 녹음 구간을 복구했습니다.';
    try { updateRecordingRow(finished.waveform?.length ? finished : await createWaveform(finished)); }
    catch { waveformFailures.add(finished.id); updateRecordingRow(finished); }
  }

  function renderPlayer(item, recording, durationLabel) {
    let playableDuration = Number(recording.durationSeconds) || 0;
    let redrawWaveform = () => {};
    const syncPlayableDuration = audio => {
      // Keep the server duration; the browser may initially report only one WebM fragment.
      durationLabel.textContent = recordingTime(playableDuration);
      redrawWaveform();
    };
    const player = document.createElement('div'); player.className = 'recording-player';
    const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata';
    audio.src = `/api/recordings/${encodeURIComponent(recording.id)}/content`;
    audio.addEventListener('loadedmetadata', () => syncPlayableDuration(audio));
    audio.addEventListener('durationchange', () => syncPlayableDuration(audio));
    const speed = document.createElement('select'); speed.setAttribute('aria-label', '재생 속도');
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].forEach(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = `${value}배속`; option.selected = value === 1; speed.append(option);
    });
    speed.onchange = () => { audio.playbackRate = Number(speed.value); audio.preservesPitch = true; };
    player.append(audio, speed); item.append(player);
    if (!recording.waveform?.length) {
      const failed = waveformFailures.has(recording.id);
      const message = document.createElement('p'); message.className = 'fine-print waveform-empty-message';
      message.textContent = failed ? '파형을 만들지 못했습니다. 녹음 재생은 가능합니다.' : '파형 데이터가 없습니다. 녹음 재생은 가능합니다.';
      item.append(message);
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'quiet-button'; retry.textContent = failed ? '파형 다시 만들기' : '파형 만들기';
      retry.onclick = async () => {
        retry.disabled = true;
        try { updateRecordingRow(await createWaveform(recording)); }
        catch (error) { waveformFailures.add(recording.id); updateRecordingRow(recording); el('recording-message').textContent = `파형 생성에 실패했습니다. ${error.message}`; }
      };
      item.append(retry);
      return;
    }
    const canvas = document.createElement('canvas'); canvas.className = 'waveform';
    canvas.setAttribute('role', 'button'); canvas.setAttribute('aria-label', '녹음 파형. 누르면 해당 위치부터 재생'); canvas.tabIndex = 0;
    let zoomIndex = 0, viewStart = 0, viewEnd = 1;
    const controls = document.createElement('div'); controls.className = 'waveform-controls';
    const zoomOut = document.createElement('button'); zoomOut.type = 'button'; zoomOut.className = 'quiet-button waveform-zoom'; zoomOut.textContent = '−'; zoomOut.setAttribute('aria-label', '파형 축소'); zoomOut.disabled = true;
    const zoomLabel = document.createElement('span'); zoomLabel.className = 'waveform-zoom-level';
    const zoomIn = document.createElement('button'); zoomIn.type = 'button'; zoomIn.className = 'quiet-button waveform-zoom'; zoomIn.textContent = '+'; zoomIn.setAttribute('aria-label', '파형 확대');
    const range = document.createElement('span'); range.className = 'waveform-range-label';
    const redraw = () => {
      const total = Math.max(0.1, playableDuration || Number(recording.durationSeconds) || 0.1);
      const cursor = Math.min(1, Math.max(0, audio.currentTime / total));
      drawWaveform(canvas, recording.waveform, cursor, viewStart, viewEnd);
      zoomLabel.textContent = `${[1, 2, 4, 8, 16][zoomIndex]}×`;
      range.textContent = `${recordingTime(viewStart * total)} – ${recordingTime(viewEnd * total)}`;
      zoomOut.disabled = zoomIndex === 0;
      zoomIn.disabled = zoomIndex === 4;
    };
    redrawWaveform = redraw;
    const setZoom = index => {
      zoomIndex = Math.min(4, Math.max(0, index));
      const scale = [1, 2, 4, 8, 16][zoomIndex];
      if (scale === 1) { viewStart = 0; viewEnd = 1; }
      else {
        const span = 1 / scale;
        const total = Math.max(0.1, playableDuration || Number(recording.durationSeconds) || 0.1);
        const cursor = Math.min(1, Math.max(0, audio.currentTime / total));
        viewStart = Math.min(1 - span, Math.max(0, cursor - span / 2));
        viewEnd = viewStart + span;
      }
      redraw();
    };
    zoomOut.onclick = () => setZoom(zoomIndex - 1); zoomIn.onclick = () => setZoom(zoomIndex + 1);
    const seekFromPointer = event => {
      const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const total = Math.max(0.1, playableDuration || Number(recording.durationSeconds) || 0.1);
      audio.currentTime = (viewStart + fraction * (viewEnd - viewStart)) * total;
      audio.play().catch(() => {}); redraw();
    };
    canvas.onclick = seekFromPointer;
    canvas.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const total = Math.max(0.1, playableDuration || Number(recording.durationSeconds) || 0.1);
      audio.currentTime = (viewStart + (rect.width ? 0.5 : 0) * (viewEnd - viewStart)) * total;
      audio.play().catch(() => {}); redraw();
    };
    audio.ontimeupdate = () => {
      const total = Math.max(0.1, playableDuration || Number(recording.durationSeconds) || 0.1);
      const cursor = audio.currentTime / total, span = viewEnd - viewStart;
      if (zoomIndex > 0 && (cursor < viewStart || cursor > viewEnd)) { viewStart = Math.min(1 - span, Math.max(0, cursor - span / 2)); viewEnd = viewStart + span; }
      redraw();
    };
    controls.append(zoomOut, zoomLabel, zoomIn, range); item.append(canvas, controls); requestAnimationFrame(redraw);
  }

  async function loadRecordings(courseId = getCourse()?.id, fallbackNoteId = getEditor().id) {
    const editor = getEditor();
    const currentCourse = getCourse();
    const recordingMessage = el('recording-message').textContent;
    if (!activeRecording || recordingMessage.startsWith('연결된 강의노트를')) el('recording-message').textContent = '';
    const requestVersion = ++version;
    setLocked(el('start-recording'), !editor.id || !!activeRecording, !editor.id ? '노트를 먼저 저장하면 녹음할 수 있어요.' : (activeRecording?.stopped ? '이전 녹음 저장을 마친 뒤 새 녹음을 시작할 수 있어요.' : (activeRecording ? '이미 녹음이 진행 중입니다.' : '')));
    if (!courseId) { el('recordings').textContent = '과목을 선택하면 해당 과목의 녹음이 표시됩니다.'; return; }
    const currentNotes = await request(`/api/courses/${encodeURIComponent(courseId)}/notes`);
    if (requestVersion !== version) return;
    let recordings;
    try { recordings = await request(`/api/courses/${encodeURIComponent(courseId)}/recordings`); }
    catch (error) {
      if (!/not found/i.test(error.message)) throw error;
      const referenceNoteId = fallbackNoteId || currentNotes[0]?.id;
      if (!referenceNoteId) { renderRecordings([], currentNotes); return []; }
      recordings = await request(`/api/notes/${encodeURIComponent(referenceNoteId)}/recordings`);
    }
    if (requestVersion !== version) return;
    renderRecordings(recordings, currentNotes);
    return recordings;
  }

  function elapsedRecording() {
    if (!activeRecording) return 0;
    return activeRecording.elapsed + (activeRecording.paused ? 0 : (performance.now() - activeRecording.since) / 1000);
  }
  function syncRailRecording(active, elapsed = 0) {
    const status = el('rail-recording-status'), brand = status?.parentElement;
    if (status) status.hidden = !active;
    brand?.classList.toggle('recording-active', active);
    const clock = el('rail-recording-clock'); if (clock) clock.textContent = `${recordingTime(elapsed)} / 60:00`;
  }
  function updateRecordingClock() {
    const elapsed = elapsedRecording();
    el('recording-timer').textContent = `${recordingTime(elapsed)} / 60:00`;
    const recording = activeRecording && activeRecording.recorder.state !== 'inactive';
    syncRailRecording(!!recording, elapsed);
    if (recording && elapsed >= 3600) stopRecording(true);
    else if (recording) recordingTimer = setTimeout(updateRecordingClock, 250);
  }

  async function startRecording() {
    const editor = getEditor(), course = getCourse();
    if (!editor.id || activeRecording || !course) return;
    const sourceNoteId = editor.id, sourceCourseId = course.id, sourceCourseName = course.name, sourceNoteTitle = editor.title;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { el('recording-message').textContent = '이 브라우저에서는 녹음을 지원하지 않습니다.'; return; }
    const button = el('start-recording'); button.disabled = true; let stream, createdId = null, newSession = null;
    try {
      await recordingOutbox.ready();
      await recordingOutbox.persist();
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find(value => MediaRecorder.isTypeSupported(value)) || '';
      const recorder = mime ? new MediaRecorder(stream, {mimeType: mime}) : new MediaRecorder(stream);
      const actualMime = recorder.mimeType?.split(',')[0] || 'audio/webm';
      const created = await request(`/api/notes/${encodeURIComponent(sourceNoteId)}/recordings`, {method: 'POST', body: JSON.stringify({title: `강의 녹음 ${new Date().toLocaleString('ko-KR')}`, mimeType: actualMime})});
      createdId = created.id;
      const session = {id: created.id, noteId: sourceNoteId, courseId: sourceCourseId, courseName: sourceCourseName, noteTitle: sourceNoteTitle, title: created.title, mimeType: actualMime, ownerUserId: userId, recorder, stream, sequence: created.chunkCount || 0, captureQueue: Promise.resolve(), elapsed: 0, since: performance.now(), paused: false, stopping: false, stopped: false};
      newSession = session;
      try { await recordingOutbox.saveSession(session); }
      catch (error) {
        await request(`/api/recordings/${encodeURIComponent(created.id)}`, {method: 'DELETE'}).catch(() => {});
        throw error;
      }
      activeRecording = session;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        const sequence = session.sequence++;
        session.captureQueue = session.captureQueue.then(async () => {
          await recordingOutbox.saveChunk(session.id, sequence, event.data);
          await recordingOutbox.saveSession({...session, elapsedSeconds: elapsedRecording()});
          await uploadOutbox(session.id);
        }).catch(error => {
          saveQueueError(session, error);
          const retryable = !error.status || [408, 425, 429].includes(error.status) || error.status >= 500;
          if (error.status && !retryable && error.status !== 401) {
            el('recording-message').textContent = `서버가 녹음 구간을 받지 못해 녹음을 멈췄습니다. 이 기기에 저장된 구간은 보존되어 있습니다. ${error.message}`;
            queueMicrotask(() => stopRecording(false));
          }
          if (error?.name === 'QuotaExceededError' || /저장소/.test(error.message)) {
            el('recording-message').textContent = `기기 임시 저장공간이 부족해 녹음을 멈춥니다. 서버에 저장된 ${sequence}개 구간은 보존됩니다.`;
            queueMicrotask(() => stopRecording(false));
          }
        });
      };
      recorder.onerror = () => { el('recording-message').textContent = '녹음 장치 오류가 발생했습니다. 저장된 구간을 정리해 보존하겠습니다.'; stopRecording(false); };
      recorder.start(4000);
      el('recording-message').textContent = '녹음 중입니다. 다른 학습 탭으로 이동해도 계속됩니다.';
      el('recording-login')?.classList.add('hidden');
      el('recording-timer').classList.add('active'); syncRailRecording(true, 0);
      button.classList.add('hidden'); el('pause-recording').textContent = '일시정지'; el('pause-recording').classList.remove('hidden'); el('stop-recording').textContent = '종료하고 저장'; el('stop-recording').classList.remove('hidden');
      heartbeatTimer = setInterval(async () => {
        if (activeRecording !== session || session.stopped) return;
        try {
          await request(`/api/recordings/${encodeURIComponent(session.id)}/heartbeat`, {method: 'POST', allowUnauthorized: true});
          await recordingOutbox.saveSession({...session, elapsedSeconds: elapsedRecording()});
        } catch (error) {
          if (error.status === 401) setAuthExpired(session);
        }
      }, 10000);
      updateRecordingClock();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (newSession && activeRecording === newSession) activeRecording = null;
      if (createdId) {
        await recordingOutbox.deleteRecording(createdId).catch(() => {});
        await request(`/api/recordings/${encodeURIComponent(createdId)}`, {method: 'DELETE'}).catch(() => {});
      }
      el('recording-message').textContent = error.name === 'NotAllowedError' ? '마이크 권한이 없어 녹음을 시작하지 않았습니다.' : error.message;
      button.disabled = false;
      if (error.status === 409) {
        await loadRecordings(sourceCourseId, sourceNoteId).catch(() => {});
        el('recording-message').textContent = '이전에 시작한 녹음이 남아 있습니다. 녹음 목록에서 저장된 구간을 복구한 뒤 새 녹음을 시작해 주세요.';
      }
    }
  }

  async function stopRecording(limit = false) {
    const session = activeRecording;
    if (!session || session.stopping) return;
    session.stopping = true; clearTimeout(recordingTimer); clearInterval(heartbeatTimer);
    if (!session.stopped) {
      if (!session.paused) session.elapsed += (performance.now() - session.since) / 1000;
      session.duration = Math.min(3600, session.elapsed);
      if (session.recorder.state !== 'inactive') {
        const stopped = new Promise(resolve => session.recorder.addEventListener('stop', resolve, {once: true}));
        session.recorder.stop(); await stopped;
      }
      session.stream.getTracks().forEach(track => track.stop());
      session.stopped = true;
    }
    try {
      await session.captureQueue;
      await uploadOutbox(session.id);
      const finished = await request(`/api/recordings/${session.id}/finish`, {method: 'POST', body: JSON.stringify({durationSeconds: Math.max(0.1, session.duration || session.elapsed)}), allowUnauthorized: true});
      await recordingOutbox.deleteRecording(session.id);
      activeRecording = null;
      let listRefreshError = null;
      try { await loadRecordings(session.courseId, session.noteId); } catch (error) { listRefreshError = error; }
      let waveformFailed = false;
      try { updateRecordingRow(finished.waveform?.length ? finished : await createWaveform(finished)); }
      catch (error) { waveformFailed = true; waveformFailures.add(finished.id); updateRecordingRow(finished); el('recording-message').textContent = `녹음은 저장됐지만 파형을 바로 만들지 못했습니다. 목록에서 다시 시도할 수 있어요. ${error.message}`; }
      if (listRefreshError) el('recording-message').textContent = `녹음은 저장됐지만 목록을 새로고침하지 못했습니다. ${listRefreshError.message}`;
      else if (!waveformFailed) el('recording-message').textContent = limit ? '60분 녹음이 저장되었습니다. 아래에서 연결할 강의노트를 변경할 수 있습니다.' : '녹음을 저장했습니다. 아래에서 연결할 강의노트를 선택하거나 변경할 수 있습니다.';
    } catch (error) {
      session.stopping = false;
      saveQueueError(session, error);
      el('recording-message').textContent = error.status === 401
        ? '로그인이 만료됐습니다. 저장된 구간을 이 기기에 보관했습니다. 다시 로그인한 뒤 녹음 목록의 “저장된 구간 복구”를 선택하세요.'
        : `녹음 구간은 이 기기에 임시 보관했습니다. 네트워크를 확인한 뒤 “저장 다시 시도”를 누르세요. ${error.message}`;
      el('recording-login')?.classList.toggle('hidden', error.status !== 401);
      syncRailRecording(false, session.duration || session.elapsed);
      el('recording-timer').textContent = `${recordingTime(session.duration || session.elapsed)} / 60:00`;
      el('pause-recording').classList.add('hidden');
      el('stop-recording').textContent = error.status === 401 ? '로그인 후 녹음 복구' : '저장 다시 시도';
      el('stop-recording').disabled = error.status === 401;
      return;
    }
    syncRailRecording(false); el('recording-timer').classList.remove('active'); el('recording-timer').textContent = '00:00 / 60:00';
    el('recording-login')?.classList.add('hidden');
    el('stop-recording').disabled = false;
    el('stop-recording').textContent = '종료하고 저장';
    {
      el('start-recording').classList.remove('hidden');
      const editor = getEditor(); setLocked(el('start-recording'), !editor.id || !!activeRecording, '노트를 먼저 저장하면 녹음할 수 있어요.');
      el('pause-recording').textContent = '일시정지'; el('pause-recording').classList.add('hidden'); el('stop-recording').classList.add('hidden');
    }
  }

  el('start-recording').onclick = startRecording;
  el('stop-recording').onclick = () => stopRecording(false);
  if (el('recording-login')) el('recording-login').onclick = () => location.assign('/');
  el('pause-recording').onclick = () => {
    const session = activeRecording; if (!session) return;
    if (session.paused) { session.recorder.resume(); session.since = performance.now(); session.paused = false; el('pause-recording').textContent = '일시정지'; }
    else { session.recorder.pause(); session.elapsed += (performance.now() - session.since) / 1000; session.paused = true; el('pause-recording').textContent = '계속 녹음'; }
  };

  return {loadRecordings, activeSession: () => activeRecording, isRecording: () => !!activeRecording && !activeRecording.stopped};
}
