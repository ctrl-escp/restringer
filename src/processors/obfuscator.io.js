/**
 * Obfuscator.io Processor
 *
 * This processor handles obfuscation patterns specific to obfuscator.io, particularly
 * the "debug protection" mechanism that creates infinite loops when the script detects
 * it has been beautified or modified.
 *
 * The debug protection works by:
 * 1. Testing function toString() output against a regex
 * 2. If the test fails (indicating beautification), triggering an infinite loop
 * 3. Preventing the script from executing normally
 *
 * This processor bypasses the protection by replacing the tested functions with
 * strings that pass the validation tests, effectively "freezing" their values.
 *
 * Combined with augmentedArray processors for comprehensive obfuscator.io support.
 */
import * as augmentedArrayProcessors from './augmentedArray.js';
import flattenStringArrayDecoder from './flattenStringArrayDecoder.js';
import inlineOperatorObjects from '../modules/safe/inlineOperatorObjects.js';
import resolvePureLiteralMethodCalls from '../modules/safe/resolvePureLiteralMethodCalls.js';
import rearrangeSwitches from '../modules/safe/rearrangeSwitches.js';

// String literal values that trigger debug protection mechanisms
const DEBUG_PROTECTION_TRIGGERS = ['newState', 'removeCookie'];
const TRAP_FUNCTION_BODIES = new Set(['debugger', 'while(true){}', 'while(true);']);

// Replacement string that bypasses obfuscator.io debug protection
const FREEZE_REPLACEMENT_STRING = 'function () {return "bypassed!"}';

/**
 * Identifies Literal nodes that contain debug protection trigger values.
 * These literals are part of obfuscator.io's anti-debugging mechanisms that test
 * function stringification to detect code beautification or modification.
 *
 * Matching criteria:
 * - Literal nodes with values 'newState' or 'removeCookie'
 * - Literals positioned within function expressions or property assignments
 * - Valid parent node structure for replacement targeting
 *
 * @param {Arborist} arb - Arborist instance containing the AST
 * @param {Function} [candidateFilter=(() => true)] - Optional filter function for additional criteria
 * @return {ASTNode[]} Array of matching Literal nodes suitable for debug protection bypass
 *
 * @example
 * // Matches: 'newState' in function context, 'removeCookie' in property assignment
 * // Ignores: Other literal values, literals in invalid contexts
 */
export function obfuscatorIoMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const candidates = arb.ast[0].typeMap.Literal;

  for (let i = 0; i < candidates.length; i++) {
    const n = candidates[i];
    if (DEBUG_PROTECTION_TRIGGERS.includes(n.value) && candidateFilter(n)) {
      matches.push(n);
    }
  }
  return matches;
}

/**
 * Transforms a debug protection trigger literal by replacing the associated function
 * or value with a bypass string that satisfies obfuscator.io's validation tests.
 *
 * This function handles two specific protection patterns:
 * 1. 'newState' - targets parent FunctionExpression nodes
 * 2. 'removeCookie' - targets parent property values
 *
 * Algorithm:
 * 1. Identify the protection trigger type ('newState' or 'removeCookie')
 * 2. Navigate the AST structure to find the appropriate target node
 * 3. Replace the target with a literal containing the bypass string
 * 4. Mark the node for replacement in the Arborist instance
 *
 * @param {Arborist} arb - Arborist instance containing the AST
 * @param {ASTNode} n - The Literal AST node containing the debug protection trigger
 * @return {Arborist} The modified Arborist instance
 */
export function obfuscatorIoTransform(arb, n) {
  let targetNode;

  // Determine target node based on protection trigger type
  switch (n.value) {
    case 'newState':
      // Navigate up to find the containing FunctionExpression
      if (n.parentNode?.parentNode?.parentNode?.type === 'FunctionExpression') {
        targetNode = n.parentNode.parentNode.parentNode;
      }
      break;
    case 'removeCookie':
      // Target the parent value directly
      targetNode = n.parentNode?.value;
      break;
  }

  // Apply the bypass replacement if a valid target was found
  if (targetNode) {
    arb.markNode(targetNode, {
      type: 'Literal',
      value: FREEZE_REPLACEMENT_STRING,
      raw: `"${FREEZE_REPLACEMENT_STRING}"`,
    });
  }

  return arb;
}

/**
 * Main function for obfuscator.io debug protection bypass.
 * Orchestrates the matching and transformation of debug protection mechanisms
 * to prevent infinite loops and allow deobfuscation to proceed.
 *
 * @param {Arborist} arb - Arborist instance containing the AST
 * @param {Function} [candidateFilter=(() => true)] - Optional filter function for additional criteria
 * @return {Arborist} The modified Arborist instance
 */
function freezeUnbeautifiedValues(arb, candidateFilter = () => true) {
  const matches = obfuscatorIoMatch(arb, candidateFilter);

  for (let i = 0; i < matches.length; i++) {
    const n = matches[i];
    arb = obfuscatorIoTransform(arb, n);
  }
  return arb;
}

/**
 * Concatenate a + chain of string literals.
 *
 * @param {ASTNode} node
 * @return {string|null}
 */
function concatLiteralString(node) {
  if (!node) {
    return null;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = concatLiteralString(node.left);
    const right = concatLiteralString(node.right);
    if (left !== null && right !== null) {
      return left + right;
    }
  }
  return null;
}

/**
 * @param {string} value
 * @return {boolean}
 */
function isTrapSourceString(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const compact = value.replace(/\s+/g, '');
  return TRAP_FUNCTION_BODIES.has(compact) || value === 'debugger';
}

/**
 * @param {ASTNode} callee
 * @return {boolean}
 */
function isFunctionConstructorCallee(callee) {
  if (!callee) {
    return false;
  }
  if (callee.type === 'Identifier' && callee.name === 'Function') {
    return true;
  }
  if (callee.type === 'MemberExpression') {
    const prop = callee.property?.name || callee.property?.value;
    return prop === 'constructor';
  }
  return false;
}

/**
 * Function / .constructor(...) building debugger or while(true){}, and
 * toString() integrity checks that gate an infinite loop.
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {ASTNode[]}
 */
export function debugProtectionShapeMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const calls = arb.ast[0].typeMap.CallExpression || [];

  for (let i = 0; i < calls.length; i++) {
    const n = calls[i];
    if (!candidateFilter(n) || !n.arguments?.length) {
      continue;
    }
    if (isFunctionConstructorCallee(n.callee)) {
      const src = concatLiteralString(n.arguments[0]);
      if (src !== null && isTrapSourceString(src)) {
        matches.push(n);
      }
    }
  }
  return matches;
}

/**
 * Replace trap constructors so they are not a live debugger / hang.
 *
 * @param {Arborist} arb
 * @param {ASTNode} n
 * @return {Arborist}
 */
export function debugProtectionShapeTransform(arb, n) {
  arb.markNode(n, {
    type: 'FunctionExpression',
    id: null,
    params: [],
    body: {
      type: 'BlockStatement',
      body: [],
    },
  });
  return arb;
}

/**
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Arborist}
 */
function neutralizeDebugProtectionShapes(arb, candidateFilter = () => true) {
  const matches = debugProtectionShapeMatch(arb, candidateFilter);
  for (let i = 0; i < matches.length; i++) {
    arb = debugProtectionShapeTransform(arb, matches[i]);
  }
  return arb;
}

export const preprocessors = [
  freezeUnbeautifiedValues,
  neutralizeDebugProtectionShapes,
  ...augmentedArrayProcessors.preprocessors,
  flattenStringArrayDecoder,
  inlineOperatorObjects,
  resolvePureLiteralMethodCalls,
  rearrangeSwitches,
];
export const postprocessors = [...augmentedArrayProcessors.postprocessors];
