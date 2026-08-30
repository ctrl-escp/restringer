import {isLiteralTruthy, isDeterministicTestNode, evaluateDeterministicTest, NOT_RESOLVABLE} from '../utils/literalTruthiness.js';

/**
 * Evaluates a test condition to get its literal value for truthiness testing.
 *
 * Handles literals, unary-of-literal, and comparisons of two literal-like sides.
 *
 * @param {ASTNode} testNode - The test condition AST node
 * @return {*} The evaluated literal value
 */
function evaluateTestValue(testNode) {
  const evaluated = evaluateDeterministicTest(testNode);
  return evaluated === NOT_RESOLVABLE ? testNode.value : evaluated;
}

/**
 * Gets the appropriate replacement node for a resolved if statement.
 *
 * When an if statement can be resolved deterministically:
 * - If test is truthy: return consequent (or null if no consequent)
 * - If test is falsy: return alternate (or null if no alternate)
 *
 * Returning null indicates the if statement should be removed entirely.
 * Handles both Literal and UnaryExpression test conditions.
 *
 * @param {ASTNode} ifNode - The IfStatement AST node to resolve
 * @return {ASTNode|null} The replacement node or null to remove
 */
function getReplacementNode(ifNode) {
  const testValue = evaluateTestValue(ifNode.test);
  const isTestTruthy = isLiteralTruthy(testValue);

  if (isTestTruthy) {
    // Test condition is truthy - use consequent
    return ifNode.consequent || null;
  } else {
    // Test condition is falsy - use alternate
    return ifNode.alternate || null;
  }
}

/**
 * Identifies IfStatement nodes with literal test conditions that can be resolved deterministically.
 *
 * An if statement is a candidate for resolution when:
 * 1. The node is an IfStatement
 * 2. The test condition is a Literal (constant value) or UnaryExpression with literal argument
 * 3. The node passes the candidate filter
 *
 * These conditions ensure the if statement's outcome is known at static analysis time.
 * Handles cases like: if (true), if (false), if (1), if (0), if (""), if (-1), etc.
 *
 * @param {Arborist} arb - The Arborist instance containing the AST
 * @param {Function} candidateFilter - Filter function to apply to candidates
 * @return {ASTNode[]} Array of IfStatement nodes that can be resolved
 */
export function resolveDeterministicIfStatementsMatch(arb, candidateFilter = () => true) {
  const relevantNodes = arb.ast[0].typeMap.IfStatement || [];
  const matches = [];

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];

    if (!n.test || !candidateFilter(n)) {
      continue;
    }

    if (isDeterministicTestNode(n.test)) {
      matches.push(n);
    }
  }

  return matches;
}

/**
 * Transforms an IfStatement with a literal test condition into its resolved form.
 *
 * The transformation logic:
 * - If test value is truthy: replace with consequent (if exists) or remove entirely
 * - If test value is falsy: replace with alternate (if exists) or remove entirely
 *
 * This transformation eliminates dead code by resolving conditional branches
 * that will always take the same path at runtime.
 *
 * @param {Arborist} arb - The Arborist instance to mark changes on
 * @param {ASTNode} n - The IfStatement node to transform
 * @return {Arborist} The modified Arborist instance
 */
export function resolveDeterministicIfStatementsTransform(arb, n) {
  const replacementNode = getReplacementNode(n);

  if (replacementNode) {
    // Replace if statement with the appropriate branch
    arb.markNode(n, replacementNode);
  } else {
    // Remove if statement entirely (no consequent/alternate to execute)
    arb.markNode(n);
  }

  return arb;
}

/**
 * Replace if statements which will always resolve the same way with their relevant consequent or alternative.
 *
 * This transformation eliminates deterministic conditional statements where the test condition
 * is a literal value, allowing static resolution of the control flow. For example:
 *
 * Input:  if (true) do_a(); else do_b(); if (false) do_c(); else do_d();
 * Output: do_a(); do_d();
 *
 * The transformation handles all JavaScript falsy values correctly (false, 0, "", null, etc.)
 * and ensures proper cleanup of dead code branches.
 *
 * @param {Arborist} arb - The Arborist instance containing the AST to transform
 * @param {Function} [candidateFilter] - Optional filter to apply on candidates
 * @return {Arborist} The modified Arborist instance
 */
export default function resolveDeterministicIfStatements(arb, candidateFilter = () => true) {
  const matches = resolveDeterministicIfStatementsMatch(arb, candidateFilter);

  for (let i = 0; i < matches.length; i++) {
    arb = resolveDeterministicIfStatementsTransform(arb, matches[i]);
  }

  return arb;
}