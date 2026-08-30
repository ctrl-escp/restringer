/**
 * js-confuser product processor.
 *
 * Labels: `js_confuser_string_bank`, `js_confuser_state_machine`.
 * Sandbox-runs the emitted indexer / state loop — does not reimplement the bank cipher.
 */
import {utils} from '../modules/index.js';
import {getDescendants} from '../modules/utils/getDescendants.js';

const {createOrderedSrc, evalInVm, getDeclarationWithContext} = utils.default;

const MIN_BANK_LENGTH = 8;
const SHORT_STRING_MAX_LEN = 8;

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isStringLiteralArrayExpression(node) {
  if (!node || node.type !== 'ArrayExpression' || !node.elements?.length) {
    return false;
  }
  for (let i = 0; i < node.elements.length; i++) {
    const el = node.elements[i];
    if (!el || el.type !== 'Literal' || typeof el.value !== 'string') {
      return false;
    }
  }
  return true;
}

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isQualifyingStringBank(node) {
  if (!isStringLiteralArrayExpression(node) || node.elements.length < MIN_BANK_LENGTH) {
    return false;
  }
  let shortCount = 0;
  for (let i = 0; i < node.elements.length; i++) {
    if (node.elements[i].value.length <= SHORT_STRING_MAX_LEN) {
      shortCount++;
    }
  }
  return shortCount / node.elements.length > 0.5;
}

/**
 * Single-return indexer whose member property is not a bare identifier or literal.
 *
 * @param {ASTNode} funcNode
 * @return {boolean}
 */
function isNonTrivialBankIndexer(funcNode) {
  let ret = null;
  if (funcNode.body?.type === 'BlockStatement') {
    if (funcNode.body.body?.length === 1 && funcNode.body.body[0].type === 'ReturnStatement') {
      ret = funcNode.body.body[0].argument;
    }
  } else {
    ret = funcNode.body;
  }
  if (ret?.type !== 'MemberExpression' || !ret.property) {
    return false;
  }
  return ret.property.type !== 'Identifier' && ret.property.type !== 'Literal';
}

/**
 * @param {ASTNode} funcNode
 * @return {string|null}
 */
function getFunctionBindingName(funcNode) {
  if (funcNode.id?.name) {
    return funcNode.id.name;
  }
  const parent = funcNode.parentNode;
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return parent.id.name;
  }
  if (parent?.type === 'Property' && !parent.computed) {
    if (parent.key?.type === 'Identifier') {
      return parent.key.name;
    }
    if (parent.key?.type === 'Literal' && typeof parent.key.value === 'string') {
      return parent.key.value;
    }
  }
  return null;
}

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isLiteralLikeValue(node) {
  if (!node) {
    return false;
  }
  if (node.type === 'Literal') {
    return true;
  }
  if (node.type === 'UnaryExpression' && node.argument?.type === 'Literal') {
    return true;
  }
  if (node.type === 'ArrayExpression') {
    const els = node.elements || [];
    for (let i = 0; i < els.length; i++) {
      if (els[i] && !isLiteralLikeValue(els[i])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * @param {ASTNode} idNode
 * @return {boolean}
 */
function isBindingReassigned(idNode) {
  const refs = idNode.references || [];
  for (let i = 0; i < refs.length; i++) {
    const parent = refs[i].parentNode;
    if (parent?.type === 'AssignmentExpression' && refs[i].parentKey === 'left') {
      return true;
    }
    if (parent?.type === 'UpdateExpression') {
      return true;
    }
  }
  return false;
}

/**
 * @param {ASTNode} arg
 * @return {boolean}
 */
function isResolvableCallArg(arg) {
  if (!arg || arg.type === 'SpreadElement') {
    return false;
  }
  if (isLiteralLikeValue(arg)) {
    return true;
  }
  if (arg.type === 'Identifier' && arg.declNode) {
    const init = arg.declNode.parentNode?.init;
    return isLiteralLikeValue(init) && !isBindingReassigned(arg.declNode);
  }
  return false;
}

/**
 * @param {ASTNode} call
 * @return {boolean}
 */
function allResolvableArgs(call) {
  const args = call.arguments || [];
  if (!args.length) {
    return false;
  }
  for (let i = 0; i < args.length; i++) {
    if (!isResolvableCallArg(args[i])) {
      return false;
    }
  }
  return true;
}

/**
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Object[]}
 */
export function flattenJsConfuserStringBankMatch(arb, candidateFilter = () => true) {
  const arrays = arb.ast[0].typeMap.ArrayExpression || [];
  let hasBank = false;
  for (let i = 0; i < arrays.length; i++) {
    if (isQualifyingStringBank(arrays[i])) {
      hasBank = true;
      break;
    }
  }
  if (!hasBank) {
    return [];
  }

  const funcs = [
    ...(arb.ast[0].typeMap.FunctionDeclaration || []),
    ...(arb.ast[0].typeMap.FunctionExpression || []),
    ...(arb.ast[0].typeMap.ArrowFunctionExpression || []),
  ];
  const calls = arb.ast[0].typeMap.CallExpression || [];
  const matches = [];

  for (let i = 0; i < funcs.length; i++) {
    const func = funcs[i];
    if (!candidateFilter(func) || !isNonTrivialBankIndexer(func)) {
      continue;
    }
    const name = getFunctionBindingName(func);
    if (!name) {
      continue;
    }
    const literalCalls = [];
    for (let j = 0; j < calls.length; j++) {
      const call = calls[j];
      if (call.callee?.type === 'Identifier' &&
				call.callee.name === name &&
				allResolvableArgs(call)) {
        literalCalls.push(call);
      }
    }
    if (literalCalls.length) {
      matches.push({indexer: func, literalCalls});
    }
  }
  return matches;
}

/**
 * @param {Arborist} arb
 * @param {Object} match
 * @return {Arborist}
 */
export function flattenJsConfuserStringBankTransform(arb, match) {
  const {indexer, literalCalls} = match;
  const contextParts = [indexer.src];
  const extra = getDeclarationWithContext(indexer, true);
  if (extra.length) {
    contextParts.push(createOrderedSrc(extra));
  }
  for (let i = 0; i < literalCalls.length; i++) {
    const callExtra = getDeclarationWithContext(literalCalls[i], true);
    if (callExtra.length) {
      contextParts.push(createOrderedSrc(callExtra));
    }
  }
  const callSrcs = [];
  for (let i = 0; i < literalCalls.length; i++) {
    callSrcs.push(literalCalls[i].src);
  }
  const src = `${contextParts.join('\n')}\n[${callSrcs.join(',')}];`;
  const replacementNode = evalInVm(src);
  if (replacementNode === evalInVm.BAD_VALUE || replacementNode?.type !== 'ArrayExpression') {
    return arb;
  }
  const elements = replacementNode.elements || [];
  if (elements.length !== literalCalls.length) {
    return arb;
  }
  for (let i = 0; i < literalCalls.length; i++) {
    if (elements[i]) {
      arb.markNode(literalCalls[i], elements[i]);
    }
  }
  return arb;
}

/**
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Arborist}
 */
export function flattenJsConfuserStringBank(arb, candidateFilter = () => true) {
  const matches = flattenJsConfuserStringBankMatch(arb, candidateFilter);
  for (let i = 0; i < matches.length; i++) {
    arb = flattenJsConfuserStringBankTransform(arb, matches[i]);
  }
  return arb;
}

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isSumStatesTest(node) {
  if (!node) {
    return false;
  }
  if (node.type === 'BinaryExpression' &&
		node.left?.type === 'CallExpression' &&
		node.left.callee?.type === 'Identifier' &&
		(node.left.callee.name === 'sum' || node.left.callee.name === 'Sum') &&
		node.left.arguments?.length === 1) {
    return true;
  }
  if (node.type === 'BinaryExpression' &&
		node.left?.type === 'CallExpression' &&
		node.left.callee?.type === 'MemberExpression') {
    const prop = node.left.callee.property?.name || node.left.callee.property?.value;
    if (prop === 'reduce') {
      return true;
    }
  }
  if (node.type === 'BinaryExpression' && node.left) {
    let current = node.left;
    let memberAdds = 0;
    while (current?.type === 'BinaryExpression' && current.operator === '+') {
      if (current.right?.type === 'MemberExpression') {
        memberAdds++;
      }
      current = current.left;
    }
    if (current?.type === 'MemberExpression') {
      memberAdds++;
    }
    if (memberAdds >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function loopBodyHasDispatch(node) {
  const body = node.body?.type === 'BlockStatement' ? node.body.body : [node.body];
  for (let i = 0; i < body.length; i++) {
    if (body[i]?.type === 'SwitchStatement' || body[i]?.type === 'IfStatement') {
      return true;
    }
  }
  return false;
}

/**
 * Calls other than `sum` / `Sum` keep the loop live.
 *
 * @param {ASTNode} whileNode
 * @return {boolean}
 */
function loopHasExternalCalls(whileNode) {
  const descendants = getDescendants(whileNode);
  for (let i = 0; i < descendants.length; i++) {
    const n = descendants[i];
    if (n.type !== 'CallExpression') {
      continue;
    }
    if (n.callee?.type === 'Identifier' && (n.callee.name === 'sum' || n.callee.name === 'Sum')) {
      continue;
    }
    if (n.callee?.type === 'MemberExpression') {
      const prop = n.callee.property?.name || n.callee.property?.value;
      if (prop === 'reduce') {
        continue;
      }
    }
    return true;
  }
  return false;
}

/**
 * @param {ASTNode} whileNode
 * @return {Set<ASTNode>} Declaration identifiers assigned inside the loop
 */
function collectAssignedDeclIds(whileNode) {
  const decls = new Set();
  const descendants = getDescendants(whileNode);
  for (let i = 0; i < descendants.length; i++) {
    const n = descendants[i];
    if (n.type === 'AssignmentExpression' && n.left?.type === 'Identifier' && n.left.declNode) {
      decls.add(n.left.declNode);
    }
    if (n.type === 'UpdateExpression' && n.argument?.type === 'Identifier' && n.argument.declNode) {
      decls.add(n.argument.declNode);
    }
  }
  return decls;
}

/**
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {ASTNode[]}
 */
export function flattenJsConfuserStateMachineMatch(arb, candidateFilter = () => true) {
  const loops = [
    ...(arb.ast[0].typeMap.WhileStatement || []),
    ...(arb.ast[0].typeMap.DoWhileStatement || []),
  ];
  const matches = [];
  for (let i = 0; i < loops.length; i++) {
    const n = loops[i];
    if (!candidateFilter(n)) {
      continue;
    }
    if (!isSumStatesTest(n.test) || !loopBodyHasDispatch(n) || loopHasExternalCalls(n)) {
      continue;
    }
    matches.push(n);
  }
  return matches;
}

/**
 * @param {Arborist} arb
 * @param {ASTNode} whileNode
 * @return {Arborist}
 */
export function flattenJsConfuserStateMachineTransform(arb, whileNode) {
  const assignedDecls = [...collectAssignedDeclIds(whileNode)];
  if (!assignedDecls.length) {
    return arb;
  }
  const contextNodes = getDeclarationWithContext(whileNode, true);
  const names = [];
  for (let i = 0; i < assignedDecls.length; i++) {
    if (assignedDecls[i].name) {
      names.push(assignedDecls[i].name);
    }
  }
  if (!names.length) {
    return arb;
  }
  const snapshot = `({${names.map(n => `${n}:${n}`).join(',')}})`;
  const src = `${contextNodes.length ? createOrderedSrc(contextNodes) : ''}\n${whileNode.src}\n${snapshot};`;
  const replacementNode = evalInVm(src);
  if (replacementNode === evalInVm.BAD_VALUE || replacementNode?.type !== 'ObjectExpression') {
    return arb;
  }
  const props = replacementNode.properties || [];
  const valuesByName = new Map();
  for (let i = 0; i < props.length; i++) {
    const key = props[i].key;
    const name = key?.type === 'Identifier' ? key.name :
      (key?.type === 'Literal' ? String(key.value) : null);
    if (name && props[i].value) {
      valuesByName.set(name, props[i].value);
    }
  }
  for (let i = 0; i < assignedDecls.length; i++) {
    const declId = assignedDecls[i];
    const value = valuesByName.get(declId.name);
    if (!value) {
      continue;
    }
    const declarator = declId.parentNode;
    if (declarator?.type === 'VariableDeclarator' && declarator.init) {
      arb.markNode(declarator.init, value);
    }
  }
  arb.markNode(whileNode);
  return arb;
}

/**
 * @param {Arborist} arb
 * @param {Function} [candidateFilter]
 * @return {Arborist}
 */
export function flattenJsConfuserStateMachine(arb, candidateFilter = () => true) {
  const matches = flattenJsConfuserStateMachineMatch(arb, candidateFilter);
  for (let i = 0; i < matches.length; i++) {
    arb = flattenJsConfuserStateMachineTransform(arb, matches[i]);
  }
  return arb;
}

export const preprocessors = [
  flattenJsConfuserStringBank,
  flattenJsConfuserStateMachine,
];
export const postprocessors = [];
