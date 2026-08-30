import {Sandbox} from '../utils/sandbox.js';
import {evalInVm} from '../utils/evalInVm.js';
import {getCache} from '../utils/getCache.js';
import {getCalleeName} from '../utils/getCalleeName.js';
import {isNodeInRanges} from '../utils/isNodeInRanges.js';
import {createOrderedSrc} from '../utils/createOrderedSrc.js';
import {SKIP_IDENTIFIERS, SKIP_PROPERTIES} from '../config.js';
import {getDeclarationWithContext} from '../utils/getDeclarationWithContext.js';
import {getDescendants} from '../utils/getDescendants.js';

const VALID_UNWRAP_TYPES = ['Literal', 'Identifier'];
const SAFE_SELF_MUTATING_REPLACEMENT_TYPES = ['Literal', 'Identifier', 'UnaryExpression'];
const CACHE_LIMIT = 100;
// Matches the obfuscator.io debug-guard `/^([^ ]+( +[^ ]+)+)+[^ ]}/` in
// function source. `.test(fn)` stringifies the function and the regex
// backtracks until the sandbox 1s timeout. Skipping the callee is required:
// neutralizing the regex lets the guard return a boolean and fold
// `_yh()` → `true`, which changes sample output.
const REDOS_DEBUG_GUARD = /\^\(\[\^ \]\+\( \+\[\^ \]\+\)\+\)\+/;

// Module-level variables for appearance tracking
let APPEARANCES = new Map();

/**
 * Sorts call expression nodes by their appearance frequency in descending order.
 * @param {ASTNode} a - First call expression node
 * @param {ASTNode} b - Second call expression node
 * @return {number} Comparison result for sorting
 */
function sortByApperanceFrequency(a, b) {
  return APPEARANCES.get(getCalleeName(b)) - APPEARANCES.get(getCalleeName(a));
}

function closeCachedSandboxes(cache) {
  const values = Object.values(cache);
  for (let i = 0; i < values.length; i++) {
    values[i]?.close?.();
  }
}

function clearLocalCache(cache) {
  closeCachedSandboxes(cache);
  for (const key in cache) {
    delete cache[key];
  }
}

/**
 * Counts and tracks the appearance frequency of a call expression's callee.
 * @param {ASTNode} n - Call expression node
 * @return {number} Updated appearance count
 */
function countAppearances(n) {
  const calleeName = getCalleeName(n);
  const count = (APPEARANCES.get(calleeName) || 0) + 1;
  APPEARANCES.set(calleeName, count);
  return count;
}

/**
 * @param {ASTNode|undefined} declNode - Candidate declaration node for the callee binding
 * @return {boolean} Whether the binding is reassigned or updated inside its own function body
 */
function doesFunctionMutateOwnBinding(declNode) {
  const bindingName = declNode?.name;
  const functionNode = declNode?.parentNode?.type?.includes('Function')
    ? declNode.parentNode
    : declNode?.parentNode?.init?.type?.includes('Function')
      ? declNode.parentNode.init
      : null;

  if (!bindingName || !functionNode) return false;

  const descendants = getDescendants(functionNode);
  for (let i = 0; i < descendants.length; i++) {
    const node = descendants[i];
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier' && node.left.name === bindingName) {
      return true;
    }
    if (node.type === 'UpdateExpression' && node.argument?.type === 'Identifier' && node.argument.name === bindingName) {
      return true;
    }
  }

  return false;
}

/**
 * @param {Arborist} arb - The Arborist instance
 * @param {ASTNode|undefined} callee - Callee node or member expression object
 * @return {ASTNode|undefined} Declaration node to use for evaluation context
 */
function resolveCalleeDeclaration(arb, callee) {
  const directDeclNode = callee?.declNode || callee?.object?.declNode;
  if (!directDeclNode || directDeclNode.parentNode?.type !== 'CatchClause' || callee?.type !== 'Identifier') {
    return directDeclNode;
  }

  const functionDeclarations = arb.ast[0].typeMap.FunctionDeclaration || [];
  for (let i = 0; i < functionDeclarations.length; i++) {
    const fn = functionDeclarations[i];
    if (fn.id?.name === callee.name) return fn.id;
  }

  const variableDeclarators = arb.ast[0].typeMap.VariableDeclarator || [];
  for (let i = 0; i < variableDeclarators.length; i++) {
    const declarator = variableDeclarators[i];
    if (declarator.id?.name === callee.name) return declarator.id;
  }

  return directDeclNode;
}

/**
 * Identifies CallExpression nodes that can be resolved through local function definitions.
 * Collects call expressions where the callee has a declaration node and meets specific criteria.
 * @param {Arborist} arb - The Arborist instance
 * @param {Function} [candidateFilter] - Optional filter for candidates
 * @return {ASTNode[]} Array of call expression nodes that can be transformed
 */
export function resolveLocalCallsMatch(arb, candidateFilter = () => true) {
  APPEARANCES = new Map();
  const matches = [];
  const relevantNodes = arb.ast[0].typeMap.CallExpression;

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];

    // Check if call expression has proper declaration context
    if ((n.callee?.declNode ||
			(n.callee?.object?.declNode &&
				!SKIP_PROPERTIES.includes(n.callee.property?.value || n.callee.property?.name)) ||
			n.callee?.object?.type === 'Literal') &&
		candidateFilter(n)) {
      countAppearances(n);	// Count appearances during the match phase to allow sorting by appearance frequency
      matches.push(n);
    }
  }

  // Sort by appearance frequency for optimization (most frequent first)
  matches.sort(sortByApperanceFrequency);
  return matches;
}

/**
 * Transforms call expressions by resolving them to their evaluated values using local function context.
 * Uses caching and sandbox evaluation to safely determine replacement values.
 * @param {Arborist} arb - The Arborist instance
 * @param {ASTNode[]} matches - Array of call expression nodes to transform
 * @return {Arborist} The modified Arborist instance
 */
export function resolveLocalCallsTransform(arb, matches) {
  if (!matches.length) return arb;

  const cache = getCache(arb.ast[0].scriptHash);
  const modifiedRanges = [];

  try {
    candidateLoop: for (let i = 0; i < matches.length; i++) {
      const c = matches[i];

      // Skip if already modified in this iteration
      if (isNodeInRanges(c, modifiedRanges)) continue;

      // Skip environment-bound calls. Check `c.arguments` (the CallExpression),
      // not `callee.arguments` - an Identifier callee has none. Compare
      // `arg.name`, not the node: `SKIP_IDENTIFIERS.includes(arg)` is always
      // false. After BOM stubs made `window` an object, missing this skip
      // evaluated `_0x18585b(window, 'setTimeout', …)` and hit the ReDoS
      // guard below (~1s timeout each).
      for (let j = 0; j < c.arguments.length; j++) {
        const arg = c.arguments[j];
        if (arg.type === 'ThisExpression') continue candidateLoop;
        if (SKIP_IDENTIFIERS.includes(arg.name || arg.value)) continue candidateLoop;
      }

      const callee = c.callee?.object || c.callee;
      const declNode = resolveCalleeDeclaration(arb, callee);
      // Skip before touching the cache. A skip that only ran on cache-miss
      // stored BAD_VALUE and later calls to the same callee still eval'd.
      if (SKIP_IDENTIFIERS.includes(callee.name) ||
				(callee.type === 'ArrayExpression' && !callee.elements.length) ||
				REDOS_DEBUG_GUARD.test(declNode?.parentNode?.src || declNode?.src || '')) {
        continue;
      }

      // Skip simple wrappers that should be handled by safe modules
      if (declNode?.parentNode?.body?.body?.[0]?.type === 'ReturnStatement') {
        const returnArg = declNode.parentNode.body.body[0].argument;
        // Leave simple literal/identifier returns to safe unwrapping modules
        if (VALID_UNWRAP_TYPES.includes(returnArg.type) || returnArg.type.includes('unction')) continue;
        // Leave function shell unwrapping to dedicated module
        else if (returnArg.type === 'CallExpression' &&
				returnArg.callee?.object?.type === 'FunctionExpression' &&
				(returnArg.callee.property?.name || returnArg.callee.property?.value) === 'apply') continue;
      }

      // Cache management for performance
      const cacheName = `rlc-${callee.name || callee.value}-${declNode?.nodeId}`;
      if (!cache[cacheName]) {
        cache[cacheName] = evalInVm.BAD_VALUE;

        if (declNode) {
          // Skip simple function wrappers (handled by safe modules)
          if (declNode.parentNode.type === 'FunctionDeclaration' &&
					VALID_UNWRAP_TYPES.includes(declNode.parentNode?.body?.body?.[0]?.argument?.type)) continue;

          // Build execution context in sandbox
          const contextSb = new Sandbox();
          try {
            contextSb.exec(createOrderedSrc(getDeclarationWithContext(declNode.parentNode)));
            if (Object.keys(cache).length >= CACHE_LIMIT) {
              clearLocalCache(cache);
            }
            cache[cacheName] = contextSb;
          } catch {
            contextSb.close();
          }
        }
      }

      // Evaluate call expression in appropriate context
      const contextVM = cache[cacheName];
      const nodeSrc = createOrderedSrc([c]);
      const replacementNode = contextVM === evalInVm.BAD_VALUE ? evalInVm(nodeSrc) : evalInVm(nodeSrc, contextVM);

      if (replacementNode !== evalInVm.BAD_VALUE && replacementNode.type !== 'FunctionDeclaration' && replacementNode.name !== 'undefined') {
        if (declNode?.parentKey === 'params' && !SAFE_SELF_MUTATING_REPLACEMENT_TYPES.includes(replacementNode.type)) continue;
        if (doesFunctionMutateOwnBinding(declNode) && !SAFE_SELF_MUTATING_REPLACEMENT_TYPES.includes(replacementNode.type)) continue;

        // Anti-debugging protection: avoid resolving function toString that might trigger detection
        if (c.callee.type === 'MemberExpression' &&
				(c.callee.property?.name || c.callee.property?.value) === 'toString' &&
				replacementNode?.value?.substring(0, 8) === 'function') continue;

        arb.markNode(c, replacementNode);
        modifiedRanges.push(c.range);
      }
    }
  } finally {
    clearLocalCache(cache);
  }
  return arb;
}

/**
 * Resolves local function calls by evaluating them with their declaration context.
 * This module identifies call expressions where the callee is defined locally and attempts
 * to resolve their values through safe evaluation in a sandbox environment.
 * @param {Arborist} arb - The Arborist instance
 * @param {Function} [candidateFilter] - Optional filter for candidates
 * @return {Arborist} The modified Arborist instance
 */
export default function resolveLocalCalls(arb, candidateFilter = () => true) {
  const matches = resolveLocalCallsMatch(arb, candidateFilter);
  return resolveLocalCallsTransform(arb, matches);
}
