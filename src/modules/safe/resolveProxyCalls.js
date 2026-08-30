/**
 * Checks if a function contains only a single return statement with no other code.
 *
 * A proxy function candidate must have exactly one statement in its body,
 * and that statement must be a return statement. This ensures the function
 * doesn't perform any side effects beyond passing through arguments.
 *
 * @param {ASTNode} funcNode - The FunctionDeclaration node to check
 * @return {boolean} True if function has only a return statement
 */
function hasOnlyReturnStatement(funcNode) {
  if (!funcNode.body ||
		!funcNode.body.body ||
		funcNode?.body?.body?.length !== 1) {
    return false;
  }

  return funcNode?.body?.body[0]?.type === 'ReturnStatement';
}

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isLiteralLike(node) {
  if (!node) {
    return false;
  }
  if (node.type === 'Literal') {
    return true;
  }
  return node.type === 'UnaryExpression' && node.argument?.type === 'Literal';
}

/**
 * True when an inner-call argument is a param, a literal, or `param ± literal`.
 *
 * @param {ASTNode} arg
 * @param {Set<ASTNode>} paramDecls
 * @return {boolean}
 */
function isRemappableArg(arg, paramDecls) {
  if (!arg) {
    return false;
  }
  if (isLiteralLike(arg)) {
    return true;
  }
  if (arg.type === 'Identifier' && arg.declNode && paramDecls.has(arg.declNode)) {
    return true;
  }
  if (arg.type === 'BinaryExpression' && (arg.operator === '+' || arg.operator === '-')) {
    const leftParam = arg.left?.type === 'Identifier' && paramDecls.has(arg.left.declNode);
    const rightParam = arg.right?.type === 'Identifier' && paramDecls.has(arg.right.declNode);
    const leftLit = isLiteralLike(arg.left);
    const rightLit = isLiteralLike(arg.right);
    return (leftParam && rightLit) || (rightParam && leftLit) || (leftParam && rightParam);
  }
  return false;
}

/**
 * Arguments are a remap of params (permutation, unused extras, one literal / param±n OK).
 *
 * @param {ASTNode[]} params
 * @param {ASTNode[]} callArgs
 * @return {boolean}
 */
function areArgumentsRemappable(params, callArgs) {
  if (!params || !callArgs) {
    return false;
  }
  const paramDecls = new Set(params);
  for (let i = 0; i < callArgs.length; i++) {
    if (!isRemappableArg(callArgs[i], paramDecls)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {ASTNode} arg
 * @param {ASTNode[]} params
 * @param {ASTNode[]} outerArgs
 * @return {ASTNode|null}
 */
function remapArg(arg, params, outerArgs) {
  if (isLiteralLike(arg)) {
    return arg;
  }
  if (arg.type === 'Identifier') {
    for (let i = 0; i < params.length; i++) {
      if (arg.declNode === params[i] || arg.name === params[i].name) {
        return outerArgs[i] || arg;
      }
    }
    return arg;
  }
  if (arg.type === 'BinaryExpression') {
    const left = remapArg(arg.left, params, outerArgs);
    const right = remapArg(arg.right, params, outerArgs);
    if (!left || !right) {
      return null;
    }
    return {
      type: 'BinaryExpression',
      operator: arg.operator,
      left,
      right,
    };
  }
  return null;
}

/**
 * In-pass cycle guard: skip a→b when following proxy targets returns to a.
 *
 * @param {string} fromName
 * @param {string} toName
 * @param {Map<string, string>} proxyTargets
 * @return {boolean}
 */
function wouldCycle(fromName, toName, proxyTargets) {
  const seen = new Set([fromName]);
  let current = toName;
  while (current) {
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    current = proxyTargets.get(current);
  }
  return false;
}

/**
 * Identifies FunctionDeclaration nodes that act as proxy calls to other functions.
 *
 * A proxy function is one that:
 * 1. Contains only a single return statement
 * 2. Returns a call expression
 * 3. The call target is an identifier (not a complex expression)
 * 4. All parameters are passed through to the target in the same order
 * 5. No parameters are modified, reordered, or omitted
 *
 * This pattern is common in obfuscated code where simple wrapper functions
 * are used to indirect function calls.
 *
 * @param {Arborist} arb - The Arborist instance containing the AST
 * @param {Function} candidateFilter - Filter function to apply to candidates
 * @return {Object[]} Array of objects with funcNode, targetCallee, and references
 */
export function resolveProxyCallsMatch(arb, candidateFilter = () => true) {
  const relevantNodes = arb.ast[0].typeMap.FunctionDeclaration;
  const matches = [];

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];

    // Must pass the candidate filter
    if (!candidateFilter(n)) {
      continue;
    }

    // Must have only a return statement
    if (!hasOnlyReturnStatement(n)) {
      continue;
    }

    const returnStmt = n.body.body[0];
    const returnArg = returnStmt.argument;

    // Must return a call expression
    if (returnArg?.type !== 'CallExpression') {
      continue;
    }

    // Call target must be a simple identifier
    if (returnArg.callee?.type !== 'Identifier') {
      continue;
    }

    // Must have a function name with references to replace
    if (!n.id?.references?.length) {
      continue;
    }

    if (!areArgumentsRemappable(n.params, returnArg.arguments || [])) {
      continue;
    }

    matches.push({
      funcNode: n,
      targetCallee: returnArg.callee,
      innerArguments: returnArg.arguments || [],
      references: n.id.references,
    });
  }

  const proxyTargets = new Map();
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i].funcNode.id?.name;
    const target = matches[i].targetCallee?.name;
    if (name && target) {
      proxyTargets.set(name, target);
    }
  }

  const acyclic = [];
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i].funcNode.id?.name;
    const target = matches[i].targetCallee?.name;
    if (name && target && wouldCycle(name, target, proxyTargets)) {
      continue;
    }
    acyclic.push(matches[i]);
  }

  return acyclic;
}

/**
 * Transforms proxy function calls by replacing them with direct calls to the target function.
 *
 * For each reference to the proxy function, replaces it with a reference to the
 * target function that the proxy was calling. This eliminates the unnecessary
 * indirection and simplifies the call chain.
 *
 * @param {Arborist} arb - The Arborist instance to mark changes on
 * @param {Object} match - Match object containing funcNode, targetCallee, and references
 * @return {Arborist} The modified Arborist instance
 */
export function resolveProxyCallsTransform(arb, match) {
  const {funcNode, targetCallee, innerArguments, references} = match;
  const params = funcNode.params || [];
  const sameOrderPassthrough = innerArguments.length === params.length &&
		innerArguments.every((arg, idx) => arg.type === 'Identifier' &&
			(arg.declNode === params[idx] || arg.name === params[idx].name));

  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    const call = ref.parentNode;
    if (!sameOrderPassthrough && call?.type === 'CallExpression' && call.callee === ref) {
      const newArgs = [];
      for (let j = 0; j < innerArguments.length; j++) {
        const mapped = remapArg(innerArguments[j], params, call.arguments || []);
        if (!mapped) {
          newArgs.length = 0;
          break;
        }
        newArgs.push(mapped);
      }
      if (newArgs.length === innerArguments.length) {
        arb.markNode(call, {
          type: 'CallExpression',
          callee: targetCallee,
          arguments: newArgs,
        });
        continue;
      }
    }
    arb.markNode(ref, targetCallee);
  }

  return arb;
}

/**
 * Remove redundant call expressions which only pass the arguments to other call expression.
 *
 * This transformation identifies proxy functions that simply pass their arguments
 * to another function and replaces calls to the proxy with direct calls to the target.
 * This is particularly useful for deobfuscating code that uses wrapper functions
 * to indirect function calls.
 *
 * Example transformation:
 *   Input:  function call2(c, d) { return call1(c, d); } call2(1, 2);
 *   Output: function call2(c, d) { return call1(c, d); } call1(1, 2);
 *
 * Safety constraints:
 * - Only processes functions with single return statements
 * - Target must be a simple identifier (not complex expression)
 * - All parameters must be passed through in exact order
 * - No parameter modification, reordering, or omission allowed
 *
 * @param {Arborist} arb - The Arborist instance containing the AST to transform
 * @param {Function} [candidateFilter] - Optional filter to apply on candidates
 * @return {Arborist} The modified Arborist instance
 */
export default function resolveProxyCalls(arb, candidateFilter = () => true) {
  const matches = resolveProxyCallsMatch(arb, candidateFilter);

  for (let i = 0; i < matches.length; i++) {
    arb = resolveProxyCallsTransform(arb, matches[i]);
  }

  return arb;
}