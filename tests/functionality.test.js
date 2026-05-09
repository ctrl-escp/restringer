import assert from 'node:assert';
import {describe, it} from 'node:test';
import {execFileSync} from 'node:child_process';
import {REstringer} from '../src/restringer.js';
import {preloadSandboxProvider} from '../src/modules/utils/sandbox/index.js';
import {isSupportedNodeSandboxVersion, MIN_NODE_SANDBOX_VERSION} from '../src/modules/utils/sandbox/providers/processProvider.js';

describe('Functionality tests', () => {
  it('TP-1: Set max iterations via options', () => {
    const code = 'eval(\'eval("eval(3)")\')';
    const restringer = new REstringer(code, {maxIterations: 3});
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(restringer.script, '3;');
  });
  it('TP-2: Populate REstringer.__version__', () => {
    assert.ok(REstringer.__version__);
  });
  it('TP-3: Support node sandbox selection', async () => {
    await preloadSandboxProvider({provider: 'process'});
    const restringer = new REstringer('1 + 2;', {
      detectObfuscationType: false,
      sandbox: {
        provider: 'process',
        options: {
          runtime: 'node',
        },
      },
    });

    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(restringer.script, '3;');
  });
  it('TP-4: Cancel deobfuscation when the sandbox runtime is unavailable', async () => {
    await preloadSandboxProvider({provider: 'process'});
    const script = 'eval("1 + 2")';
    const restringer = new REstringer(script, {
      detectObfuscationType: false,
      sandbox: {
        provider: 'process',
        options: {
          runtime: 'missing-runtime-for-restringer-tests',
        },
      },
    });

    restringer.logger.setLogLevelNone();

    assert.throws(() => restringer.deobfuscate(), /Unsupported process sandbox runtime|Sandbox runtime "missing-runtime-for-restringer-tests" is not available/);
    assert.strictEqual(restringer.script, script);
  });
  it('TP-5: Print CLI help output', () => {
    const output = execFileSync('node', ['bin/deobfuscate.js', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    assert.match(output, /Usage: restringer/);
    assert.match(output, /--sb-exec <path>/);
    assert.match(output, /--sb-timeout <ms>[\s\S]*default: 1000/);
    assert.match(output, /--sb-memory-limit <mb>[\s\S]*default: 128/);
  });
  it('TP-6: Enforce minimum Node.js version for the node sandbox', () => {
    assert.ok(isSupportedNodeSandboxVersion(MIN_NODE_SANDBOX_VERSION));
    assert.ok(!isSupportedNodeSandboxVersion('v22.19.9'));
  });
});
