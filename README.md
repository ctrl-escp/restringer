# REstringer

[![Node.js CI](https://github.com/ctrl-escp/restringer/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/ctrl-escp/restringer/actions/workflows/node.js.yml)
[![Downloads](https://img.shields.io/npm/dm/restringer.svg?maxAge=43200)](https://www.npmjs.com/package/restringer)
[![npm version](https://badge.fury.io/js/restringer.svg)](https://badge.fury.io/js/restringer)

**A JavaScript deobfuscation tool that reconstructs strings and simplifies complex logic.**

REstringer automatically detects obfuscation patterns and applies targeted deobfuscation techniques to restore readable JavaScript code. It handles various obfuscation methods while respecting scope limitations and maintaining code functionality.

**Contact:** For questions and suggestions, open an issue or find me on [LinkedIn - Ben Baryo](https://www.linkedin.com/in/bbaryo/)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Command-Line Usage](#command-line-usage)
  - [Sandbox backends](#sandbox-backends)
  - [Module Usage](#module-usage)
- [Advanced Usage](#advanced-usage)
  - [Custom Deobfuscators](#custom-deobfuscators)
  - [Targeted Processing](#targeted-processing)
  - [Custom Method Integration](#custom-method-integration)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [Resources](#resources)

---

## Features

- Obfuscation detection via [Obfuscation Detector](https://github.com/ctrl-escp/obfuscation-detector)
- 40+ modules split into safe (no execution) and unsafe (sandboxed eval) passes
- Swappable sandbox backends: `isolated-vm` or subprocess evaluation under Node / Deno / Bun
- Processors for specific stacks (obfuscator.io, Caesar Plus, etc.)
- String recovery, dead-node cleanup, control-flow cleanup where patterns match
- But the major feature is the modularity that allows one to create [bespoke deobfuscators](#custom-deobfuscators)

---

## Installation

### Requirements

You can run REstringer with only Node.js (v22+). The default sandbox will be Node itself running in a spawned process.
You can manually install `[isolated-vm](https://www.npmjs.com/package/isolated-vm)` with `npm i isolated-ve` which will then be used as the default sandbox. Deno and Bun can also be used (see [Sandbox backends](#sandbox-backends)).

### Global Installation (CLI)

```bash
npm install -g restringer
```

### Local Installation (Module)

```bash
npm install restringer
```

### Optional `isolated-vm` Backend

`isolated-vm` is no longer installed by default. Install it only if you plan to run:

```bash
npm install isolated-vm
```

### Development Installation

```bash
git clone https://github.com/ctrl-escp/restringer.git
cd restringer
npm install
```

---

## Usage

### Command-Line Usage

```
Usage: restringer input_filename [-h] [-c] [-q | -v] [-m M] [-o [output_filename]]
                  [--sandbox <name>] [--sb-exec <path>] [--sb-timeout <ms>] [--sb-memory-limit <mb>]

positional arguments:
  input_filename                  The obfuscated JavaScript file

optional arguments:
  -h, --help                      Show this help message and exit
  -V, --version                   Show version number and exit
  -c, --clean                     Remove dead nodes after deobfuscation (unsafe)
  -q, --quiet                     Suppress output to stdout
  -v, --verbose                   Show debug messages during deobfuscation
  -m, --max-iterations M          Maximum deobfuscation iterations (must be > 0)
  -o, --output [filename]         Write output to file (default: <input>-deob.js)
  --sandbox <name>                Sandbox to use: isolated-vm, node, deno, or bun (default: current runtime)
  --sb-exec <path>                Path to the sandbox runtime executable
  --sb-timeout <ms>               Sandbox execution timeout in milliseconds (default: 1000)
  --sb-memory-limit <mb>          isolated-vm memory limit in MB (default: 128)
```

#### Examples

Print to stdout (default sandbox follows whatever started the CLI: same Node/Deno/Bun binary when REstringer can detect it):

```bash
restringer obfuscated.js
```

Write to a file, limit iterations, tweak verbosity:

```bash
restringer obfuscated.js -o clean-code.js
restringer obfuscated.js -v -m 10 -o output.js
restringer obfuscated.js -q -o output.js
```

`--clean` strips dead nodes afterward (can change behavior; treat as unsafe):

```bash
restringer obfuscated.js -c -o output.js
```

Sandbox flags:

```bash
restringer obfuscated.js --sandbox=node
restringer obfuscated.js --sandbox=deno
restringer obfuscated.js --sandbox=node --sb-exec=/opt/node-v22/bin/node
restringer obfuscated.js --sandbox=deno --sb-timeout=400
restringer obfuscated.js --sandbox=isolated-vm --sb-memory-limit=64
```

### Sandbox backends

Unsafe passes evaluate snippets to fold literals and builtins. There is a `process` provider (spawn Node, Deno, or Bun) and `isolated-vm`, which uses a V8 isolate via the [npm package](https://www.npmjs.com/package/isolated-vm).

If you skip `--sandbox`, REstringer aligns `process` with the host runtime (Node / Deno / Bun) and reuses the current executable path when it can. `--sandbox node` or `bun` uses that binary from `PATH` unless `--sb-exec` says otherwise. `--sandbox deno` picks Deno and sets `strict: true`; only Deno can honor that, so enabling strict evaluation on Node or Bun fails fast. The CLI never accepts `--sandbox process`; use `node`, `deno`, `bun`, or `isolated-vm`.

For `process` with Node, the evaluated binary must be at least **22.20.0** (the subprocess uses hardened Node flags). Deno and Bun only need to be installed discoverably. `isolated-vm` remains optional: `npm install isolated-vm` when you need it.

`--sb-timeout` maps to `sandbox.options.timeout` (default 1000 ms per eval), `--sb-exec` to `executablePath`, `--sb-memory-limit` to `memoryLimit` (128 MB default; isolate sizing only applies to `isolated-vm`). Strict Deno from code:

```javascript
await preloadSandboxProvider({
  provider: 'process',
  options: {runtime: 'deno', strict: true},
});
```

Importing the package loads the sandbox glue and seeds the default `process` setup, so simple scripts usually need nothing else. If you switch to `isolated-vm` or another registered provider, call `await preloadSandboxProvider({...})` before `deobfuscate()`. `registerSandboxProvider` is there for custom implementations.

Neither path looks like a full browser or unrestricted Node: snippets run after dropping `Math.random` and `Date`, and subprocess engines scrub globals such as `fetch`, `WebAssembly`, and `navigator` (`isolated-vm` has its own small blocklist too). Values coming back must serialize (no Promises, no cycles). Node workers start with `--permission` and related flags; strict Deno wraps the engine with `--deny-read`, `--deny-write`, `--deny-net`, `--deny-run`, `--deny-env`. That cuts down accidental damage during deobfuscation; it is not a guarantee against malicious code.

### Module Usage

#### Basic Example

```javascript
import {REstringer} from 'restringer';

const obfuscatedCode = `
const _0x4c2a = ['hello', 'world'];
const _0x3f1b = _0x4c2a[0] + ' ' + _0x4c2a[1];
console.log(_0x3f1b);
`;

const restringer = new REstringer(obfuscatedCode, {
  clean: false,
  detectObfuscationType: true,
  maxIterations: 500,
  normalize: true,
});

if (restringer.deobfuscate()) {
  console.log(restringer.script);
} else {
  console.log('No changes applied.');
}
```

Process-backed Node runtime:

```javascript
import {REstringer, preloadSandboxProvider} from 'restringer';

await preloadSandboxProvider({provider: 'process'});

const restringer = new REstringer(obfuscatedCode, {
  sandbox: {
    provider: 'process',
    options: {
      runtime: 'node',
    },
  },
});

restringer.deobfuscate();
```

With `isolated-vm` installed:

```javascript
import {REstringer, preloadSandboxProvider} from 'restringer';

await preloadSandboxProvider({provider: 'isolated-vm'});

const restringer = new REstringer(obfuscatedCode, {
  sandbox: {
    provider: 'isolated-vm',
  },
});

restringer.deobfuscate();
```

---

## Advanced Usage

### Custom Deobfuscators

```javascript
import {applyIteratively} from 'flast';
import {safe, unsafe} from 'restringer';

// Import specific modules
const normalizeComputed = safe.normalizeComputed.default;
const removeRedundantBlockStatements = safe.removeRedundantBlockStatements.default;
const resolveDefiniteBinaryExpressions = unsafe.resolveDefiniteBinaryExpressions.default;
const resolveLocalCalls = unsafe.resolveLocalCalls.default;

let script = 'your obfuscated code here';

// Define custom deobfuscation pipeline
const customModules = [
  resolveDefiniteBinaryExpressions,  // Resolve literal math operations
  resolveLocalCalls,                 // Inline function calls
  normalizeComputed,                 // Convert obj['prop'] to obj.prop
  removeRedundantBlockStatements,    // Clean up unnecessary blocks
];

// Apply modules iteratively
script = applyIteratively(script, customModules);
console.log(script);
```

### Targeted Processing

Use candidate filters to target specific nodes:

```javascript
import {unsafe} from 'restringer';
import {applyIteratively} from 'flast';

const {resolveLocalCalls} = unsafe;

function resolveGlobalScopeCalls(arb) {
  // Only process calls in global scope
  return resolveLocalCalls(arb, n => n.parentNode?.type === 'Program');
}

function resolveSpecificFunctions(arb) {
  // Only process calls to functions with specific names
  return resolveLocalCalls(arb, n => {
    const callee = n.callee;
    return callee.type === 'Identifier' && 
           ['decode', 'decrypt', 'transform'].includes(callee.name);
  });
}

const script = applyIteratively(code, [
  resolveGlobalScopeCalls,
  resolveSpecificFunctions
]);
```

### Custom Method Integration

Replace or customize built-in methods:

```javascript
import fs from 'node:fs';
import {REstringer} from 'restringer';

const code = fs.readFileSync('obfuscated.js', 'utf-8');
const restringer = new REstringer(code, {
  detectObfuscationType: false,
});

// Find and replace a specific method
const targetMethod = restringer.unsafeMethods.find(m => 
  m.name === 'resolveLocalCalls'
);

if (targetMethod) {
  let processedCount = 0;
  const maxProcessing = 5;
  
  // Custom implementation with limits
  const customMethod = function limitedResolveLocalCalls(arb) {
    return targetMethod(arb, () => processedCount++ < maxProcessing);
  };
  
  // Replace the method
  const index = restringer.unsafeMethods.indexOf(targetMethod);
  restringer.unsafeMethods[index] = customMethod;
}

restringer.deobfuscate();
```

---

## Architecture

### Module Categories

**Safe Modules** (`src/modules/safe/`):

- Perform transformations without code evaluation
- No risk of executing malicious code
- Examples: String normalization, syntax simplification, dead code removal

**Unsafe Modules** (`src/modules/unsafe/`):

- Use provider-backed sandbox execution for dynamic analysis (see [Sandbox backends](#sandbox-backends))
- Can resolve complex expressions and function calls
- Support `isolated-vm` and local process runtimes today
- Reserve Docker and iframe providers as extension points for later adapters

### Processing Pipeline

Detect obfuscation flavor; run preprocessors; iterate safe then unsafe modules; postprocessors; optional normalization / `--clean`.

### Processor Architecture

Processors are separate match/transform steps tuned for particular tools; see [src/processors/README.md](src/processors/README.md).

---

## Development

### Project Structure

- `src/modules/safe/` - safe transforms (no evaluation)
- `src/modules/unsafe/` - eval-backed transforms
- `src/modules/utils/` - shared helpers
- `src/processors/` - obfuscation-specific processors
- `src/restringer.js` - main class
- `tests/` - test suites
- `docs/` - contributor docs

### Running Tests

```bash
# Quick test suite (without testing against samples)
npm run test:quick

# Watch mode for development (quick tests)
npm run test:quick:watch

# Full test suite with samples
npm test
```

---

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for setup, style notes, and PR expectations.

---

## Resources

### Documentation

- [Processors Guide](src/processors/README.md)
- [Contributing Guide](docs/CONTRIBUTING.md)

### Related Projects

- [Obfuscation Detector](https://github.com/ctrl-escp/obfuscation-detector)
- [flAST](https://github.com/ctrl-escp/flast)

### Research & Blog Posts

**The REstringer Tri(b)logy**:

- [The Far Point of a Static Encounter](https://www.humansecurity.com/tech-engineering-blog/the-far-point-of-a-static-encounter/) - Part 1: Understanding static analysis challenges
- [Automating Skimmer Deobfuscation](https://www.humansecurity.com/tech-engineering-blog/automating-skimmer-deobfuscation/) - Part 2: Automated deobfuscation techniques  
- [Defeating JavaScript Obfuscation](https://www.humansecurity.com/tech-engineering-blog/defeating-javascript-obfuscation/) - Part 3: The story of REstringer

**Additional Resources**:

- [Caesar Plus Deobfuscation](https://www.humansecurity.com/tech-engineering-blog/deobfuscating-caesar/)

### Community

- [GitHub Issues](https://github.com/ctrl-escp/restringer/issues)
- [Twitter @ctrl__esc](https://twitter.com/ctrl__esc)

---

## License

This project is licensed under the [MIT License](LICENSE).