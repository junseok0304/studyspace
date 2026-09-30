export class DraftStore {
  constructor(storage, userId) { this.storage = storage; this.prefix = `studyspace.draft.${userId}.`; }
  read(key) {
    try {
      const value = JSON.parse(this.storage.getItem(this.prefix + key));
      if (!value || typeof value.title !== 'string' || value.title.length > 200 || typeof value.body !== 'string' ||
          value.body.length > 60000 || !Number.isInteger(value.version) || value.version < 0 ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId || '')) return null;
      return {title:value.title,body:value.body,version:value.version,requestId:value.requestId};
    } catch { return null; }
  }
  write(key, value) {
    try { this.storage.setItem(this.prefix + key,JSON.stringify(value)); return true; } catch { return false; }
  }
  remove(key) { try { this.storage.removeItem(this.prefix + key); } catch { /* Storage unavailable. */ } }
  clear(allUsers = false) {
    try {
      for (const key of Object.keys(this.storage)) if (key.startsWith(allUsers ? 'studyspace.draft.' : this.prefix)) this.storage.removeItem(key);
    } catch { /* Storage unavailable. */ }
  }
}

export class NoteEditor {
  constructor({request, drafts, changed = () => {}, saved = () => {}, schedule = (callback, delay) => setTimeout(callback, delay), cancel = timer => clearTimeout(timer), idFactory = () => crypto.randomUUID()}) {
    Object.assign(this,{request,drafts,changed,saved,schedule,cancel,idFactory});
    this.dirty = false; this.saving = false; this.active = false; this.blocked = false; this.epoch = 0;
  }
  get key() { return `${this.courseId}.${this.id || 'new'}`; }
  snapshot() { return {title:this.title,body:this.body,version:this.version,requestId:this.requestId}; }
  notify(status) { this.status = status; this.changed(this); }
  open(courseId, note) {
    if (this.saving) return false;
    ++this.epoch;
    this.cancel(this.timer); this.timer = null;
    this.active = true; this.courseId = courseId; this.id = note?.id || null;
    this.title = note?.title || ''; this.body = note?.body || ''; this.version = note?.version || 0;
    this.requestId = this.idFactory(); this.base = note; this.dirty = false; this.blocked = false;
    this.pendingDraft = this.drafts.read(this.key);
    if (this.pendingDraft && note && this.pendingDraft.title === note.title && this.pendingDraft.body === note.body) {
      this.drafts.remove(this.key); this.pendingDraft = null;
    }
    this.notify(note ? '서버에 저장된 노트입니다.' : '새 노트 · 저장 버튼을 눌러 서버에 저장하세요.');
    return true;
  }
  restore() {
    if (!this.pendingDraft || this.saving) return;
    Object.assign(this,this.pendingDraft);
    this.pendingDraft = null; this.dirty = true;
    this.blocked = !!this.base && this.base.version !== this.version;
    this.notify(this.blocked ? '초안 이후 서버 내용이 바뀌었습니다. 초안을 내려받고 서버 내용을 다시 열어 비교해주세요.' : '임시 초안을 복구했습니다. 내용을 확인하고 저장을 눌러주세요.');
    // Restoring a draft never silently writes over the server copy.
    this.queue();
  }
  discardDraft() {
    if (this.saving) return false;
    this.drafts.remove(this.key); this.pendingDraft = null; this.dirty = false; this.blocked = false;
    this.cancel(this.timer); this.timer = null; return true;
  }
  close() { this.cancel(this.timer); this.timer = null; this.active = false; ++this.epoch; }
  persist() { return this.drafts.write(this.key,this.snapshot()); }
  change(title, body) {
    if (!this.active || this.pendingDraft) return;
    this.title = title; this.body = body; this.dirty = true;
    const backedUp = this.persist();
    this.notify(this.blocked ? '저장이 중단되었습니다. 현재 내용을 내려받고 서버 내용을 다시 열어주세요.' :
      backedUp ? '임시 초안이 보관되었습니다. 서버 반영은 저장 버튼으로 진행하세요.' : '임시 초안을 보관할 수 없습니다. 저장 전에는 이 화면을 닫지 마세요.');
    this.queue();
  }
  queue() {
    if (this.timer || !this.active || !this.dirty || this.blocked || this.pendingDraft) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (!this.active || !this.dirty || this.blocked || this.pendingDraft) return;
      const backedUp=this.persist();
      this.notify(backedUp ? '3분 간격 임시저장 완료 · 저장 버튼을 누르면 노트에 반영됩니다.' : '임시 초안을 보관할 수 없습니다. 저장 전에는 이 화면을 닫지 마세요.');
      this.queue();
    },180000);
  }
  async save() {
    this.cancel(this.timer); this.timer = null;
    if (!this.active || this.saving || this.pendingDraft || (!this.dirty && !this.id) || this.blocked) return false;
    if (!this.title.trim()) { this.notify('제목을 입력하면 저장할 수 있습니다.'); return false; }
    const input = this.snapshot(), oldKey = this.key, epoch = this.epoch, creating = !this.id;
    this.saving = true; this.notify('서버에 저장 중…');
    try {
      const result = await this.request(this.id ? `/api/notes/${this.id}` : `/api/courses/${this.courseId}/notes`, {
        method:this.id ? 'PUT' : 'POST', body:JSON.stringify(input)
      });
      if (epoch !== this.epoch || !this.active) return false;
      const changedDuringSave = this.title !== input.title || this.body !== input.body;
      this.id = result.id; this.version = result.version; this.base = result;
      const createResponseIsStale = creating && (input.title.trim() !== result.title || input.body !== result.body);
      this.dirty = changedDuringSave || createResponseIsStale;
      if (!this.dirty) {
        this.title = result.title;
        this.body = result.body;
      }
      this.drafts.remove(oldKey);
      if (this.dirty) this.persist(); else this.drafts.remove(this.key);
      this.notify(this.dirty ? '저장 도중 추가로 수정된 내용이 있습니다. 저장 버튼을 다시 눌러주세요.' : '서버에 저장했습니다.');
      this.saved(result);
      return true;
    } catch (error) {
      if (epoch !== this.epoch || !this.active) return false;
      this.blocked = [401,403,409].includes(error.status);
      this.persist();
      this.notify(error.status === 409 ? '다른 화면에서 수정된 노트입니다. 현재 내용을 내려받고 서버 내용을 다시 열어 비교해주세요.' :
        error.status === 401 || error.status === 403 ? '로그인이 만료되었습니다. 현재 내용을 내려받고 다시 로그인해주세요.' :
        '서버에 저장하지 못했습니다. 연결을 확인한 뒤 저장을 눌러 다시 시도해주세요.');
      return false;
    } finally {
      this.saving = false;
      if (epoch === this.epoch && this.active) this.changed(this);
      // Keep a periodic local backup for unsaved edits; server writes require an explicit save.
      if (this.dirty && !this.blocked) this.queue();
    }
  }
}
