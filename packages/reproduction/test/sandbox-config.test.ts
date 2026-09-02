import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSandboxConfig, DEFAULT_SANDBOX_CONFIG } from '../src/sandbox/sandbox-config';

test('falls back to defaults when nothing is set', () => {
  const config = loadSandboxConfig({});
  assert.deepEqual(config, DEFAULT_SANDBOX_CONFIG);
});

test('reads every REPRODUCTION_* env var when present', () => {
  const config = loadSandboxConfig({
    REPRODUCTION_DOCKER_IMAGE: 'custom:latest',
    REPRODUCTION_CPU_LIMIT: '2',
    REPRODUCTION_MEMORY_LIMIT: '2g',
    REPRODUCTION_TIMEOUT_MS: '30000',
    REPRODUCTION_MAX_OUTPUT_BYTES: '5000',
    REPRODUCTION_PIDS_LIMIT: '64',
  });
  assert.deepEqual(config, {
    image: 'custom:latest',
    cpuLimit: '2',
    memoryLimit: '2g',
    timeoutMs: 30000,
    maxOutputBytes: 5000,
    pidsLimit: 64,
  });
});

test('ignores an invalid numeric override and falls back to the default', () => {
  const config = loadSandboxConfig({ REPRODUCTION_TIMEOUT_MS: 'not-a-number' });
  assert.equal(config.timeoutMs, DEFAULT_SANDBOX_CONFIG.timeoutMs);
});

test('ignores a non-positive numeric override', () => {
  const config = loadSandboxConfig({ REPRODUCTION_MAX_OUTPUT_BYTES: '-100' });
  assert.equal(config.maxOutputBytes, DEFAULT_SANDBOX_CONFIG.maxOutputBytes);
});
