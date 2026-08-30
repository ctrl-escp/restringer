/**
 * Flatten javascript-obfuscator string-array factory + decoder calls.
 * Runs the emitted factory / rotator / decoder in the sandbox — does not reimplement RC4/base64.
 */
import {utils} from '../modules/index.js';
import {getDescendants} from '../modules/utils/getDescendants.js';

const {createOrderedSrc, evalInVm, getDeclarationWithContext} = utils.default;

/**
 * Memoized factory: function f() { const a = [...]; f = function () { return a; }; return f(); }
 *
 * @param {ASTNode} n - FunctionDeclaration
 * @return {boolean}
 */
function isMemoizedStringArrayFactory(n) {
  if (n.type !== 'FunctionDeclaration' || !n.id?.name || !n.body?.body?.length) {
    return false;
  }
  const name = n.id.name;
  const body = n.body.body;
  let hasArray = false;
  let selfAssign = false;
  let returnsSelfCall = false;

  for (let i = 0; i < body.length; i++) {
    const stmt = body[i];
    if (stmt.type === 'VariableDeclaration') {
      for (let j = 0; j < stmt.declarations.length; j++) {
        if (stmt.declarations[j].init?.type === 'ArrayExpression') {
          hasArray = true;
        }
      }
    }
    if (stmt.type === 'ExpressionStatement' &&
			stmt.expression?.type === 'AssignmentExpression' &&
			stmt.expression.left?.type === 'Identifier' &&
			stmt.expression.left.name === name) {
      selfAssign = true;
    }
    if (stmt.type === 'ReturnStatement' &&
			stmt.argument?.type === 'CallExpression' &&
			stmt.argument.callee?.type === 'Identifier' &&
			stmt.argument.callee.name === name) {
      returnsSelfCall = true;
    }
  }
  return hasArray && selfAssign && returnsSelfCall;
}

/**
 * @param {ASTNode} funcNode
 * @param {string} factoryName
 * @return {boolean}
 */
function functionCallsFactory(funcNode, factoryName) {
  const descendants = getDescendants(funcNode);
  for (let i = 0; i < descendants.length; i++) {
    const node = descendants[i];
    if (node.type === 'CallExpression' &&
			node.callee?.type === 'Identifier' &&
			node.callee.name === factoryName) {
      return true;
    }
  }
  return false;
}

/**
 * @param {ASTNode} call
 * @return {boolean}
 */
function allLiteralArgs(call) {
  const args = call.arguments || [];
  if (!args.length) {
    return false;
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg || arg.type === 'SpreadElement') {
      return false;
    }
    if (arg.type !== 'Literal' &&
			!(arg.type === 'UnaryExpression' && arg.argument?.type === 'Literal')) {
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
export function flattenStringArrayDecoderMatch(arb, candidateFilter = () => true) {
  const matches = [];
  const funcs = arb.ast[0].typeMap.FunctionDeclaration || [];
  const calls = arb.ast[0].typeMap.CallExpression || [];

  const factories = [];
  for (let i = 0; i < funcs.length; i++) {
    if (isMemoizedStringArrayFactory(funcs[i]) && candidateFilter(funcs[i])) {
      factories.push(funcs[i]);
    }
  }

  for (let i = 0; i < factories.length; i++) {
    const factory = factories[i];
    const factoryName = factory.id.name;
    const decoders = [];
    for (let j = 0; j < funcs.length; j++) {
      if (funcs[j] !== factory && functionCallsFactory(funcs[j], factoryName)) {
        decoders.push(funcs[j]);
      }
    }
    if (!decoders.length) {
      continue;
    }

    const decoderNames = new Set(decoders.map(d => d.id?.name).filter(Boolean));
    const literalCalls = [];
    for (let j = 0; j < calls.length; j++) {
      const call = calls[j];
      if (call.callee?.type === 'Identifier' &&
				decoderNames.has(call.callee.name) &&
				allLiteralArgs(call)) {
        literalCalls.push(call);
      }
    }
    if (literalCalls.length) {
      matches.push({factory, decoders, literalCalls});
    }
  }
  return matches;
}

/**
 * One sandbox eval of factory + decoder + the literal call list; replace calls with strings.
 *
 * @param {Arborist} arb
 * @param {Object} match
 * @return {Arborist}
 */
export function flattenStringArrayDecoderTransform(arb, match) {
  const {factory, decoders, literalCalls} = match;
  const contextParts = [factory.src];
  for (let i = 0; i < decoders.length; i++) {
    contextParts.push(decoders[i].src);
    const extra = getDeclarationWithContext(decoders[i], true);
    if (extra.length) {
      contextParts.push(createOrderedSrc(extra));
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
export default function flattenStringArrayDecoder(arb, candidateFilter = () => true) {
  const matches = flattenStringArrayDecoderMatch(arb, candidateFilter);
  for (let i = 0; i < matches.length; i++) {
    arb = flattenStringArrayDecoderTransform(arb, matches[i]);
  }
  return arb;
}
