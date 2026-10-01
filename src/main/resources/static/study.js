import { renderMarkdown } from './markdown.js';
import { removeDuplicateLeadingTitle } from './note-markdown.js';
import { stripSummarySourceLabels } from './summary-view.js';
import { DraftStore, NoteEditor } from './note-editor.js';
import { renderInfographicPages } from './infographic-view.js';
import { courseChangeTool, mountWorkspaceNavigation } from './workspace-nav.js';
import { splitAiFrontmatter, withAiFrontmatter } from './note-metadata.js';
import { byId } from './dom.js';
import { mountRecording } from './recording.js';
import { mountGeneration } from './generation.js';
import { mountQuiz } from './quiz.js';
import { mountFlashcards } from './flashcards.js';
import { mountAttachments } from './attachments.js';
import { mountDashboard } from './dashboard.js';
import { mountLearningWorkspace } from './learning-workspace.js';
const NEW_NOTE_TEMPLATE = `## 수업 내용
## 교수님 강조 내용
## 질문과 헷갈린 점
## 다음 수업까지 할 일
`;
let started = false;
export async function start(request, userId) {
  if (started) return;
  started = true;
  mountWorkspaceNavigation();
  const aiConfig = await request('/api/ai/config');
  const matchesAiMode = result => result.mockResult === aiConfig.mockEnabled;
  let course = null, navigating = false;
  let notesVersion = 0, importPreview = null, importRequestId = null;
  let dashboardFeature;
  let recordingFeature;
  let generationFeature;
  let quizFeature;
  let flashcardsFeature;
  let attachmentsFeature;
  let learningFeature;
  const loadDashboard = () => dashboardFeature?.loadDashboard();
  const loadCourses = () => dashboardFeature?.loadCourses();
  const renderCourses = () => dashboardFeature?.renderCourses();
  const getCourses = () => dashboardFeature?.courses || [];
  const tell = text => { byId('study-message').textContent = text; };
  const updateNoteMeta = value => {
    const meta=byId('note-meta');
    if(!meta)return;
    const updated=value?.updatedAt ? new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value.updatedAt)) : '아직 저장되지 않음';
    meta.textContent=`${course?.name || '과목 미지정'} · ${updated}`;
  };
  const updateGenerationNoteContext = value => {
    const context=byId('generation-note-context');
    if(context) context.textContent=value ? `${course?.name || '과목'} · ${value.title || '제목 없는 노트'}` : '노트를 선택하면 인포그래픽·퀴즈·플래시카드를 볼 수 있습니다.';
  };
  const setLocked = (button, locked, reason) => {
    button.disabled = locked;
    if (locked) button.title = reason || '';
    else button.removeAttribute('title');
  };
  const saveIsBlocked = state => state.saving || (!state.dirty && !state.id) ||
    (!!state.dirty && (!!state.pendingDraft || state.blocked));

  let storage;
  try { storage = window.sessionStorage; } catch { storage = null; }
  const drafts = new DraftStore(storage,userId);
  let noteAiMetadata = null;
  const readWorkspaceState = () => {
    if (!location.hash.startsWith('#study?')) return null;
    const params = new URLSearchParams(location.hash.slice('#study?'.length));
    return {course: params.get('course'), note: params.get('note'), tool: params.get('tool') || 'note'};
  };
  const persistWorkspaceState = tool => {
    if (!course?.id) return;
    const savedTool = ['generation-panel', 'practice', 'practice-panel'].includes(tool) ? 'learning-panel' : (tool || 'note');
    const params = new URLSearchParams({course: course.id, tool: savedTool});
    if (editor.active && editor.id) params.set('note', editor.id);
    history.replaceState({studyspace: true}, '', `${location.pathname}${location.search}#study?${params}`);
  };
  const editorRequest = async (path, options = {}) => {
    if (['POST','PUT'].includes(options.method) && /\/api\/(?:courses\/[^/]+\/notes|notes\/[^/]+)$/.test(path)) {
      const input = JSON.parse(options.body || '{}');
      const now = new Date();
      const today = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
      const metadata = {
        course_id: course?.id || noteAiMetadata?.course_id || '',
        course_name: course?.name || noteAiMetadata?.course_name || '',
        created: noteAiMetadata?.created || today,
        id: noteAiMetadata?.id || `lecture-${crypto.randomUUID()}`,
        semester: course?.semester || noteAiMetadata?.semester || '',
        status: noteAiMetadata?.status || 'draft',
        updated: today
      };
      noteAiMetadata = metadata;
      const bodyWithMetadata = withAiFrontmatter(input.body,metadata);
      const saved = await request(path,{...options,body:JSON.stringify({...input,body:bodyWithMetadata})});
      const stored = splitAiFrontmatter(saved.body ?? bodyWithMetadata);
      noteAiMetadata = stored.metadata || metadata;
      return {...saved,body:stored.body};
    }
    return request(path,options);
  };
  const editor = new NoteEditor({request:editorRequest,drafts,changed: state => {
    tell(state.status);
    byId('save-note').disabled = saveIsBlocked(state);
    byId('note-title').readOnly = !!state.pendingDraft;
    byId('note-body').readOnly = !!state.pendingDraft;
    byId('draft-banner').classList.toggle('hidden',!state.pendingDraft);
    byId('reload-note').classList.toggle('hidden',!state.blocked);
  },saved: result => {
    updateNoteMeta(result);
    updateGenerationNoteContext({...result,title:byId('note-title').value});
    loadNotes().catch(() => tell('본문은 저장했지만 목록 갱신에 실패했습니다.'));
    attachmentsFeature?.loadAttachments(editor.id).catch(() => {});
    recordingFeature?.loadRecordings(course?.id).catch(() => {});
    quizFeature?.loadQuizSets(course?.id).catch(() => {});
    flashcardsFeature?.loadFlashcardDecks(course?.id).catch(() => {});
    document.dispatchEvent(new CustomEvent('studyspace:learning-refresh'));
  }});
  recordingFeature = mountRecording({request, byId, getCourse: () => course, getEditor: () => editor, setLocked, emptyState});
  const getAttachmentIds = () => attachmentsFeature?.selectedAttachmentIds() || [];
  const updateSourceSummary = () => attachmentsFeature?.updateSourceSummary();
  quizFeature = mountQuiz({request, byId, getCourse: () => course, getEditor: () => editor, setLocked, emptyState, getAttachmentIds, loadDashboard, updateSourceSummary, matchesAiMode});
  flashcardsFeature = mountFlashcards({request, byId, getCourse: () => course, getEditor: () => editor, setLocked, emptyState, getAttachmentIds, matchesAiMode});
  const guard = () => {
    if (editor.saving || navigating) { tell('저장이 끝날 때까지 잠시 기다려주세요.'); return false; }
    if (editor.dirty) {
      if (!window.confirm('서버에 저장되지 않은 변경 내용과 임시 초안을 버릴까요?')) return false;
      editor.discardDraft();
    }
    return true;
  };
  function button(text, action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'list-item'; b.textContent = text;
    b.onclick = () => Promise.resolve(action()).catch(e => tell(e.message));
    return b;
  }
  function emptyState(message, hint, actionLabel, action) {
    const box = document.createElement('div');
    box.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = message;
    box.append(p);
    if (hint) { const s = document.createElement('span'); s.className = 'fine-print'; s.textContent = hint; box.append(s); }
    if (actionLabel && action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary empty-state-action';
      button.textContent = actionLabel;
      button.onclick = action;
      box.append(button);
    }
    return box;
  }
  dashboardFeature = mountDashboard({request, byId, getCourse: () => course, selectCourse, button, emptyState, tell});
  // 노트 상세보기는 Markdown 원문에 집중하고, 편집 모드와 동일한 문서 흐름을 유지한다.
  const writingPanel = document.querySelector('.writing-panel');
  const readView = document.createElement('article');
  readView.className = 'markdown-preview note-read-view';
  readView.id = 'note-read-view';
  readView.setAttribute('aria-label', '강의노트 본문');
  readView.hidden = true;
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'secondary';
  editButton.textContent = '노트 편집';
  editButton.setAttribute('aria-controls', readView.id);
  editButton.hidden = true;
  editButton.onclick = () => setNoteMode('edit');
  const noteActions = document.createElement('div');
  noteActions.className = 'note-view-actions';
  noteActions.append(editButton, byId('save-note'), byId('trash-note'));
  byId('note-title').closest('label')?.after(noteActions);
  writingPanel.append(readView);
  let noteMode = 'edit';
  function setNoteMode(mode) {
    noteMode = mode;
    const bodyLabel = byId('note-body').closest('label');
    readView.hidden = mode !== 'view';
    editButton.hidden = mode !== 'view' || !editor.id;
    byId('note-title').readOnly = mode === 'view';
    writingPanel.classList.toggle('view-mode', mode === 'view');
    if (bodyLabel) bodyLabel.hidden = mode === 'view';
    if (mode === 'view') {
      // 본문 첫 제목이 노트 제목과 같을 때만 열람 화면에서 중복을 숨긴다.
      const body = splitAiFrontmatter(byId('note-body').value || '').body;
      readView.replaceChildren(renderMarkdown(removeDuplicateLeadingTitle(body, byId('note-title').value)));
      byId('save-note').hidden = true;
    } else {
      byId('save-note').hidden = false;
      byId('save-note').disabled = saveIsBlocked(editor);
    }
    byId('trash-note').classList.toggle('hidden',mode !== 'view' || !editor.id);
  }

  function edit(value) {
    const parsedBody = value ? splitAiFrontmatter(value.body) : null;
    noteAiMetadata = parsedBody?.metadata || null;
    const visibleNote = value ? {...value,body:parsedBody.body} : null;
    editor.open(course.id,visibleNote);
    byId('note-title').value = value?.title || '';
    const initialBody = visibleNote ? visibleNote.body : NEW_NOTE_TEMPLATE;
    byId('note-body').value = initialBody;
    if (!value) editor.body = initialBody;
    updateNoteMeta(value);
    updateGenerationNoteContext(value);
    byId('note-form').classList.remove('hidden');
    byId('trash-note').classList.toggle('hidden',!value);
    preview(false);
    setNoteMode(value ? 'view' : 'edit');
    tell(value ? '' : '새 노트 · 아직 저장하지 않았습니다.');
    attachmentsFeature.loadAttachments(value?.id).catch(() => {});
    recordingFeature.loadRecordings(course?.id).catch(() => {});
    generationFeature.resetForNote();
    learningFeature?.resetForNote();
    quizFeature.loadQuizSets(course?.id).catch(() => {});
    flashcardsFeature.loadFlashcardDecks(course?.id).catch(() => {});
    document.dispatchEvent(new Event('studyspace:note-opened'));
    document.querySelectorAll('#notes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === value?.id)));
    if (value) request(`/api/notes/${value.id}/activity`, {method:'POST'}).catch(() => tell('노트는 열었지만 학습 기록을 반영하지 못했습니다.'));
  }

  function renderGenerations(rows) {
    const currentSourceIds=[...getAttachmentIds()].sort();
    const matchesSources=row=>{
      if(Array.isArray(row.sourceAttachmentIds)) {
        const saved=[...row.sourceAttachmentIds].sort();
        return saved.length===currentSourceIds.length&&saved.every((id,index)=>id===currentSourceIds[index]);
      }
      return Number(row.attachmentCount||0)===currentSourceIds.length;
    };
    const summaryStage=byId('summary-stage');
    const summaryResult=rows.find(row=>row.kind==='SUMMARY'&&row.sourceNoteVersion===editor.version&&matchesSources(row)&&matchesAiMode(row));
    summaryStage.replaceChildren();
    if (!editor.id) byId('summary-message').textContent='노트를 저장하면 요약을 준비할 수 있습니다.';
    else if (summaryResult?.status==='PENDING'||summaryResult?.status==='RUNNING') summaryStage.append(emptyState('노트 내용을 요약하고 있습니다.','완료되면 핵심 내용을 글로 보여드립니다.'));
    else if (summaryResult?.status==='FAILED') summaryStage.append(emptyState('요약을 만들지 못했습니다.','다시 생성을 눌러 새 요약을 요청해 주세요.'));
    else if (summaryResult?.status==='COMPLETED'&&summaryResult.content) {
      summaryStage.append(renderMarkdown(stripSummarySourceLabels(summaryResult.content)));
    }
    const stage=byId('infographic-stage');
    const badge=byId('learning-mode-badge');
    const result=rows.find(row=>row.kind==='INFOGRAPHIC'&&row.sourceNoteVersion===editor.version&&matchesSources(row)&&matchesAiMode(row));
    stage.replaceChildren();
    if (!result) {
      badge.textContent=aiConfig.mockEnabled?'모의 모드':'Gemini 연결됨';
      return;
    }
    badge.textContent=result.mockResult?'모의 결과 저장됨':'AI 생성 결과 저장됨';
    if (result.status==='PENDING'||result.status==='RUNNING') {
      const loading=emptyState('현재 노트의 인포그래픽을 만들고 있습니다.','결과를 저장한 뒤 이 화면에 표시합니다.');
      loading.classList.add('infographic-loading');
      stage.append(loading);
      return;
    }
    if (result.status==='FAILED'||result.status==='CANCELED') {
      const failed=emptyState('인포그래픽을 만들지 못했습니다.','다시 생성 버튼을 눌러 새 결과를 만들어 보세요.');
      stage.append(failed);
      return;
    }
    if (result.status==='COMPLETED'&&result.content) {
      const title=byId('note-title').value.trim()||'현재 노트';
      renderInfographicPages(document,stage,{title,content:result.content,renderMarkdown});
    }
  }

  generationFeature = mountGeneration({request, byId, getEditor: () => editor, getAttachmentIds,
    getAttachmentSourceLength: () => attachmentsFeature?.selectedAttachmentLength() || 0,
    render: renderGenerations, matchesAiMode});
  attachmentsFeature = mountAttachments({request, byId, getEditor: () => editor, getGenerationFeature: () => generationFeature, emptyState, mockEnabled: aiConfig.mockEnabled});
  learningFeature = mountLearningWorkspace({document, byId, getEditor: () => editor, generation: generationFeature, quiz: quizFeature, flashcards: flashcardsFeature, beforeOpen: noteId => attachmentsFeature.loadAttachments(noteId)});
  document.addEventListener('studyspace:tool-selected', event => {
    if (navigating || !editor.active || !course?.id) return;
    persistWorkspaceState(event.detail?.id);
  });

  byId('restore-draft').onclick = () => {
    if (!editor.pendingDraft || !editor.restore) return;
    editor.restore();
    byId('note-title').value = editor.title;
    byId('note-body').value = editor.body;
    setNoteMode('edit');
    byId('note-body').focus();
    byId('note-body').setSelectionRange(byId('note-body').value.length,byId('note-body').value.length);
  };
  byId('discard-draft').onclick = () => {
    if (!window.confirm('이 탭의 임시 초안을 삭제할까요? 서버에 저장된 내용은 유지됩니다.')) return;
    const base = editor.base;
    if (!editor.discardDraft()) { tell('저장 중에는 초안을 버릴 수 없습니다.'); return; }
    edit(base);
  };
  byId('reload-note').onclick = async () => {
    if (!guard()) return;
    try {
      const rows = await request(`/api/courses/${course.id}/notes`);
      const current = rows.find(n => n.id === editor.id);
      if (!current && editor.id) { tell('서버에서 노트를 찾지 못했습니다.'); return; }
      edit(current || null);
    } catch(e) { tell(e.message); }
  };
  function preview(show) {
    // The editor is intentionally single-mode: write and save in one place.
    // Keep this no-op for draft restoration compatibility with older sessions.
  }
  function showDashboard(show) {
    if (show) generationFeature.pausePolling();
    byId('dashboard').classList.toggle('hidden', !show);
    byId('note-list-card').classList.toggle('hidden', show);
    byId('note-editor-card').classList.toggle('hidden', show);
    byId('dashboard-button').setAttribute('aria-pressed', String(show));
    if (show) history.replaceState({studyspace: true}, '', `${location.pathname}${location.search}`);
    document.dispatchEvent(new CustomEvent('studyspace:view',{detail:{dashboard:show}}));
  }
  async function selectCourse(row, noteId, {restoreRecording = false} = {}) {
    if (!row || !guard()) return false;
    const courseChanged = course?.id !== row.id;
    const activeTool = byId('note-editor-card').dataset.activeTool || 'note';
    const dashboardVisible = !byId('dashboard').classList.contains('hidden');
    const nextTool = courseChangeTool(activeTool,{noteId,dashboardVisible,restoreRecording});
    let deferredRecordingRoute = false;
    navigating = true;
    try {
    if (courseChanged) document.dispatchEvent(new CustomEvent('studyspace:course-changing',{detail:{courseId:row.id}}));
    editor.close(); course = row;
    if (!noteId) {
      document.dispatchEvent(new CustomEvent('studyspace:note-closed'));
      byId('note-title').value = '';
      updateNoteMeta(null);
      updateGenerationNoteContext(null);
    }
    byId('course-heading').textContent = row.name;
    byId('course-settings-name').value=row.name;
    byId('course-settings-archived').checked=!!row.archived;
    byId('new-note').disabled = false; byId('new-note').removeAttribute('title');
    byId('note-import-file').value=''; byId('note-import-preview').classList.add('hidden'); byId('note-import-message').textContent=''; importPreview=null; importRequestId=null;
    byId('note-form').classList.add('hidden');
    showDashboard(false);
    const session=recordingFeature.activeSession();
    if (nextTool==='recording-panel' && session && session.courseId!==row.id) deferredRecordingRoute=true;
    else document.dispatchEvent(new CustomEvent('studyspace:select-tool',{detail:{id:nextTool}}));
    renderCourses();
    const rows = await loadNotes();
    await loadTrash();
    const selected = rows.find(n => n.id === noteId);
    // The workspace context already explains the empty state. Keep the save
    // status line reserved for actionable feedback so the same instruction is
    // not repeated in two places.
    if (selected) edit(selected); else { tell(''); await recordingFeature.loadRecordings(row.id); document.dispatchEvent(new Event('studyspace:course-opened')); }
    persistWorkspaceState(nextTool);
    return true;
    } finally {
      navigating = false;
      if (deferredRecordingRoute) queueMicrotask(() => document.dispatchEvent(new CustomEvent('studyspace:select-tool',{detail:{id:'recording-panel'}})));
    }
  }
  async function loadNotes() {
    const version = ++notesVersion;
    const rows = await request(`/api/courses/${course.id}/notes`);
    if (version !== notesVersion) return [];
    byId('notes').replaceChildren(...rows.map(row => {
      const b = button('', () => { if (guard()) edit(row); });
      b.dataset.id = row.id; b.setAttribute('aria-pressed', String(editor.active && row.id === editor.id));
      const title = document.createElement('strong');
      title.textContent = row.title;
      b.append(title);
      if (row.updatedAt) {
        const meta = document.createElement('small');
        meta.className = 'note-row-date';
        try { meta.textContent = `최근 수정 · ${new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.updatedAt))}`; }
        catch { meta.textContent = ''; }
        if (meta.textContent) b.append(meta);
      }
      return b;
    }));
    const noteCount=byId('note-count'); if(noteCount) noteCount.textContent=rows.length ? `${rows.length}` : '';
    if (!rows.length) {
      byId('notes').replaceChildren(emptyState('아직 강의노트가 없습니다.', '수업 직후 핵심 내용을 짧게 남겨 보세요.', '첫 노트 작성하기', () => byId('new-note').click()));
    }
    return rows;
  }
  async function loadTrash() {
    if(!course) return;
    const rows=await request(`/api/courses/${encodeURIComponent(course.id)}/trash`);
    byId('trash-count').textContent=rows.length ? `(${rows.length})` : '';
    byId('trash-notes').replaceChildren(...rows.map(row => {
      const item=document.createElement('div'); item.className='trash-row';
      const title=document.createElement('span'); title.textContent=row.title;
      const restore=document.createElement('button'); restore.type='button'; restore.className='quiet-button'; restore.textContent='복원';
      restore.onclick=async()=>{ restore.disabled=true; try { await request(`/api/notes/${encodeURIComponent(row.id)}/restore`,{method:'POST'}); await Promise.all([loadNotes(),loadTrash()]); tell('노트를 복원했습니다.'); } catch(error) { tell(error.message); restore.disabled=false; } };
      const remove=document.createElement('button');remove.type='button';remove.className='quiet-button danger-text';remove.textContent='영구 삭제';remove.onclick=async()=>{remove.disabled=true;try{const impact=await request(`/api/notes/${encodeURIComponent(row.id)}/delete-impact`);const summary=`첨부 ${impact.attachments}개, AI 자료 ${impact.artifacts}개, 퀴즈 ${impact.quizSets}개, 플래시카드 ${impact.flashcardDecks}개가 함께 삭제됩니다.\n녹음 ${impact.recordings}개는 파일을 보존하고 이 노트와의 연결만 해제합니다.\n\n복구할 수 없습니다. 노트를 영구 삭제할까요?`;if(!window.confirm(summary)){remove.disabled=false;return;}await request(`/api/notes/${encodeURIComponent(row.id)}/permanent`,{method:'DELETE',body:JSON.stringify({confirmation:'영구삭제'})});await Promise.all([loadTrash(),loadDashboard()]);tell('노트를 영구 삭제했습니다. 연결된 녹음은 과목 녹음 목록에 보존됩니다.');}catch(error){tell(error.message);remove.disabled=false;}};
      item.append(title,restore,remove); return item;
    }));
    if(!rows.length) byId('trash-notes').textContent='휴지통이 비어 있습니다.';
  }
  async function previewMarkdownImport(file) {
    const form = new FormData(); form.append('file', file);
    return request(`/api/courses/${encodeURIComponent(course.id)}/notes/import/preview`, {method:'POST', formData:form});
  }
  byId('preview-note-import').onclick=async()=>{
    const file=byId('note-import-file').files[0]; if(!course || !file){byId('note-import-message').textContent='가져올 Markdown 파일을 선택해 주세요.';return;}
    const button=byId('preview-note-import');button.disabled=true;byId('note-import-message').textContent='파일 내용을 확인하고 있습니다.';
    try { importPreview=await previewMarkdownImport(file);importRequestId=crypto.randomUUID();byId('note-import-title').textContent=importPreview.title;byId('note-import-summary').textContent=importPreview.duplicate?'같은 제목과 본문의 노트가 이미 있어 중복으로 가져오지 않습니다.':`${importPreview.body.length.toLocaleString()}자 · 저장 전 미리보기`;byId('confirm-note-import').disabled=importPreview.duplicate;byId('note-import-preview').classList.remove('hidden');byId('note-import-message').textContent=''; }
    catch(error){importPreview=null;byId('note-import-preview').classList.add('hidden');byId('note-import-message').textContent=error.message;}
    finally{button.disabled=false;}
  };
  byId('confirm-note-import').onclick=async()=>{
    if(!course || !importPreview || importPreview.duplicate)return;const button=byId('confirm-note-import');button.disabled=true;
    try { const note=await request(`/api/courses/${encodeURIComponent(course.id)}/notes`,{method:'POST',body:JSON.stringify({title:importPreview.title,body:importPreview.body,version:0,requestId:importRequestId})});await loadNotes();edit(note);byId('note-import-file').value='';byId('note-import-preview').classList.add('hidden');importPreview=null;byId('note-import-message').textContent='Markdown 노트를 가져왔습니다.'; }
    catch(error){byId('note-import-message').textContent=error.message;button.disabled=false;}
  };
  byId('dashboard-date').textContent = new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Seoul'}).format(new Date());
  byId('dashboard-retry').onclick = () => loadDashboard();
  byId('dashboard-button').onclick = () => { if (guard()) { editor.close(); showDashboard(true); renderCourses(); loadDashboard(); } };
  byId('dashboard-semester').onchange = () => { renderCourses(); loadDashboard(); };
  byId('show-archived').onchange=renderCourses;
  byId('course-form').onsubmit = async event => {
    event.preventDefault();
    const submit = event.submitter; submit.disabled = true;
    try {
      if (!byId('course-semester').value) throw new Error('마이페이지에서 학기를 먼저 추가해 주세요.');
      await request('/api/courses', {method:'POST', body:JSON.stringify({semester:byId('course-semester').value,name:byId('course-name').value})});
      byId('course-name').value = ''; await loadCourses(); await loadDashboard(); tell('과목을 추가했습니다.');
    } catch(e) { tell(e.message); } finally { submit.disabled = false; }
  };
  document.addEventListener('studyspace:tool-request', async event => {
    const {id, message, view} = event.detail;
    try {
      const courseRows = getCourses();
      const selected = course
        || courseRows.find(item => !item.archived && item.semester === byId('dashboard-semester').value)
        || courseRows.find(item => !item.archived);
      // 대시보드에서 도구를 선택하면 이전 과목이 메모리에 남아 있을 수 있습니다.
      // 이때도 작업 영역을 먼저 열어야 선택한 도구가 실제 화면에 나타납니다.
      if (selected && (byId('dashboard').classList.contains('hidden') === false || course?.id !== selected.id)) {
        await selectCourse(selected);
      }
      if (!course) { tell(message); return; }
      // `close()` deliberately keeps the previous id for draft bookkeeping.
      // A dashboard is still not an open editor, so test its active state too.
      if (!editor.active || !editor.id) {
        const notes = await loadNotes();
        if (notes.length) edit(notes[0]);
        else if (id === 'note') edit(null);
        else { tell('먼저 이 과목에 강의노트를 작성해 주세요.'); return; }
      }
      document.dispatchEvent(new CustomEvent('studyspace:select-tool', {detail: {id, view}}));
    } catch (error) { tell(error.message); }
  });
  document.addEventListener('studyspace:before-tool-select', event => {
    const activeRecording = recordingFeature.activeSession();
    if (event.detail?.id !== 'recording-panel' || !activeRecording || (editor.active && course?.id===activeRecording.courseId)) return;
    event.preventDefault();
    const session=activeRecording;
    if(session.reopening)return;
    session.reopening=true;
    (async()=>{
      try {
        const owner=getCourses().find(item=>item.id===session.courseId) || (course?.id===session.courseId?course:null);
        if(!owner){tell('녹음을 시작한 과목을 찾지 못했습니다. 녹음은 계속 진행 중입니다.');return;}
        const opened=await selectCourse(owner,session.noteId);
        if(opened && editor.active && editor.id===session.noteId) {
          document.dispatchEvent(new CustomEvent('studyspace:select-tool',{detail:{id:'recording-panel'}}));
        } else tell('녹음을 시작한 노트를 다시 열지 못했습니다. 녹음은 계속 진행 중입니다.');
      } catch(error) { tell(`녹음 노트를 여는 중 오류가 발생했습니다. ${error.message}`); }
      finally { if(recordingFeature.activeSession()===session)session.reopening=false; }
    })();
  });
  byId('new-note').onclick = () => { if (guard()) edit(null); };
  byId('trash-note').onclick=async()=>{
    if(!editor.id || !guard() || !window.confirm('이 노트를 휴지통으로 이동할까요? 첨부자료와 생성 결과는 함께 보존됩니다.')) return;
    const noteId=editor.id; byId('trash-note').disabled=true;
    try { await request(`/api/notes/${encodeURIComponent(noteId)}`,{method:'DELETE'}); editor.close(); byId('note-form').classList.add('hidden'); await Promise.all([loadNotes(),loadTrash(),loadDashboard()]); tell('노트를 휴지통으로 이동했습니다.'); }
    catch(error) { tell(error.message); }
    finally { byId('trash-note').disabled=false; }
  };
  byId('course-settings-form').onsubmit=async event => {
    event.preventDefault();
    if(!course || !guard()) return;
    const submit=event.submitter; submit.disabled=true;
    try {
      const updated=await request(`/api/courses/${encodeURIComponent(course.id)}`,{method:'PUT',body:JSON.stringify({name:byId('course-settings-name').value,archived:byId('course-settings-archived').checked})});
      course=updated; await loadCourses();
      if(updated.archived && !byId('show-archived').checked) { editor.close(); showDashboard(true); await loadDashboard(); tell('과목을 보관했습니다. 노트는 그대로 유지됩니다.'); }
      else { byId('course-heading').textContent=updated.name; renderCourses(); tell('과목 설정을 저장했습니다.'); }
    } catch(error) { tell(error.message); } finally { submit.disabled=false; }
  };
  const noteChanged=()=>editor.change(byId('note-title').value,byId('note-body').value);
  byId('note-title').addEventListener('input',noteChanged);
  byId('note-body').addEventListener('input',noteChanged);
  const saveOrCancelNote = async () => {
    if (!editor.dirty && editor.id) {
      setNoteMode('view');
      return true;
    }
    const saved=await editor.save();
    if (saved && editor.id && !editor.dirty) {
      byId('note-title').value = editor.title;
      byId('note-body').value = editor.body;
      setNoteMode('view');
    }
    return saved;
  };
  byId('note-form').onsubmit = async event => {
    event.preventDefault();
    await saveOrCancelNote();
  };  document.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      if (editor.active && !editor.saving) saveOrCancelNote();
    } else if (key === 'i') {
      event.preventDefault();
      setNoteMode('edit');
      const body = byId('note-body');
      body.focus();
      const end = body.value.length;
      body.setSelectionRange(end, end);
    }
  }, true);
  window.addEventListener('beforeunload', event => { if(recordingFeature.isRecording() || (editor.active && (editor.dirty || editor.saving))) { event.preventDefault(); event.returnValue = ''; } });
  byId('study').classList.remove('hidden');
  try {
    await loadCourses(); await loadDashboard();
    const saved = readWorkspaceState();
    const target = saved?.course && getCourses().find(item => item.id === saved.course);
    if (target) {
      await selectCourse(target, saved.note || undefined, {restoreRecording:saved.tool==='recording-panel'});
      if (saved.tool && saved.tool !== 'note' && (editor.id || saved.tool==='recording-panel')) document.dispatchEvent(new CustomEvent('studyspace:select-tool', {detail:{id:saved.tool}}));
    }
  } catch(e) { byId('dashboard-message').textContent = e.message; }
  return {canLeave:guard,clearDrafts:() => { editor.close(); editor.dirty = false; drafts.clear(true); }};
}
