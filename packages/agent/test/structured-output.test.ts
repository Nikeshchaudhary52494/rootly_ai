import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { generateValidated, StructuredOutputError } from '../src/llm/structured-output';
import { FakeLLM } from './fake-llm';

const Schema = z.object({ value: z.string() });

test('structured output: returns valid data on the first attempt', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({ value: 'ok' }));
  const result = await generateValidated(llm, { system: 's', user: 'u', schema: Schema, schemaName: 'test' });
  assert.equal(result.data.value, 'ok');
  assert.equal(llm.calls.length, 1);
});

test('structured output: retries once after an invalid response, then succeeds', async () => {
  const llm = new FakeLLM()
    .enqueueValid(() => ({ value: 123 })) // wrong type — fails schema
    .enqueueValid(() => ({ value: 'fixed' }));
  const result = await generateValidated(llm, { system: 's', user: 'u', schema: Schema, schemaName: 'test' });
  assert.equal(result.data.value, 'fixed');
  assert.equal(llm.calls.length, 2);
  // the retry prompt should carry the original request forward plus a correction note
  assert.ok(llm.calls[1].user.includes('previous response was invalid'));
});

test('structured output: sums token usage across both attempts', async () => {
  const llm = new FakeLLM()
    .enqueueValid(() => ({ value: 123 }), { inputTokens: 5, outputTokens: 5, totalTokens: 10 })
    .enqueueValid(() => ({ value: 'fixed' }), { inputTokens: 7, outputTokens: 7, totalTokens: 14 });
  const result = await generateValidated(llm, { system: 's', user: 'u', schema: Schema, schemaName: 'test' });
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 12, totalTokens: 24 });
});

test('structured output: fails after two invalid responses', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({ value: 123 })).enqueueValid(() => ({ value: 456 }));
  await assert.rejects(
    () => generateValidated(llm, { system: 's', user: 'u', schema: Schema, schemaName: 'test' }),
    StructuredOutputError,
  );
  assert.equal(llm.calls.length, 2);
});

test('structured output: an LLM-level error also triggers exactly one retry', async () => {
  const llm = new FakeLLM().enqueueError('rate limited').enqueueValid(() => ({ value: 'ok' }));
  const result = await generateValidated(llm, { system: 's', user: 'u', schema: Schema, schemaName: 'test' });
  assert.equal(result.data.value, 'ok');
  assert.equal(llm.calls.length, 2);
});
