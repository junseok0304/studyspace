import test from 'node:test';
import assert from 'node:assert/strict';
import {splitAiFrontmatter, withAiFrontmatter} from '../src/main/resources/static/note-metadata.js';

test('AI metadata is added to saved Markdown and removed from the visible note body', () => {
  const metadata = {
    course_id:'course-123', course_name:'AI활용프로그래밍', created:'2026-09-23',
    id:'lecture-75bcabbc-954a-447b-aaf1-4d4ff0ee7141', semester:'2026-2', status:'draft', updated:'2026-09-24'
  };
  const stored = withAiFrontmatter('## 수업 내용\n- 신경망 기초',metadata);
  assert.match(stored,/^---\ncourse_id: "course-123"/);
  assert.match(stored,/course_name: "AI활용프로그래밍"/);
  assert.match(stored,/id: "lecture-75bcabbc-954a-447b-aaf1-4d4ff0ee7141"/);
  assert.deepEqual(splitAiFrontmatter(stored),{metadata:{...metadata,type:'lecture'},body:'## 수업 내용\n- 신경망 기초'});
});

test('AI metadata can be refreshed without duplicating frontmatter or changing note text', () => {
  const first = withAiFrontmatter('강의 내용',{
    course_id:'course-123',course_name:'운영체제',created:'2026-09-22',id:'lecture-first',semester:'2026-2',status:'draft',updated:'2026-09-22'
  });
  const updated = withAiFrontmatter(first,{
    course_id:'course-123',course_name:'운영체제',created:'2026-09-22',id:'lecture-first',semester:'2026-2',status:'draft',updated:'2026-09-23'
  });
  assert.equal((updated.match(/^---$/gm) || []).length,2);
  assert.match(updated,/updated: 2026-09-23/);
  assert.equal(splitAiFrontmatter(updated).body,'강의 내용');
});

test('unrecognized user-authored YAML remains untouched', () => {
  const body='---\ntitle: my markdown\n---\n\nbody';
  assert.deepEqual(splitAiFrontmatter(body),{metadata:null,body});
});

