import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore, NoteEditor } from '../src/main/resources/static/note-editor.js';

const requestId = 'c5edbcf5-951b-4719-90b8-eaf1168d62c3';
function storage() {
  return Object.defineProperties({}, {
    getItem:{value(key) {return this[key] || null;}},
    setItem:{value(key,value) {this[key]=value;}},
    removeItem:{value(key) {delete this[key];}}
  });
}
function setup(request) {
  const local = storage(), drafts = new DraftStore(local,1), timers = new Map(); let count=0;
  const editor = new NoteEditor({request,drafts,idFactory:() => requestId,
    schedule:(fn,delay) => { assert.equal(delay,180000); timers.set(++count,fn); return count; },cancel:id => timers.delete(id)});
  return {editor,drafts,local,timers,run:async () => {const pending=[...timers.values()];timers.clear();for(const fn of pending) await fn();}};
}
const base = {id:'note',title:'강의',body:'원문',version:2};

test('keeps a local draft, backs it up every three minutes, and saves to the server manually', async () => {
  let calls=0;
  const ctx=setup(async (path,options) => {calls++;assert.equal(path,'/api/notes/note');return {...base,...JSON.parse(options.body),version:3};});
  ctx.editor.open('course',base);
  ctx.editor.change('강의','첫 수정');ctx.editor.change('강의','최종 수정');
  assert.equal(ctx.timers.size,1);assert.equal(ctx.drafts.read('course.note').body,'최종 수정');
  await ctx.run();assert.equal(calls,0);assert.equal(ctx.editor.dirty,true);assert.equal(ctx.drafts.read('course.note').body,'최종 수정');
  assert.equal(ctx.timers.size,1);
  await ctx.editor.save();assert.equal(calls,1);assert.equal(ctx.editor.dirty,false);assert.equal(ctx.drafts.read('course.note'),null);assert.equal(ctx.timers.size,0);
});

test('allows an unchanged saved note to be explicitly saved again', async () => {
  let calls=0;
  const ctx=setup(async (path,options) => {calls++;assert.equal(path,'/api/notes/note');assert.equal(options.method,'PUT');return {...base,version:3};});
  ctx.editor.open('course',base);
  assert.equal(ctx.editor.dirty,false);
  assert.equal(await ctx.editor.save(),true);
  assert.equal(calls,1);
  assert.equal(ctx.editor.dirty,false);
});

test('serializes saves and retains edits typed while request is in flight', async () => {
  let resolve;
  const ctx=setup(() => new Promise(done => {resolve=done;}));
  ctx.editor.open('course',base);ctx.editor.change('강의','저장 요청');
  const first=ctx.editor.save();assert.equal(await ctx.editor.save(),false);
  ctx.editor.change('강의','추가 입력');
  resolve({...base,body:'저장 요청',version:3});await first;
  assert.equal(ctx.editor.dirty,true);assert.equal(ctx.editor.body,'추가 입력');
  assert.equal(ctx.drafts.read('course.note').version,3);assert.equal(ctx.timers.size,1);
  await ctx.run();assert.equal(ctx.editor.dirty,true);
});

test('accepts the server canonical body when no edits happened during save', async () => {
  const ctx=setup(async () => ({...base,body:'canonical body',version:3}));
  ctx.editor.open('course',base);
  ctx.editor.change('강의','submitted body');
  assert.equal(await ctx.editor.save(),true);
  assert.equal(ctx.editor.body,'canonical body');
  assert.equal(ctx.editor.dirty,false);
});

test('conflicts stop automatic overwrites and retain the draft', async () => {
  const ctx=setup(async () => {throw Object.assign(new Error(),{status:409});});
  ctx.editor.open('course',base);ctx.editor.change('강의','내 내용');await ctx.editor.save();
  assert.equal(ctx.editor.blocked,true);assert.equal(ctx.editor.dirty,true);
  ctx.editor.change('강의','보존할 내용');assert.equal(ctx.timers.size,0);
  ctx.editor.close();ctx.editor.open('course',{...base,version:3});
  assert.ok(ctx.editor.pendingDraft);ctx.editor.restore();
  assert.equal(ctx.editor.body,'보존할 내용');assert.equal(ctx.editor.version,2);
  assert.equal(ctx.editor.blocked,true);assert.equal(await ctx.editor.save(),false);
});

test('failed create can restore and retry with the same request identity', async () => {
  let attempts=[];
  const ctx=setup(async (path,options) => {attempts.push(JSON.parse(options.body).requestId);throw new Error('offline');});
  ctx.editor.open('course',null);ctx.editor.change('새 노트','초안');await ctx.editor.save();
  assert.equal(ctx.editor.dirty,true);assert.equal(ctx.timers.size,1);
  ctx.editor.close();ctx.editor.open('course',null);ctx.editor.restore();
  assert.equal(ctx.timers.size,1);await ctx.editor.save();
  assert.deepEqual(attempts,[requestId,requestId]);
});

test('a successful duplicate create response cannot erase newer edits', async () => {
  const ctx=setup(async () => ({id:requestId,title:'새 노트',body:'이전 저장',version:0}));
  ctx.editor.open('course',null);ctx.editor.change('새 노트','최신 수정');await ctx.editor.save();
  assert.equal(ctx.editor.id,requestId);assert.equal(ctx.editor.dirty,true);
  assert.equal(ctx.drafts.read(`course.${requestId}`).body,'최신 수정');assert.equal(ctx.drafts.read('course.new'),null);
});

test('drafts are scoped by account, can be cleared on logout, and storage failure is nonfatal', () => {
  const local=storage(), a=new DraftStore(local,1),b=new DraftStore(local,2);
  a.write('course.note',{...base,requestId});assert.equal(b.read('course.note'),null);
  b.write('course.note',{...base,requestId});a.clear();assert.ok(b.read('course.note'));
  b.clear(true);assert.equal(Object.keys(local).length,0);
  assert.equal(new DraftStore(null,1).write('x',base),false);
});

test('blank title does not create a note and closing cancels pending autosave', async () => {
  let calls=0;const ctx=setup(async () => {calls++;});
  ctx.editor.open('course',null);ctx.editor.change('','본문');await ctx.run();assert.equal(calls,0);
  ctx.editor.change('제목','본문');ctx.editor.close();assert.equal(ctx.timers.size,0);assert.ok(ctx.drafts.read('course.new'));
});
