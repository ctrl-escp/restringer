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
    assert.match(output, /--method <name>/);
    assert.match(output, /--skip-preprocessors/);
    assert.match(output, /--run-preproc/);
    assert.match(output, /--run-postproc/);
    assert.match(output, /--max-marked-nodes <number>/);
    assert.match(output, /--safely/);
  });
  it('TP-6: Enforce minimum Node.js version for the node sandbox', () => {
    assert.ok(isSupportedNodeSandboxVersion(MIN_NODE_SANDBOX_VERSION));
    assert.ok(!isSupportedNodeSandboxVersion('v22.19.9'));
  });
  it('TP-7: Named methods run in the given order', () => {
    const restringer = new REstringer('eval("1 + 2")', {
      detectObfuscationType: false,
      methods: ['replaceEvalCallsWithLiteralContent', 'resolveNestedBinaryExpressions'],
    });
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(restringer.script, '3;');
  });
  it('TP-8: Unknown method name throws', () => {
    assert.throws(() => new REstringer('1;', {methods: ['notARealMethod']}), /Unknown deobfuscation method/);
  });
  it('TP-9: runPreprocessors false skips preprocessors', () => {
    let ran = false;
    const dummy = arb => {
      ran = true;
      return arb;
    };
    const restringer = new REstringer('1 + 1;', {
      detectObfuscationType: false,
      runPreprocessors: false,
    });
    restringer._preprocessors = [dummy];
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(ran, false);
    assert.strictEqual(restringer.script, '2;');
  });
  it('TP-10: runPreprocessors true with methods runs preprocessors', () => {
    let ran = false;
    const dummy = arb => {
      ran = true;
      return arb;
    };
    const restringer = new REstringer('1 + 1;', {
      detectObfuscationType: false,
      methods: ['resolveNestedBinaryExpressions'],
      runPreprocessors: true,
    });
    restringer._preprocessors = [dummy];
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(ran, true);
    assert.strictEqual(restringer.script, '2;');
  });
  it('TP-11: methods default skips preprocessors', () => {
    let ran = false;
    const dummy = arb => {
      ran = true;
      return arb;
    };
    const restringer = new REstringer('1 + 1;', {
      detectObfuscationType: false,
      methods: ['resolveNestedBinaryExpressions'],
    });
    restringer._preprocessors = [dummy];
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(ran, false);
  });
  it('TP-12: runPostprocessors true with methods runs postprocessors', () => {
    let ran = false;
    const dummy = arb => {
      ran = true;
      return arb;
    };
    const restringer = new REstringer('1 + 1;', {
      detectObfuscationType: false,
      methods: ['resolveNestedBinaryExpressions'],
      runPostprocessors: true,
    });
    restringer._postprocessors = [dummy];
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(ran, true);
  });
  it('TP-13: Iteration logs continue from a preprocessor into the main loop', () => {
    const messages = [];
    const noop = arb => arb;
    const restringer = new REstringer('1 + 1;', {detectObfuscationType: false});
    restringer._preprocessors = [noop];
    restringer.logger.setLogFunc((...args) => messages.push(String(args[0] ?? '')));
    restringer.logger.setLogLevelLog();
    restringer.deobfuscate();
    const iterationNumbers = messages
      .filter(message => message.includes('Iteration #'))
      .map(message => Number(message.match(/Iteration #(\d+)/)[1]));
    assert.ok(iterationNumbers.length >= 2);
    assert.strictEqual(iterationNumbers[0], 1);
    assert.ok(iterationNumbers.slice(1).some(n => n >= 2));
  });
  it('TP-14: maxMarkedNodes is stored and deobfuscation still runs', () => {
    const restringer = new REstringer('1 + 1;', {
      detectObfuscationType: false,
      maxMarkedNodes: 1,
    });
    assert.strictEqual(restringer.maxMarkedNodes, 1);
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(restringer.script, '2;');
  });
  it('TP-15: safely applies valid edits', () => {
    const restringer = new REstringer('1 + 1;', {
      detectObfuscationType: false,
      safely: true,
    });
    restringer.logger.setLogLevelNone();
    restringer.deobfuscate();
    assert.strictEqual(restringer.script, '2;');
  });
});
