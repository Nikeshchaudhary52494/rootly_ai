import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RootlyAI } from '../src/rootly.ai';
import { normalizeError } from '../src/utils/error-normalizer';
import { buildErrorEvent } from '../src/capture/error.capture';
import { HttpTransport } from '../src/transport/http.transport';
import { Logger } from '../src/utils/logger';

const originalFetch = globalThis.fetch;

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test('normalizeError: real Error instance', () => {
  const normalized = normalizeError(new TypeError('boom'));
  assert.equal(normalized.name, 'TypeError');
  assert.equal(normalized.message, 'boom');
  assert.ok(normalized.stack?.includes('TypeError'));
});

test('normalizeError: non-Error string thrown value is normalized', () => {
  const normalized = normalizeError('plain string error');
  assert.equal(normalized.name, 'Error');
  assert.equal(normalized.message, 'plain string error');
  assert.equal(normalized.stack, undefined);
});

test('normalizeError: unknown object with message/code is normalized', () => {
  const normalized = normalizeError({ message: 'Something failed', code: 'PAYMENT_FAILED' });
  assert.equal(normalized.name, 'PAYMENT_FAILED');
  assert.equal(normalized.message, 'Something failed');
});

test('normalizeError: object with neither message nor name still produces a usable value', () => {
  const normalized = normalizeError({ foo: 'bar' });
  assert.equal(normalized.name, 'Error');
  assert.equal(normalized.message, '{"foo":"bar"}');
});

test('event IDs are unique across captures', () => {
  const config = { apiKey: 'k', serviceName: 's', environment: 'e' };
  const first = buildErrorEvent(new Error('a'), config);
  const second = buildErrorEvent(new Error('b'), config);
  assert.notEqual(first.eventId, second.eventId);
});

test('manual capture sends a normalized error to the transport', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  const rootlyAI = new RootlyAI({
    apiKey: 'iai_dev_test',
    serverUrl: 'http://localhost:3001',
    serviceName: 'payment-service',
    environment: 'production',
  });

  rootlyAI.captureException(new TypeError('Cannot read properties of undefined'));
  await flushMicrotasks();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:3001/events');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.error.name, 'TypeError');
  assert.equal(body.error.message, 'Cannot read properties of undefined');
  assert.equal(body.service.name, 'payment-service');
  assert.ok(body.eventId);

  globalThis.fetch = originalFetch;
});

test('disabled SDK sends nothing', async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  const rootlyAI = new RootlyAI({
    apiKey: 'iai_dev_test',
    serviceName: 'payment-service',
    environment: 'production',
    enabled: false,
  });

  rootlyAI.captureException(new Error('should not be sent'));
  await flushMicrotasks();

  assert.equal(called, false);
  globalThis.fetch = originalFetch;
});

test('failed HTTP request does not throw', async () => {
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  const transport = new HttpTransport('http://localhost:3001', 'iai_dev_test', new Logger(false));

  const result = await transport.send({
    eventId: 'x',
    timestamp: new Date().toISOString(),
    service: { name: 's', environment: 'e' },
    error: { name: 'Error', message: 'm' },
  });

  assert.equal(result, false);
  globalThis.fetch = originalFetch;
});

test('failed HTTP request through captureException does not throw or crash the process', async () => {
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  const rootlyAI = new RootlyAI({
    apiKey: 'iai_dev_test',
    serviceName: 'payment-service',
    environment: 'production',
  });

  assert.doesNotThrow(() => rootlyAI.captureException(new Error('boom')));
  await flushMicrotasks();

  globalThis.fetch = originalFetch;
});

test('debug logs do not expose the API key or Authorization header', async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));
  console.warn = (...args: unknown[]) => logs.push(args.join(' '));

  const secretKey = 'iai_live_supersecretvalue';
  globalThis.fetch = (async () => new Response(null, { status: 201 })) as typeof fetch;

  const rootlyAI = new RootlyAI({
    apiKey: secretKey,
    serviceName: 'payment-service',
    environment: 'production',
    debug: true,
  });
  rootlyAI.init();
  rootlyAI.captureException(new Error('boom'));
  await flushMicrotasks();

  console.log = originalLog;
  console.warn = originalWarn;
  globalThis.fetch = originalFetch;

  assert.ok(logs.length > 0);
  for (const line of logs) {
    assert.ok(!line.includes(secretKey), `log line leaked the API key: ${line}`);
    assert.ok(!line.toLowerCase().includes('bearer'), `log line leaked the auth header: ${line}`);
  }
});
