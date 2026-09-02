import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReproductionTestSchema } from '../src/schemas/reproduction.schema';

test('accepts a well-formed reproduction test payload', () => {
  const result = ReproductionTestSchema.safeParse({
    filePath: 'reproduction-tests/payment.spec.js',
    testName: 'reproduces crash when payment has no customer',
    language: 'javascript',
    framework: 'jest',
    content: "describe('x', () => { it('y', () => { expect(true).toBe(true); }); });",
    explanation: 'Constructs a payment with a null customer and asserts the access throws.',
  });
  assert.equal(result.success, true);
});

test('rejects an unsupported framework', () => {
  const result = ReproductionTestSchema.safeParse({
    filePath: 'reproduction-tests/payment.spec.js',
    testName: 'x',
    language: 'javascript',
    framework: 'mocha',
    content: 'x',
    explanation: 'x',
  });
  assert.equal(result.success, false);
});

test('rejects an unsupported language', () => {
  const result = ReproductionTestSchema.safeParse({
    filePath: 'reproduction-tests/payment.spec.js',
    testName: 'x',
    language: 'python',
    framework: 'jest',
    content: 'x',
    explanation: 'x',
  });
  assert.equal(result.success, false);
});

test('rejects a missing required field', () => {
  const result = ReproductionTestSchema.safeParse({
    filePath: 'reproduction-tests/payment.spec.js',
    language: 'javascript',
    framework: 'jest',
    content: 'x',
    explanation: 'x',
  });
  assert.equal(result.success, false);
});
