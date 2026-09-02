import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneratedTest, requiresDependencyInstall } from '../src/test/test-validator';

const VALID_CONTENT = `
describe('payment null customer reproduction', () => {
  it('reproduces crash when payment has no customer', () => {
    const { confirmPayment } = require('../src/services/payment.service');
    expect(() => confirmPayment({ id: 'p1', customer: null })).toThrow();
  });
});
`;

test('accepts a well-formed reproduction test', () => {
  const result = validateGeneratedTest({ filePath: 'reproduction-tests/payment.spec.js', content: VALID_CONTENT });
  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});

test('rejects an absolute file path', () => {
  const result = validateGeneratedTest({ filePath: '/etc/passwd', content: VALID_CONTENT });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('relative')));
});

test('rejects a path with .. traversal', () => {
  const result = validateGeneratedTest({
    filePath: 'reproduction-tests/../../../etc/passwd.spec.js',
    content: VALID_CONTENT,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('traversal')));
});

test('rejects a path outside reproduction-tests/', () => {
  const result = validateGeneratedTest({ filePath: 'src/services/payment.service.js', content: VALID_CONTENT });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('reproduction-tests/')));
});

test('rejects a disallowed extension', () => {
  const result = validateGeneratedTest({ filePath: 'reproduction-tests/payment.js', content: VALID_CONTENT });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('extension') || r.includes('must end with')));
});

test('rejects content that does not look like a Jest test', () => {
  const result = validateGeneratedTest({ filePath: 'reproduction-tests/x.spec.js', content: 'console.log("hi");' });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('Jest test')));
});

test('rejects child_process usage', () => {
  const content = `${VALID_CONTENT}\nconst { exec } = require('child_process');`;
  const result = validateGeneratedTest({ filePath: 'reproduction-tests/x.spec.js', content });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('child_process')));
});

test('rejects direct exec/spawn calls', () => {
  for (const call of ['exec(', 'execSync(', 'spawn(', 'spawnSync(']) {
    const content = `${VALID_CONTENT}\n${call}'echo hi');`;
    const result = validateGeneratedTest({ filePath: 'reproduction-tests/x.spec.js', content });
    assert.equal(result.valid, false, `expected ${call} to be rejected`);
  }
});

test('rejects eval and Function construction', () => {
  const evalResult = validateGeneratedTest({
    filePath: 'reproduction-tests/x.spec.js',
    content: `${VALID_CONTENT}\neval('1+1');`,
  });
  assert.equal(evalResult.valid, false);

  const fnResult = validateGeneratedTest({
    filePath: 'reproduction-tests/x.spec.js',
    content: `${VALID_CONTENT}\nnew Function('return 1');`,
  });
  assert.equal(fnResult.valid, false);
});

test('rejects network access (fetch, axios, raw http)', () => {
  for (const snippet of ["fetch('http://x')", "require('axios')", "require('http')", "require('node-fetch')"]) {
    const content = `${VALID_CONTENT}\n${snippet};`;
    const result = validateGeneratedTest({ filePath: 'reproduction-tests/x.spec.js', content });
    assert.equal(result.valid, false, `expected "${snippet}" to be rejected`);
  }
});

test('rejects reading process.env', () => {
  const content = `${VALID_CONTENT}\nconst key = process.env.SECRET;`;
  const result = validateGeneratedTest({ filePath: 'reproduction-tests/x.spec.js', content });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('process.env')));
});

test('rejects filesystem access via fs', () => {
  const content = `${VALID_CONTENT}\nconst fs = require('fs');`;
  const result = validateGeneratedTest({ filePath: 'reproduction-tests/x.spec.js', content });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('fs module')));
});

test('rejects shell invocation', () => {
  const content = `${VALID_CONTENT}\n// sh -c "rm -rf /"`;
  const result = validateGeneratedTest({ filePath: 'reproduction-tests/x.spec.js', content });
  assert.equal(result.valid, false);
});

test('requiresDependencyInstall: false for relative-only imports', () => {
  assert.equal(requiresDependencyInstall(VALID_CONTENT), false);
});

test('requiresDependencyInstall: true when a bare package is imported', () => {
  const content = `${VALID_CONTENT}\nconst axios = require('axios');`;
  assert.equal(requiresDependencyInstall(content), true);
});

test('requiresDependencyInstall: false for known test builtins', () => {
  const content = "import { describe, it, expect } from '@jest/globals';\nrequire('node:assert');";
  assert.equal(requiresDependencyInstall(content), false);
});
