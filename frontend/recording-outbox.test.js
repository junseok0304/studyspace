import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingOutbox} from '../src/main/resources/static/recording-outbox.js';

test('reuses IndexedDB connection and reads/deletes only the requested recording chunks', async () => {
  const nativeOpen = indexedDB.open.bind(indexedDB);
  let openCount = 0;
  indexedDB.open = (...args) => { openCount += 1; return nativeOpen(...args); };

  await recordingOutbox.ready();
  await recordingOutbox.saveSession({id: 'recording-a', title: 'A', ownerUserId: 'user-a'});
  await recordingOutbox.saveChunk('recording-a', 1, new Blob(['a1']));
  await recordingOutbox.saveChunk('recording-b', 0, new Blob(['b0']));
  await recordingOutbox.saveChunk('recording-a', 0, new Blob(['a0']));

  const chunks = await recordingOutbox.getChunks('recording-a');
  assert.deepEqual(chunks.map(chunk => chunk.sequence), [0, 1]);
  assert.equal(openCount, 1, 'operations should share the same opened database connection');

  await recordingOutbox.deleteRecording('recording-a');
  assert.equal(await recordingOutbox.getSession('recording-a'), undefined);
  assert.deepEqual((await recordingOutbox.getChunks('recording-a')), []);
  assert.deepEqual((await recordingOutbox.getChunks('recording-b')).map(chunk => chunk.sequence), [0]);
});
