import {fileURLToPath} from 'node:url';
import {logger as flastLogger, applyIteratively} from 'flast';
import {processors} from './processors/index.js';
import {detectObfuscationReduced} from 'obfuscation-detector';
import {config, safe as safeMod, unsafe as unsafeMod, utils} from './modules/index.js';
import {assertSandboxProviderAvailable, normalizeSandboxConfig, withSandboxConfig} from './modules/utils/sandbox/index.js';
const {normalizeScript} = utils.default;
import {readFileSync} from 'node:fs';
const __version__ = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8')).version;
const safe = {};
for (const funcName in safeMod) {
  safe[funcName] = safeMod[funcName].default || safeMod[funcName];
}
const unsafe = {};
for (const funcName in unsafeMod) {
  unsafe[funcName] = unsafeMod[funcName].default || unsafeMod[funcName];
}

// Silence async errors
// process.on('uncaughtException', () => {});

export class REstringer {
  static __version__ = __version__;
  logger = flastLogger;

  /**
	 * @param {string} script The target script to be deobfuscated
	 * @param {Object} [options] Configuration options
	 * @param {boolean} [options.clean=false] Remove dead nodes after deobfuscation
	 * @param {boolean} [options.detectObfuscationType=true] Whether to auto-detect obfuscation type
	 * @param {number} [options.maxIterations=500] Maximum safe-pass iterations per loop
	 * @param {boolean} [options.normalize=true] Normalize output script formatting after deobfuscation
	 * @param {Object} [options.sandbox] Sandbox provider configuration
	 */
  constructor(script, options = {}) {
    this.script = script;
    this.normalize = options.normalize ?? true;
    this.clean = options.clean ?? false;
    this.modified = false;
    this.obfuscationName = 'Generic';
    this._preprocessors = [];
    this._postprocessors = [];
    this.logger.setLogLevelLog();
    this.maxIterations = options.maxIterations ?? config.DEFAULT_MAX_ITERATIONS.value;
    this.detectObfuscationType = options.detectObfuscationType ?? true;
    this.sandbox = normalizeSandboxConfig(options.sandbox);
    // Deobfuscation methods that don't use eval
    this.safeMethods = [
      safe.rearrangeSequences,
      safe.separateChainedDeclarators,
      safe.rearrangeSwitches,
      safe.normalizeEmptyStatements,
      safe.removeRedundantBlockStatements,
      safe.resolveRedundantLogicalExpressions,
      safe.unwrapSimpleOperations,
      safe.resolveProxyCalls,
      safe.resolveProxyVariables,
      safe.resolveProxyReferences,
      safe.resolveMemberExpressionReferencesToArrayIndex,
      safe.resolveMemberExpressionsWithDirectAssignment,
      safe.parseTemplateLiteralsIntoStringLiterals,
      safe.resolveDeterministicIfStatements,
      safe.replaceCallExpressionsWithUnwrappedIdentifier,
      safe.replaceEvalCallsWithLiteralContent,
      safe.replaceIdentifierWithFixedAssignedValue,
      safe.replaceIdentifierWithFixedValueNotAssignedAtDeclaration,
      safe.replaceNewFuncCallsWithLiteralContent,
      safe.replaceBooleanExpressionsWithIf,
      safe.replaceSequencesWithExpressions,
      safe.resolveFunctionConstructorCalls,
      safe.replaceFunctionShellsWithWrappedValue,
      safe.replaceFunctionShellsWithWrappedValueIIFE,
      safe.simplifyCalls,
      safe.unwrapFunctionShells,
      safe.unwrapIIFEs,
      safe.simplifyIfStatements,
    ];
    // Deobfuscation methods that use eval
    this.unsafeMethods = [
      unsafe.resolveMinimalAlphabet,
      unsafe.resolveDefiniteBinaryExpressions,
      unsafe.resolveAugmentedFunctionWrappedArrayReplacements,
      unsafe.resolveMemberExpressionsLocalReferences,
      unsafe.resolveDefiniteMemberExpressions,
      unsafe.resolveBuiltinCalls,
      unsafe.resolveDeterministicConditionalExpressions,
      unsafe.resolveInjectedPrototypeMethodCalls,
      unsafe.resolveLocalCalls,
      unsafe.resolveEvalCallsOnNonLiterals,
    ];
  }

  /**
	 * Determine the type of the obfuscation, and populate the appropriate pre- and post- processors.
	 * @return {string} Detected obfuscation type name
	 */
  determineObfuscationType() {
    const detectedObfuscationType = detectObfuscationReduced(this.script).slice(-1)[0];
    if (detectedObfuscationType) {
      this.obfuscationName = detectedObfuscationType;
      if (processors[detectedObfuscationType]) {
        ({preprocessors: this._preprocessors, postprocessors: this._postprocessors} = processors[detectedObfuscationType]);
      }
    }
    this.logger.log(`[+] Obfuscation type is ${this.obfuscationName}`);
    return this.obfuscationName;
  }

  /**
	 * Iteratively applies safe and unsafe deobfuscation methods until no further changes occur.
	 *
	 * Algorithm per iteration:
	 * 1. Apply all safe methods repeatedly until they stop making changes (up to maxIterations)
	 * 2. Apply all unsafe methods exactly once (they may be overreaching, so limited to 1 iteration)
	 * 3. Repeat the entire process until no changes occur in either phase
	 *
   * This approach maximizes safe deobfuscation before using potentially risky eval-based methods,
   * while allowing unsafe methods to expose new opportunities for safe methods in subsequent iterations.
	 * @return {void}
	 */
  _loopSafeAndUnsafeDeobfuscationMethods() {
    // Track whether any iteration made changes (vs this.modified which tracks current iteration only)
    let wasEverModified, script;
    do {
      this.modified = false;
      script = applyIteratively(this.script, this.safeMethods, this.maxIterations);
      script = applyIteratively(script, this.unsafeMethods, 1);
      if (this.script !== script) {
        this.modified = true;
        this.script = script;
      }
      if (this.modified) wasEverModified = true;
    } while (this.modified); // Run this loop until the deobfuscation methods stop being effective.
    this.modified = wasEverModified;
  }

  /**
	 * Entry point for this class.
	 * Determine obfuscation type and run the pre- and post- processors accordingly.
	 * Run the deobfuscation methods in a loop until nothing more is changed.
	 * Normalize script to make it more readable.
	 * @return {boolean} true if the script was modified during deobfuscation; false otherwise.
	 */
  deobfuscate() {
    assertSandboxProviderAvailable(this.sandbox);

    return withSandboxConfig(this.sandbox, () => {
      if (this.detectObfuscationType) this.determineObfuscationType();
      this._runProcessors(this._preprocessors);
      this._loopSafeAndUnsafeDeobfuscationMethods();
      this._runProcessors(this._postprocessors);
      if (this.modified && this.normalize) this.script = normalizeScript(this.script);
      if (this.clean) this.script = applyIteratively(this.script, [safe.removeDeadNodes], this.maxIterations);
      return this.modified;
    });
  }

  /**
	 * Run specific deobfuscation which must run before or after the main deobfuscation loop
	 * in order to successfully complete deobfuscation.
	 * @param {Array<Function|string>} processorsArr An array of either imported deobfuscation methods or the name of internal methods.
	 * @return {void}
	 */
  _runProcessors(processorsArr) {
    for (let i = 0; i < processorsArr.length; i++) {
      const processor = processorsArr[i];
      this.script = applyIteratively(this.script, [processor], 1);
    }
  }
}
