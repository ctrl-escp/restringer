import {Sandbox} from '../utils/sandbox.js';
import {evalInVm} from '../utils/evalInVm.js';
import {getCache} from '../utils/getCache.js';
import {getCalleeName} from '../utils/getCalleeName.js';
import {isNodeInRanges} from '../utils/isNodeInRanges.js';
import {createOrderedSrc} from '../utils/createOrderedSrc.js';
import {getDeclarationWithContext} from '../utils/getDeclarationWithContext.js';
import {badValue, badArgumentTypes, skipIdentifiers, skipProperties} from '../config.js';

let appearances = new Map();
const cacheLimit = 100;

/**
 * @param {ASTNode} a
 * @param {ASTNode} b
 */
function sortByApperanceFrequency(a, b) {
	return appearances.get(getCalleeName(b)) - appearances.get(getCalleeName(a));
}

/**
 * @param {ASTNode} node
 * @return {number}
 */
function countAppearances(node) {
	const callee = getCalleeName(node);
	const count = (appearances.get(callee) || 0) + 1;
	appearances.set(callee, count);
	return count;
}

/**
 * Collect all available context on call expressions where the callee is defined in the script and attempt
 * to resolve their value.
 * @param {Arborist} arb
 * @param {Function} candidateFilter (optional) a filter to apply on the candidates list
 * @return {Arborist}
 */
export default function resolveLocalCalls(arb, candidateFilter = () => true) {
	appearances = new Map();
	const cache = getCache(arb.ast[0].scriptHash);
	const candidates = [];
	const relevantNodes = [
		...(arb.ast[0].typeMap.CallExpression || []),
	];
	for (let i = 0; i < relevantNodes.length; i++) {
		const n = relevantNodes[i];
		if ((n.callee?.declNode ||
			(n.callee?.object?.declNode &&
				!skipProperties.includes(n.callee.property?.value || n.callee.property?.name)) ||
			n.callee?.object?.type === 'Literal') &&
		countAppearances(n) &&
		candidateFilter(n)) {
			candidates.push(n);
		}
	}
	candidates.sort(sortByApperanceFrequency);

	const modifiedRanges = [];
	candidateLoop: for (let i = 0; i < candidates.length; i++) {
		const c = candidates[i];
		if (isNodeInRanges(c, modifiedRanges)) continue;
		for (let j = 0; j < c.arguments.length; j++) {
			const arg = c.arguments[j];
			if (badArgumentTypes.includes(arg.type)) continue candidateLoop;
		}
		const callee = c.callee?.object || c.callee;
		const declNode = c.callee?.declNode || c.callee?.object?.declNode;
		if (declNode?.parentNode?.body?.body?.[0]?.type === 'ReturnStatement') {
			// Leave this replacement to a safe function
			const returnArg = declNode.parentNode.body.body[0].argument;
			if (['Literal', 'Identifier'].includes(returnArg.type) || returnArg.type.includes('unction')) continue;   // Unwrap identifier
			else if (returnArg.type === 'CallExpression' &&
				returnArg.callee?.object?.type === 'FunctionExpression' &&
				(returnArg.callee.property?.name || returnArg.callee.property?.value) === 'apply') continue;    // Unwrap function shells
		}
		const cacheName = `rlc-${callee.name || callee.value}-${declNode?.nodeId}`;
		if (!cache[cacheName]) {
			cache[cacheName] = badValue;
			// Skip call expressions with problematic values
			if (skipIdentifiers.includes(callee.name) ||
				(callee.type === 'ArrayExpression' && !callee.elements.length) ||
				(callee.arguments || []).some(a => skipIdentifiers.includes(a) || a?.type === 'ThisExpression')) continue;
			if (declNode) {
				// Verify the declNode isn't a simple wrapper for an identifier
				if (declNode.parentNode.type === 'FunctionDeclaration' &&
					['Identifier', 'Literal'].includes(declNode.parentNode?.body?.body?.[0]?.argument?.type)) continue;
				const contextSb = new Sandbox();
				try {
					contextSb.run(createOrderedSrc(getDeclarationWithContext(declNode.parentNode)));
					if (Object.keys(cache) >= cacheLimit) cache.flush();
					cache[cacheName] = contextSb;
				} catch {}
			}
		}
		const contextVM = cache[cacheName];
		const nodeSrc = createOrderedSrc([c]);
		const replacementNode = contextVM === badValue ? evalInVm(nodeSrc) : evalInVm(nodeSrc, contextVM);
		if (replacementNode !== badValue && replacementNode.type !== 'FunctionDeclaration' && replacementNode.name !== 'undefined') {
			// Prevent resolving a function's toString as it might be an anti-debugging mechanism
			// which will spring if the code is beautified
			if (c.callee.type === 'MemberExpression' && (c.callee.property?.name || c.callee.property?.value) === 'toString' &&
				replacementNode?.value.substring(0, 8) === 'function') continue;
			arb.markNode(c, replacementNode);
			modifiedRanges.push(c.range);
		}
	}
	return arb;
}