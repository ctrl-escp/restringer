import {areReferencesModified} from '../utils/areReferencesModified.js';

/**
 * Checks if the target identifier name is shadowed by a different declaration
 * at the reference's scope, which would make replacement incorrect.
 */
function isTargetShadowedAtReference(ref, targetName, targetDeclNode) {
	let scope = ref.scope;
	while (scope) {
		const vars = scope.variables || [];
		for (let j = 0; j < vars.length; j++) {
			if (vars[j].name === targetName) {
				const ids = vars[j].identifiers || [];
				for (let k = 0; k < ids.length; k++) {
					if (ids[k] === targetDeclNode) {
						return false; // Same declaration = not shadowed
					}
				}
				return true; // Different declaration = shadowed
			}
		}
		scope = scope.upper;
	}
	return false;
}

/**
 * Validates that a VariableDeclarator represents a proxy variable assignment.
 * 
 * A proxy variable is one that simply assigns another identifier without modification.
 * For example: `const alias = originalVar;` where `alias` is a proxy to `originalVar`.
 * 
 * @param {ASTNode} declaratorNode - The VariableDeclarator node to check
 * @param {Function} candidateFilter - Filter function to apply additional criteria
 * @return {boolean} True if this is a valid proxy variable pattern
 */
function isProxyVariablePattern(declaratorNode, candidateFilter) {
	// Must have an identifier as the initialization value
	if (!declaratorNode.init || declaratorNode.init.type !== 'Identifier') {
		return false;
	}
	
	// Must pass the candidate filter
	if (!candidateFilter(declaratorNode)) {
		return false;
	}
	
	return true;
}

/**
 * Identifies VariableDeclarator nodes that represent proxy variables to other identifiers.
 * 
 * A proxy variable is a declaration like `const alias = originalVar;` where the variable
 * simply points to another identifier. These can either be removed (if unused) or have
 * all their references replaced with the target identifier.
 * 
 * This function finds all such proxy variables and returns them along with their
 * reference information for transformation.
 * 
 * @param {Arborist} arb - The AST tree manager
 * @param {Function} candidateFilter - Filter to apply on candidate nodes
 * @return {Object[]} Array of match objects containing proxy info
 */
export function resolveProxyVariablesMatch(arb, candidateFilter = () => true) {
	const relevantNodes = arb.ast[0].typeMap.VariableDeclarator;
	const matches = [];
	
	for (let i = 0; i < relevantNodes.length; i++) {
		const n = relevantNodes[i];
		
		// Must be a valid proxy variable pattern
		if (!isProxyVariablePattern(n, candidateFilter)) {
			continue;
		}
		
		// Get references to this proxy variable
		const refs = n.id?.references || [];
		
		// Add to matches - we'll handle both removal and replacement in transform
		matches.push({
			declaratorNode: n,
			targetIdentifier: n.init,
			references: refs,
			shouldRemove: refs.length === 0
		});
	}
	
	return matches;
}

/**
 * Transforms proxy variable declarations by either removing them or replacing references.
 * 
 * For proxy variables with no references, removes the entire declaration.
 * For proxy variables with references, replaces all references with the target identifier
 * if the references are not modified elsewhere.
 * 
 * @param {Arborist} arb - The AST tree manager
 * @param {Object} match - Match object from resolveProxyVariablesMatch
 * @return {Arborist} The modified AST tree manager
 */
export function resolveProxyVariablesTransform(arb, match) {
	const {declaratorNode, targetIdentifier, references, shouldRemove} = match;
	
	if (shouldRemove) {
		// Remove the proxy assignment if there are no references
		arb.markNode(declaratorNode);
	} else {
		// Check if references are modified - if so, skip transformation
		if (areReferencesModified(arb.ast, references)) {
			return arb;
		}
		// Also check if the TARGET variable's references are modified
		const targetRefs = targetIdentifier.declNode?.references || [];
		if (areReferencesModified(arb.ast, targetRefs)) {
			return arb;
		}

		// Replace all references with the target identifier
		for (let i = 0; i < references.length; i++) {
			const ref = references[i];
			// Skip if target name is shadowed by a different declaration at this reference
			if (isTargetShadowedAtReference(ref, targetIdentifier.name, targetIdentifier.declNode)) {
				continue;
			}
			arb.markNode(ref, targetIdentifier);
		}
	}

	return arb;
}

/**
 * Replace proxied variables with their intended target.
 * 
 * This module handles simple variable assignments where one identifier is assigned
 * to another identifier, creating a "proxy" relationship. It either removes unused
 * proxy assignments or replaces all references to the proxy with the original identifier.
 * 
 * Examples of transformations:
 * - `const alias = original; console.log(alias);` → `console.log(original);`
 * - `const unused = original;` → (removed entirely)
 * - `const a2b = atob; console.log(a2b('test'));` → `console.log(atob('test'));`
 * 
 * Safety considerations:
 * - Only transforms when references are not modified (no assignments or updates)
 * - Preserves program semantics by ensuring proxy and target are equivalent
 * - Removes unused declarations to clean up dead code
 * 
 * @param {Arborist} arb - The AST tree manager
 * @param {Function} [candidateFilter] - Optional filter to apply on candidates
 * @return {Arborist} The modified AST tree manager
 */
export default function resolveProxyVariables(arb, candidateFilter = () => true) {
	const matches = resolveProxyVariablesMatch(arb, candidateFilter);
	
	// Separate matches into safe and unsafe batches
	const safeMatches = [];
	const unsafeMatches = [];

	// Pre-validate all matches before applying any changes
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const {declaratorNode, targetIdentifier, references, shouldRemove} = match;
		const proxyName = declaratorNode.id?.name || '?';
		const targetName = targetIdentifier?.name || '?';

		// Skip self-replacements (proxy name === target name)
		// These are no-ops and waste processing time
		if (proxyName === targetName) {
			continue;
		}

		if (shouldRemove) {
			// Unused proxies are always safe to remove
			safeMatches.push(match);
		} else {
			// Check safety conditions using original AST state
			if (!areReferencesModified(arb.ast, references)) {
				const targetRefs = targetIdentifier.declNode?.references || [];
				if (!areReferencesModified(arb.ast, targetRefs)) {
					// Check shadowing for each reference
					let allRefsSafe = true;
					for (let j = 0; j < references.length; j++) {
						if (isTargetShadowedAtReference(references[j], targetIdentifier.name, targetIdentifier.declNode)) {
							allRefsSafe = false;
							break;
						}
					}
					if (allRefsSafe) {
						safeMatches.push(match);
						continue;
					}
				}
			}
			unsafeMatches.push(match);
		}
	}

	// Apply all safe replacements in one batch
	for (let i = 0; i < safeMatches.length; i++) {
		arb = resolveProxyVariablesTransform(arb, safeMatches[i]);
	}
	
	return arb;
}