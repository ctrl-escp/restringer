import {createNewNode} from '../utils/createNewNode.js';
import {BAD_VALUE} from '../config.js';
import {evaluateResolvableValue, NOT_RESOLVABLE} from '../utils/literalTruthiness.js';

/**
 * Pure methods that can be applied to a string or array value without eval
 * and without callbacks. Do not add methods that take functions (`map`, `find`, …).
 */
const STRING_METHODS = new Set([
  'split',
  'join',
  'slice',
  'substring',
  'charAt',
  'charCodeAt',
  'concat',
  'indexOf',
  'lastIndexOf',
  'includes',
  'startsWith',
  'endsWith',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'repeat',
]);

const ARRAY_METHODS = new Set([
  'join',
  'slice',
  'concat',
  'indexOf',
  'lastIndexOf',
  'includes',
]);

/**
 * @param {ASTNode} callee - CallExpression.callee
 * @return {string|null}
 */
function getMethodName(callee) {
  if (!callee || callee.type !== 'MemberExpression' || callee.optional) {
    return null;
  }
  if (callee.computed) {
    if (callee.property?.type === 'Literal' && typeof callee.property.value === 'string') {
      return callee.property.value;
    }
    return null;
  }
  return callee.property?.type === 'Identifier' ? callee.property.name : null;
}

/**
 * @param {ASTNode} n - CallExpression
 * @return {*|undefined}
 */
function foldPureCall(n) {
  const methodName = getMethodName(n.callee);
  if (!methodName) {
    return undefined;
  }

  const receiver = evaluateResolvableValue(n.callee.object);
  if (receiver === NOT_RESOLVABLE || receiver === null || receiver === undefined) {
    return undefined;
  }

  const isString = typeof receiver === 'string';
  const isArray = Array.isArray(receiver);
  if (isString && !STRING_METHODS.has(methodName)) {
    return undefined;
  }
  if (isArray && !ARRAY_METHODS.has(methodName)) {
    return undefined;
  }
  if (!isString && !isArray) {
    return undefined;
  }

  const args = [];
  const src = n.arguments || [];
  for (let i = 0; i < src.length; i++) {
    const arg = src[i];
    if (!arg || arg.type === 'SpreadElement') {
      return undefined;
    }
    const value = evaluateResolvableValue(arg);
    if (value === NOT_RESOLVABLE) {
      return undefined;
    }
    args.push(value);
  }

  try {
    const method = receiver[methodName];
    if (typeof method !== 'function') {
      return undefined;
    }
    return method.apply(receiver, args);
  } catch {
    return undefined;
  }
}

/**
 * Identifies CallExpressions of allow-listed pure methods on string or array literals.
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {ASTNode[]}
 */
export function resolvePureLiteralMethodCallsMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const relevantNodes = arb.ast[0].typeMap.CallExpression || [];

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];
    if (n.optional || !candidateFilter(n)) {
      continue;
    }
    if (foldPureCall(n) !== undefined) {
      matches.push(n);
    }
  }
  return matches;
}

/**
 * @param {Arborist} arb
 * @param {ASTNode} n
 * @return {Arborist}
 */
export function resolvePureLiteralMethodCallsTransform(arb, n) {
  const value = foldPureCall(n);
  if (value === undefined) {
    return arb;
  }
  const replacementNode = createNewNode(value);
  if (replacementNode !== BAD_VALUE) {
    arb.markNode(n, replacementNode);
  }
  return arb;
}

/**
 * Folds allow-listed pure method calls on string/array literals.
 * `'a|b'.split('|')` → `['a', 'b']`. Does not eval arbitrary methods.
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Arborist}
 */
export default function resolvePureLiteralMethodCalls(arb, candidateFilter = () => true) {
  const matches = resolvePureLiteralMethodCallsMatch(arb, candidateFilter);
  for (let i = 0; i < matches.length; i++) {
    arb = resolvePureLiteralMethodCallsTransform(arb, matches[i]);
  }
  return arb;
}
