# REstringer

[![Node.js CI](https://github.com/ctrl-escp/restringer/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/ctrl-escp/restringer/actions/workflows/node.js.yml)
[![Downloads](https://img.shields.io/npm/dm/restringer.svg?maxAge=43200)](https://www.npmjs.com/package/restringer)
[![npm version](https://badge.fury.io/js/restringer.svg)](https://badge.fury.io/js/restringer)

**A JavaScript deobfuscation tool that reconstructs strings and simplifies complex logic.**

REstringer automatically detects obfuscation patterns and applies targeted deobfuscation techniques to restore readable JavaScript code. It handles various obfuscation methods while respecting scope limitations and maintaining code functionality.

📧 **Contact**: For questions and suggestions, open an issue or find me on [LinkedIn - Ben Baryo](https://www.linkedin.com/in/bbaryo/)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Command-Line Usage](#command-line-usage)
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

✨ **Automatic Obfuscation Detection**: Uses [Obfuscation Detector](https://github.com/ctrl-escp/obfuscation-detector) to identify specific obfuscation types

🔧 **Modular Architecture**: 40+ deobfuscation modules organized into safe and unsafe categories

🛡️ **Pluggable Sandbox Execution**: Unsafe modules can run through provider-backed sandboxes such as `isolated-vm` or a local process runtime

🎯 **Targeted Processing**: Specialized processors for common obfuscators (obfuscator.io, Caesar Plus, etc.)

⚡ **Performance Optimized**: Match/transform patterns and performance improvements throughout

🔍 **Comprehensive Coverage**: Handles string reconstruction, dead code removal, control flow simplification, and more

---

## Installation

### Requirements
- **Node.js v22+**

For the hardened `node` sandbox backend, the selected Node executable must be **v22.20.0 or newer**.
By default, the process sandbox now inherits the same runtime and executable that launched REstringer.

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

**Basic deobfuscation** (print to stdout):
```bash
restringer obfuscated.js
```

This uses the same runtime that launched `restringer` by default.

Examples:
- `node bin/deobfuscate.js ...` -> sandbox defaults to that Node executable
- `deno run -A bin/deobfuscate.js ...` -> sandbox defaults to that Deno executable
- `bun run bin/deobfuscate.js ...` -> sandbox defaults to that Bun executable

**Save to specific file**:
```bash
restringer obfuscated.js -o clean-code.js
```

**Verbose output with iteration limit**:
```bash
restringer obfuscated.js -v -m 10 -o output.js
```

**Quiet mode** (no console output):
```bash
restringer obfuscated.js -q -o output.js
```

**Remove dead code** (potentially unsafe):
```bash
restringer obfuscated.js -c -o output.js
```

**Use the Node.js sandbox**:
```bash
restringer obfuscated.js --sandbox=node
```

**Use the Deno sandbox**:
```bash
restringer obfuscated.js --sandbox=deno
```

**Use a specific Node.js binary for the sandbox**:
```bash
restringer obfuscated.js --sandbox=node --sb-exec=/opt/node-v22/bin/node
```

**Raise the sandbox timeout**:
```bash
restringer obfuscated.js --sandbox=deno --sb-timeout=400
```

**Set an isolated-vm memory limit**:
```bash
restringer obfuscated.js --sandbox=isolated-vm --sb-memory-limit=64
```

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
  console.log('✅ Deobfuscation successful!');
  console.log(restringer.script);
  // Output: console.log('hello world');
} else {
  console.log('❌ No changes made');
}
```

#### Using the Node Sandbox
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

#### Using `isolated-vm`
Install `isolated-vm` first, then preload and select it explicitly:

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

Create targeted deobfuscators using REstringer's modular system:

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
- Use provider-backed sandbox execution for dynamic analysis
- Can resolve complex expressions and function calls
- Support `isolated-vm` and local process runtimes today
- Reserve Docker and iframe providers as extension points for later adapters

### Processing Pipeline

1. **Detection**: Identify obfuscation type using pattern recognition
2. **Preprocessing**: Apply obfuscation-specific preparations
3. **Core Deobfuscation**: Run safe and unsafe modules iteratively  
4. **Postprocessing**: Clean up and optimize the result
5. **Validation**: Ensure output correctness

### Processor Architecture

Specialized processors handle specific obfuscation patterns:
- **Match/Transform Pattern**: Separate identification and modification logic
- **Performance Optimized**: Pre-compiled patterns and efficient algorithms  
- **Configurable**: Support for custom filtering and targeting

---

## Development

### Project Structure
```
restringer/
├── src/
│   ├── modules/
│   │   ├── safe/          # Safe deobfuscation modules
│   │   ├── unsafe/        # Unsafe deobfuscation modules
│   │   └── utils/         # Utility functions
│   ├── processors/        # Obfuscation-specific processors
│   └── restringer.js      # Main REstringer class
├── tests/                 # Comprehensive test suites
└── docs/                  # Documentation
```

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

We welcome contributions! Please see our [Contributing Guide](docs/CONTRIBUTING.md) for detailed guidelines on:

- Setting up the development environment
- Code standards and best practices  
- Module and processor development
- Testing requirements
- Pull request process

---

## Resources

### Documentation
- 📖 [Processors Guide](src/processors/README.md) - Detailed processor documentation
- 🤝 [Contributing Guide](docs/CONTRIBUTING.md) - How to contribute to REstringer

### Related Projects  
- 🔍 [Obfuscation Detector](https://github.com/ctrl-escp/obfuscation-detector) - Automatic obfuscation detection
- 🌳 [flAST](https://github.com/ctrl-escp/flast) - AST manipulation utilities

### Research & Blog Posts

**The REstringer Tri(b)logy**:
- 📝 [The Far Point of a Static Encounter](https://www.humansecurity.com/tech-engineering-blog/the-far-point-of-a-static-encounter/) - Part 1: Understanding static analysis challenges
- 🔧 [Automating Skimmer Deobfuscation](https://www.humansecurity.com/tech-engineering-blog/automating-skimmer-deobfuscation/) - Part 2: Automated deobfuscation techniques  
- 🛡️ [Defeating JavaScript Obfuscation](https://www.humansecurity.com/tech-engineering-blog/defeating-javascript-obfuscation/) - Part 3: The story of REstringer

**Additional Resources**:
- 🔐 [Caesar Plus Deobfuscation](https://www.humansecurity.com/tech-engineering-blog/deobfuscating-caesar/) - Deep dive into Caesar cipher obfuscation

### Community
- 💬 [GitHub Issues](https://github.com/ctrl-escp/restringer/issues) - Bug reports and feature requests  
- 🐦 [Twitter @ctrl__esc](https://twitter.com/ctrl__esc) - Updates and discussions
---

## License

This project is licensed under the [MIT License](LICENSE).
