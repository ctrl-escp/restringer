import {createNewNode} from '../utils/createNewNode.js';
import {BAD_VALUE} from '../config.js';
import {doesDescendantMatchCondition} from '../utils/doesDescendantMatchCondition.js';
import {evaluateResolvableValue, NOT_RESOLVABLE} from '../utils/literalTruthiness.js';

/**
 * Identifies unary and binary expressions that can be resolved to simplified values.
 * Targets JSFuck-style obfuscation patterns using non-numeric operands and excludes
 * expressions containing ThisExpression for safe evaluation.
 * @param {Arborist} arb - Arborist instance
 * @param {Function} [candidateFilter] - Optional filter function for additional candidate filtering
 * @return {ASTNode[]} Array of expression nodes that can be resolved
 */
export function resolveMinimalAlphabetMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const unaryNodes = arb.ast[0].typeMap.UnaryExpression;
  const binaryNodes = arb.ast[0].typeMap.BinaryExpression;

  // Process unary expressions: +true, +[], -false, ~[], etc.
  for (let i = 0; i < unaryNodes.length; i++) {
    const n = unaryNodes[i];
    if (((n.argument.type === 'Literal' && /^\D/.test(n.argument.raw[0])) ||
			n.argument.type === 'ArrayExpression') &&
		candidateFilter(n)) {
      // Skip expressions containing ThisExpression for safe evaluation
      if (doesDescendantMatchCondition(n, descendant => descendant.type === 'ThisExpression')) continue;
      matches.push(n);
    }
  }

  // Process binary expressions: [] + [], [][[]] + [], true + [].flat, etc.
  for (let i = 0; i < binaryNodes.length; i++) {
    const n = binaryNodes[i];
    if (n.operator === '+' &&
		n.left?.type !== 'ThisExpression' &&
		n.right?.type !== 'ThisExpression' &&
		candidateFilter(n)) {
      // Skip expressions containing ThisExpression for safe evaluation
      if (doesDescendantMatchCondition(n, descendant => descendant.type === 'ThisExpression')) continue;
      matches.push(n);
    }
  }

  return matches;
}

/**
 * Transforms unary and binary expressions by folding JSFuck-style coercions
 * (ToNumber / ToString on arrays, booleans, and null) without evaluating source text.
 * @param {Arborist} arb - Arborist instance
 * @param {ASTNode} n - Expression node to transform
 * @return {Arborist} The modified Arborist instance
 */
export function resolveMinimalAlphabetTransform(arb, n) {
  const value = evaluateResolvableValue(n);
  if (value === NOT_RESOLVABLE) {
    return arb;
  }
  const replacementNode = createNewNode(value);
  if (replacementNode !== BAD_VALUE) {
    arb.markNode(n, replacementNode);
  }
  return arb;
}

/**
 * Resolve unary expressions on values which aren't numbers such as +true, +[], +[...], etc,
 * as well as binary expressions around the + operator. These usually resolve to string values,
 * which can be used to obfuscate code in schemes such as JSFuck.
 * @param {Arborist} arb - Arborist instance
 * @param {Function} [candidateFilter] - Optional filter function for additional candidate filtering
 * @return {Arborist} The modified Arborist instance
 */
export default function resolveMinimalAlphabet(arb, candidateFilter = () => true) {
  const matches = resolveMinimalAlphabetMatch(arb, candidateFilter);

  for (let i = 0; i < matches.length; i++) {
    arb = resolveMinimalAlphabetTransform(arb, matches[i]);
  }
  return arb;
}
