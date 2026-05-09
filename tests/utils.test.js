import assert from 'node:assert';
import {describe, it} from 'node:test';
import {parseArgs} from '../src/utils/parseArgs.js';
import {createHostRuntimeSandboxConfig} from '../src/modules/utils/sandbox/runtime.js';
const consolelog = console.log;

function createExpectedOptions(inputFilename, overrides = {}) {
  return {
    inputFilename,
    help: false,
    clean: false,
    quiet: false,
    verbose: false,
    outputToFile: false,
    maxIterations: false,
    outputFilename: inputFilename ? `${inputFilename}-deob.js` : '-deob.js',
    sandbox: createHostRuntimeSandboxConfig(),
    ...overrides,
  };
}

describe('parseArgs tests', () => {
  it('TP-1: Defaults', () => {
    assert.deepEqual(parseArgs(['input.js']), createExpectedOptions('input.js'));
  });
  it('TP-1.1: Defaults inherit the current runtime executable', () => {
    const result = parseArgs(['input.js']);
    assert.deepEqual(result.sandbox, createHostRuntimeSandboxConfig());
  });
  it('TP-2: All on - short', () => {
    assert.deepEqual(parseArgs(['input.js', '-h', '-c', '-q', '-v', '-o', '-m', '1']), createExpectedOptions('input.js', {
      help: true,
      clean: true,
      quiet: true,
      verbose: true,
      outputToFile: true,
      maxIterations: 1,
    }));
  });
  it('TP-3: All on - full', () => {
    assert.deepEqual(parseArgs(['input.js', '--help', '--clean', '--quiet', '--verbose', '--output', '--max-iterations=1']), createExpectedOptions('input.js', {
      help: true,
      clean: true,
      quiet: true,
      verbose: true,
      outputToFile: true,
      maxIterations: 1,
    }));
  });
  it('TP-4: Custom outputFilename split', () => {
    assert.deepEqual(parseArgs(['input.js', '-o', 'customName.js']), createExpectedOptions('input.js', {
      outputToFile: true,
      outputFilename: 'customName.js',
    }));
  });
  it('TP-5: Custom outputFilename equals', () => {
    assert.deepEqual(parseArgs(['input.js', '-o=customName.js']), createExpectedOptions('input.js', {
      outputToFile: true,
      outputFilename: 'customName.js',
    }));
  });
  it('TP-6: Custom outputFilename full', () => {
    assert.deepEqual(parseArgs(['input.js', '--output=customName.js']), createExpectedOptions('input.js', {
      outputToFile: true,
      outputFilename: 'customName.js',
    }));
  });
  it('TP-7: Max iterations short equals', () => {
    assert.deepEqual(parseArgs(['input.js', '-m=2']), createExpectedOptions('input.js', {
      maxIterations: 2,
    }));
  });
  it('TP-8: Max iterations short split', () => {
    assert.deepEqual(parseArgs(['input.js', '-m', '2']), createExpectedOptions('input.js', {
      maxIterations: 2,
    }));
  });
  it('TP-9: Max iterations long equals', () => {
    assert.deepEqual(parseArgs(['input.js', '--max-iterations=2']), createExpectedOptions('input.js', {
      maxIterations: 2,
    }));
  });
  it('TP-10: Max iterations long split', () => {
    assert.deepEqual(parseArgs(['input.js', '--max-iterations', '2']), createExpectedOptions('input.js', {
      maxIterations: 2,
    }));
  });
  it('TP-11: Sandbox selection', () => {
    assert.deepEqual(parseArgs(['input.js', '--sandbox', 'node']), createExpectedOptions('input.js', {
      sandbox: {
        provider: 'process',
        options: {
          runtime: 'node',
        },
      },
    }));
  });
  it('TP-12: Deno sandbox implies strict process isolation', () => {
    assert.deepEqual(parseArgs(['input.js', '--sandbox=deno']), createExpectedOptions('input.js', {
      sandbox: {
        provider: 'process',
        options: {
          runtime: 'deno',
          strict: true,
        },
      },
    }));
  });
  it('TP-13: Sandbox timeout option', () => {
    assert.deepEqual(
      parseArgs(['input.js', '--sandbox=node', '--sb-timeout=250']),
      createExpectedOptions('input.js', {
        sandbox: {
          provider: 'process',
          options: {
            runtime: 'node',
            timeout: 250,
          },
        },
      }),
    );
  });
  it('TP-14: Sandbox executable path override', () => {
    assert.deepEqual(parseArgs(['input.js', '--sandbox=node', '--sb-exec', '/custom/node']), createExpectedOptions('input.js', {
      sandbox: {
        provider: 'process',
        options: {
          runtime: 'node',
          executablePath: '/custom/node',
        },
      },
    }));
  });
  it('TP-15: isolated-vm sandbox memory limit option', () => {
    assert.deepEqual(parseArgs(['input.js', '--sandbox=isolated-vm', '--sb-memory-limit=64']), createExpectedOptions('input.js', {
      sandbox: {
        provider: 'isolated-vm',
        options: {
          memoryLimit: 64,
        },
      },
    }));
  });
  it('TP-16: Reject unsupported process sandbox alias', () => {
    assert.throws(() => parseArgs(['input.js', '--sandbox=process']), /Unknown sandbox "process"/);
  });
});
