/** Owns course-note attachments, upload validation, analysis, and source state. */
export function mountAttachments({request, byId, getEditor, getGenerationFeature, emptyState, mockEnabled = true}) {
  const el = byId;
  let version = 0;
  let timer;
  let activeNoteId = '';
  let pendingFiles = [];
  let availableSources = [];
  let dragDepth = 0;
  const maxAttachmentBytes = 50 * 1024 * 1024;
  const attachmentExtensions = new Set(['pdf', 'pptx', 'hwp', 'png']);
  const input = el('attachment-input');
  const dropzone = el('attachment-dropzone');

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function selectedAttachmentIds() {
    return availableSources.map(row => row.id);
  }

  function updateSourceSummary() {
    const selected = availableSources;
    const names = selected.map(row => row.originalName);
    const count = selected.length;
    const sourceLength = selected.reduce((total, row) => total + Number(row.extractedLength || 0), 0);
    const noteLength = el('note-body')?.value.length || 0;
    let message = '현재 노트만 사용합니다. 분석이 완료된 강의자료는 AI 학습 자료 생성에 포함됩니다.';
    if (count) {
      const visible = names.slice(0, 2).join(', ');
      const extra = names.length > 2 ? ` 외 ${names.length - 2}개` : '';
      message = `현재 노트와 분석 완료 자료 ${count}개를 함께 사용합니다 · 약 ${(noteLength + sourceLength).toLocaleString()}자${visible ? ` · ${visible}${extra}` : ''}.`;
    }
    ['generation-source-summary', 'practice-source-summary'].forEach(id => {
      const target = el(id);
      if (target) { target.textContent = message; target.setAttribute('aria-live', 'polite'); }
    });
  }

  function renderAttachments(rows) {
    const list = el('attachments');
    availableSources = rows.filter(row => row.analysisStatus === 'TEXT_READY');
    el('attachment-count').textContent = rows.length ? `${rows.length}개` : '';
    const statuses = {NOT_ANALYZED: '분석 전', ANALYZING: '분석 중', TEXT_READY: '분석 완료', AWAITING_AI: 'AI 분석 대기', FAILED: '분석 실패'};
    const analysisErrors = {PROVIDER_NOT_CONFIGURED: 'AI 키 설정 필요', PROVIDER_AUTH_FAILED: 'AI 인증 실패', PROVIDER_RATE_LIMITED: 'AI 요청 한도 초과', PROVIDER_TIMEOUT: 'AI 응답 시간 초과', PROVIDER_UNAVAILABLE: 'AI 분석 일시 오류', PROVIDER_INVALID_RESULT: 'AI 결과 확인 필요', IMAGE_TOO_LARGE: '이미지 용량 초과', IMAGE_MEDIA_TYPE_INVALID: '이미지 형식 오류', TEXT_EXTRACTION_FAILED: '문서 읽기 실패'};
    list.replaceChildren(...rows.map(row => {
      const item = document.createElement('div'); item.className = 'attachment-row';
      const info = document.createElement('div'); info.className = 'attachment-info';
      const link = document.createElement('a'); link.href = `/api/attachments/${encodeURIComponent(row.id)}/content`; link.textContent = row.originalName; link.setAttribute('download', ''); link.setAttribute('aria-label', `${row.originalName} 다운로드`);
      const analysisLabel = row.analysisStatus === 'FAILED' && row.analysisErrorCode ? (analysisErrors[row.analysisErrorCode] || '분석 실패') : (statuses[row.analysisStatus] || row.analysisStatus);
      const meta = document.createElement('span'); meta.textContent = `${formatSize(row.size)} · ${row.reusedAnalysis ? '분석 재사용' : analysisLabel}${row.extractedLength ? ` · ${row.extractedLength.toLocaleString()}자` : ''}`;
      info.append(link, meta);
      if (row.analysisStatus === 'TEXT_READY') {
        const summary = document.createElement('p'); summary.className = 'attachment-summary'; summary.setAttribute('aria-live', 'polite');
        summary.textContent = row.summaryStatus === 'READY' && row.summaryText ? row.summaryText : mockEnabled ? '모의 모드에서는 AI 요약을 호출하지 않습니다.' : row.summaryStatus === 'FAILED' ? 'AI 요약을 만들지 못했습니다. 다시 시도해 주세요.' : 'AI 요약을 생성하고 있어요…';
        info.append(summary);
      }
      const actions = document.createElement('div'); actions.className = 'attachment-actions';
      if (!mockEnabled && row.analysisStatus === 'TEXT_READY' && row.summaryStatus === 'FAILED') {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'quiet-button'; retry.textContent = '요약 다시 시도';
        retry.onclick = async () => {
          retry.disabled = true;
          try { await request(`/api/attachments/${encodeURIComponent(row.id)}/summary`, {method: 'POST'}); await loadAttachments(getEditor().id); }
          catch (error) { el('attachment-message').textContent = error.message; retry.disabled = false; }
        };
        actions.append(retry);
      }
      if (row.analysisStatus === 'FAILED' || (!mockEnabled && ['AWAITING_AI', 'NOT_ANALYZED'].includes(row.analysisStatus))) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'quiet-button'; retry.textContent = '다시 분석';
        retry.onclick = async () => {
          retry.disabled = true;
          try { await request(`/api/attachments/${encodeURIComponent(row.id)}/analysis`, {method: 'POST'}); await loadAttachments(getEditor().id); }
          catch (error) { el('attachment-message').textContent = error.message; retry.disabled = false; }
        };
        actions.append(retry);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button'; remove.textContent = '삭제';
      remove.onclick = async () => {
        if (!window.confirm('이 강의자료를 삭제할까요?')) return;
        remove.disabled = true;
        try { await request(`/api/attachments/${encodeURIComponent(row.id)}`, {method: 'DELETE'}); await loadAttachments(getEditor().id); }
        catch (error) { el('attachment-message').textContent = error.message; remove.disabled = false; }
      };
      actions.append(remove); item.append(info, actions); return item;
    }));
    if (!rows.length) list.replaceChildren(emptyState('아직 첨부한 자료가 없습니다.', 'PDF·PPTX·HWP·PNG를 이 노트에 연결해 보세요.'));
    updateSourceSummary();
  }

  async function loadAttachments(noteId) {
    const normalizedId = noteId || '';
    clearTimeout(timer);
    const requestVersion = ++version;
    if (normalizedId !== activeNoteId) {
      activeNoteId = normalizedId;
      pendingFiles = [];
      availableSources = [];
      updatePendingAttachments();
      updateSourceSummary();
    }
    const upload = el('upload-attachments');
    input.disabled = !normalizedId; upload.disabled = !normalizedId;
    dropzone.setAttribute('aria-disabled', String(!normalizedId));
    if (!normalizedId) {
      el('attachment-count').textContent = '';
      el('attachment-message').textContent = '노트를 먼저 저장하면 강의자료를 연결할 수 있습니다.';
      el('attachments').textContent = '새 노트를 저장한 뒤 자료를 첨부해 보세요.';
      return;
    }
    el('attachment-message').textContent = '첨부자료를 불러오는 중입니다.';
    const rows = await request(`/api/notes/${encodeURIComponent(normalizedId)}/attachments`);
    if (requestVersion !== version) return;
    renderAttachments(rows); el('attachment-message').textContent = '';
    if (rows.some(row => row.analysisStatus === 'ANALYZING' || (!mockEnabled && (row.summaryStatus === 'ANALYZING' || (row.analysisStatus === 'TEXT_READY' && row.summaryStatus === 'NOT_SUMMARIZED'))))) {
      timer = setTimeout(() => loadAttachments(normalizedId).catch(error => { el('attachment-message').textContent = error.message; }), 1600);
    }
    return rows;
  }

  function updatePendingAttachments() {
    const selection = el('attachment-selection');
    const total = pendingFiles.reduce((sum, file) => sum + file.size, 0);
    selection.hidden = pendingFiles.length === 0;
    selection.textContent = pendingFiles.length ? `${pendingFiles.length}개 선택 · ${pendingFiles.map(file => file.name).join(', ')} · 합계 ${formatSize(total)}` : '';
    el('upload-attachments').disabled = !getEditor().id || pendingFiles.length === 0;
  }

  function chooseAttachmentFiles(files, append = false) {
    const incoming = [...files];
    const invalid = incoming.filter(file => !attachmentExtensions.has(file.name.split('.').pop().toLowerCase()) || file.size > maxAttachmentBytes);
    const accepted = incoming.filter(file => attachmentExtensions.has(file.name.split('.').pop().toLowerCase()) && file.size <= maxAttachmentBytes);
    pendingFiles = append ? [...pendingFiles, ...accepted] : accepted;
    const errors = [];
    if (invalid.some(file => file.size > maxAttachmentBytes)) errors.push('파일당 최대 크기는 50MB입니다.');
    if (invalid.some(file => file.size <= maxAttachmentBytes)) errors.push('PDF, PPTX, HWP, PNG 파일만 첨부할 수 있습니다.');
    if (invalid.some(file => file.size > maxAttachmentBytes && !attachmentExtensions.has(file.name.split('.').pop().toLowerCase()))) errors.push('지원하지 않는 파일 형식이 포함되어 있습니다.');
    updatePendingAttachments();
    el('attachment-message').textContent = errors.join(' ');
  }

  input.addEventListener('change', () => chooseAttachmentFiles(input.files));
  dropzone.addEventListener('dragenter', event => {
    event.preventDefault();
    if (!input.disabled) { dragDepth++; dropzone.classList.add('is-dragover'); }
  });
  dropzone.addEventListener('dragover', event => event.preventDefault());
  dropzone.addEventListener('dragleave', event => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropzone.classList.remove('is-dragover');
  });
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0; dropzone.classList.remove('is-dragover');
    if (input.disabled) return;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) chooseAttachmentFiles(files, true);
  });

  el('upload-attachments').onclick = async () => {
    const noteId = getEditor().id;
    const files = [...pendingFiles];
    if (!noteId || !files.length) { el('attachment-message').textContent = '첨부할 파일을 선택해 주세요.'; return; }
    const button = el('upload-attachments'); button.disabled = true; input.disabled = true; dropzone.setAttribute('aria-disabled', 'true');
    let completed = 0;
    const uploaded = [];
    try {
      for (const file of files) {
        const form = new FormData(); form.append('file', file);
        el('attachment-message').textContent = `${file.name} 첨부 중…`;
        uploaded.push(await request(`/api/notes/${encodeURIComponent(noteId)}/attachments`, {method: 'POST', formData: form})); completed++;
      }
      pendingFiles = []; input.value = ''; updatePendingAttachments();
      await loadAttachments(noteId);
      clearTimeout(timer);
      input.disabled = true; button.disabled = true; dropzone.setAttribute('aria-disabled', 'true');
      el('attachment-message').textContent = '첨부자료를 분석하고 있어요. 완료되면 AI 학습 자료 생성에 반영됩니다.';
      for (const row of uploaded) {
        if (['NOT_ANALYZED', 'FAILED', 'AWAITING_AI'].includes(row.analysisStatus)) {
          await request(`/api/attachments/${encodeURIComponent(row.id)}/analysis`, {method: 'POST'});
        }
      }
      const uploadedIds = new Set(uploaded.map(row => row.id));
      const deadline = Date.now() + 180000;
      let latest = [];
      while (Date.now() < deadline) {
        if (getEditor().id !== noteId) return;
        latest = await request(`/api/notes/${encodeURIComponent(noteId)}/attachments`);
        const current = latest.filter(row => uploadedIds.has(row.id));
        renderAttachments(latest);
        if (current.length === uploadedIds.size && current.every(row => !['ANALYZING', 'NOT_ANALYZED'].includes(row.analysisStatus))) break;
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
      const readyIds = latest.filter(row => uploadedIds.has(row.id) && row.analysisStatus === 'TEXT_READY').map(row => row.id);
      if (!readyIds.length) {
        el('attachment-message').textContent = '자료는 첨부했지만 자동 분석을 완료하지 못했습니다. 각 자료의 분석 상태를 확인해 주세요.';
        return;
      }
      renderAttachments(latest);
      el('attachment-message').textContent = '분석이 끝났습니다. 파일별 요약을 저장하고 AI 학습 자료 생성에 반영합니다.';
      await loadAttachments(noteId);
      document.dispatchEvent(new window.CustomEvent('studyspace:learning-refresh'));
    } catch (error) {
      if (getEditor().id === noteId) pendingFiles = pendingFiles.slice(completed);
      el('attachment-message').textContent = completed ? `${completed}개 첨부 후 자료 분석이 중단되었습니다. ${error.message}` : error.message;
      await loadAttachments(noteId).catch(() => {});
      updatePendingAttachments();
    } finally {
      button.disabled = !getEditor().id || pendingFiles.length === 0; input.disabled = !getEditor().id;
      dropzone.setAttribute('aria-disabled', String(!getEditor().id));
      if (pendingFiles.length) updatePendingAttachments();
    }
  };

  return {loadAttachments, selectedAttachmentIds, updateSourceSummary};
}
