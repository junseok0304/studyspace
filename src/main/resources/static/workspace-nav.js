export function courseChangeTool(activeTool, {noteId, dashboardVisible = false, restoreRecording = false} = {}) {
  if (noteId) return 'note';
  if (restoreRecording) return 'recording-panel';
  if (activeTool !== 'recording-panel') return 'note';
  return dashboardVisible ? 'note' : 'recording-panel';
}

export function mountWorkspaceNavigation(doc = document) {
  const CustomEventType = doc.defaultView?.CustomEvent || CustomEvent;
  const icon = (name) => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('nav-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = value => {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('d', value);
      svg.append(node);
    };
    if (name === 'home') {
      path('M4 13.2 12 5l8 8.2'); path('M6.5 11.5V19h11v-7.5M9.5 19v-4.5h5V19');
    } else if (name === 'book') {
      path('M4.5 5.5A2.5 2.5 0 0 1 7 3h11.5v16H7a2.5 2.5 0 0 0-2.5 2.5z'); path('M4.5 5.5v16M8.5 7h6.5M8.5 10h6.5');
    } else if (name === 'bulb') {
      path('M9 18h6M10 21h4M8.3 14.5A6 6 0 1 1 15.7 14c-.9.7-1.4 1.5-1.6 2.5H9.9c-.2-.8-.7-1.5-1.6-2z');
    } else if (name === 'user') {
      path('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'); path('M4.5 20c1.2-3.2 4-5 7.5-5s6.3 1.8 7.5 5');
    } else if (name === 'exit') {
      path('M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 12h11M15 8l4 4-4 4');
    }
    return svg;
  };
  const menuButton = (label, iconName) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'course-menu-button';
    const labelNode = doc.createElement('span');
    labelNode.textContent = label;
    button.append(icon(iconName), labelNode);
    return button;
  };
  const form = doc.getElementById('note-form');
  const card = doc.getElementById('note-editor-card');
  const list = doc.getElementById('note-list-card');
  const study = doc.getElementById('study');
  study.classList.add('notesup-workspace');
  const courseRail = study.querySelector('aside');
  courseRail.classList.add('course-rail', 'left-rail');
  const shell = doc.querySelector('.workspace-shell');
  const hero = shell?.querySelector('.hero');
  const account = doc.getElementById('account-card');
  let logo = hero?.querySelector('.brand-logo');
  let brandName = hero?.querySelector('.workspace-brand');
  if (!logo) {
    logo = doc.createElement('img');
    logo.className = 'brand-logo';
    logo.src = '/assets/studyspace-logo.png';
    logo.alt = 'StudySpace';
  }
  if (!brandName) {
    brandName = doc.createElement('span');
    brandName.className = 'workspace-brand';
    brandName.textContent = 'StudySpace';
  }
  const railBrand = doc.createElement('div');
  railBrand.className = 'rail-brand';
  if (logo) railBrand.append(logo);
  if (brandName) railBrand.append(brandName);
  const recordingStatus = doc.createElement('div');
  recordingStatus.id = 'rail-recording-status';
  recordingStatus.className = 'rail-recording-status';
  recordingStatus.hidden = true;
  const recordingDot = doc.createElement('span');
  recordingDot.className = 'rail-recording-dot';
  recordingDot.setAttribute('aria-hidden', 'true');
  const recordingClock = doc.createElement('span');
  recordingClock.id = 'rail-recording-clock';
  recordingClock.textContent = '00:00 / 60:00';
  recordingStatus.append(recordingDot, recordingClock);
  railBrand.append(recordingStatus);
  courseRail.prepend(railBrand);
  if (account) {
    account.classList.remove('card', 'hidden');
    account.classList.add('rail-account');
    courseRail.append(account);
  }
  shell?.classList.add('rail-only-shell');
  const courseTitle = courseRail.querySelector('h2');
  courseTitle.textContent = '내 과목';
  const noteHeading = doc.getElementById('course-heading');

  // NotesUp keeps the working context inside the left rail. Keeping the
  // semester selector here also prevents the global header from changing
  // width when a workspace view is selected.
  const semesterFilter = doc.createElement('label');
  semesterFilter.className = 'semester-filter rail-semester-filter';
  const semesterLabel = doc.createElement('span');
  semesterLabel.textContent = '학기';
  const semesterSelect = doc.createElement('select');
  semesterSelect.id = 'dashboard-semester';
  semesterSelect.setAttribute('aria-label', '과목 학기');
  const allSemester = doc.createElement('option');
  allSemester.value = '';
  allSemester.textContent = '전체 학기';
  semesterSelect.append(allSemester);
  semesterFilter.append(semesterLabel, semesterSelect);

  // Keep the course rail stable. Only the note list can collapse, so course
  // names never disappear or squeeze into a narrow column while writing.
  const legacyNav = courseRail.querySelector('.study-nav');
  const home = doc.getElementById('dashboard-button');
  const schoolLink = legacyNav?.querySelector('a[href="/mypage.html"]');
  legacyNav?.remove();

  const courseMenu = doc.createElement('nav');
  courseMenu.className = 'course-menu';
  courseMenu.setAttribute('aria-label', '학습 메뉴');
  home.className = 'course-menu-button';
  home.classList.add('dashboard-menu-button');
  const homeLabel = doc.createElement('span');
  homeLabel.textContent = '학습 현황';
  home.replaceChildren(icon('home'), homeLabel);
  home.type = 'button';
  courseMenu.append(home);
  const tips = menuButton('작성 팁', 'bulb');
  tips.id = 'tips-tab';
  tips.classList.add('tips-tab');
  const openTool = (id, message, view) => {
    // The rail is available both on the dashboard and in an open note.  Route
    // every request through the controller so it can first open a course and
    // a note when the editor is not mounted yet.
    doc.dispatchEvent(new CustomEventType('studyspace:tool-request', {detail: {id, message, view}}));
  };
  const lecture = menuButton('수업노트', 'book');
  lecture.onclick = () => openTool('note','과목을 고르고 강의노트를 열면 작성할 수 있어요.');
  courseMenu.append(lecture, tips);
  if (schoolLink) courseMenu.append(schoolLink);
  courseRail.insertBefore(semesterFilter, courseTitle);
  courseRail.insertBefore(courseMenu, courseTitle);

  const courseLabel = doc.createElement('div');
  courseLabel.className = 'rail-section-label';
  const courseLabelText = doc.createElement('span');
  courseLabelText.textContent = '과목';
  const courseCount = doc.createElement('span');
  courseCount.id = 'course-count';
  const courseLabelMain = doc.createElement('span');
  courseLabelMain.className = 'rail-course-label-main';
  courseLabelMain.append(courseLabelText);
  const courseManagement = courseRail.querySelector('.course-management');
  if (courseManagement) {
    const managementSummary = courseManagement.querySelector(':scope > summary');
    if (managementSummary) {
      managementSummary.textContent = '관리';
      managementSummary.setAttribute('aria-label', '과목 관리 열기');
      const popoverHead = doc.createElement('div');
      popoverHead.className = 'course-management-popover-head';
      const popoverTitle = doc.createElement('strong');
      popoverTitle.textContent = '과목 관리';
      const closeManagement = doc.createElement('button');
      closeManagement.type = 'button';
      closeManagement.className = 'course-management-close';
      closeManagement.textContent = '닫기';
      closeManagement.setAttribute('aria-label', '과목 관리 닫기');
      closeManagement.onclick = () => {
        courseManagement.open = false;
        managementSummary.focus();
      };
      popoverHead.append(popoverTitle, closeManagement);
      managementSummary.after(popoverHead);
    }
    courseLabelMain.append(courseManagement);
  }
  courseLabel.append(courseLabelMain, courseCount);
  courseRail.insertBefore(courseLabel, courseTitle.nextSibling);

  const noteContent = doc.createElement('div');
  noteContent.className = 'note-rail-content';
  while (list.firstChild) noteContent.append(list.firstChild);
  const noteToggle = doc.createElement('button');
  noteToggle.type = 'button';
  noteToggle.className = 'rail-toggle';
  noteToggle.setAttribute('aria-controls', 'notes');
  let noteRailCollapsed = false;
  try {
    noteRailCollapsed = doc.defaultView?.sessionStorage?.getItem('studyspace.noteRailCollapsed') === 'true';
  } catch {}
  study.classList.toggle('note-rail-collapsed', noteRailCollapsed);
  noteToggle.setAttribute('aria-expanded', String(!noteRailCollapsed));
  noteToggle.setAttribute('aria-label', noteRailCollapsed ? '강의노트 목록 펼치기' : '강의노트 목록 접기');
  noteToggle.textContent = noteRailCollapsed ? '›' : '목록 접기';
  list.append(noteContent);

  const listHead = doc.createElement('div');
  listHead.className = 'note-list-heading';
  const noteTitle = doc.createElement('div');
  noteTitle.className = 'note-list-title';
  const noteCount = doc.createElement('span');
  noteCount.id = 'note-count';
  noteTitle.append(noteHeading, noteCount);
  const management = doc.createElement('details');
  management.className = 'note-management';
  const managementTitle = doc.createElement('summary');
  managementTitle.textContent = '관리';
  management.append(managementTitle);
  const managementMenu = doc.createElement('div');
  managementMenu.className = 'note-management-menu';
  managementMenu.append(list.querySelector('.course-settings'), list.querySelector('.note-import'), list.querySelector('.trash-panel'));
  management.append(managementMenu);
  listHead.append(noteTitle, management, noteToggle, doc.getElementById('new-note'));
  list.prepend(listHead);
  doc.getElementById('new-note').textContent = '＋ 새 노트';

  const tabs = doc.createElement('nav');
  tabs.className = 'workspace-tabs';
  tabs.setAttribute('aria-label', '현재 노트 학습 도구');
  const tools = [
    ['note', '노트'],
    ['attachment-panel', '강의자료'],
    ['recording-panel', '녹음'],
    ['learning-panel', 'AI 학습']
  ];
  const panels = ['recording-panel', 'learning-panel'].map(id => doc.getElementById(id));
  const attachment = doc.getElementById('attachment-panel');

  // The tool navigation belongs to the open note, not the global header.
  // This keeps the header focused on account and semester context.
  card.prepend(tabs);

  // Keep the editor mounted so switching tools never discards a draft or
  // interrupts the recording controls.
  const editor = doc.createElement('div');
  editor.className = 'writing-panel';
  const panelsToKeep = new Set(['attachment-panel', 'recording-panel', 'learning-panel']);
  [...form.children].filter(child => !panelsToKeep.has(child.id)).forEach(child => editor.append(child));
  form.querySelector('.note-tool-nav')?.remove();
  form.prepend(editor);

  const context = doc.createElement('p');
  context.className = 'workspace-context';
  card.prepend(context);
  let noteOpen = false;
  const setPageTitle = title => {
    setBaseTitle(title, doc);
  };
  const updatePageTitle = (tool = card.dataset.activeTool || 'note') => {
    if (!doc.getElementById('auth-card')?.classList.contains('hidden')) {
      setPageTitle('StudySpace | 로그인');
      return;
    }
    if (!doc.getElementById('dashboard').classList.contains('hidden')) {
      setPageTitle('StudySpace | 학습 현황');
      return;
    }
    const noteTitle = doc.getElementById('note-title').value.trim();
    const labels = {note:'강의노트','attachment-panel':'강의자료','recording-panel':'녹음','learning-panel':'AI 학습',practice:'AI 학습','generation-panel':'AI 학습'};
    setPageTitle(`StudySpace | ${noteTitle ? `${noteTitle} · ` : ''}${labels[tool] || '학습공간'}`);
  };
  const updateContext = () => {
    context.textContent = '목록에서 열람할 노트를 선택해주세요';
    context.hidden = noteOpen || card.dataset.activeTool === 'recording-panel';
  };

  const buttons = tools.map(([id, label]) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.tool = id;
    button.textContent = label;
    button.onclick = () => select(id);
    tabs.append(button);
    return button;
  });

  const tipsPanel = doc.getElementById('tips-panel');
  tipsPanel?.classList.add('notesup-tips-panel');
  function showTips(show) {
    if (!tipsPanel) return;
    tipsPanel.classList.toggle('hidden', !show);
    // A view change dispatches `studyspace:view` after the study controller
    // has set dashboard/list/editor visibility. Do not unhide those panels
    // while merely closing the tips panel.
    if (show) {
      doc.getElementById('dashboard').classList.add('hidden');
      list.classList.add('hidden');
      card.classList.add('hidden');
    }
    tabs.hidden = show;
    tips.setAttribute('aria-pressed', String(show));
    tips.classList.toggle('active', show);
    home.setAttribute('aria-pressed', String(!show));
    if (show) setPageTitle('StudySpace | 작성 팁');
  }

  tips.onclick = () => showTips(true);
  const setNoteRailCollapsed = collapsed => {
    study.classList.toggle('note-rail-collapsed', collapsed);
    try { doc.defaultView?.sessionStorage?.setItem('studyspace.noteRailCollapsed', String(collapsed)); } catch {}
    noteToggle.setAttribute('aria-expanded', String(!collapsed));
    noteToggle.setAttribute('aria-label', collapsed ? '강의노트 목록 펼치기' : '강의노트 목록 접기');
    noteToggle.textContent = collapsed ? '›' : '목록 접기';
  };
  noteToggle.onclick = () => setNoteRailCollapsed(!study.classList.contains('note-rail-collapsed'));
  doc.addEventListener('studyspace:course-changing', () => {
    noteOpen = false;
    updateContext();
    setNoteRailCollapsed(false);
  });

  function select(requestedId, view, options = {}) {
    const id = ['practice', 'practice-panel', 'generation-panel'].includes(requestedId) ? 'learning-panel' : requestedId;
    const beforeSelect = new CustomEventType('studyspace:before-tool-select', {cancelable: true, detail: {id}});
    doc.dispatchEvent(beforeSelect);
    if (beforeSelect.defaultPrevented) return;
    if (tipsPanel && !tipsPanel.classList.contains('hidden')) {
      showTips(false);
      card.classList.remove('hidden');
      list.classList.remove('hidden');
    }
    const note = id === 'note';
    const learning = id === 'learning-panel';
    editor.hidden = !note;
    if (id === 'recording-panel') form.classList.remove('hidden');
    form.classList.toggle('recording-workspace', id === 'recording-panel');
    attachment.hidden = id !== 'attachment-panel';
    panels.forEach(panel => { panel.hidden = panel.id !== id; });
    // Tool workspaces use the full canvas instead of leaving an empty note rail.
    study.classList.toggle('tool-mode', id === 'recording-panel' || learning);
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(tools[index][0] === id)));
    card.dataset.activeTool = id;
    updatePageTitle(id);
    card.classList.remove('screen-transitioning');
    const scheduleFrame = doc.defaultView?.requestAnimationFrame || (callback => setTimeout(callback, 0));
    scheduleFrame(() => {
      card.classList.add('screen-transitioning');
      (doc.defaultView?.setTimeout || setTimeout)(() => card.classList.remove('screen-transitioning'), 220);
    });
    updateContext();
    doc.dispatchEvent(new CustomEventType('studyspace:tool-selected', {detail: {id, view, dueOnly: Boolean(options.dueOnly)}}));
  }

  doc.getElementById('new-note').addEventListener('click', () => select('note'));
  doc.addEventListener('studyspace:note-opened', () => {
    noteOpen = true;
    updateContext();
    // Keep the current note-scoped workspace open while its note changes.
    const activeTool = card.dataset.activeTool;
    select(activeTool === 'attachment-panel' || activeTool === 'recording-panel' || activeTool === 'learning-panel' ? activeTool : 'note');
  });
  doc.addEventListener('studyspace:note-closed', () => {
    noteOpen = false;
    updateContext();
  });
  doc.addEventListener('studyspace:select-tool', event => select(event.detail.id, event.detail.view, event.detail));
  doc.addEventListener('studyspace:view', event => {
    showTips(false);
    noteOpen = false;
    updateContext();
    tabs.hidden = event.detail.dashboard;
    home.setAttribute('aria-pressed', String(event.detail.dashboard));
    if (event.detail.dashboard) updatePageTitle();
    else setPageTitle('StudySpace | 수업노트');
  });
  tabs.hidden = !doc.getElementById('dashboard').classList.contains('hidden');
  doc.getElementById('note-title').addEventListener('input', () => {
    updateContext();
    updatePageTitle();
  });
  select('note');
}
import { setBaseTitle } from './page-title.js';
