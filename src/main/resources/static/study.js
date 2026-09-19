let started = false;
export async function start(request) {
  if (started) return;
  started = true;
  const el = id => document.getElementById(id);
  let course = null, note = null, dirty = false, saving = false;
  const tell = text => { el('study-message').textContent = text; };
  const guard = () => !saving && (!dirty || window.confirm('저장하지 않은 변경 내용을 버릴까요?'));
  function button(text, action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'list-item'; b.textContent = text;
    b.onclick = () => Promise.resolve(action()).catch(e => tell(e.message));
    return b;
  }
  function edit(value) {
    note = value; dirty = false;
    el('note-title').value = value?.title || '';
    el('note-body').value = value?.body || '';
    el('note-form').classList.remove('hidden');
    tell(value ? '서버에 저장된 노트입니다.' : '새 노트 · 아직 저장하지 않았습니다.');
  }
  async function loadNotes() {
    const rows = await request(`/api/courses/${course.id}/notes`);
    el('notes').replaceChildren(...rows.map(row => button(row.title, () => { if (guard()) edit(row); })));
    if (!rows.length) el('notes').textContent = '아직 노트가 없습니다.';
  }
  async function loadCourses() {
    const rows = await request('/api/courses');
    el('courses').replaceChildren(...rows.map(row => button(`${row.semester} · ${row.name}`, async () => {
      if (!guard()) return;
      course = row; note = null; dirty = false;
      el('course-heading').textContent = row.name;
      el('new-note').disabled = false;
      el('note-form').classList.add('hidden');
      await loadNotes(); tell('노트를 선택하거나 새로 작성하세요.');
    })));
  }
  el('course-form').onsubmit = async event => {
    event.preventDefault();
    const submit = event.submitter; submit.disabled = true;
    try {
      await request('/api/courses', {method:'POST', body:JSON.stringify({semester:el('semester').value,name:el('course-name').value})});
      el('course-name').value = ''; await loadCourses(); tell('과목을 추가했습니다.');
    } catch(e) { tell(e.message); } finally { submit.disabled = false; }
  };
  el('new-note').onclick = () => { if (guard()) edit(null); };
  el('note-form').oninput = () => { dirty = true; tell('저장하지 않은 변경 내용이 있습니다.'); };
  el('note-form').onsubmit = async event => {
    event.preventDefault(); if (saving) return; saving = true; el('save-note').disabled = true;
    const title = el('note-title').value, body = el('note-body').value;
    try {
      note = await request(note ? `/api/notes/${note.id}` : `/api/courses/${course.id}/notes`, {
        method:note ? 'PUT' : 'POST', body:JSON.stringify({title,body,version:note?.version || 0})
      });
      dirty = title !== el('note-title').value || body !== el('note-body').value;
      await loadNotes(); tell(dirty ? '추가 변경 내용을 저장해 주세요.' : '서버에 저장했습니다.');
    } catch(e) { tell(e.message); } finally { saving = false; el('save-note').disabled = false; }
  };
  el('export-note').onclick = () => {
    const url = URL.createObjectURL(new Blob([el('note-body').value], {type:'text/markdown;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url;
    a.download = (el('note-title').value.replace(/[^\p{L}\p{N} _-]/gu,'_') || 'note') + '.md';
    a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  window.addEventListener('beforeunload', event => { if(dirty) { event.preventDefault(); event.returnValue = ''; } });
  el('study').classList.remove('hidden');
  try { await loadCourses(); } catch(e) { tell(e.message); }
}
