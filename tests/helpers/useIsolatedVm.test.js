import assert from 'node:assert';
import {describe, it} from 'node:test';
import {shouldUseIsolatedVmForUnsafeTests} from './useIsolatedVm.js';

describe('useIsolatedVmForUnsafeTests', () => {
  it('uses isolated-vm by default in node', () => {
    assert.strictEqual(shouldUseIsolatedVmForUnsafeTests('node'), true);
  });

  it('keeps the host runtime default outside node', () => {
    assert.strictEqual(shouldUseIsolatedVmForUnsafeTests('bun'), false);
    assert.strictEqual(shouldUseIsolatedVmForUnsafeTests('deno'), false);
  });
});
