import {createNewNode} from '../utils/createNewNode.js';
import {BAD_VALUE} from '../config.js';
import {evaluateResolvableValue, NOT_RESOLVABLE} from '../utils/literalTruthiness.js';

const VALID_OBJECT_TYPES = ['ArrayExpression', 'Literal'];

/**
 * Resolves a member expression on a string or array literal to a JS value.
 * Returns undefined for out-of-bounds access, holes, and non-index properties
 * (matching previous sandbox behavior that left those nodes unchanged).
 *
 * @param {ASTNode} n - MemberExpression node
 * @return {*|undefined} Resolved value, or undefined when the access cannot be folded
 */
function resolveMemberValue(n) {
  const obj = n.object;
  const key = n.property.type === 'Literal' ? n.property.value : n.property.name;

  if (obj.type === 'Literal' && typeof obj.value === 'string') {
    const result = obj.value[key];
    if (typeof result === 'string' || (key === 'length' && typeof result === 'number')) {
      return result;
    }
    return undefined;
  }

  if (obj.type === 'ArrayExpression') {
    if (key === 'length') {
      return obj.elements.length;
    }
    const index = typeof key === 'number' ? key : Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= obj.elements.length) {
      return undefined;
    }
    const element = obj.elements[index];
    if (!element) {
      return undefined;
    }
    const value = evaluateResolvableValue(element);
    if (value === NOT_RESOLVABLE || value === undefined) {
      return undefined;
    }
    return value;
  }

  return undefined;
}

/**
 * Identifies MemberExpression nodes that can be safely resolved to literal values.
 * Matches expressions like '123'[0], 'hello'.length, [1,2,3][0] that access
 * literal properties of literal objects/arrays.
 * @param {Arborist} arb - The Arborist instance
 * @param {Function} [candidateFilter] - Optional filter for candidates
 * @return {ASTNode[]} Array of MemberExpression nodes ready for evaluation
 */
export function resolveDefiniteMemberExpressionsMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const relevantNodes = arb.ast[0].typeMap.MemberExpression;

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];

    // Prevent unsafe transformations that could break semantics
    if (n.parentNode.type === 'UpdateExpression') {
      // Prevent replacing (++[[]][0]) with (++1) which changes semantics
      continue;
    }

    if (n.parentKey === 'callee') {
      // Prevent replacing obj.method() with undefined() calls
      continue;
    }

    // Property must be a literal or non-computed identifier (safe to evaluate)
    const hasValidProperty = n.property.type === 'Literal' ||
			(n.property.name && !n.computed);
    if (!hasValidProperty) continue;

    // Object must be a literal or array expression (deterministic)
    if (!VALID_OBJECT_TYPES.includes(n.object.type)) continue;

    // Object must have content to access (length or elements)
    if (!(n.object?.value?.length || n.object?.elements?.length)) continue;

    if (candidateFilter(n)) {
      matches.push(n);
    }
  }
  return matches;
}

/**
 * Transforms a matched MemberExpression by replacing it with its resolved literal.
 * @param {Arborist} arb - The Arborist instance
 * @param {ASTNode} n - MemberExpression node to transform
 * @return {Arborist} The updated Arborist instance
 */
export function resolveDefiniteMemberExpressionsTransform(arb, n) {
  const value = resolveMemberValue(n);
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
 * Resolves MemberExpression nodes that access literal properties of literal objects/arrays.
 * Transforms expressions like '123'[0] → '1', 'hello'.length → 5, [1,2,3][0] → 1
 * Only processes safe expressions that won't change program semantics.
 * @param {Arborist} arb - The Arborist instance
 * @param {Function} [candidateFilter] - Optional filter function for candidates
 * @return {Arborist} The updated Arborist instance
 */
export default function resolveDefiniteMemberExpressions(arb, candidateFilter = () => true) {
  const matches = resolveDefiniteMemberExpressionsMatch(arb, candidateFilter);

  for (let i = 0; i < matches.length; i++) {
    arb = resolveDefiniteMemberExpressionsTransform(arb, matches[i]);
  }
  return arb;
}
