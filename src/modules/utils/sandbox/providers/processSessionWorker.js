import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {parentPort, workerData} from 'node:worker_threads';

const READY_TYPE = 'ready';
const RESPONSE_TYPE = 'response';

function createNodeLikeBootstrap() {
  return `
const readline = require('node:readline');
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
function serialize(value, seen = new WeakSet()) {
  if (value === null) return { type: 'null' };
  const valueType = typeof value;
  switch (valueType) {
    case 'undefined': return { type: 'undefined' };
    case 'string':
    case 'boolean': return { type: valueType, value };
    case 'number':
      if (Number.isNaN(value)) return { type: 'number', special: 'NaN' };
      if (value === Infinity) return { type: 'number', special: 'Infinity' };
      if (value === -Infinity) return { type: 'number', special: '-Infinity' };
      if (Object.is(value, -0)) return { type: 'number', special: '-0' };
      return { type: 'number', value };
    case 'bigint': return { type: 'bigint', value: value.toString() };
    case 'symbol': return { type: 'symbol', value: value.description };
    case 'function': return { type: 'function', value: value.toString() };
    case 'object':
      if (value instanceof RegExp) return { type: 'regexp', source: value.source, flags: value.flags };
      if (value instanceof Promise) throw new Error('Unsupported sandbox value type: Promise');
      if (seen.has(value)) throw new Error('Cannot serialize circular sandbox values');
      seen.add(value);
      if (Array.isArray(value)) {
        const serializedArray = value.map(item => serialize(item, seen));
        seen.delete(value);
        return { type: 'array', value: serializedArray };
      }
      const serializedEntries = Object.entries(value).map(([key, item]) => [key, serialize(item, seen)]);
      seen.delete(value);
      return { type: 'object', value: serializedEntries };
    default:
      throw new Error('Unsupported sandbox value type: ' + valueType);
  }
}
function createRequestSource(history, code, mode) {
  const historySource = history.join('\\n');
  const finalSource = mode === 'exec'
    ? code + '\\nconst __restringerResult = undefined;'
    : 'const __restringerResult = eval(' + JSON.stringify(code) + ');';
  return [
    'delete Math.random;',
    'delete Date;',
    'globalThis.fetch = undefined;',
    'globalThis.XMLHttpRequest = undefined;',
    'globalThis.WebSocket = undefined;',
    'globalThis.WebAssembly = undefined;',
    'globalThis.navigator = undefined;',
    'globalThis.Navigator = undefined;',
    historySource,
    finalSource,
  ].join('\\n');
}
function handleRequest(request) {
  try {
    const source = createRequestSource(request.history || [], request.code, request.mode);
    const value = (0, eval)(source + '\\n__restringerResult;');
    send({ type: 'response', requestId: request.requestId, ok: true, value: serialize(value) });
  } catch (error) {
    send({
      type: 'response',
      requestId: request.requestId,
      ok: false,
      message: (error && (error.name ? error.name + ': ' : '') + (error.message || String(error))) || 'Unknown sandbox error'
    });
  }
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line) return;
  handleRequest(JSON.parse(line));
});
send({ type: 'ready' });
`;
}

const DENO_ENGINE_PATH = fileURLToPath(new URL('./sandboxEngineDeno.js', import.meta.url));

function getRuntimeCommand(runtime, strict, executablePath) {
  switch (runtime) {
    case 'node':
      return {
        command: executablePath || 'node',
        args: [
          '--no-warnings',
          '--permission',
          '--disable-proto=throw',
          '--disable-sigusr1',
          '--eval',
          createNodeLikeBootstrap(),
        ],
      };
    case 'bun':
      return {
        command: executablePath || 'bun',
        args: ['--eval', createNodeLikeBootstrap()],
      };
    case 'deno':
      return {
        command: executablePath || 'deno',
        args: [
          'run',
          ...(strict ? ['--deny-read', '--deny-write', '--deny-net', '--deny-run', '--deny-env'] : []),
          DENO_ENGINE_PATH,
        ],
      };
    default:
      throw new Error(`Unsupported process sandbox runtime "${runtime}"`);
  }
}

const {runtime, executablePath, strict, timeout, readyBuffer, startupErrorFile} = workerData;
const readySignal = new Int32Array(readyBuffer);
let child;
let childStdout;
let childStderrBuffer = '';
let ready = false;
let currentRequest = null;
const requestHistory = [];
let timeoutId = null;
let pendingReadyError = null;

function notify(signalBuffer) {
  const signal = new Int32Array(signalBuffer);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

function notifyReady(value) {
  Atomics.store(readySignal, 0, value);
  Atomics.notify(readySignal, 0);
}

function writeStartupError(message) {
  if (!startupErrorFile) return;
  try {
    writeFileSync(startupErrorFile, String(message), 'utf-8');
  } catch {}
}

function respond(request, response) {
  try {
    writeFileSync(request.responseFile, JSON.stringify(response), 'utf-8');
  } finally {
    notify(request.signalBuffer);
  }
}

function clearCurrentTimeout() {
  if (!timeoutId) return;
  clearTimeout(timeoutId);
  timeoutId = null;
}

function failCurrentRequest(message) {
  if (!currentRequest) return;
  const failedRequest = currentRequest;
  currentRequest = null;
  clearCurrentTimeout();
  respond(failedRequest, {ok: false, message});
}

function resetRuntime(message) {
  failCurrentRequest(message);
  ready = false;

  if (child) {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

function startRuntime() {
  const {command, args} = getRuntimeCommand(runtime, strict, executablePath);
  const childProcess = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  childProcess.unref();
  child = childProcess;
  childStdout = createInterface({input: childProcess.stdout});
  childStderrBuffer = '';

  childProcess.stderr?.setEncoding('utf8');
  childProcess.stderr?.on('data', chunk => {
    childStderrBuffer += chunk;
  });

  childStdout.on('line', line => {
    if (!line) return;

    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload.type === READY_TYPE) {
      ready = true;
      notifyReady(1);
      return;
    }

    if (payload.type !== RESPONSE_TYPE || !currentRequest || payload.requestId !== currentRequest.requestId) {
      return;
    }

    const completedRequest = currentRequest;
    currentRequest = null;
    clearCurrentTimeout();

    if (payload.ok) {
      if (completedRequest.mode === 'exec' || completedRequest.mode === 'run') {
        requestHistory.push(completedRequest.code);
      }
      respond(completedRequest, {ok: true, value: payload.value});
    } else {
      respond(completedRequest, {ok: false, message: payload.message || 'Unknown sandbox error'});
    }
  });

  childProcess.once('error', error => {
    if (child !== childProcess) return;
    pendingReadyError = `Unable to execute sandbox runtime "${runtime}" at "${command}": ${error.message}`;
    writeStartupError(pendingReadyError);
    if (!ready) notifyReady(-1);
    resetRuntime(pendingReadyError);
  });

  childProcess.once('exit', (code, signal) => {
    if (child !== childProcess) return;
    const stderr = childStderrBuffer.trim();
    const exitMessage = pendingReadyError ||
      `Sandbox runtime "${runtime}" exited unexpectedly (${signal || code || 'unknown'})${stderr ? `: ${stderr}` : ''}`;
    writeStartupError(exitMessage);
    pendingReadyError = null;
    if (!ready) notifyReady(-1);
    resetRuntime(exitMessage);
  });
}

function queueRequest(request) {
  if (!ready) {
    respond(request, {
      ok: false,
      message: pendingReadyError || `Sandbox runtime "${runtime}" is not ready`,
    });
    return;
  }

  if (currentRequest) {
    respond(request, {
      ok: false,
      message: 'Process sandbox only supports one request at a time',
    });
    return;
  }

  currentRequest = request;
  clearCurrentTimeout();
  timeoutId = setTimeout(() => {
    resetRuntime(`Process sandbox runtime "${runtime}" timed out`);
    startRuntime();
  }, timeout);

  child.stdin.write(`${JSON.stringify({
    requestId: request.requestId,
    history: requestHistory,
    code: request.code,
    mode: request.mode,
  })}\n`);
}

startRuntime();

parentPort.on('message', message => {
  if (message.type === 'close') {
    clearCurrentTimeout();
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
    process.exit(0);
  }

  if (message.type === 'request') {
    queueRequest(message);
  }
});
