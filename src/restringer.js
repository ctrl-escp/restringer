import {fileURLToPath} from 'node:url';
import {logger as flastLogger, applyIteratively, applyIterativelySafely} from 'flast';
import {processors} from './processors/index.js';
import {detectObfuscationReduced} from 'obfuscation-detector';
import {config, safe as safeMod, unsafe as unsafeMod, utils} from './modules/index.js';
import {assertSandboxProviderAvailable, normalizeSandboxConfig, withSandboxConfig} from './modules/utils/sandbox/index.js';
import {resolveDeobMethods} from './utils/deobMethods.js';
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
	 * @param {number} [options.maxIterations=500] Hard stop for applyIteratively
	 * @param {boolean} [options.normalize=true] Normalize output script formatting after deobfuscation
	 * @param {Object} [options.sandbox] Sandbox provider configuration
	 * @param {string[]} [options.methods] Named deobfuscation methods to run instead of the default loop
	 * @param {boolean} [options.runPreprocessors] Run detected preprocessors. Defaults off when `methods` is set so a targeted run is not preceded by type-specific processors.
	 * @param {boolean} [options.runPostprocessors] Run detected postprocessors. Same default as `runPreprocessors`.
	 * @param {number} [options.maxMarkedNodes] Per-modifier mark cap forwarded to flast so a long method yields and the next pass sees a rebuilt tree
	 * @param {boolean} [options.safely=false] Use applyIterativelySafely: keep valid marks when one queued edit would fail the atomic commit
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
    // Last completed count passed to flast as currentIteration so logs and the hard cap continue across calls.
    this.currentIteration = 0;
    this.detectObfuscationType = options.detectObfuscationType ?? true;
    this.sandbox = normalizeSandboxConfig(options.sandbox);
    this.maxMarkedNodes = options.maxMarkedNodes;
    this.safely = options.safely ?? false;
    this._namedMethods = options.methods?.length ? resolveDeobMethods(options.methods) : null;
    this.runPreprocessors = options.runPreprocessors ?? !this._namedMethods;
    this.runPostprocessors = options.runPostprocessors ?? !this._namedMethods;
    // Deobfuscation methods that don't use eval
    this.safeMethods = [
      safe.rearrangeSequences,
      safe.separateChainedDeclarators,
      safe.inlineOperatorObjects,
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
      safe.resolveDefiniteMemberExpressions,
      safe.resolvePureLiteralMethodCalls,
      safe.parseTemplateLiteralsIntoStringLiterals,
      safe.resolveDeterministicIfStatements,
      safe.resolveDeterministicWhileStatements,
      safe.resolveDeterministicConditionalExpressions,
      safe.replaceCallExpressionsWithUnwrappedIdentifier,
      safe.replaceEvalCallsWithLiteralContent,
      safe.replaceIdentifierWithFixedAssignedValue,
      safe.replaceIdentifierWithFixedValueNotAssignedAtDeclaration,
      safe.resolveMinimalAlphabet,
      safe.resolveNestedBinaryExpressions,
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
      unsafe.resolveAugmentedFunctionWrappedArrayReplacements,
      unsafe.resolveMemberExpressionsLocalReferences,
      unsafe.resolveBuiltinCalls,
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
	 * One applyIteratively call with the shared hard cap and log offset.
	 * Does not bump `currentIteration`: flast may run many inner passes and does not
	 * return how many completed. Callers that issued a single-pass stage increment themselves.
	 *
	 * @param {string} script Source to transform
	 * @param {Function[]} methods Modifier functions
	 * @param {Object} [opts]
	 * @param {boolean} [opts.includeMaxMarkedNodes=true] False for normalize/clean so the mark cap does not slice cosmetic passes
	 * @return {string} Possibly modified source
	 */
  _applyIteratively(script, methods, {includeMaxMarkedNodes = true} = {}) {
    if (this.currentIteration >= this.maxIterations) return script;
    const options = {
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
    };
    if (includeMaxMarkedNodes && this.maxMarkedNodes) {
      options.maxMarkedNodes = this.maxMarkedNodes;
    }
    let next = script;
    if (this.safely) {
      const {script: out, rejected} = applyIterativelySafely(script, methods, options);
      next = out;
      if (rejected?.length) {
        this.logger.log(`[!] ${rejected.length} edit(s) rejected by safely apply`);
        for (let i = 0; i < rejected.length; i++) {
          const rec = rejected[i];
          this.logger.debug(`[!] Rejected ${rec.type} node ${rec.nodeId}: ${rec.error}`);
        }
      }
    } else {
      next = applyIteratively(script, methods, options);
    }
    return next;
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
    // Named methods replace the whole main loop: one list, caller order, no safe-then-unsafe split.
    if (this._namedMethods) {
      this.modified = false;
      const script = this._applyIteratively(this.script, this._namedMethods);
      if (this.script !== script) {
        this.modified = true;
        this.script = script;
      }
      return;
    }
    // Track whether any iteration made changes (vs this.modified which tracks current iteration only)
    let wasEverModified, script;
    do {
      this.modified = false;
      script = this._applyIteratively(this.script, this.safeMethods);
      script = this._applyIteratively(script, this.unsafeMethods);
      // Only the unsafe call is treated as one pass. The safe call may have used many
      // inner iterations; flast does not report that count.
      if (this.currentIteration < this.maxIterations) this.currentIteration++;
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
      if (this.runPreprocessors) this._runProcessors(this._preprocessors);
      this._loopSafeAndUnsafeDeobfuscationMethods();
      if (this.runPostprocessors) this._runProcessors(this._postprocessors);
      if (this.modified && this.normalize) {
        this.script = normalizeScript(this.script, {
          currentIteration: this.currentIteration,
          maxIterations: this.maxIterations,
          safely: this.safely,
        });
      }
      if (this.clean) {
        this.script = this._applyIteratively(this.script, [safe.removeDeadNodes], {includeMaxMarkedNodes: false});
      }
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
      this.script = this._applyIteratively(this.script, [processor]);
      // Each processor is its own applyIteratively call; +1 keeps the next stage's logs in sequence.
      if (this.currentIteration < this.maxIterations) this.currentIteration++;
    }
  }
}
