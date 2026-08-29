/**
 * Sandbox host-hiding and BOM stubbing.
 *
 * Goal: guest code cannot see Node/Deno/Bun, cannot use real browser I/O, and
 * cannot fold environment checks to whatever this sandbox happens to contain.
 * Language builtins, `eval` / `Function`, `atob` / `btoa`, `TextEncoder` /
 * `TextDecoder`, `URL`, typed arrays, WebCrypto (`crypto`), and `console`
 * stay available. `self` is left alone so packers that resolve the global
 * through it still work.
 *
 * Why not just `delete` every name?
 *   `'x' in this` is false after delete. Scripts like evalOxd do
 *   `if (!('navigator' in this)) return` and that `if` folds away, so the
 *   deobfuscated output no longer matches the original control flow.
 *
 * Why not `globalThis.x = undefined`?
 *   `'x' in this` becomes true (own property). Fine for hiding Node (`typeof
 *   process === 'undefined'`). Bad for BOM: `navigator` is then not an object,
 *   and feature tests that expect `typeof navigator === 'object'` fold wrong.
 *
 * Why not filled stubs (`location.hash = ''`, `sendBeacon = () => false`)?
 *   Those values leak into deobfuscation. `window.location.hash` becomes `''`,
 *   `href.indexOf(...)` becomes `false`, `e()` becomes `true`, and `if (e())
 *   return` collapses to a bare `return`.
 *
 * Why throwing Proxies?
 *   BOM names stay objects (`typeof navigator === 'object'`, `'navigator' in
 *   this` is true) but `get` / `has` throw. The check cannot be constant-folded
 *   because evaluation fails. One shared proxy prototype plus `Object.create`
 *   is enough - a new Proxy per name is wasted isolate compile time.
 *
 * Wipe vs stub split:
 *   Node / Deno / Bun names are wiped to `undefined`. BOM names are reinstalled
 *   as inert stubs after the wipe. `crypto` and `console` are omitted from the
 *   Node core-module wipe so WebCrypto and logging survive.
 *
 * Two source strings, one policy:
 *   Process runtimes (Node `--eval`, Bun, Deno) have host objects, so they run
 *   `PROCESS_HARDENING_SOURCE` (full wipe + BOM). isolated-vm has no Node
 *   builtins; assigning those names creates dummy own properties and extra
 *   compile work, so `ISOLATE_HARDENING_SOURCE` only hides `WebAssembly` and
 *   installs BOM stubs.
 *
 * When it runs:
 *   Once per session start, never per eval. Per-eval wipe doubled test time.
 *
 * `globalThis` is wiped last: the wipe/stub IIFE itself addresses the global
 * through `globalThis`.
 */

const NODE_IDENTITY_GLOBALS = [
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'global',
  'setImmediate',
  'clearImmediate',
];

// Top-level `node:module` builtin names. Omit `crypto` and `console` so
// WebCrypto and logging stay available. Slash paths are not global bindings.
const NODE_CORE_MODULE_GLOBALS = [
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_stream_duplex',
  '_stream_passthrough',
  '_stream_readable',
  '_stream_transform',
  '_stream_wrap',
  '_stream_writable',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'constants',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'net',
  'os',
  'path',
  'perf_hooks',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'sqlite',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
];

const DENO_IDENTITY_GLOBALS = [
  'Deno',
];

const BUN_IDENTITY_GLOBALS = [
  'Bun',
  'ffi',
  'jsc',
  'HTMLRewriter',
];

const DISABLED_RUNTIME_GLOBALS = [
  'debugger',
  'WebAssembly',
];

const BOM_INSTANCE_NAMES = [
  'window',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'performance',
  'caches',
];

const BOM_CTOR_NAMES = [
  'Window',
  'Navigator',
  'Location',
  'History',
  'Storage',
  'Performance',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'FileReader',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'WebTransport',
  'Cache',
  'CacheStorage',
];

export const BLOCKED_API_NAMES = [
  ...new Set([
    ...NODE_IDENTITY_GLOBALS,
    ...NODE_CORE_MODULE_GLOBALS,
    ...DENO_IDENTITY_GLOBALS,
    ...BUN_IDENTITY_GLOBALS,
    ...DISABLED_RUNTIME_GLOBALS,
    'globalThis',
  ]),
];

export const BLOCKED_APIS = Object.fromEntries(BLOCKED_API_NAMES.map(name => [name, undefined]));

/**
 * Guest source that hides host bindings.
 *
 * Delete first so configurable names disappear. Then assign `undefined` so
 * names that survive delete (non-configurable getters, CJS free vars like
 * `process` on Node `--eval`) still have `typeof x === 'undefined'`. Both
 * steps are try/catch: some bindings throw on delete or assign.
 *
 * @param {string[]} names
 * @return {string}
 */
function createHostWipeSource(names) {
  return `var __restringerWipe = ${JSON.stringify(names)};
  for (var __restringerI = 0; __restringerI < __restringerWipe.length; __restringerI++) {
    var __restringerName = __restringerWipe[__restringerI];
    try { delete globalThis[__restringerName]; } catch (e) {}
    try { globalThis[__restringerName] = undefined; } catch (e) {}
  }`;
}

/**
 * Guest source that installs inert BOM objects.
 *
 * Proxy traps (the whole point of the stub):
 *   get  - `toString` / `valueOf` / `@@toStringTag` keep `typeof` / string
 *          coercion looking like a normal object. Every other read throws so
 *          `location.hash` cannot fold to `''`.
 *   has  - throws so `'sendBeacon' in navigator` cannot fold to true/false.
 *   set  - no-op success, so `navigator.foo = 1` does not become a second
 *          reason an eval fails.
 *
 * `replaceHostBindings`:
 *   Process hosts (Node) expose `navigator` as an accessor. Assignment is
 *   ignored until the getter is deleted and `defineProperty` replaces it.
 *   isolated-vm has no such accessors, so a plain assignment is enough and
 *   cheaper when every `new Sandbox()` compiles this script.
 *
 * `enumerable: false` keeps `for (k in globalThis)` from picking up stubs.
 *
 * @param {{replaceHostBindings?: boolean}} [options]
 * @return {string}
 */
function createBomStubsSource({replaceHostBindings = true} = {}) {
  const defineBinding = replaceHostBindings
    ? `function __restringerDef(name, value) {
    try { delete globalThis[name]; } catch (e) {}
    try {
      Object.defineProperty(globalThis, name, {value: value, writable: true, configurable: true, enumerable: false});
    } catch (e) {
      try { globalThis[name] = value; } catch (e2) {}
    }
  }`
    : 'function __restringerDef(name, value) { globalThis[name] = value; }';
  return `var __restringerBomProto = new Proxy({}, {
    get: function (target, prop) {
      if (prop === Symbol.toStringTag) return 'Object';
      if (prop === 'toString') return function () { return '[object Object]'; };
      if (prop === 'valueOf') return function () { return this; };
      throw new TypeError('BOM is disabled');
    },
    has: function () { throw new TypeError('BOM is disabled'); },
    set: function () { return true; }
  });
  ${defineBinding}
  function __restringerBom() { return Object.create(__restringerBomProto); }
  function __restringerBomCtor() { return __restringerBom(); }
  var __restringerBomNames = ${JSON.stringify(BOM_INSTANCE_NAMES)};
  var __restringerBomCtors = ${JSON.stringify(BOM_CTOR_NAMES)};
  for (var __restringerJ = 0; __restringerJ < __restringerBomNames.length; __restringerJ++) {
    __restringerDef(__restringerBomNames[__restringerJ], __restringerBom());
  }
  for (var __restringerK = 0; __restringerK < __restringerBomCtors.length; __restringerK++) {
    __restringerDef(__restringerBomCtors[__restringerK], __restringerBomCtor);
  }
  __restringerDef('fetch', function () { throw new TypeError('Failed to fetch'); });
  __restringerDef('requestAnimationFrame', function () { throw new TypeError('requestAnimationFrame is disabled'); });
  __restringerDef('cancelAnimationFrame', function () {});
  __restringerDef('requestIdleCallback', function () { throw new TypeError('requestIdleCallback is disabled'); });
  __restringerDef('cancelIdleCallback', function () {});
  __restringerDef('importScripts', function () {});
  __restringerDef('postMessage', function () {});
  __restringerDef('alert', function () {});
  __restringerDef('confirm', function () { throw new TypeError('confirm is disabled'); });
  __restringerDef('prompt', function () { throw new TypeError('prompt is disabled'); });
  __restringerDef('close', function () {});
  __restringerDef('closed', false);
  __restringerDef('createImageBitmap', function () { throw new TypeError('createImageBitmap is disabled'); });`;
}

/**
 * Wraps wipe/stub body in an IIFE so helper names (`__restringerDef`, …) do
 * not leak into the guest global, then hides `globalThis` itself. That last
 * step must come after the body: the body addresses the global through
 * `globalThis`.
 *
 * @param {string} body
 * @return {string}
 */
function wrapHardeningSource(body) {
  return `(function () {
  ${body}
  try { delete globalThis.globalThis; } catch (e) {}
  try { globalThis.globalThis = undefined; } catch (e) {}
})();`;
}

const HOST_WIPE_NAMES = BLOCKED_API_NAMES.filter(name => name !== 'globalThis');

export const PROCESS_HARDENING_SOURCE = wrapHardeningSource(
  createHostWipeSource(HOST_WIPE_NAMES) + '\n  ' + createBomStubsSource(),
);

// isolated-vm has no Node/Deno host objects. Skip that wipe so each session
// does not compile or attach dozens of dummy globals.
export const ISOLATE_HARDENING_SOURCE = wrapHardeningSource(
  'try { delete globalThis.WebAssembly; } catch (e) {}\n' +
  '  try { globalThis.WebAssembly = undefined; } catch (e) {}\n  ' +
  createBomStubsSource({replaceHostBindings: false}),
);

/**
 * Run process hardening in the current realm (Deno session engine).
 *
 * `(0, eval)(src)` is an *indirect* eval. A call is a direct eval only when
 * the callee is the identifier `eval`. Direct eval runs in this module's
 * lexical scope (it can see `stdoutWrite`, `stdinReadable`, … and marks that
 * scope as dynamic). The comma expression evaluates `0`, then `eval`, and
 * calls the resulting function - not the identifier - so the engine treats it
 * as global script code. Same effect as `const run = eval; run(src)` or
 * `globalThis.eval(src)`.
 *
 * Node/Bun cannot call this: they interpolate `createBlockedApisSource()`
 * into a `--eval` string. Both paths execute the same
 * `PROCESS_HARDENING_SOURCE` text.
 *
 * @return {void}
 */
export function hideBlockedApis() {
  (0, eval)(PROCESS_HARDENING_SOURCE);
}

/**
 * Process-runtime guest source (Node `--eval`, Bun `--eval`). Same string
 * `hideBlockedApis` evals in Deno.
 *
 * @return {string}
 */
export function createBlockedApisSource() {
  return PROCESS_HARDENING_SOURCE;
}

export const DEFAULT_MEMORY_LIMIT = 128;
export const DEFAULT_TIMEOUT = 1000;
