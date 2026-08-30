import {evaluateResolvableValue, NOT_RESOLVABLE} from '../utils/literalTruthiness.js';

const BINARY_EXPRESSION_TYPES = ['BinaryExpression', 'LogicalExpression'];
const FIVE_LETTER_KEY = /^[A-Za-z]{5}$/;

/**
 * Product-specific javascript-obfuscator identifier shape (CFF storage keys).
 * Used so the generic “every property is a shell” rule does not have to be
 * loosened onto ordinary user objects — same idea as MIN_ARRAY_LENGTH.
 *
 * @param {string} name
 * @return {boolean}
 */
function isFiveLetterKey(name) {
  return FIVE_LETTER_KEY.test(name);
}

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isLiteralLikeProperty(node) {
  if (!node) {
    return false;
  }
  if (node.type === 'Literal') {
    return true;
  }
  if (node.type === 'UnaryExpression' && node.argument?.type === 'Literal') {
    return true;
  }
  return evaluateResolvableValue(node) !== NOT_RESOLVABLE &&
		(node.type === 'Literal' || node.type === 'UnaryExpression');
}

/**
 * Single-return function whose body is an operator or a call of the params.
 *
 * @param {ASTNode} node
 * @return {ASTNode|null} The returned expression, or null
 */
function getShellReturn(node) {
  if (!node) {
    return null;
  }
  let body = null;
  if (node.type === 'ArrowFunctionExpression') {
    if (node.body?.type === 'BlockStatement') {
      if (node.body.body?.length === 1 && node.body.body[0].type === 'ReturnStatement') {
        body = node.body.body[0].argument;
      }
    } else {
      body = node.body;
    }
  } else if (node.type === 'FunctionExpression') {
    if (node.body?.body?.length === 1 && node.body.body[0].type === 'ReturnStatement') {
      body = node.body.body[0].argument;
    }
  }
  if (!body) {
    return null;
  }
  if (BINARY_EXPRESSION_TYPES.includes(body.type) || body.type === 'UnaryExpression' || body.type === 'CallExpression') {
    return body;
  }
  return null;
}

/**
 * @param {ASTNode} prop - Object property
 * @return {string|null}
 */
function getPropertyKeyName(prop) {
  if (!prop || prop.type !== 'Property' || prop.computed) {
    return null;
  }
  if (prop.key.type === 'Identifier') {
    return prop.key.name;
  }
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
    return prop.key.value;
  }
  return null;
}

/**
 * @param {ASTNode} objExpr
 * @return {boolean}
 */
function everyPropertyIsShellOrLiteral(objExpr) {
  const props = objExpr.properties || [];
  if (!props.length) {
    return false;
  }
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (prop.type !== 'Property' || prop.kind !== 'init' || prop.method) {
      return false;
    }
    if (isLiteralLikeProperty(prop.value) || getShellReturn(prop.value)) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Generic matcher: every own property is a literal or a single-return shell.
 * Product extra: same rule when a majority of keys are 5-letter identifiers.
 *
 * @param {ASTNode} objExpr
 * @return {boolean}
 */
function isOperatorObject(objExpr) {
  if (!objExpr || objExpr.type !== 'ObjectExpression') {
    return false;
  }
  // Generic: every property is a literal or single-return shell (any keys).
  // Product extra (5-letter CFF keys): same property rule — do not loosen
  // this matcher onto arbitrary user objects. isFiveLetterKey documents the emit.
  return everyPropertyIsShellOrLiteral(objExpr);
}

/**
 * @param {ASTNode} idNode
 * @return {boolean}
 */
/**
 * True when the object binding is assigned or updated. Method calls (the call
 * sites we want to inline) are not treated as modifications — `add` is a
 * Set mutator name and would otherwise block CFF helper objects.
 *
 * @param {ASTNode[]} refs
 * @return {boolean}
 */
function isObjectBindingReassigned(refs) {
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const parent = ref.parentNode;
    if (!parent) {
      continue;
    }
    if (parent.type === 'AssignmentExpression' && ref.parentKey === 'left') {
      return true;
    }
    if (parent.type === 'UpdateExpression') {
      return true;
    }
    if (parent.type === 'MemberExpression' && parent.object === ref &&
			parent.parentNode?.type === 'AssignmentExpression' && parent.parentKey === 'left') {
      return true;
    }
  }
  return false;
}

function isPassedAsWhole(idNode) {
  const refs = idNode.references || [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const parent = ref.parentNode;
    if (!parent) {
      continue;
    }
    if (parent.type === 'CallExpression' && ref.parentKey !== 'callee' && parent.callee !== ref) {
      return true;
    }
    if (parent.type === 'AssignmentExpression' && ref.parentKey === 'right') {
      return true;
    }
    if (parent.type === 'ArrayExpression' || parent.type === 'ReturnStatement') {
      return true;
    }
  }
  return false;
}

/**
 * @param {ASTNode} objExpr
 * @param {string} keyName
 * @return {ASTNode|null}
 */
function findPropertyValue(objExpr, keyName) {
  const props = objExpr.properties || [];
  for (let i = 0; i < props.length; i++) {
    if (getPropertyKeyName(props[i]) === keyName) {
      return props[i].value;
    }
  }
  return null;
}

/**
 * @param {ASTNode} member
 * @return {string|null}
 */
function getMemberKeyName(member) {
  if (member.computed) {
    return member.property?.type === 'Literal' && typeof member.property.value === 'string' ?
      member.property.value : null;
  }
  return member.property?.type === 'Identifier' ? member.property.name : null;
}

/**
 * Map a shell operand (param or literal) onto a call's arguments.
 *
 * @param {ASTNode} operand
 * @param {ASTNode[]} params
 * @param {ASTNode[]} args
 * @return {ASTNode|null}
 */
function remapOperand(operand, params, args) {
  if (!operand) {
    return null;
  }
  if (operand.type === 'Literal' ||
		(operand.type === 'UnaryExpression' && operand.argument?.type === 'Literal')) {
    return operand;
  }
  if (operand.type === 'Identifier') {
    for (let i = 0; i < params.length; i++) {
      if (params[i] === operand.declNode || params[i].name === operand.name) {
        return args[i] || operand;
      }
    }
  }
  return null;
}

/**
 * @param {ASTNode} shellExpr
 * @param {ASTNode} funcNode
 * @param {ASTNode[]} args
 * @return {ASTNode|null}
 */
function instantiateShell(shellExpr, funcNode, args) {
  const params = funcNode.params || [];
  if (BINARY_EXPRESSION_TYPES.includes(shellExpr.type)) {
    const left = remapOperand(shellExpr.left, params, args);
    const right = remapOperand(shellExpr.right, params, args);
    if (!left || !right) {
      return null;
    }
    return {
      type: shellExpr.type,
      operator: shellExpr.operator,
      left,
      right,
    };
  }
  if (shellExpr.type === 'UnaryExpression') {
    const argument = remapOperand(shellExpr.argument, params, args);
    if (!argument) {
      return null;
    }
    return {
      type: 'UnaryExpression',
      operator: shellExpr.operator,
      prefix: shellExpr.prefix,
      argument,
    };
  }
  if (shellExpr.type === 'CallExpression' && shellExpr.callee?.type === 'Identifier') {
    const newArgs = [];
    const src = shellExpr.arguments || [];
    for (let i = 0; i < src.length; i++) {
      const mapped = remapOperand(src[i], params, args);
      if (!mapped) {
        return null;
      }
      newArgs.push(mapped);
    }
    return {
      type: 'CallExpression',
      callee: shellExpr.callee,
      arguments: newArgs,
    };
  }
  return null;
}

/**
 * Identifies object bindings that can be inlined at member reads and call sites.
 *
 * Generic: object is not reassigned; every property is a literal or single-return shell.
 * Product-specific extra: 5-letter keys (javascript-obfuscator CFF storage) use the same
 * property rule so a looser “any helper object” matcher is never required.
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Object[]}
 */
export function inlineOperatorObjectsMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const relevantNodes = arb.ast[0].typeMap.VariableDeclarator || [];

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];
    if (!candidateFilter(n) || n.init?.type !== 'ObjectExpression' || n.id?.type !== 'Identifier') {
      continue;
    }
    if (!isOperatorObject(n.init)) {
      continue;
    }
    const refs = n.id.references || [];
    if (!refs.length || isObjectBindingReassigned(refs) || isPassedAsWhole(n.id)) {
      continue;
    }
    matches.push({
      declarator: n,
      objectExpr: n.init,
      references: refs,
      fiveLetterKeys: (n.init.properties || []).filter(p => {
        const name = getPropertyKeyName(p);
        return name && isFiveLetterKey(name);
      }).length,
    });
  }
  return matches;
}

/**
 * @param {Arborist} arb
 * @param {Object} match
 * @return {Arborist}
 */
export function inlineOperatorObjectsTransform(arb, match) {
  const {objectExpr, references} = match;

  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    const member = ref.parentNode;
    if (!member || member.type !== 'MemberExpression' || member.object !== ref) {
      continue;
    }
    const keyName = getMemberKeyName(member);
    if (!keyName) {
      continue;
    }
    const propValue = findPropertyValue(objectExpr, keyName);
    if (!propValue) {
      continue;
    }

    if (member.parentNode?.type === 'CallExpression' && member.parentKey === 'callee') {
      const shell = getShellReturn(propValue);
      if (!shell) {
        continue;
      }
      const replacement = instantiateShell(shell, propValue, member.parentNode.arguments || []);
      if (replacement) {
        arb.markNode(member.parentNode, replacement);
      }
      continue;
    }

    if (isLiteralLikeProperty(propValue)) {
      arb.markNode(member, propValue);
    }
  }
  return arb;
}

/**
 * Inline readonly objects of operator/literal shells at their call sites and reads.
 *
 * ```js
 * const sto = { add(a, b) { return a + b; }, msg: 'ok' };
 * sto.add(u, v); sto.msg;
 * // → u + v; 'ok';
 * ```
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Arborist}
 */
export default function inlineOperatorObjects(arb, candidateFilter = () => true) {
  const matches = inlineOperatorObjectsMatch(arb, candidateFilter);
  for (let i = 0; i < matches.length; i++) {
    arb = inlineOperatorObjectsTransform(arb, matches[i]);
  }
  return arb;
}
