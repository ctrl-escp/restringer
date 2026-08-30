import {isLiteralTruthy, isDeterministicTestNode, evaluateDeterministicTest, NOT_RESOLVABLE} from '../utils/literalTruthiness.js';

/**
 * Identifies WhileStatement / DoWhileStatement nodes whose test is a foldable literal
 * or a comparison of two literal-like sides. Complements if/ternary folding (W1-1).
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {ASTNode[]}
 */
export function resolveDeterministicWhileStatementsMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const whiles = arb.ast[0].typeMap.WhileStatement || [];
  const doWhiles = arb.ast[0].typeMap.DoWhileStatement || [];
  const relevantNodes = whiles.concat(doWhiles);

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];
    if (n.test && isDeterministicTestNode(n.test) && candidateFilter(n)) {
      matches.push(n);
    }
  }
  return matches;
}

/**
 * Truthy `while`: keep the body (caller / later passes handle infinite loops).
 * Falsy `while`: remove the loop (do-while still ran once - keep the body).
 *
 * @param {Arborist} arb
 * @param {ASTNode} n
 * @return {Arborist}
 */
export function resolveDeterministicWhileStatementsTransform(arb, n) {
  const testValue = evaluateDeterministicTest(n.test);
  if (testValue === NOT_RESOLVABLE) {
    return arb;
  }
  const truthy = isLiteralTruthy(testValue);

  if (n.type === 'DoWhileStatement') {
    if (!truthy) {
      arb.markNode(n, n.body || null);
    }
    return arb;
  }

  if (!truthy) {
    arb.markNode(n);
  }
  return arb;
}

/**
 * Removes `while (false)` / `while ('a' === 'b')` and equivalent do-while after one run.
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Arborist}
 */
export default function resolveDeterministicWhileStatements(arb, candidateFilter = () => true) {
  const matches = resolveDeterministicWhileStatementsMatch(arb, candidateFilter);
  for (let i = 0; i < matches.length; i++) {
    arb = resolveDeterministicWhileStatementsTransform(arb, matches[i]);
  }
  return arb;
}
