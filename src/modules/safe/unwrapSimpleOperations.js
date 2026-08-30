const BINARY_OPERATORS = ['+', '-', '*', '/', '%', '&', '|', '&&', '||', '**', '^', '<=', '>=', '<', '>', '==', '===', '!=',
  '!==', '<<', '>>', '>>>', 'in', 'instanceof', '??'];
const UNARY_OPERATORS = ['!', '~', '-', '+', 'typeof', 'void', 'delete', '--', '++'];
const BINARY_EXPRESSION_TYPES = ['LogicalExpression', 'BinaryExpression'];
const UNARY_EXPRESSION_TYPES = ['UnaryExpression', 'UpdateExpression'];

/**
 * Determines if a node is a simple binary or logical operation within a function wrapper.
 *
 * @param {ASTNode} n - The expression node to check
 * @return {boolean} True if the node is a binary/logical operation in a simple function wrapper
 */
/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isLiteralLikeOperand(node) {
  if (!node) {
    return false;
  }
  if (node.type === 'Literal') {
    return true;
  }
  return node.type === 'UnaryExpression' && node.argument?.type === 'Literal';
}

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isParamOperand(node) {
  return node?.type === 'Identifier' && node.declNode?.parentKey === 'params';
}

function isBinaryOrLogicalWrapper(n) {
  if (!BINARY_EXPRESSION_TYPES.includes(n.type) ||
		!BINARY_OPERATORS.includes(n.operator) ||
		n.parentNode.type !== 'ReturnStatement' ||
		n.parentNode.parentNode?.body?.length !== 1) {
    return false;
  }
  const leftOk = isParamOperand(n.left) || isLiteralLikeOperand(n.left);
  const rightOk = isParamOperand(n.right) || isLiteralLikeOperand(n.right);
  return leftOk && rightOk && (isParamOperand(n.left) || isParamOperand(n.right));
}

/**
 * Determines if a node is a simple unary or update operation within a function wrapper.
 *
 * @param {ASTNode} n - The expression node to check
 * @return {boolean} True if the node is a unary/update operation in a simple function wrapper
 */
function isUnaryOrUpdateWrapper(n) {
  return UNARY_EXPRESSION_TYPES.includes(n.type) &&
		UNARY_OPERATORS.includes(n.operator) &&
		n.parentNode.type === 'ReturnStatement' &&
		n.parentNode.parentNode?.body?.length === 1 &&
		n.argument?.declNode?.parentKey === 'params';
}

/**
 * Creates a unary or update expression node from the original operation.
 *
 * @param {ASTNode} operationNode - The original unary/update expression node
 * @param {ASTNode[]} args - The function call arguments to use as operands
 * @return {ASTNode} New unary or update expression node
 */
function createUnaryOrUpdateExpression(operationNode, args) {
  return {
    type: operationNode.type,
    operator: operationNode.operator,
    prefix: operationNode.prefix,
    argument: args[0],
  };
}

/**
 * Finds nodes representing simple operations wrapped in functions.
 *
 * Identifies operation expressions (binary, logical, unary, update) that are:
 * - Single statements in function return statements
 * - Use function parameters as operands
 * - Can be safely unwrapped to direct operation calls
 *
 * @param {Arborist} arb - The Arborist instance containing the AST
 * @param {Function} candidateFilter - Filter function to apply to candidates
 * @return {ASTNode[]} Array of operation nodes that can be unwrapped
 */
export function unwrapSimpleOperationsMatch(arb, candidateFilter = () => true) {
  const relevantNodes = arb.ast[0].typeMap.BinaryExpression
    .concat(arb.ast[0].typeMap.LogicalExpression)
    .concat(arb.ast[0].typeMap.UnaryExpression)
    .concat(arb.ast[0].typeMap.UpdateExpression);

  const matches = [];

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];

    if ((isBinaryOrLogicalWrapper(n) || isUnaryOrUpdateWrapper(n)) && candidateFilter(n)) {
      matches.push(n);
    }
  }

  return matches;
}

/**
 * Transforms a simple operation wrapper by replacing function calls with direct operations.
 *
 * Replaces function calls that wrap simple operations with the actual operation.
 * For example, `add(1, 2)` where `add` is `function add(a,b) { return a + b; }`
 * becomes `1 + 2`.
 *
 * @param {Arborist} arb - The Arborist instance to mark nodes for transformation
 * @param {ASTNode} n - The operation expression node within the function wrapper
 * @return {Arborist} The Arborist instance for chaining
 */
/**
 * @param {ASTNode} operand
 * @param {ASTNode[]} params
 * @param {ASTNode[]} args
 * @return {ASTNode|null}
 */
function resolveWrapperOperand(operand, params, args) {
  if (isLiteralLikeOperand(operand)) {
    return operand;
  }
  if (operand?.type === 'Identifier') {
    for (let i = 0; i < params.length; i++) {
      if (operand.declNode === params[i] || operand.name === params[i].name) {
        return args[i] || null;
      }
    }
  }
  return null;
}

export function unwrapSimpleOperationsTransform(arb, n) {
  const funcNode = n.scope.block;
  const references = funcNode?.id?.references || [];
  const params = funcNode?.params || [];

  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    const callExpression = ref.parentNode;

    if (callExpression.type === 'CallExpression') {
      let replacementNode = null;

      if (BINARY_EXPRESSION_TYPES.includes(n.type)) {
        const left = resolveWrapperOperand(n.left, params, callExpression.arguments || []);
        const right = resolveWrapperOperand(n.right, params, callExpression.arguments || []);
        if (left && right) {
          replacementNode = {
            type: n.type,
            operator: n.operator,
            left,
            right,
          };
        }
      } else if (UNARY_EXPRESSION_TYPES.includes(n.type) && callExpression.arguments.length === 1) {
        replacementNode = createUnaryOrUpdateExpression(n, callExpression.arguments);
      }

      if (replacementNode) {
        arb.markNode(callExpression, replacementNode);
      }
    }
  }

  return arb;
}

/**
 * Replace calls to functions that wrap simple operations with the actual operations.
 *
 * This optimization identifies function wrappers around simple operations (binary, logical,
 * unary, and update expressions) and replaces function calls with direct operations.
 * This removes unnecessary function call overhead for basic operations.
 *
 * Transforms:
 * ```javascript
 * function add(a, b) { return a + b; }
 * add(1, 2);
 * ```
 *
 * Into:
 * ```javascript
 * function add(a, b) { return a + b; }
 * 1 + 2;
 * ```
 *
 * @param {Arborist} arb - The Arborist instance containing the AST
 * @param {Function} [candidateFilter] - Optional filter to apply to candidates
 * @return {Arborist} The Arborist instance for chaining
 */
export default function unwrapSimpleOperations(arb, candidateFilter = () => true) {
  const matches = unwrapSimpleOperationsMatch(arb, candidateFilter);

  for (let i = 0; i < matches.length; i++) {
    arb = unwrapSimpleOperationsTransform(arb, matches[i]);
  }

  return arb;
}