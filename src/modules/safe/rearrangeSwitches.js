import {getDescendants} from '../utils/getDescendants.js';

const MAX_REPETITION = 50;

/**
 * @param {ASTNode} node
 * @return {boolean}
 */
function isLiteralArrayExpression(node) {
  if (!node || node.type !== 'ArrayExpression' || !node.elements?.length) {
    return false;
  }
  for (let i = 0; i < node.elements.length; i++) {
    const el = node.elements[i];
    if (!el || el.type !== 'Literal') {
      return false;
    }
  }
  return true;
}

/**
 * Sequence values when the discriminant is `seq[i++]` (or `seq[i]`) and `seq` is
 * an array of literals. After resolvePureLiteralMethodCalls, `'2|0|1'.split('|')`
 * is that array.
 *
 * @param {ASTNode} discriminant
 * @return {*[]|null}
 */
function getSequencedArrayValues(discriminant) {
  if (!discriminant || discriminant.type !== 'MemberExpression') {
    return null;
  }
  const obj = discriminant.object;
  if (obj?.type !== 'Identifier') {
    return null;
  }
  const init = obj.declNode?.parentNode?.init;
  if (!isLiteralArrayExpression(init)) {
    return null;
  }
  const prop = discriminant.property;
  const isCursor = prop?.type === 'UpdateExpression' || prop?.type === 'Identifier';
  if (!isCursor) {
    return null;
  }
  const values = [];
  for (let i = 0; i < init.elements.length; i++) {
    values.push(init.elements[i].value);
  }
  return values;
}

/**
 * Find switch statements that can be linearized into sequential code.
 *
 * Identifies switch statements that use a discriminant which is either:
 * - An identifier with literal initialization and literal hops, or
 * - A sequenced array index (`seq[i++]`) whose binding is an array of literals
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter] a filter to apply on the candidates list. Defaults to true.
 * @return {Object[]} Matches with `{node, kind, sequenceValues?}`
 */
export function rearrangeSwitchesMatch(arb, candidateFilter = () => true) {
  const relevantNodes = arb.ast[0].typeMap.SwitchStatement;
  const matchingNodes = [];

  for (let i = 0; i < relevantNodes.length; i++) {
    const n = relevantNodes[i];
    if (!candidateFilter(n)) {
      continue;
    }
    if (n.discriminant.type === 'Identifier' &&
			n?.discriminant.declNode?.parentNode?.init?.type === 'Literal') {
      matchingNodes.push({node: n, kind: 'literal'});
      continue;
    }
    const sequenceValues = getSequencedArrayValues(n.discriminant);
    if (sequenceValues) {
      const cases = n.cases || [];
      let allLiteralTests = true;
      for (let j = 0; j < cases.length; j++) {
        if (cases[j].test && cases[j].test.type !== 'Literal') {
          allLiteralTests = false;
          break;
        }
      }
      if (allLiteralTests) {
        matchingNodes.push({node: n, kind: 'sequence', sequenceValues});
      }
    }
  }
  return matchingNodes;
}

/**
 * @param {ASTNode} stmt
 * @return {boolean}
 */
function isDispatcherJump(stmt) {
  return stmt.type === 'BreakStatement' || stmt.type === 'ContinueStatement';
}

/**
 * @param {ASTNode[]} cases
 * @param {*} currentVal
 * @return {ASTNode|undefined}
 */
function findMatchingCase(cases, currentVal) {
  let defaultCase;
  for (let i = 0; i < cases.length; i++) {
    if (!cases[i].test) {
      defaultCase = cases[i];
      continue;
    }
    if (cases[i].test?.value === currentVal) {
      return cases[i];
    }
  }
  return defaultCase;
}

/**
 * Linearize a switch whose discriminant is `seq[i++]` by walking array order.
 *
 * @param {Arborist} arb
 * @param {ASTNode} switchNode
 * @param {*[]} sequenceValues
 * @return {Arborist}
 */
function rearrangeSequencedSwitch(arb, switchNode, sequenceValues) {
  const ordered = [];
  const cases = switchNode.cases;
  const limit = Math.min(sequenceValues.length, MAX_REPETITION);

  for (let i = 0; i < limit; i++) {
    const currentCase = findMatchingCase(cases, sequenceValues[i]);
    if (!currentCase) {
      break;
    }
    for (let j = 0; j < currentCase.consequent.length; j++) {
      const stmt = currentCase.consequent[j];
      if (!isDispatcherJump(stmt)) {
        ordered.push(stmt);
      }
    }
  }

  if (ordered.length) {
    arb.markNode(switchNode, {
      type: 'BlockStatement',
      body: ordered,
    });
  }
  return arb;
}

export function rearrangeSwitchesTransform(arb, match) {
  const switchNode = match.node || match;
  if (match.kind === 'sequence') {
    return rearrangeSequencedSwitch(arb, switchNode, match.sequenceValues);
  }

  const ordered = [];
  const cases = switchNode.cases;
  let currentVal = switchNode.discriminant.declNode.parentNode.init.value;
  let counter = 0;

  // Trace execution path through switch cases
  while (currentVal !== undefined && counter < MAX_REPETITION) {
    // Find the matching case for current value (or default case)
    let currentCase;
    for (let i = 0; i < cases.length; i++) {
      if (cases[i].test?.value === currentVal || !cases[i].test) {
        currentCase = cases[i];
        break;
      }
    }
    if (!currentCase) break;

    // Collect all statements from this case (except break statements)
    for (let i = 0; i < currentCase.consequent.length; i++) {
      if (currentCase.consequent[i].type !== 'BreakStatement') {
        ordered.push(currentCase.consequent[i]);
      }
    }

    // Find assignments to discriminant variable to determine next case
    const allDescendants = [];
    for (let i = 0; i < currentCase.consequent.length; i++) {
      allDescendants.push(...getDescendants(currentCase.consequent[i]));
    }

    // Look for assignments to the switch discriminant variable
    const assignments2Next = allDescendants.filter(d =>
      d.declNode === switchNode.discriminant.declNode &&
			d.parentKey === 'left' &&
			d.parentNode.type === 'AssignmentExpression',
    );

    if (assignments2Next.length === 1) {
      // Single assignment found - use its value for next iteration
      currentVal = assignments2Next[0].parentNode.right.value;
    } else {
      // Multiple or no assignments - can't determine next case reliably
      currentVal = undefined;
    }
    ++counter;
  }

  // Replace switch with sequential block if we collected any statements
  if (ordered.length) {
    arb.markNode(switchNode, {
      type: 'BlockStatement',
      body: ordered,
    });
  }
  return arb;
}

/**
 * Rearrange switch statements with deterministic flow into sequential code blocks.
 *
 * Converts switch statements that use a control variable to sequence operations
 * into a linear sequence of statements. This is commonly seen in obfuscated code
 * where a simple sequence of operations is disguised as a switch statement.
 *
 * Example transformation:
 *   var state = 0;
 *   switch (state) {
 *     case 0: doFirst(); state = 1; break;
 *     case 1: doSecond(); state = 2; break;
 *     case 2: doThird(); break;
 *   }
 *
 * Becomes:
 *   doFirst();
 *   doSecond();
 *   doThird();
 *
 * @param {Arborist} arb
 * @param {Function} [candidateFilter] a filter to apply on the candidates list. Defaults to true.
 * @return {Arborist}
 */
export default function rearrangeSwitches(arb, candidateFilter = () => true) {
  const matchingNodes = rearrangeSwitchesMatch(arb, candidateFilter);
  for (let i = 0; i < matchingNodes.length; i++) {
    arb = rearrangeSwitchesTransform(arb, matchingNodes[i]);
  }
  return arb;
}