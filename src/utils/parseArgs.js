import {Command} from 'commander';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DEFAULT_MEMORY_LIMIT, DEFAULT_TIMEOUT} from '../modules/utils/sandbox/constants.js';
import {createHostRuntimeSandboxConfig} from '../modules/utils/sandbox/runtime.js';

const PACKAGE_VERSION = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8')).version;

/**
 * Pre-processes arguments to handle short option `=` syntax that Commander.js doesn't support.
 * Commander.js supports `--long-option=value` but not `-o=value`, so we only need to handle short options.
 *
 * @param {string[]} args - Original command line arguments
 * @return {string[]} Processed arguments compatible with Commander.js
 */
function preprocessShortOptionsWithEquals(args) {
  const processed = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle short options with = syntax: -o=value, -m=value
    if (arg.startsWith('-') && !arg.startsWith('--') && arg.includes('=')) {
      const equalIndex = arg.indexOf('=');
      const flag = arg.substring(0, equalIndex);
      const value = arg.substring(equalIndex + 1);
      processed.push(flag, value);
    }
    // All other arguments pass through unchanged (including --long=value which Commander.js handles)
    else processed.push(arg);
  }

  return processed;
}

/**
 * @param {string} value - CLI sandbox shorthand
 * @return {{provider: string, options: Object}} Normalized sandbox configuration
 */
function parseSandboxSelection(value) {
  const selection = String(value || '').toLowerCase();

  switch (selection) {
    case 'isolated-vm':
      return {provider: 'isolated-vm', options: {}};
    case 'node':
    case 'bun':
      return {
        provider: 'process',
        options: {
          runtime: selection,
        },
      };
    case 'deno':
      return {
        provider: 'process',
        options: {
          runtime: 'deno',
          strict: true,
        },
      };
    default:
      throw new Error(`Unknown sandbox "${value}". Use isolated-vm, node, deno, or bun.`);
  }
}

/**
 * @param {string} value - CLI numeric option value
 * @param {string} optionName - Option label for errors
 * @return {number} Parsed positive number
 */
function parsePositiveNumber(value, optionName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive number`);
  }
  return parsed;
}

/**
 * @return {Command} Configured Commander program
 */
function createProgram() {
  const program = new Command();

  program
    .name('restringer')
    .version(PACKAGE_VERSION, '-V, --version', 'Show version number and exit')
    .description('REstringer - a JavaScript deobfuscator')
    .allowUnknownOption(false)
    .exitOverride()
    .argument('[input_filename]', 'The obfuscated JS file')
    .option('-c, --clean', 'Remove dead nodes from script after deobfuscation is complete (unsafe)')
    .option('-q, --quiet', 'Suppress output to stdout. Output result only to stdout if the -o option is not set')
    .option('-v, --verbose', 'Show more debug messages while deobfuscating')
    .option('-o, --output [filename]', 'Write deobfuscated script to output_filename. <input_filename>-deob.js is used if no filename is provided')
    .option('--sandbox <name>', 'Sandbox to use (default: current runtime; available: isolated-vm, node, deno, or bun)')
    .option('--sb-exec <path>', 'Path to the sandbox runtime executable')
    .option('--sb-timeout <ms>', `Sandbox execution timeout in milliseconds (default: ${DEFAULT_TIMEOUT})`, (value) => parsePositiveNumber(value, 'sb-timeout'))
    .option('--sb-memory-limit <mb>', `isolated-vm memory limit in MB (default: ${DEFAULT_MEMORY_LIMIT})`, (value) => parsePositiveNumber(value, 'sb-memory-limit'))
    .option('-m, --max-iterations <number>', 'Run at most M iterations', (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error('max-iterations must be a positive number');
      }
      return parsed;
    });

  program.hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if (options.verbose && options.quiet) {
      throw new Error('Don\'t set both -q and -v at the same time *smh*');
    }
  });

  return program;
}

/**
 * @return {string} CLI help text
 */
export function getHelpText() {
  return createProgram().helpInformation();
}

/**
 * Parses command line arguments into a structured options object using Commander.js.
 *
 * @param {string[]} args - Array of command line arguments (typically process.argv.slice(2))
 * @return {Object} Parsed options object with the following structure:
 * @return {string} return.inputFilename - Path to input JavaScript file
 * @return {boolean} return.help - Whether help was requested
 * @return {boolean} return.clean - Whether to remove dead nodes after deobfuscation
 * @return {boolean} return.quiet - Whether to suppress output to stdout
 * @return {boolean} return.verbose - Whether to show debug messages
 * @return {boolean} return.outputToFile - Whether output should be written to file
 * @return {number|boolean|null} return.maxIterations - Maximum iterations (number > 0), false if not set, or null if flag present with invalid value
 * @return {string} return.outputFilename - Output filename (auto-generated or user-specified)
 * @return {Object} return.sandbox - Sandbox selection and sandbox-specific options
 */
export function parseArgs(args) {
  // Input validation - handle edge cases gracefully
  if (!args || !Array.isArray(args)) {
    return createDefaultOptions('');
  }

  try {
    // Pre-process to handle short option `=` syntax (e.g., -o=file.js, -m=2)
    const processedArgs = preprocessShortOptionsWithEquals(args);
    const program = createProgram();

    // Check if help is requested first, then parse without help to get all options
    const hasHelp = processedArgs.includes('-h') || processedArgs.includes('--help');

    // If help is requested, parse without the help flag to get all other options
    let argsToProcess = processedArgs;
    if (hasHelp) {
      argsToProcess = processedArgs.filter(arg => arg !== '-h' && arg !== '--help');
    }

    // Parse arguments and handle potential errors
    try {
      program.parse(argsToProcess, {from: 'user'});
    } catch (error) {
      // Handle parsing errors (like invalid max-iterations value)
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        // Help or version was displayed, return with help flag set
        return {...createDefaultOptions(''), help: true};
      }
      // For other errors (like invalid numeric values), set the matching option to null
      const opts = createDefaultOptions('');
      if (error.message.includes('max-iterations')) {
        opts.maxIterations = null;
      }
      if (error.message.includes('sb-timeout')) {
        opts.sandbox.options.timeout = null;
      }
      if (error.message.includes('sb-memory-limit')) {
        opts.sandbox.options.memoryLimit = null;
      }
      return opts;
    }

    const options = program.opts();
    const inputFilename = program.args[0] || '';

    // Create the return object matching the original API
    const opts = createDefaultOptions(inputFilename);

    // Map Commander.js options to our expected format
    opts.help = hasHelp;
    opts.clean = !!options.clean;
    opts.quiet = !!options.quiet;
    opts.verbose = !!options.verbose;

    // Handle output option
    if (options.output !== undefined) {
      opts.outputToFile = true;
      if (typeof options.output === 'string' && options.output.length > 0) {
        opts.outputFilename = options.output;
      }
    }

    // Handle max-iterations option
    if (options.maxIterations !== undefined) {
      opts.maxIterations = options.maxIterations;
    }

    if (options.sandbox !== undefined) {
      opts.sandbox = parseSandboxSelection(options.sandbox);
    }

    if (options.sbExec !== undefined) {
      opts.sandbox.options = {
        ...opts.sandbox.options,
        executablePath: options.sbExec,
      };
    }

    if (options.sbTimeout !== undefined) {
      opts.sandbox.options = {
        ...opts.sandbox.options,
        timeout: options.sbTimeout,
      };
    }

    if (options.sbMemoryLimit !== undefined) {
      opts.sandbox.options = {
        ...opts.sandbox.options,
        memoryLimit: options.sbMemoryLimit,
      };
    }

    // Validate required input filename (unless help is requested)
    if (!hasHelp && (!opts.inputFilename || opts.inputFilename.length === 0)) {
      throw new Error('missing required argument \'input_filename\'');
    }

    return opts;
  } catch (error) {
    if (error.message.includes('Unknown sandbox')) {
      throw error;
    }

    // Provide meaningful error context instead of silent failure
    console.warn(`Warning: Error parsing arguments, using defaults. Error: ${error.message}`);
    return createDefaultOptions('');
  }
}

/**
 * Creates a default options object with safe fallback values.
 * This helper ensures consistent default behavior and reduces code duplication.
 *
 * @param {string} inputFilename - The input filename to use for generating output filename
 * @return {Object} Default options object with all required properties
 */
function createDefaultOptions(inputFilename) {
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
  };
}
