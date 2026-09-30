/** Owns course filtering and dashboard data presentation. */
export function mountDashboard({request, byId, getCourse, selectCourse, button, emptyState, tell}) {
  const el = byId;
  let courses = [];
  let version = 0;

  function renderCourses() {
    const selected = el('dashboard-semester').value;
    const showArchived = el('show-archived').checked;
    const rows = courses.filter(course => (!selected || course.semester === selected) && (showArchived || !course.archived));
    el('courses').replaceChildren(...rows.map(row => {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'course-tab list-item';
      const active = row.id === getCourse()?.id && el('dashboard').classList.contains('hidden');
      item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active));
      const inner = document.createElement('span'); inner.className = 'course-tab-row';
      const dot = document.createElement('span'); dot.className = 'course-dot'; dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong'); name.textContent = row.name;
      inner.append(dot, name); item.append(inner);
      item.onclick = () => selectCourse(row);
      return item;
    }));
    const count = el('course-count');
    if (count) count.textContent = rows.length ? `${rows.length}개 과목` : '';
    if (!rows.length) el('courses').textContent = '시간표를 연동하거나 과목을 추가하세요.';
  }

  async function loadCourses() {
    const courseRows = await request('/api/courses');
    // The semester endpoint may lag during first-run initialization; courses are still usable.
    const semesterRows = await request('/api/semesters').catch(() => []);
    courses = courseRows;
    const previous = el('dashboard-semester').value;
    const semesters = semesterRows.map(row => row.name);
    for (const semester of courses.map(course => course.semester)) if (!semesters.includes(semester)) semesters.push(semester);
    el('dashboard-semester').replaceChildren(new Option('전체 학기', ''), ...semesters.map(semester => new Option(semester, semester)));
    el('dashboard-semester').value = previous && semesters.includes(previous) ? previous : (semesters[0] || '');
    const courseSemester = el('course-semester');
    courseSemester.replaceChildren(...semesters.map(semester => new Option(semester, semester)));
    courseSemester.value = el('dashboard-semester').value || semesters[0] || '';
    courseSemester.disabled = !semesters.length;
    renderCourses();
    return courses;
  }

  async function openPracticeFromDashboard(view, note, dueOnly = false) {
    const semester = el('dashboard-semester').value;
    const target = note && courses.find(item => item.id === note.courseId)
      || courses.find(item => !item.archived && item.semester === semester)
      || courses.find(item => !item.archived);
    if (!target) return;
    await selectCourse(target, note?.id);
    document.dispatchEvent(new CustomEvent('studyspace:select-tool', {detail: {id: 'learning-panel', view, dueOnly}}));
  }

  async function loadDashboard() {
    const requestVersion = ++version;
    const retry = el('dashboard-retry');
    if (retry) retry.hidden = true;
    el('dashboard-message').textContent = '학습 현황을 불러오는 중입니다.';
    try {
      const data = await request(`/api/dashboard?semester=${encodeURIComponent(el('dashboard-semester').value)}`);
      if (requestVersion !== version) return;
      // Keep links usable if a page is connected to a backend during a rolling
      // restart that has not yet exposed the explicit practice targets.
      const latestNote = data.recent?.[0] || null;
      const quizTarget = data.quizTarget || latestNote;
      const reviewTarget = data.reviewTarget || (data.flashcardsDue > 0 ? latestNote : null);
      el('dashboard-message').textContent = data.notes ? '' : '아직 학습 기록이 없습니다. 좌측에서 과목을 추가해 첫 노트를 시작하세요.';
      const studyRate = data.notes ? Math.round((data.viewed / data.notes) * 100) : 0;
      el('dashboard-summary').replaceChildren(...[
        ['노트 열람률', `${studyRate}%`, `확인한 노트 ${data.viewed}/${data.notes}개`],
        ['최근 7일', `${data.activeDays}일`, '노트를 열어 공부한 날'],
        ['수강 과목', `${data.courses}개`, '현재 선택한 학기 기준'],
        ['쌓아온 노트', `${data.notes}개`, '강의마다 남긴 기록']
      ].map(([label, value, detail], index) => {
        const chip = document.createElement('article'); chip.className = `study-stat${index === 0 ? ' study-stat-featured' : ''}`;
        const name = document.createElement('span'); name.className = 'study-stat-label'; name.textContent = label;
        const strong = document.createElement('strong'); strong.className = 'study-stat-value'; strong.textContent = value;
        const hint = document.createElement('span'); hint.className = 'study-stat-hint'; hint.textContent = detail;
        chip.append(name, strong, hint);
        if (index === 0) {
          const track = document.createElement('div'); track.className = 'progress-track'; track.setAttribute('aria-hidden', 'true');
          const fill = document.createElement('span'); fill.style.width = `${studyRate}%`; track.append(fill); chip.append(track);
        }
        return chip;
      }));
      el('metric-flashcards-due').textContent = `${data.flashcardsDue}장`;
      const flashcardBreakdown = el('metric-flashcards-breakdown');
      if (flashcardBreakdown) flashcardBreakdown.textContent = `이번 학기 전체 · 새 카드 ${data.newFlashcards ?? 0}장 · 오늘 복습 ${data.reviewFlashcards ?? 0}장`;
      const flashcardTarget = el('metric-flashcards-target');
      if (flashcardTarget) flashcardTarget.textContent = reviewTarget
        ? `바로 시작할 노트: ${reviewTarget.title} · ${reviewTarget.courseName}`
        : '지금 학습할 카드가 없습니다.';
      const reviewButton = el('dashboard-review-button');
      if (reviewButton) {
        reviewButton.disabled = data.flashcardsDue < 1 || !reviewTarget;
        reviewButton.onclick = () => openPracticeFromDashboard('flashcards', reviewTarget, true).catch(error => tell(error.message));
      }
      const quizButton = el('dashboard-quiz-button');
      if (quizButton) {
        quizButton.disabled = !quizTarget;
        quizButton.onclick = () => openPracticeFromDashboard('quiz', quizTarget).catch(error => tell(error.message));
      }
      const accuracy = document.createElement('strong'); accuracy.className = 'stat-big'; accuracy.textContent = data.quizAccuracy === null ? '기록 없음' : `${data.quizAccuracy}%`;
      const quizLabel = document.createElement('p'); quizLabel.className = 'fine-print'; quizLabel.textContent = '완료한 퀴즈의 누적 정답률';
      const quizDetail = document.createElement('p'); quizDetail.className = 'fine-print'; quizDetail.textContent = data.quizAttempts ? `완료 ${data.quizAttempts}회 · 누적 오답 ${data.wrongAnswers}개` : '최근 노트에서 퀴즈를 시작할 수 있어요.';
      el('quiz-stats').replaceChildren(accuracy, quizLabel, quizDetail);
      const max = Math.max(1, ...data.days.map(day => day.count));
      el('activity-chart').replaceChildren(...data.days.map(day => {
        const item = document.createElement('div'); item.className = 'bar-column';
        const count = document.createElement('span'); count.textContent = `${day.count}개`;
        const track = document.createElement('div'); track.className = 'bar-track'; track.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('i'); fill.className = 'bar-fill'; fill.style.height = `${day.count / max * 100}%`; track.append(fill);
        const label = document.createElement('span'); label.textContent = day.date.slice(5).replace('-', '/');
        item.setAttribute('aria-label', `${day.date} · 열어 본 노트 ${day.count}개 (노트별 하루 1회 집계)`); item.title = `${day.date}: 노트 ${day.count}개 열람`; item.append(count, track, label); return item;
      }));
      el('recent-notes').replaceChildren(...data.recent.map(note => {
        const open = button('', () => selectCourse(courses.find(course => course.id === note.courseId), note.id)); open.className = 'dashboard-link-row';
        const title = document.createElement('strong'); title.textContent = note.title;
        const courseName = document.createElement('span'); courseName.textContent = note.courseName;
        open.append(title, courseName); return open;
      }));
      if (!data.recent.length) el('recent-notes').textContent = '첫 노트를 작성하면 여기에 표시됩니다.';
      const todayTarget = el('today-classes');
      if (!data.todayClasses.length) todayTarget.replaceChildren(emptyState('오늘은 등록된 수업이 없어요.', '마이페이지에서 시간표를 연동해 보세요.'));
      else {
        const table = document.createElement('table'); table.className = 'dashboard-data-table';
        const caption = document.createElement('caption'); caption.className = 'sr-only'; caption.textContent = '오늘 수업 일정';
        const head = document.createElement('thead'); const headRow = document.createElement('tr');
        ['시간', '수업', '강의실'].forEach(label => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headRow.append(th); });
        head.append(headRow); const body = document.createElement('tbody');
        data.todayClasses.forEach(item => {
          const row = document.createElement('tr'); const time = document.createElement('th'); time.scope = 'row'; time.textContent = `${item.start}–${item.end}`;
          const courseCell = document.createElement('td'); const open = button(item.name, () => selectCourse(courses.find(course => course.id === item.courseId))); open.className = 'today-class-link'; courseCell.append(open);
          const room = document.createElement('td'); room.textContent = item.room || '강의실 미확인'; row.append(time, courseCell, room); body.append(row);
        });
        table.append(caption, head, body); todayTarget.replaceChildren(table);
      }
      const progressTarget = el('course-progress');
      if (!data.courseStats.length) progressTarget.replaceChildren(emptyState('과목별 학습 기록이 없어요.', '과목을 추가하면 진행률을 확인할 수 있습니다.'));
      else {
        const table = document.createElement('table'); table.className = 'dashboard-data-table course-progress-table';
        const caption = document.createElement('caption'); caption.className = 'sr-only'; caption.textContent = '과목별 노트 열람 진행률';
        const head = document.createElement('thead'); const headRow = document.createElement('tr');
        ['과목', '열람 노트', '진행률'].forEach(label => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headRow.append(th); }); head.append(headRow);
        const body = document.createElement('tbody');
        data.courseStats.forEach(course => {
          const row = document.createElement('tr'); const nameCell = document.createElement('th'); nameCell.scope = 'row';
          const open = document.createElement('button'); open.type = 'button'; open.className = 'course-progress-name'; open.textContent = course.name; open.onclick = () => selectCourse(courses.find(item => item.id === course.id)); nameCell.append(open);
          const count = document.createElement('td'); count.textContent = `${course.viewed}/${course.notes}개`;
          const progressCell = document.createElement('td'); const progress = document.createElement('progress'); progress.max = Math.max(1, course.notes); progress.value = course.viewed; progress.setAttribute('aria-label', `${course.name} 노트 열람 비율`);
          const percent = document.createElement('span'); percent.className = 'progress-percent'; percent.textContent = `${course.notes ? Math.round(course.viewed / course.notes * 100) : 0}%`; progressCell.append(progress, percent);
          row.append(nameCell, count, progressCell); body.append(row);
        });
        table.append(caption, head, body); progressTarget.replaceChildren(table);
      }
    } catch (error) {
      if (requestVersion === version) {
        el('dashboard-message').textContent = `${error.message} 잠시 후 다시 시도해 주세요.`;
        if (retry) retry.hidden = false;
      }
    }
  }

  return {renderCourses, loadCourses, loadDashboard, get courses() { return courses; }};
}
