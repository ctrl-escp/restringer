/**
 * Shared truthiness and literal-value helpers for safe (no-eval) folding.
 * Used by if-statements, ternaries, NOT normalization, logicals, and JSFuck-style coercions.
 */

export const NOT_RESOLVABLE = Symbol('not-resolvable');

const ALWAYS_TRUTHY_NODE_TYPES = [
  'ArrayExpression',
  'ObjectExpression',
  'FunctionExpression',
  'ArrowFunctionExpression',
];

const LITERAL_IDENTIFIER_VALUES = {
  NaN,
  Infinity,
  undefined,
};

/**
 * Determines whether a JavaScript value is truthy.
 * Falsy: false, 0, -0, 0n, "", null, undefined, NaN.
 *
 * @param {*} value - Value to test
 * @return {boolean} Whether the value is truthy
 */
export function isLiteralTruthy(value) {
  if (value === false || value === 0 || value === -0 || value === 0n ||
		value === '' || value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'number' && value !== value) {
    return false;
  }
  return true;
}

/**
 * Determines the truthiness of an AST node when it can be decided statically.
 *
 * Always truthy: arrays, objects, functions, regex literals.
 * Literals use {@link isLiteralTruthy}.
 *
 * @param {ASTNode} node - AST node to test
 * @return {boolean|null} true/false when known, null when indeterminate
 */
export function isNodeTruthy(node) {
  if (!node) {
    return null;
  }
  if (ALWAYS_TRUTHY_NODE_TYPES.includes(node.type) || (node.type === 'Literal' && node.regex)) {
    return true;
  }
  if (node.type === 'Literal') {
    return isLiteralTruthy(node.value);
  }
  return null;
}

/**
 * Applies a unary operator to an already-resolved value using JavaScript semantics.
 *
 * @param {string} operator - Unary operator
 * @param {*} value - Operand
 * @return {*|symbol} Result, or NOT_RESOLVABLE if unsupported or it throws
 */
export function applyUnaryOp(operator, value) {
  try {
    switch (operator) {
      case '+':
        return +value;
      case '-':
        return -value;
      case '!':
        return !value;
      case '~':
        return ~value;
      case 'void':
        return undefined;
      case 'typeof':
        return typeof value;
      default:
        return NOT_RESOLVABLE;
    }
  } catch {
    return NOT_RESOLVABLE;
  }
}

/**
 * Applies a binary operator to two already-resolved values using JavaScript semantics.
 *
 * @param {string} operator - Binary operator
 * @param {*} left - Left operand
 * @param {*} right - Right operand
 * @return {*|symbol} Result, or NOT_RESOLVABLE if unsupported or it throws
 */
export function applyBinaryOp(operator, left, right) {
  try {
    switch (operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return left / right;
      case '%':
        return left % right;
      case '**':
        return left ** right;
      case '&':
        return left & right;
      case '|':
        return left | right;
      case '^':
        return left ^ right;
      case '<<':
        return left << right;
      case '>>':
        return left >> right;
      case '>>>':
        return left >>> right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '==':
        // Intentional loose equality to match JS `==` evaluation
        // eslint-disable-next-line eqeqeq
        return left == right;
      case '!=':
        // eslint-disable-next-line eqeqeq
        return left != right;
      case '===':
        return left === right;
      case '!==':
        return left !== right;
      default:
        return NOT_RESOLVABLE;
    }
  } catch {
    return NOT_RESOLVABLE;
  }
}

/**
 * Extracts a JavaScript value from a statically resolvable AST node.
 * Supports literals, empty template literals, undefined/NaN/Infinity, arrays of
 * resolvable elements (for ToPrimitive/ToString), objects as `{}` (truthiness /
 * ToString only), member access on those values (JSFuck `[][[]]`, `[].flat`),
 * `toString` calls with resolvable arguments (`(31).toString(32)`),
 * and nested unary/binary expressions over those values.
 *
 * @param {ASTNode} node - Node to evaluate
 * @return {*|symbol} The JS value, or NOT_RESOLVABLE
 */
export function evaluateResolvableValue(node) {
  if (!node || !node.type) {
    return NOT_RESOLVABLE;
  }

  switch (node.type) {
    case 'Literal':
      if (node.regex) {
        try {
          return new RegExp(node.regex.pattern, node.regex.flags);
        } catch {
          return NOT_RESOLVABLE;
        }
      }
      if (node.bigint !== undefined) {
        try {
          return BigInt(node.bigint);
        } catch {
          return NOT_RESOLVABLE;
        }
      }
      return node.value;

    case 'Identifier':
      if (Object.hasOwn(LITERAL_IDENTIFIER_VALUES, node.name)) {
        return LITERAL_IDENTIFIER_VALUES[node.name];
      }
      return NOT_RESOLVABLE;

    case 'TemplateLiteral':
      if (node.expressions?.length) {
        return NOT_RESOLVABLE;
      }
      return (node.quasis || []).map(quasi => quasi.value.cooked).join('');

    case 'ArrayExpression': {
      const elements = [];
      const src = node.elements || [];
      for (let i = 0; i < src.length; i++) {
        const element = src[i];
        if (!element) {
          elements.push(undefined);
          continue;
        }
        const value = evaluateResolvableValue(element);
        if (value === NOT_RESOLVABLE) {
          return NOT_RESOLVABLE;
        }
        elements.push(value);
      }
      return elements;
    }

    case 'ObjectExpression':
      return {};

    case 'UnaryExpression': {
      const argumentValue = evaluateResolvableValue(node.argument);
      if (argumentValue === NOT_RESOLVABLE) {
        return NOT_RESOLVABLE;
      }
      return applyUnaryOp(node.operator, argumentValue);
    }

    case 'BinaryExpression': {
      const left = evaluateResolvableValue(node.left);
      const right = evaluateResolvableValue(node.right);
      if (left === NOT_RESOLVABLE || right === NOT_RESOLVABLE) {
        return NOT_RESOLVABLE;
      }
      return applyBinaryOp(node.operator, left, right);
    }

    case 'MemberExpression':
      return evaluateMemberExpression(node);

    case 'CallExpression':
      return evaluateToStringCall(node);

    default:
      return NOT_RESOLVABLE;
  }
}

/**
 * Resolves `obj[prop]` / `obj.prop` when both sides are statically known.
 * Needed for JSFuck (`[][[]] + []` → `'undefined'`, `true + [].flat` → native function string).
 *
 * @param {ASTNode} node - MemberExpression node
 * @return {*|symbol} The JS value, or NOT_RESOLVABLE
 */
function evaluateMemberExpression(node) {
  if (node.optional) {
    return NOT_RESOLVABLE;
  }
  const objectValue = evaluateResolvableValue(node.object);
  if (objectValue === NOT_RESOLVABLE || objectValue === null || objectValue === undefined) {
    return NOT_RESOLVABLE;
  }

  let propertyKey;
  if (node.computed) {
    propertyKey = evaluateResolvableValue(node.property);
    if (propertyKey === NOT_RESOLVABLE) {
      return NOT_RESOLVABLE;
    }
  } else if (node.property?.type === 'Identifier') {
    propertyKey = node.property.name;
  } else {
    return NOT_RESOLVABLE;
  }

  try {
    return objectValue[propertyKey];
  } catch {
    return NOT_RESOLVABLE;
  }
}

/**
 * Resolves `value.toString(radix)` when the object and arguments are statically known.
 * JSFuck uses patterns like `(31).toString(32)` → `'v'`.
 *
 * @param {ASTNode} node - CallExpression node
 * @return {*|symbol} The JS value, or NOT_RESOLVABLE
 */
function evaluateToStringCall(node) {
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.optional || node.optional) {
    return NOT_RESOLVABLE;
  }

  let methodName;
  if (callee.computed) {
    methodName = evaluateResolvableValue(callee.property);
    if (methodName === NOT_RESOLVABLE) {
      return NOT_RESOLVABLE;
    }
  } else if (callee.property?.type === 'Identifier') {
    methodName = callee.property.name;
  } else {
    return NOT_RESOLVABLE;
  }
  if (methodName !== 'toString') {
    return NOT_RESOLVABLE;
  }

  const objectValue = evaluateResolvableValue(callee.object);
  if (objectValue === NOT_RESOLVABLE || objectValue === null || objectValue === undefined) {
    return NOT_RESOLVABLE;
  }

  const args = [];
  const src = node.arguments || [];
  for (let i = 0; i < src.length; i++) {
    const arg = src[i];
    if (!arg || arg.type === 'SpreadElement') {
      return NOT_RESOLVABLE;
    }
    const value = evaluateResolvableValue(arg);
    if (value === NOT_RESOLVABLE) {
      return NOT_RESOLVABLE;
    }
    args.push(value);
  }

  try {
    const toStringFn = objectValue.toString;
    if (typeof toStringFn !== 'function') {
      return NOT_RESOLVABLE;
    }
    return toStringFn.apply(objectValue, args);
  } catch {
    return NOT_RESOLVABLE;
  }
}
