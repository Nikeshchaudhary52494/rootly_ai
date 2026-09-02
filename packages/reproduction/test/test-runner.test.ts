import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJestCommand, buildInstallCommand } from '../src/test/test-runner';

test('buildJestCommand targets exactly the given file, no shell involved', () => {
  const cmd = buildJestCommand('reproduction-tests/payment.spec.js');
  assert.deepEqual(cmd, ['jest', 'reproduction-tests/payment.spec.js', '--ci', '--runInBand']);
});

test('buildInstallCommand uses npm ci when a lockfile exists', () => {
  const cmd = buildInstallCommand(true);
  assert.deepEqual(cmd, ['npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund']);
});

test('buildInstallCommand uses npm install when no lockfile exists', () => {
  const cmd = buildInstallCommand(false);
  assert.deepEqual(cmd, ['npm', 'install', '--prefer-offline', '--no-audit', '--no-fund']);
});
