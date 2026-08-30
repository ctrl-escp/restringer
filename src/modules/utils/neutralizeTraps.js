/**
 * Replaces unsafe atomic strings (literal values, identifier names, keys)
 * with predetermined safer counterparts before they are injected into the AST.
 */

const UNSAFE_STRINGS = [
  {trap: 'debugger', replaceWith: 'debugge_', ignoreCase: false},
];

const SKIP_WALK_KEYS = new Set([
  'parentNode',
  'childNodes',
  'descendants',
  'declNode',
  'references',
  'scope',
  'typeMap',
  'range',
  'loc',
  'src',
]);

/**
 * Returns a safer replacement when `value` is an unsafe string; otherwise returns `value`.
 * Non-strings pass through unchanged.
 *
 * @param {*} value - Literal value, identifier name, or property key
 * @return {*} The replacement string, or the original value
 */
export function neutralizeInjectedString(value) {
  if (typeof value !== 'string') {
    return value;
  }
  for (let i = 0; i < UNSAFE_STRINGS.length; i++) {
    const {trap, replaceWith, ignoreCase} = UNSAFE_STRINGS[i];
    const matched = ignoreCase ? value.toLowerCase() === trap.toLowerCase() : value === trap;
    if (matched) {
      return replaceWith;
    }
  }
  return value;
}

/**
 * Applies {@link neutralizeInjectedString} to Identifier names and string Literal
 * values on an injected subtree. Does not rewrite source text or DebuggerStatements.
 *
 * @param {ASTNode|*} node - Root of a newly created/parsed subtree
 * @return {ASTNode|*} The same node, mutated in place
 */
export function neutralizeInjectedNode(node) {
  if (!node || typeof node !== 'object') {
    return node;
  }

  const seen = new Set();
  const stack = [node];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (current.type === 'Identifier' && typeof current.name === 'string') {
      current.name = neutralizeInjectedString(current.name);
    } else if (current.type === 'Literal' && typeof current.value === 'string') {
      const next = neutralizeInjectedString(current.value);
      if (next !== current.value) {
        current.value = next;
        if (typeof current.raw === 'string') {
          current.raw = next;
        }
      }
    }

    if (Array.isArray(current.childNodes) && current.childNodes.length) {
      for (let i = 0; i < current.childNodes.length; i++) {
        stack.push(current.childNodes[i]);
      }
      continue;
    }

    const keys = Object.keys(current);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (SKIP_WALK_KEYS.has(key)) {
        continue;
      }
      const child = current[key];
      if (!child || typeof child !== 'object') {
        continue;
      }
      if (Array.isArray(child)) {
        for (let j = 0; j < child.length; j++) {
          stack.push(child[j]);
        }
      } else if (child.type) {
        stack.push(child);
      }
    }
  }

  return node;
}
