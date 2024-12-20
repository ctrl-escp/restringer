const operators = ['+', '-', '*', '/', '%', '&', '|', '&&', '||', '**', '^', '<=', '>=', '<', '>', '==', '===', '!=',
	'!==', '<<', '>>', '>>>', 'in', 'instanceof', '??'];
const fixes = ['!', '~', '-', '+', 'typeof', 'void', 'delete', '--', '++']; // as in prefix and postfix operators

/**
 * @param {ASTNode} n
 * @return {boolean}
 */
function matchBinaryOrLogical(n) {
	return ['LogicalExpression', 'BinaryExpression'].includes(n.type) &&
		operators.includes(n.operator) &&
		n.parentNode.type === 'ReturnStatement' &&
		n.parentNode.parentNode?.body?.length === 1 &&
		n.left?.declNode?.parentKey === 'params' &&
		n.right?.declNode?.parentKey === 'params';
}

/**
 * @param {ASTNode} c
 * @param {Arborist} arb
 */
function handleBinaryOrLogical(c, arb) {
	const refs = (c.scope.block?.id?.references || []).map(r => r.parentNode);
	for (const ref of refs) {
		if (ref.type === 'CallExpression' && ref.arguments.length === 2) arb.markNode(ref, {
			type: c.type,
			operator: c.operator,
			left: ref.arguments[0],
			right: ref.arguments[1],
		});
	}
}

/**
 * @param {ASTNode} n
 * @return {boolean}
 */
function matchUnaryOrUpdate(n) {
	return ['UnaryExpression', 'UpdateExpression'].includes(n.type) &&
		fixes.includes(n.operator) &&
		n.parentNode.type === 'ReturnStatement' &&
		n.parentNode.parentNode?.body?.length === 1 &&
		n.argument?.declNode?.parentKey === 'params';
}

/**
 * @param {ASTNode} c
 * @param {Arborist} arb
 */
function handleUnaryAndUpdate(c, arb) {
	const refs = (c.scope.block?.id?.references || []).map(r => r.parentNode);
	for (const ref of refs) {
		if (ref.type === 'CallExpression' && ref.arguments.length === 1) arb.markNode(ref, {
			type: c.type,
			operator: c.operator,
			prefix: c.prefix,
			argument: ref.arguments[0],
		});
	}
}

/**
 * Replace calls to functions that wrap simple operations with the actual operations
 * @param {Arborist} arb
 * @param {Function} candidateFilter (optional) a filter to apply on the candidates list
 * @return {Arborist}
 */
function unwrapSimpleOperations(arb, candidateFilter = () => true) {
	const relevantNodes = [
		...(arb.ast[0].typeMap.BinaryExpression || []),
		...(arb.ast[0].typeMap.LogicalExpression || []),
		...(arb.ast[0].typeMap.UnaryExpression || []),
		...(arb.ast[0].typeMap.UpdateExpression || []),
	];
	for (let i = 0; i < relevantNodes.length; i++) {
		const n = relevantNodes[i];
		if ((matchBinaryOrLogical(n) || matchUnaryOrUpdate(n)) && candidateFilter(n)) {
			switch (n.type) {
				case 'BinaryExpression':
				case 'LogicalExpression':
					handleBinaryOrLogical(n, arb);
					break;
				case 'UnaryExpression':
				case 'UpdateExpression':
					handleUnaryAndUpdate(n, arb);
					break;
			}
		}
	}
	return arb;
}

export default unwrapSimpleOperations;