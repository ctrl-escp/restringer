import {hideBlockedApis} from '../constants.js';

// Capture IPC handles before hideBlockedApis() wipes `Deno`. After that,
// `Deno.stdout` / `Deno.stdin` are gone.
const stdoutWrite = Deno.stdout.writeSync.bind(Deno.stdout);
const textEncoder = new TextEncoder();
const stdinReadable = Deno.stdin.readable;
delete Math.random;
// `delete Date` is a SyntaxError in module strict mode. Date lives on the
// global, so delete that binding instead.
delete globalThis.Date;
hideBlockedApis();

function send(message) {
  stdoutWrite(textEncoder.encode(JSON.stringify(message) + '\n'));
}

function serialize(value, seen = new WeakSet()) {
  if (value === null) return {type: 'null'};
  const valueType = typeof value;
  switch (valueType) {
    case 'undefined':
      return {type: 'undefined'};
    case 'string':
    case 'boolean':
      return {type: valueType, value};
    case 'number':
      if (Number.isNaN(value)) return {type: 'number', special: 'NaN'};
      if (value === Infinity) return {type: 'number', special: 'Infinity'};
      if (value === -Infinity) return {type: 'number', special: '-Infinity'};
      if (Object.is(value, -0)) return {type: 'number', special: '-0'};
      return {type: 'number', value};
    case 'bigint':
      return {type: 'bigint', value: value.toString()};
    case 'symbol':
      return {type: 'symbol', value: value.description};
    case 'function':
      return {type: 'function', value: value.toString()};
    case 'object':
      if (value instanceof RegExp) return {type: 'regexp', source: value.source, flags: value.flags};
      if (value instanceof Promise) throw new Error('Unsupported sandbox value type: Promise');
      if (seen.has(value)) throw new Error('Cannot serialize circular sandbox values');
      seen.add(value);
      if (Array.isArray(value)) {
        const serializedArray = value.map(item => serialize(item, seen));
        seen.delete(value);
        return {type: 'array', value: serializedArray};
      }
      const serializedEntries = Object.entries(value).map(([key, item]) => [key, serialize(item, seen)]);
      seen.delete(value);
      return {type: 'object', value: serializedEntries};
    default:
      throw new Error('Unsupported sandbox value type: ' + valueType);
  }
}

function createRequestSource(history, code, mode) {
  const historySource = history.join('\n');
  const finalSource = mode === 'exec'
    ? code + '\nconst __restringerResult = undefined;'
    : 'const __restringerResult = eval(' + JSON.stringify(code) + ');';
  return [historySource, finalSource].join('\n');
}

function formatError(error) {
  return (error && (error.name ? error.name + ': ' : '') + (error.message || String(error))) || 'Unknown sandbox error';
}

function handleRequest(request) {
  try {
    const source = createRequestSource(request.history || [], request.code, request.mode);
    // Indirect eval: run guest+history as global script, not in this module
    // scope. See hideBlockedApis() in constants.js.
    const value = (0, eval)(source + '\n__restringerResult;');
    send({type: 'response', requestId: request.requestId, ok: true, value: serialize(value)});
  } catch (error) {
    send({
      type: 'response',
      requestId: request.requestId,
      ok: false,
      message: formatError(error),
    });
  }
}

async function main() {
  send({type: 'ready'});
  const reader = stdinReadable
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let buffer = '';
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += value;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) handleRequest(JSON.parse(line));
      newlineIndex = buffer.indexOf('\n');
    }
  }
}

main();
