// Explicit opt-in smoke check against a running server. Never stores credentials.
// TEST_EMAIL, TEST_PASSWORD required. TEST_NOTE_ID + --generate opt into paid generation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base = process.env.TEST_BASE_URL || 'http://localhost:8091';
assert.ok(new URL(base).hostname === 'localhost' || new URL(base).hostname === '127.0.0.1', 'Only a local test server is allowed');
assert.ok(process.env.TEST_EMAIL && process.env.TEST_PASSWORD, 'Provide TEST_EMAIL and TEST_PASSWORD');
const cookies = new Map();
async function request(path, method = 'GET', body) {
  const headers = {'Content-Type':'application/json'};
  if(method !== 'GET') headers['X-XSRF-TOKEN'] = (await request('/api/auth/csrf')).token;
  headers.Cookie = [...cookies].map(([key,value])=>`${key}=${value}`).join('; ');
  const response = await fetch(base + path, {method, headers, body:body===undefined?undefined:JSON.stringify(body), signal:AbortSignal.timeout(120000)});
  for(const cookie of response.headers.getSetCookie()) {
    const entry=cookie.split(';')[0]; const index=entry.indexOf('=');
    cookies.set(entry.slice(0,index),entry.slice(index+1));
  }
  const data=await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${data.error || data.message || ''}`);
  return data;
}
await request('/api/auth/login','POST',{email:process.env.TEST_EMAIL,password:process.env.TEST_PASSWORD});
const config=await request('/api/ai/config');
console.log('AI mode',config);
const courses=await request('/api/courses');
if(!process.argv.includes('--generate')) {
  for(const course of courses) {
    const notes=await request(`/api/courses/${course.id}/notes`);
    console.log(JSON.stringify({course:course.name,notes:notes.map(n=>({id:n.id,title:n.title,version:n.version,bodyLength:n.body?.length}))}));
    if(process.argv.includes('--with-attachments')) for(const note of notes) {
      const files=await request(`/api/notes/${note.id}/attachments`);
      if(files.length) console.log('ATTACHMENTS',JSON.stringify({noteId:note.id,title:note.title,files:files.map(f=>({id:f.id,name:f.originalName,status:f.analysisStatus,summary:f.summaryStatus,length:f.extractedLength}))}));
    }
  }
} else {
  assert.equal(config.mockEnabled,false,'Real provider must be enabled explicitly');
  const noteId=process.env.TEST_NOTE_ID;
  assert.ok(noteId,'TEST_NOTE_ID is required');
  const attachments=await request(`/api/notes/${noteId}/attachments`);
  const attachmentIds=attachments.filter(a=>a.analysisStatus==='TEXT_READY').map(a=>a.id);
  console.log('Source attachments',attachments.map(a=>({id:a.id,name:a.originalName,status:a.analysisStatus,summary:a.summaryStatus,length:a.extractedLength})));
  assert.ok(attachmentIds.length,'Select a note with analyzed lecture materials');
  for(const kind of ['SUMMARY','INFOGRAPHIC']) {
    const created=await request(`/api/notes/${noteId}/generations`,'POST',{requestId:randomUUID(),kind,attachmentIds});
    let job;
    for(let attempt=0;attempt<100;attempt++) {
      job=(await request(`/api/notes/${noteId}/generations`)).find(row=>row.id===created.id);
      if(['COMPLETED','FAILED','CANCELED'].includes(job.status)) break;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    assert.equal(job.status,'COMPLETED',`${kind}: ${job.errorCode}`);
    assert.equal(job.mockResult,false);
    assert.ok(job.content?.length>30);
    console.log(JSON.stringify({kind,id:job.id,model:job.model,mock:job.mockResult,attachments:job.attachmentCount,chars:job.content.length,preview:job.content.slice(0,240)}));
  }
  const quiz=await request(`/api/notes/${noteId}/quiz-sets`,'POST',{requestId:randomUUID(),questionCount:3,attachmentIds});
  assert.equal(quiz.mockResult,false);
  const questions=await request(`/api/quiz-sets/${quiz.id}/questions`);
  assert.equal(questions.length,3);
  assert.ok(questions.every(q=>q.options.length===4&&q.hint&&q.source));
  console.log(JSON.stringify({kind:'QUIZ',id:quiz.id,count:questions.length,preview:questions[0].prompt,source:questions[0].source}));
  const deck=await request(`/api/notes/${noteId}/flashcard-decks`,'POST',{requestId:randomUUID(),cardCount:8,attachmentIds});
  assert.equal(deck.mockResult,false);
  const saved=await request(`/api/flashcard-decks/${deck.id}`);
  assert.equal(saved.cards.length,8);
  assert.ok(saved.cards.every(c=>c.front&&c.back&&c.source));
  console.log(JSON.stringify({kind:'FLASHCARD',id:deck.id,count:saved.cards.length,preview:saved.cards[0].front,source:saved.cards[0].source}));
  console.log('PASS: real outputs persisted; original notes and files untouched');
}
