import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DockerSandbox } from '../src/sandbox/docker-sandbox';
import { loadSandboxConfig } from '../src/sandbox/sandbox-config';

// These tests spin up real, short-lived containers from the sandbox image built
// via packages/reproduction/docker/sandbox.Dockerfile. Requires Docker and that
// image to be available locally — see packages/reproduction/README.md.
const IMAGE = process.env.REPRODUCTION_DOCKER_IMAGE || 'incident-ai-reproduction-sandbox';

function config(overrides: Partial<ReturnType<typeof loadSandboxConfig>> = {}) {
  return loadSandboxConfig({ REPRODUCTION_DOCKER_IMAGE: IMAGE, REPRODUCTION_TIMEOUT_MS: '10000', ...toEnv(overrides) });
}

function toEnv(overrides: Partial<ReturnType<typeof loadSandboxConfig>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (overrides.timeoutMs) env.REPRODUCTION_TIMEOUT_MS = String(overrides.timeoutMs);
  if (overrides.maxOutputBytes) env.REPRODUCTION_MAX_OUTPUT_BYTES = String(overrides.maxOutputBytes);
  return env;
}

test('network is disabled — DNS resolution fails inside the sandbox', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config());
  try {
    await sandbox.create();
    const result = await sandbox.run([
      'node',
      '-e',
      "require('http').get('http://example.com', () => console.log('REACHED')).on('error', (e) => console.log('ERR:' + e.code))",
    ]);
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.stdout, /REACHED/);
    assert.match(result.stdout, /ERR:(EAI_AGAIN|ENOTFOUND)/);
  } finally {
    await sandbox.destroy();
  }
});

test('the Docker socket is never present inside the sandbox', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config());
  try {
    await sandbox.create();
    const result = await sandbox.run(['node', '-e', "console.log(require('fs').existsSync('/var/run/docker.sock'))"]);
    assert.equal(result.stdout.trim(), 'false');
  } finally {
    await sandbox.destroy();
  }
});

test('host environment variables (including secrets) are never forwarded', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config());
  const originalSecret = process.env.SUPER_SECRET_TEST_VALUE;
  process.env.SUPER_SECRET_TEST_VALUE = 'leaked-if-forwarded';
  try {
    await sandbox.create();
    const result = await sandbox.run(['node', '-e', "console.log('SUPER_SECRET_TEST_VALUE' in process.env)"]);
    assert.equal(result.stdout.trim(), 'false');
  } finally {
    await sandbox.destroy();
    if (originalSecret === undefined) delete process.env.SUPER_SECRET_TEST_VALUE;
    else process.env.SUPER_SECRET_TEST_VALUE = originalSecret;
  }
});

test('a command argument containing shell metacharacters is never interpreted by a shell', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config());
  try {
    await sandbox.create();
    // If this ever ran through a shell, `; touch /tmp/pwned` would execute as a second command.
    const result = await sandbox.run(['node', '-e', 'console.log(process.argv[1])', '; touch /tmp/pwned']);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /; touch \/tmp\/pwned/); // treated as one literal argv string
  } finally {
    await sandbox.destroy();
  }
});

test('a timeout kills the container and it is not left running', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config({ timeoutMs: 1500 }));
  await sandbox.create();
  const result = await sandbox.run(['node', '-e', 'while (true) {}']);
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  await sandbox.destroy();
});

test('stdout is truncated once it exceeds the configured byte limit', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config({ maxOutputBytes: 100 }));
  try {
    await sandbox.create();
    const result = await sandbox.run(['node', '-e', "process.stdout.write('x'.repeat(5000))"]);
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') < 5000);
    assert.match(result.stdout, /truncated/);
  } finally {
    await sandbox.destroy();
  }
});

test('the container is removed after a successful run', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config());
  await sandbox.create();
  await sandbox.run(['node', '-e', "console.log('ok')"]);
  await sandbox.destroy();
  assert.equal(sandbox.isCreated(), false);
});

test('the container is removed even after a failing command', { timeout: 20000 }, async () => {
  const sandbox = new DockerSandbox(config());
  await sandbox.create();
  const result = await sandbox.run(['node', '-e', 'process.exit(1)']);
  assert.equal(result.exitCode, 1);
  await sandbox.destroy();
  assert.equal(sandbox.isCreated(), false);
});

test('destroy() never throws even if called twice or before create()', { timeout: 20000 }, async () => {
  const neverCreated = new DockerSandbox(config());
  await assert.doesNotReject(() => neverCreated.destroy());

  const sandbox = new DockerSandbox(config());
  await sandbox.create();
  await sandbox.destroy();
  await assert.doesNotReject(() => sandbox.destroy());
});
