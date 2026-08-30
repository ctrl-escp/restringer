import {createNewNode} from '../utils/createNewNode.js';
import {BAD_VALUE} from '../config.js';
import {evaluateResolvableValue, NOT_RESOLVABLE} from '../utils/literalTruthiness.js';

const NOT_LITERAL = Symbol('not-literal');
const CANNOT_APPLY = Symbol('cannot-apply');

const UNARY_OPERATORS = ['+', '-', '!', '~'];
const MUL_OPERATORS = ['*', '/'];
const LITERAL_IDENTIFIER_VALUES = {
  NaN,
  Infinity,
  undefined,
};

/**
 * Applies a unary operator to a known primitive value using JavaScript semantics.
 *
 * @param {string} operator - Unary operator
 * @param {*} value - Already-resolved operand
 * @return {*|symbol} The result, or CANNOT_APPLY if the operator is unsupported or throws
 */
function applyUnaryOp(operator, value) {
  try {
    switch (operator) {
      case '+':
        return +value;
      case '-':
        return -value;
      case '!':
        return !value;
      case '~':
        return ~value;
      default:
        return CANNOT_APPLY;
    }
  } catch {
    return CANNOT_APPLY;
  }
}

/**
 * Applies a binary operator to two known primitive values using JavaScript semantics.
 * Does not evaluate source text. Mixed BigInt/Number and `in`/`instanceof` are skipped.
 *
 * @param {string} operator - Binary operator
 * @param {*} left - Already-resolved left operand
 * @param {*} right - Already-resolved right operand
 * @return {*|symbol} The result, or CANNOT_APPLY if the operator cannot be applied
 */
function applyBinaryOp(operator, left, right) {
  try {
    switch (operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return left / right;
      case '%':
        return left % right;
      case '**':
        return left ** right;
      case '&':
        return left & right;
      case '|':
        return left | right;
      case '^':
        return left ^ right;
      case '<<':
        return left << right;
      case '>>':
        return left >> right;
      case '>>>':
        return left >>> right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '==':
        // Intentional loose equality to match JS `==` evaluation
        // eslint-disable-next-line eqeqeq
        return left == right;
      case '!=':
        // eslint-disable-next-line eqeqeq
        return left != right;
      case '===':
        return left === right;
      case '!==':
        return left !== right;
      default:
        return CANNOT_APPLY;
    }
  } catch {
    return CANNOT_APPLY;
  }
}

/**
 * Extracts a JavaScript value from a literal-like AST node.
 * Supports Literals, unary + - ! ~ of literal-like nodes, NaN/Infinity/undefined
 * identifiers, and ArrayExpressions whose elements are themselves literal-like
 * (so `+[]`, `[] + []`, and `[][[]] + []` can fold without eval). Object literals are skipped.
 *
 * @param {ASTNode} node - Node to read
 * @return {*|symbol} The JS value, or NOT_LITERAL
 */
function getLiteralLikeValue(node) {
  if (!node) {
    return NOT_LITERAL;
  }

  if (node.type === 'Literal') {
    if (node.regex) {
      try {
        return new RegExp(node.regex.pattern, node.regex.flags);
      } catch {
        return NOT_LITERAL;
      }
    }
    if (node.bigint !== undefined) {
      try {
        return BigInt(node.bigint);
      } catch {
        return NOT_LITERAL;
      }
    }
    return node.value;
  }

  if (node.type === 'Identifier' && Object.hasOwn(LITERAL_IDENTIFIER_VALUES, node.name)) {
    return LITERAL_IDENTIFIER_VALUES[node.name];
  }

  if (node.type === 'UnaryExpression' && UNARY_OPERATORS.includes(node.operator)) {
    const argumentValue = getLiteralLikeValue(node.argument);
    if (argumentValue === NOT_LITERAL) {
      return NOT_LITERAL;
    }
    return applyUnaryOp(node.operator, argumentValue);
  }

  if (node.type === 'ArrayExpression') {
    const elements = [];
    const src = node.elements || [];
    for (let i = 0; i < src.length; i++) {
      const element = src[i];
      if (!element) {
        elements.push(undefined);
        continue;
      }
      const elementValue = getLiteralLikeValue(element);
      if (elementValue === NOT_LITERAL) {
        return NOT_LITERAL;
      }
      elements.push(elementValue);
    }
    return elements;
  }

  if (node.type === 'MemberExpression' || node.type === 'CallExpression') {
    const value = evaluateResolvableValue(node);
    return value === NOT_RESOLVABLE ? NOT_LITERAL : value;
  }

  return NOT_LITERAL;
}

/**
 * @param {string} operator
 * @param {ASTNode} left
 * @param {ASTNode} right
 * @return {ASTNode}
 */
function createBinary(operator, left, right) {
  return {
    type: 'BinaryExpression',
    operator,
    left,
    right,
  };
}

/**
 * Structural equality for replacement trees. Same-reference nodes short-circuit.
 *
 * @param {ASTNode} a
 * @param {ASTNode} b
 * @return {boolean}
 */
function nodesEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.type !== b.type) {
    return false;
  }

  switch (a.type) {
    case 'Literal':
      if (a.regex || b.regex) {
        return a.regex?.pattern === b.regex?.pattern && a.regex?.flags === b.regex?.flags;
      }
      if (a.bigint !== undefined || b.bigint !== undefined) {
        return a.bigint === b.bigint;
      }
      return Object.is(a.value, b.value);
    case 'Identifier':
      return a.name === b.name;
    case 'UnaryExpression':
      return a.operator === b.operator && nodesEqual(a.argument, b.argument);
    case 'BinaryExpression':
      return a.operator === b.operator && nodesEqual(a.left, b.left) && nodesEqual(a.right, b.right);
    default:
      return false;
  }
}

/**
 * Creates an AST node for a folded primitive. Returns null if the value cannot be represented.
 *
 * @param {*} value
 * @return {ASTNode|null}
 */
function literalNodeFromValue(value) {
  // createNewNode(-5) uses the string '-5', so the argument becomes the string '5' (`-'5'`).
  // Build numeric negatives as unary-minus of a number so the result is `-5`.
  if (typeof value === 'number' && value < 0 && Number.isFinite(value) && !Object.is(value, -0)) {
    const argument = createNewNode(-value);
    if (argument === BAD_VALUE) {
      return null;
    }
    return {
      type: 'UnaryExpression',
      operator: '-',
      prefix: true,
      argument,
    };
  }
  const newNode = createNewNode(value);
  return newNode === BAD_VALUE ? null : newNode;
}

/**
 * Collects * / factors, flipping invert on each `/`.
 *
 * @param {ASTNode} node
 * @param {boolean} invert
 * @param {Object[]} factors
 */
function collectMulFactors(node, invert, factors) {
  if (node.type === 'BinaryExpression' && MUL_OPERATORS.includes(node.operator)) {
    collectMulFactors(node.left, invert, factors);
    const nextInvert = node.operator === '/' ? !invert : invert;
    collectMulFactors(node.right, nextInvert, factors);
  } else {
    factors.push({node, invert});
  }
}

/**
 * Combines two or more numeric/bigint literals in a * / chain around non-literals.
 * Skips mixed BigInt/Number. Skips bigint chains that include `/` (integer division would truncate).
 *
 * @param {ASTNode} node - Root * or / expression (children already simplified)
 * @return {ASTNode|null} Replacement tree, or null if flattening does not help
 */
function flattenMultiplicative(node) {
  const factors = [];
  collectMulFactors(node, false, factors);

  let coeff = null;
  let literalCount = 0;
  let hasBigInt = false;
  let hasNumber = false;
  let hasDivideLiteral = false;
  const nonLiterals = [];

  for (let i = 0; i < factors.length; i++) {
    const factor = factors[i];
    const value = getLiteralLikeValue(factor.node);

    if (value === NOT_LITERAL) {
      nonLiterals.push(factor);
      continue;
    }

    literalCount++;
    if (typeof value === 'bigint') {
      hasBigInt = true;
    } else {
      hasNumber = true;
    }
    if (factor.invert) {
      hasDivideLiteral = true;
    }
    if (hasBigInt && hasNumber) {
      return null;
    }

    if (coeff === null) {
      const identity = typeof value === 'bigint' ? 1n : 1;
      coeff = factor.invert ? identity / value : identity * value;
    } else if (factor.invert) {
      coeff = coeff / value;
    } else {
      coeff = coeff * value;
    }
  }

  if (literalCount < 2 || coeff === null) {
    return null;
  }
  if (hasBigInt && hasDivideLiteral) {
    return null;
  }

  let result = literalNodeFromValue(coeff);
  if (!result) {
    return null;
  }
  for (let i = 0; i < nonLiterals.length; i++) {
    result = createBinary(nonLiterals[i].invert ? '/' : '*', result, nonLiterals[i].node);
  }
  return result;
}

/**
 * Collects a left-assoc chain of `-` into a base and the subtracted operands.
 *
 * @param {ASTNode} node
 * @return {{base: ASTNode, subtracted: ASTNode[]}}
 */
function collectMinusTerms(node) {
  const subtracted = [];
  let current = node;
  while (current.type === 'BinaryExpression' && current.operator === '-') {
    subtracted.unshift(current.right);
    current = current.left;
  }
  return {base: current, subtracted};
}

/**
 * Combines two or more literals in a pure `-` chain (`a - 2 - 3` → `a - 5`).
 * Does not walk through `+` (string concat would make that unsafe).
 *
 * @param {ASTNode} node - Root `-` expression (children already simplified)
 * @return {ASTNode|null}
 */
/**
 * Collects a left-assoc `+` chain into terms (`a + 2 + 3` → [a, 2, 3]).
 *
 * @param {ASTNode} node
 * @return {ASTNode[]}
 */
function collectPlusTerms(node) {
  const terms = [];
  let current = node;
  while (current.type === 'BinaryExpression' && current.operator === '+') {
    terms.unshift(current.right);
    current = current.left;
  }
  terms.unshift(current);
  return terms;
}

/**
 * Merges only **adjacent** literal `+` siblings (`a + 2 + 3` → `a + 5`).
 * Does not jump an identifier (`2 + a + 3` stays). Two string literals concat.
 *
 * @param {ASTNode} node
 * @return {ASTNode|null}
 */
function flattenAdjacentLiteralPlus(node) {
  const terms = collectPlusTerms(node);
  if (terms.length < 3) {
    return null;
  }

  const merged = [];
  let changed = false;
  let i = 0;
  while (i < terms.length) {
    const value = getLiteralLikeValue(terms[i]);
    if (value === NOT_LITERAL) {
      merged.push(terms[i]);
      i++;
      continue;
    }
    let acc = value;
    let j = i + 1;
    while (j < terms.length) {
      const next = getLiteralLikeValue(terms[j]);
      if (next === NOT_LITERAL) {
        break;
      }
      acc = acc + next;
      changed = true;
      j++;
    }
    if (j === i + 1) {
      merged.push(terms[i]);
    } else {
      const lit = literalNodeFromValue(acc);
      if (!lit) {
        return null;
      }
      merged.push(lit);
    }
    i = j;
  }

  if (!changed || merged.length === terms.length) {
    return null;
  }

  let result = merged[0];
  for (let k = 1; k < merged.length; k++) {
    result = createBinary('+', result, merged[k]);
  }
  return result;
}

function flattenPureMinus(node) {
  const {base, subtracted} = collectMinusTerms(node);
  const remaining = [];
  let literalCount = 0;
  let subtractedSum = null;
  let resultBase = base;
  const baseValue = getLiteralLikeValue(base);

  if (baseValue !== NOT_LITERAL) {
    literalCount++;
    subtractedSum = baseValue;
    resultBase = null;
  }

  for (let i = 0; i < subtracted.length; i++) {
    const term = subtracted[i];
    const value = getLiteralLikeValue(term);
    if (value === NOT_LITERAL) {
      remaining.push(term);
      continue;
    }
    literalCount++;
    if (subtractedSum === null) {
      subtractedSum = value;
    } else if ((typeof subtractedSum === 'bigint') !== (typeof value === 'bigint')) {
      return null;
    } else if (resultBase === null) {
      // Base was a literal: apply JS `-` in encounter order
      subtractedSum = subtractedSum - value;
    } else {
      // Base is unknown: subtracted literals add together (`(a-2)-3 === a-(2+3)`)
      subtractedSum = subtractedSum + value;
    }
  }

  if (literalCount < 2) {
    return null;
  }

  let result;
  if (resultBase === null) {
    result = literalNodeFromValue(subtractedSum);
    if (!result) {
      return null;
    }
  } else {
    const sumNode = literalNodeFromValue(subtractedSum);
    if (!sumNode) {
      return null;
    }
    result = createBinary('-', resultBase, sumNode);
  }

  for (let i = 0; i < remaining.length; i++) {
    result = createBinary('-', result, remaining[i]);
  }
  return result;
}

/**
 * Recursively simplifies a binary/unary tree without evaluating source text.
 *
 * @param {ASTNode} node
 * @return {ASTNode}
 */
function simplifyNode(node) {
  if (!node) {
    return node;
  }

  if (node.type === 'UnaryExpression') {
    const argument = simplifyNode(node.argument);
    const argumentValue = getLiteralLikeValue(argument);
    if (argumentValue !== NOT_LITERAL && UNARY_OPERATORS.includes(node.operator)) {
      const folded = applyUnaryOp(node.operator, argumentValue);
      if (folded !== CANNOT_APPLY) {
        const replacement = literalNodeFromValue(folded);
        if (replacement) {
          return replacement;
        }
      }
    }
    if (argument !== node.argument) {
      return {
        type: 'UnaryExpression',
        operator: node.operator,
        prefix: node.prefix,
        argument,
      };
    }
    return node;
  }

  if (node.type !== 'BinaryExpression') {
    return node;
  }

  const left = simplifyNode(node.left);
  const right = simplifyNode(node.right);
  const leftValue = getLiteralLikeValue(left);
  const rightValue = getLiteralLikeValue(right);

  if (leftValue !== NOT_LITERAL && rightValue !== NOT_LITERAL) {
    const folded = applyBinaryOp(node.operator, leftValue, rightValue);
    if (folded !== CANNOT_APPLY) {
      const replacement = literalNodeFromValue(folded);
      if (replacement) {
        return replacement;
      }
    }
  }

  const simplified = left !== node.left || right !== node.right ?
    createBinary(node.operator, left, right) :
    node;

  if (MUL_OPERATORS.includes(node.operator)) {
    const flattened = flattenMultiplicative(simplified);
    if (flattened && !nodesEqual(flattened, simplified)) {
      return flattened;
    }
  }

  if (node.operator === '-') {
    const flattened = flattenPureMinus(simplified);
    if (flattened && !nodesEqual(flattened, simplified)) {
      return flattened;
    }
  }

  if (node.operator === '+') {
    const flattened = flattenAdjacentLiteralPlus(simplified);
    if (flattened && !nodesEqual(flattened, simplified)) {
      return flattened;
    }
  }

  return simplified;
}

/**
 * Finds root BinaryExpression nodes (parent is not another BinaryExpression) that can be simplified.
 *
 * @param {Arborist} arb - The Arborist instance containing the AST
 * @param {Function} candidateFilter - Filter function to apply to candidates
 * @return {ASTNode[]} Root binary expressions that simplify to a different tree
 */
export function resolveNestedBinaryExpressionsMatch(arb, candidateFilter = () => true) {
  const relevantNodes = arb.ast[0].typeMap.BinaryExpression;
  const matches = [];

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];
    if (n.parentNode?.type === 'BinaryExpression' || !candidateFilter(n)) {
      continue;
    }
    const replacement = simplifyNode(n);
    if (replacement && !nodesEqual(replacement, n)) {
      matches.push(n);
    }
  }

  return matches;
}

/**
 * Replaces a nested binary expression with its simplified form.
 *
 * @param {Arborist} arb - The Arborist instance to mark nodes for transformation
 * @param {ASTNode} n - Root BinaryExpression to simplify
 * @return {Arborist} The Arborist instance for chaining
 */
export function resolveNestedBinaryExpressionsTransform(arb, n) {
  const replacement = simplifyNode(n);
  if (replacement && !nodesEqual(replacement, n)) {
    arb.markNode(n, replacement);
  }
  return arb;
}

/**
 * Resolve nested BinaryExpression trees by applying JavaScript operators to known literals.
 * Does not use eval. Precedence and parentheses come from the AST.
 *
 * Fully literal subtrees fold (`1 + 2 * 2` → `5`, `'1' + 2` → `'12'`).
 * `*` / `/` literals can be regrouped around identifiers (`a * 2 * 3` → `6 * a`)
 * because those operators always coerce with ToNumber/ToBigInt.
 * Pure `-` chains can combine subtracted literals (`a - 2 - 3` → `a - 5`).
 * Adjacent literal `+` siblings fold (`a + 2 + 3` → `a + 5`); `+` does not
 * jump an identifier (`2 + a + 3` stays).
 * String results that reconstruct `debugger` are neutralized to `debugge_` via createNewNode.
 *
 * Transforms:
 *   2 * (5 + 1) - (4 / 2) + '1' * 2 → 12
 *   2 * (5 + 1) - (4 / 2) + '1' → '101'
 *   2 * (a + 0) - ((5 - 1) / 2) → 2 * (a + 0) - 2
 *
 * @param {Arborist} arb - The Arborist instance containing the AST
 * @param {Function} [candidateFilter] - Optional filter to apply to candidates
 * @return {Arborist} The Arborist instance for chaining
 */
export default function resolveNestedBinaryExpressions(arb, candidateFilter = () => true) {
  const matches = resolveNestedBinaryExpressionsMatch(arb, candidateFilter);

  for (let i = 0; i < matches.length; i++) {
    arb = resolveNestedBinaryExpressionsTransform(arb, matches[i]);
  }

  return arb;
}
