import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCommitMessage } from '../src/commit/commit-manager';

test('generateCommitMessage: title uses the fix summary when present', () => {
  const msg = generateCommitMessage({ incidentSequenceNumber: 42, errorName: 'TypeError', fixSummary: 'handle missing customer' });
  assert.equal(msg.title, 'fix(incident-42): handle missing customer');
});

test('generateCommitMessage: falls back to the error name with no fix summary', () => {
  const msg = generateCommitMessage({ incidentSequenceNumber: 7, errorName: 'TypeError', fixSummary: null });
  assert.equal(msg.title, 'fix(incident-7): fix TypeError');
});

test('generateCommitMessage: body references the incident number, never secrets', () => {
  const msg = generateCommitMessage({ incidentSequenceNumber: 42, errorName: 'TypeError', fixSummary: 'x' });
  assert.match(msg.body, /Incident: #42/);
  assert.doesNotMatch(msg.body, /token|secret|password/i);
});

test('generateCommitMessage: full message is "title\\n\\nbody"', () => {
  const msg = generateCommitMessage({ incidentSequenceNumber: 1, errorName: 'Err', fixSummary: 'x' });
  assert.equal(msg.full, `${msg.title}\n\n${msg.body}`);
});

test('generateCommitMessage: long fix summaries are truncated to a reasonable title length', () => {
  const msg = generateCommitMessage({ incidentSequenceNumber: 1, errorName: 'Err', fixSummary: 'x'.repeat(200) });
  assert.ok(msg.title.length <= 72);
});
