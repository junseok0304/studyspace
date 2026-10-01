import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = name => readFileSync(new URL(`../src/main/resources/static/${name}`, import.meta.url), 'utf8');

test('workspace feature styles keep their final selectors in the owning file', () => {
  const navigation = css('workspace-navigation.css');
  const dashboard = css('workspace-dashboard.css');
  const practice = css('workspace-practice-tools.css');
  const reading = css('workspace-note-reading.css');
  assert.doesNotMatch(navigation, /\.today-class-row|\.today-classes|\.dashboard-main-grid\s*>\s*\.dashboard-card/);
  assert.doesNotMatch(css('workspace-theme.css'), /\.study-dashboard \.dashboard-card\s*\{/);
  assert.match(dashboard, /\.study-dashboard \.today-class-row\s*\{/);
  assert.doesNotMatch(css('workspace.css'), /\.quiz-option\s*[:{]/);
  assert.match(practice, /\.quiz-option\.is-correct/);
  assert.doesNotMatch(css('workspace-controls.css'), /\.note-view-actions\s*\{/);
  assert.match(reading, /\.writing-panel:not\(\.view-mode\)\s*>\s*\.note-view-actions/);
});
