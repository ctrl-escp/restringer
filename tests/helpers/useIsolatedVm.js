import {after, before} from 'node:test';
import {createHostRuntimeSandboxConfig, detectCurrentRuntime} from '../../src/modules/utils/sandbox/runtime.js';
import {preloadSandboxProvider, setDefaultSandboxConfig} from '../../src/modules/utils/sandbox/index.js';

export function shouldUseIsolatedVmForUnsafeTests(runtime = detectCurrentRuntime()) {
  return runtime === 'node';
}

export function useIsolatedVmForUnsafeTests() {
  if (!shouldUseIsolatedVmForUnsafeTests()) return;

  before(async () => {
    await preloadSandboxProvider({provider: 'isolated-vm'});
    setDefaultSandboxConfig({provider: 'isolated-vm'});
  });

  after(() => {
    setDefaultSandboxConfig(createHostRuntimeSandboxConfig());
  });
}
