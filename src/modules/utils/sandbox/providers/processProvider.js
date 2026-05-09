import {mkdtempSync, readFileSync, rmSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {DEFAULT_TIMEOUT} from '../constants.js';

const PROCESS_RUNTIME_ALIASES = new Set(['node', 'deno', 'bun']);
const MIN_NODE_SANDBOX_VERSION = '22.20.0';
let sessionId = 0;

/**
 * @param {Object} value - Serialized runtime value
 * @return {*} Deserialized runtime value
 */
function deserializeRuntimeValue(value) {
  switch (value?.type) {
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'string':
    case 'boolean':
      return value.value;
    case 'number':
      if (value.special === 'NaN') return NaN;
      if (value.special === 'Infinity') return Infinity;
      if (value.special === '-Infinity') return -Infinity;
      if (value.special === '-0') return -0;
      return value.value;
    case 'bigint':
      return BigInt(value.value);
    case 'symbol':
      return value.value === undefined ? Symbol() : Symbol(value.value);
    case 'function':
      return {
        [Symbol.toStringTag]: 'Function',
        toString() {
          return value.value;
        },
      };
    case 'regexp':
      return new RegExp(value.source, value.flags);
    case 'array':
      return value.value.map(deserializeRuntimeValue);
    case 'object':
      return Object.fromEntries(value.value.map(([key, item]) => [key, deserializeRuntimeValue(item)]));
    default:
      throw new Error(`Unsupported serialized sandbox value: ${value?.type}`);
  }
}

/**
 * @param {string} runtime - Runtime name
 * @return {boolean} Whether the runtime can enforce strict isolation flags
 */
function isStrictCapableRuntime(runtime) {
  return runtime === 'deno';
}

/**
 * @param {string} runtime - Runtime name
 * @param {Object} options - Session options
 * @return {{runtime: string, executablePath: string, strict: boolean, timeout: number}} Normalized session settings
 */
function normalizeSessionOptions(runtime, options) {
  const normalizedRuntime = String(runtime || 'node').toLowerCase();
  if (!PROCESS_RUNTIME_ALIASES.has(normalizedRuntime)) {
    throw new Error(`Unsupported process sandbox runtime "${normalizedRuntime}"`);
  }

  const strictCapable = isStrictCapableRuntime(normalizedRuntime);
  const strictInput = options.strict ?? options.strictIsolation;
  const strict = strictInput === undefined ? strictCapable : strictInput === true || strictInput === 'true';
  const timeout = Number(options.timeout ?? DEFAULT_TIMEOUT);

  if (strict && !strictCapable) {
    throw new Error(`Sandbox runtime "${normalizedRuntime}" cannot enforce strict isolation. Use deno or disable strict mode.`);
  }

  return {
    runtime: normalizedRuntime,
    executablePath: options.executablePath ? String(options.executablePath) : normalizedRuntime,
    strict,
    timeout,
  };
}

/**
 * @param {string} runtime - Runtime name
 * @return {string[]} Version command arguments
 */
function getRuntimeVersionArgs(runtime) {
  if (runtime === 'deno') return ['--version'];
  if (runtime === 'bun') return ['--version'];
  return ['--version'];
}

/**
 * @param {string} version - Runtime version string
 * @return {{major: number, minor: number, patch: number}|null} Parsed version
 */
function parseSemver(version) {
  const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * @param {{major: number, minor: number, patch: number}} left - Parsed version
 * @param {{major: number, minor: number, patch: number}} right - Parsed version
 * @return {number} Comparison result
 */
function compareSemver(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

/**
 * @param {string} version - Node.js version string
 * @return {boolean} Whether the version supports the hardened node sandbox flags
 */
function isSupportedNodeSandboxVersion(version) {
  const parsedVersion = parseSemver(version);
  const minVersion = parseSemver(MIN_NODE_SANDBOX_VERSION);
  if (!parsedVersion || !minVersion) return false;
  return compareSemver(parsedVersion, minVersion) >= 0;
}

/**
 * @param {Object} [options={}] - Provider options
 * @return {{runtime: string, executablePath: string, strict: boolean, timeout: number}} Verified settings
 */
function assertProcessRuntimeAvailable(options = {}) {
  const runtimeOption = String(options.runtime || 'node').toLowerCase();
  const settings = normalizeSessionOptions(runtimeOption, options);
  const probe = spawnSync(settings.executablePath, getRuntimeVersionArgs(settings.runtime), {
    encoding: 'utf-8',
    timeout: settings.timeout,
  });

  if (probe.error) {
    throw new Error(`Sandbox runtime "${settings.runtime}" is not available at "${settings.executablePath}": ${probe.error.message}`);
  }

  if (probe.status !== 0) {
    const stderr = probe.stderr?.trim();
    throw new Error(`Sandbox runtime "${settings.runtime}" is unavailable at "${settings.executablePath}"${stderr ? `: ${stderr}` : ''}`);
  }

  if (settings.runtime === 'node') {
    const versionOutput = `${probe.stdout || ''}\n${probe.stderr || ''}`.trim();
    const versionLine = versionOutput.split('\n').find(Boolean) || '';
    if (!isSupportedNodeSandboxVersion(versionLine)) {
      throw new Error(`Sandbox runtime "node" at "${settings.executablePath}" must be Node.js ${MIN_NODE_SANDBOX_VERSION} or newer for the hardened sandbox flags. Found: ${versionLine || 'unknown version'}`);
    }
  }

  return settings;
}

class ProcessSandboxSession {
  /**
   * @param {{runtime: string, executablePath: string, strict: boolean, timeout: number}} settings - Session settings
   */
  constructor(settings) {
    this.id = ++sessionId;
    this.settings = settings;
    this.tempDir = mkdtempSync(join(tmpdir(), 'restringer-process-sandbox-'));
    this.startupErrorFile = join(this.tempDir, 'startup-error.txt');
    this.requestId = 0;
    this.closed = false;
    const readyBuffer = new SharedArrayBuffer(4);
    this.readySignal = new Int32Array(readyBuffer);
    this.worker = new Worker(new URL('./processSessionWorker.js', import.meta.url), {
      type: 'module',
      workerData: {
        ...settings,
        readyBuffer,
        startupErrorFile: this.startupErrorFile,
      },
    });
    this.worker.unref();

    const readyResult = Atomics.wait(this.readySignal, 0, 0, this.settings.timeout + 250);
    if (readyResult === 'timed-out' || Atomics.load(this.readySignal, 0) !== 1) {
      let startupError = '';
      try {
        startupError = readFileSync(this.startupErrorFile, 'utf-8').trim();
      } catch {}
      this.close();
      throw new Error(`Unable to initialize sandbox runtime "${this.settings.runtime}"${startupError ? `: ${startupError}` : ''}`);
    }
  }

  /**
   * @param {'run'|'exec'} mode - Request mode
   * @param {string} code - Source code to execute
   * @return {*} Request result
   */
  request(mode, code) {
    if (this.closed) {
      throw new Error('Process sandbox session is closed');
    }

    const requestId = ++this.requestId;
    const signalBuffer = new SharedArrayBuffer(4);
    const signal = new Int32Array(signalBuffer);
    const responseFile = join(this.tempDir, `${requestId}.json`);

    this.worker.postMessage({
      type: 'request',
      requestId,
      mode,
      code,
      responseFile,
      signalBuffer,
    });

    const waitResult = Atomics.wait(signal, 0, 0, this.settings.timeout + 250);
    if (waitResult === 'timed-out') {
      throw new Error(`Process sandbox runtime "${this.settings.runtime}" timed out`);
    }

    let response;
    try {
      response = JSON.parse(readFileSync(responseFile, 'utf-8'));
    } finally {
      try {
        unlinkSync(responseFile);
      } catch {}
    }

    if (!response.ok) {
      throw new Error(response.message);
    }

    return mode === 'run' ? deserializeRuntimeValue(response.value) : undefined;
  }

  /**
   * @param {string} code - Source code to evaluate
   * @return {*} Evaluated value
   */
  run(code) {
    return this.request('run', code);
  }

  /**
   * @param {string} code - Source code to execute
   * @return {void}
   */
  exec(code) {
    this.request('exec', code);
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    try {
      this.worker.postMessage({type: 'close'});
    } catch {}

    try {
      this.worker.terminate();
    } catch {}

    try {
      rmSync(this.tempDir, {recursive: true, force: true});
    } catch {}
  }
}

export async function createPersistentProcessProvider() {
  return {
    name: 'process',
    capabilities: {
      reusableContext: true,
      strictIsolation: false,
      dockerReady: true,
      iframeReady: true,
    },
    assertAvailable(options = {}) {
      assertProcessRuntimeAvailable(options);
    },
    createSession(options = {}) {
      const settings = assertProcessRuntimeAvailable(options);
      const session = new ProcessSandboxSession(settings);

      return {
        providerName: 'process',
        capabilities: {
          reusableContext: true,
          strictIsolation: settings.strict,
        },
        run(code) {
          return session.run(code);
        },
        exec(code) {
          session.exec(code);
        },
        close() {
          session.close();
        },
      };
    },
  };
}

/**
 * @return {Promise<Object>} Process-backed sandbox provider
 */
export async function createProcessProvider() {
  return createPersistentProcessProvider();
}

export {assertProcessRuntimeAvailable, deserializeRuntimeValue, isSupportedNodeSandboxVersion, MIN_NODE_SANDBOX_VERSION};
