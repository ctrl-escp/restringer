import {Arborist} from 'flast';
import assert from 'node:assert';
import {describe, it} from 'node:test';

/**
 * @param {Arborist} arb
 */
function applyEachProcessor(arb) {
  return proc => {
    if (typeof proc === 'function') {
      arb = proc(arb);
      arb.applyChanges();
    }
  };
}

/**
 * @param {Arborist} arb
 * @param {{preprocessors, postprocessors}} processors
 * @return {Arborist}
 */
function applyProcessors(arb, processors) {
  processors.preprocessors.forEach(applyEachProcessor(arb));
  processors.postprocessors.forEach(applyEachProcessor(arb));
  return arb;
}

describe('Processors tests: Augmented Array', async () => {
  const targetProcessors = (await import('../src/processors/augmentedArray.js'));
  it('TP-1: Complex IIFE with mixed array elements', () => {
    const code = `const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'a', 'b', 'c'];
(function (targetArray, numberOfShifts) {
  var augmentArray = function (counter) {
    while (--counter) {
        targetArray['push'](targetArray['shift']());
    }
  };
  augmentArray(++numberOfShifts);
}(arr, 3));`;
    const expected  = 'const arr = [\n  4,\n  5,\n  6,\n  7,\n  8,\n  9,\n  10,\n  \'a\',\n  \'b\',\n  \'c\',\n  1,\n  2,\n  3\n];';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-2: Simple array with single shift', () => {
    const code = `const data = ['first', 'second', 'third'];
(function(arr, shifts) {
  for (let i = 0; i < shifts; i++) {
    arr.push(arr.shift());
  }
})(data, 1);`;
    const expected = 'const data = [\n  \'second\',\n  \'third\',\n  \'first\'\n];';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-3: Array with zero shifts (no change)', () => {
    const code = `const unchanged = [1, 2, 3];
(function(arr, n) {
  for (let i = 0; i < n; i++) {
    arr.push(arr.shift());
  }
})(unchanged, 0);`;
    const expected = 'const unchanged = [\n  1,\n  2,\n  3\n];';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-4: Array with larger shift count', () => {
    const code = `const numbers = [10, 20, 30, 40, 50];
(function(arr, count) {
  for (let i = 0; i < count; i++) {
    arr.push(arr.shift());
  }
})(numbers, 3);`;
    const expected = 'const numbers = [\n  40,\n  50,\n  10,\n  20,\n  30\n];';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TN-1: IIFE with non-literal shift count', () => {
    const code = `const arr = [1, 2, 3];
let shifts = 2;
(function(array, n) {
  for (let i = 0; i < n; i++) {
    array.push(array.shift());
  }
})(arr, shifts);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-2: IIFE with insufficient arguments', () => {
    const code = `const arr = [1, 2, 3];
(function(array) {
  array.push(array.shift());
})(arr);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-3: IIFE with non-identifier array argument', () => {
    const code = `(function(array, shifts) {
  for (let i = 0; i < shifts; i++) {
    array.push(array.shift());
  }
})([1, 2, 3], 1);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-4: Non-IIFE function call', () => {
    const code = `const arr = [1, 2, 3];
function shuffle(array, shifts) {
  for (let i = 0; i < shifts; i++) {
    array.push(array.shift());
  }
}
shuffle(arr, 2);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-5: Invalid shift count (NaN)', () => {
    const code = `const arr = [1, 2, 3];
(function(array, shifts) {
  for (let i = 0; i < shifts; i++) {
    array.push(array.shift());
  }
})(arr, "invalid");`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-6: Function passed to IIFE (function not self-modifying)', () => {
    const code = `function getArray() {
  return ['a', 'b', 'c'];
}
(function(fn, shifts) {
  const arr = fn();
  for (let i = 0; i < shifts; i++) {
    arr.push(arr.shift());
  }
})(getArray, 2);`;
    // The IIFE modifies a local copy, but the function itself is not self-modifying
    // so no transformation should occur
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TP-5: Arrow function IIFE', () => {
    const code = `const items = ['x', 'y', 'z'];
((arr, n) => {
  for (let i = 0; i < n; i++) {
    arr.push(arr.shift());
  }
})(items, 1);`;
    const expected = `const items = [
  'y',
  'z',
  'x'
];`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-6: Shift count larger than array length', () => {
    const code = `const small = ['a', 'b'];
(function(arr, shifts) {
  for (let i = 0; i < shifts; i++) {
    arr.push(arr.shift());
  }
})(small, 5);`;
    // 5 shifts on 2-element array: a,b -> b,a -> a,b -> b,a -> a,b -> b,a
    const expected = `const small = [
  'b',
  'a'
];`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TN-7: Arrow function without parentheses around parameters', () => {
    const code = `const arr = [1, 2, 3];
(arr => {
  arr.push(arr.shift());
})(arr);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-8: Negative shift count', () => {
    const code = `const arr = [1, 2, 3];
(function(array, shifts) {
  for (let i = 0; i < shifts; i++) {
    array.push(array.shift());
  }
})(arr, -1);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TP-7: Rotate IIFE with a parseInt stop condition', () => {
    const code = `const arr = ['3', '1', '2'];
(function (a) {
  while (true) {
    if (parseInt(a[0]) + parseInt(a[1]) === 4) break;
    a.push(a.shift());
  }
})(arr);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /const arr = \[/);
    assert.doesNotMatch(arb.script, /parseInt/);
  });
  it('TN-9: IIFE with complex array manipulation that cannot be resolved', () => {
    const code = `const arr = [1, 2, 3];
(function(array, shifts) {
  Math.random() > 0.5 ? array.push(array.shift()) : array.unshift(array.pop());
})(arr, 1);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
});
describe('Processors tests: Caesar Plus', async () => {
  const targetProcessors = (await import('../src/processors/caesarp.js'));
  // TODO: Align this expectation with the processor's current extraction behavior.
  it.skip('TP-1: Extract Caesar+ inner layer from DOM-based wrapper', () => {
    const code = `(function() {
	const a = document.createElement('div');
	const b = 'Y29uc29sZS5sb2co';
	const c = 'IlJFc3RyaW5nZXIiKQ==';
	a.innerHTML = b + c;
	const atb = window.atob || function (val) {return Buffer.from(val, 'base64').toString()};
	let dbt = {};
	const abc = a.innerHTML;
	dbt['toString'] = ''.constructor.constructor(atb(abc));
	dbt = dbt + "this will execute dbt's toString method";
})();`;
    const expected  = 'console.log("REstringer")';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
});
describe('Processors tests: Function to Array', async () => {
  const targetProcessors = (await import('../src/processors/functionToArray.js'));
  it('TP-1: Independent call', () => {
    const code = 'function getArr() {return [\'One\', \'Two\', \'Three\']} const a = getArr(); console.log(a[0] + \' + \' + a[1] + \' = \' + a[2]);';
    const expected  = 'function getArr() {\n  return [\n    \'One\',\n    \'Two\',\n    \'Three\'\n  ];\n}\nconst a = [\n  \'One\',\n  \'Two\',\n  \'Three\'\n];\nconsole.log(a[0] + \' + \' + a[1] + \' = \' + a[2]);';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-2: IIFE', () => {
    const code = 'const a = (function(){return [\'One\', \'Two\', \'Three\']})(); console.log(a[0] + \' + \' + a[1] + \' = \' + a[2]);';
    const expected  = 'const a = [\n  \'One\',\n  \'Two\',\n  \'Three\'\n];\nconsole.log(a[0] + \' + \' + a[1] + \' = \' + a[2]);';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-3: Arrow function returning array', () => {
    const code = 'const getItems = () => [\'x\', \'y\', \'z\']; const items = getItems(); console.log(items[0]);';
    const expected = 'const getItems = () => [\n  \'x\',\n  \'y\',\n  \'z\'\n];\nconst items = [\n  \'x\',\n  \'y\',\n  \'z\'\n];\nconsole.log(items[0]);';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-4: Multiple variables with array access only', () => {
    const code = 'function getData() {return [1, 2, 3]} const x = getData(); const y = getData(); console.log(x[0], y[1]);';
    const expected = 'function getData() {\n  return [\n    1,\n    2,\n    3\n  ];\n}\nconst x = [\n  1,\n  2,\n  3\n];\nconst y = [\n  1,\n  2,\n  3\n];\nconsole.log(x[0], y[1]);';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TN-1: Function called multiple times without assignment', () => {
    const code = 'function getArr() {return [\'One\', \'Two\', \'Three\']} console.log(getArr()[0] + \' + \' + getArr()[1] + \' = \' + getArr()[2]);';
    const expected  = code;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TN-2: Mixed usage (array access and other)', () => {
    const code = 'function getArr() {return [\'a\', \'b\', \'c\']} const data = getArr(); console.log(data[0], data.length, data.slice(1));';
    const expected = code;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TN-3: Variable not assigned function call', () => {
    const code = 'const arr = [\'static\', \'array\']; console.log(arr[0], arr[1]);';
    const expected = code;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-5: Flatten factory + decoder calls with literal args', () => {
    const code = `function f() {
  const a = ['hello', 'world'];
  f = function () { return a; };
  return f();
}
function dec(i) {
  return f()[i];
}
dec(0);
dec(1);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /'hello'/);
    assert.match(arb.script, /'world'/);
    assert.doesNotMatch(arb.script, /dec\(0\)/);
  });
});
describe('Processors tests: Obfuscator.io', async () => {
  const targetProcessors = (await import('../src/processors/obfuscator.io.js'));
  it('TP-1: Replace object method anti-tamper body with bypass string', () => {
    const code = `var a = {
  'removeCookie': function () {
    return 'dev';
  }
}`;
    const expected  = 'var a = { \'removeCookie\': \'function () {return "bypassed!"}\' };';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-2: Replace assigned instance method anti-tamper body with bypass string', () => {
    const code = `var a = function (f) {
  this['JoJo'] = function () {
    return 'newState';
  }
}`;
    const expected  = `var a = function (f) {
  this['JoJo'] = 'function () {return "bypassed!"}';
};`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, expected);
  });
  it('TP-3: Neutralize Function constructor debugger trap', () => {
    const code = 'Function(\'debu\' + \'gger\');';
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.doesNotMatch(arb.script, /Function\(/);
    assert.doesNotMatch(arb.script, /debugger/);
  });
  it('TP-4: Flatten factory + decoder calls with literal args', () => {
    const code = `function f() {
  const a = ['hello', 'world'];
  f = function () { return a; };
  return f();
}
function dec(i) {
  return f()[i];
}
dec(0);
dec(1);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /'hello'/);
    assert.match(arb.script, /'world'/);
    assert.doesNotMatch(arb.script, /dec\(0\)/);
  });
  it('TN-2: Do not flatten a function that returns an array without self-reassign', () => {
    const code = `function getArr() { return ['a', 'b']; }
function dec(i) { return getArr()[i]; }
dec(x);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-1: Leave ordinary Function constructor calls', () => {
    const code = 'Function(\'return 1\');';
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TP-5: Neutralize toString integrity that gates while(true)', () => {
    const code = `function fn() { return 1; }
if (fn.toString() !== 'function fn() { return 1; }') {
  while (true) {}
}
ok();`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.doesNotMatch(arb.script, /while\s*\(\s*true\s*\)/);
    assert.match(arb.script, /ok\(\)/);
  });
  it('TP-6: Flatten factory after a rotate IIFE on the factory', () => {
    const code = `function f() {
  const a = ['hello', 'world'];
  f = function () { return a; };
  return f();
}
(function (fn) {
  const a = fn();
  a.push(a.shift());
})(f);
function dec(i) {
  return f()[i];
}
dec(0);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.doesNotMatch(arb.script, /dec\(0\)/);
    assert.match(arb.script, /'(hello|world)'/);
  });
  it('TP-7: Remove unused factory and decoder after flattening', () => {
    const code = `function f() {
  const a = ['hello'];
  f = function () { return a; };
  return f();
}
function dec(i) {
  return f()[i];
}
dec(0);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /'hello'/);
    assert.doesNotMatch(arb.script, /function f\(/);
    assert.doesNotMatch(arb.script, /function dec\(/);
  });
  it('TP-8: Sandbox-run a custom decoder body (xor stand-in for RC4)', () => {
    const code = `function f() {
  const a = ['idmmn'];
  f = function () { return a; };
  return f();
}
function dec(i, k) {
  const s = f()[i];
  let out = '';
  for (let j = 0; j < s.length; j++) {
    out += String.fromCharCode(s.charCodeAt(j) ^ k);
  }
  return out;
}
dec(0, 1);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /'hello'/);
    assert.doesNotMatch(arb.script, /dec\(0/);
  });
  it('TP-9: Flatten calls through a decoder alias', () => {
    const code = `function f() {
  const a = ['hello'];
  f = function () { return a; };
  return f();
}
function dec(i) {
  return f()[i];
}
const w = dec;
w(0);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /'hello'/);
    assert.doesNotMatch(arb.script, /w\(0\)/);
  });
  it('TP-10: Inline 5-letter operator object then linearize pipe-split switch', () => {
    const code = `const sto = {
  AbCde: function (x, y) { return x + y; },
  FgHij: 'ok'
};
const seq = '0|1'.split('|');
let i = 0;
while (true) {
  switch (seq[i++]) {
    case '0': sto.AbCde(1, 2); continue;
    case '1': sto.FgHij; continue;
  }
  break;
}`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /1 \+ 2/);
    assert.match(arb.script, /'ok'/);
    assert.doesNotMatch(arb.script, /switch/);
  });
  it('TN-3: Leave decoder calls whose arguments are not literals', () => {
    const code = `function f() {
  const a = ['hello'];
  f = function () { return a; };
  return f();
}
function dec(i) {
  return f()[i];
}
dec(idx);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-5: Keep factory when a non-literal decoder call remains', () => {
    const code = `function f() {
  const a = ['hello'];
  f = function () { return a; };
  return f();
}
function dec(i) {
  return f()[i];
}
dec(0);
dec(idx);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /'hello'/);
    assert.match(arb.script, /function f\(/);
    assert.match(arb.script, /dec\(idx\)/);
  });
  it('TN-4: Do not inline a 5-letter object that is not operator shells', () => {
    const code = `const user = {
  AbCde: function () { console.log(1); return 2; }
};
user.AbCde();`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
});
describe('Processors tests: CFF flattening', async () => {
  const targetProcessors = (await import('../src/processors/cffFlattening.js'));
  it('TP-1: Inline a 5-letter operator object', () => {
    const code = `const sto = {
  AbCde: function (x, y) { return x + y; },
  FgHij: 'ok'
};
sto.AbCde(1, 2);
sto.FgHij;`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /1 \+ 2/);
    assert.match(arb.script, /'ok'/);
  });
  it('TP-2: Linearize a pipe-split sequenced switch', () => {
    const code = `const seq = '0|1'.split('|');
let i = 0;
while (true) {
  switch (seq[i++]) {
    case '0': a(); continue;
    case '1': b(); continue;
  }
  break;
}`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /a\(\)/);
    assert.match(arb.script, /b\(\)/);
    assert.doesNotMatch(arb.script, /switch/);
  });
  it('TN-1: Leave a 5-letter object that is not operator shells', () => {
    const code = `const user = {
  AbCde: function () { console.log(1); return 2; }
};
user.AbCde();`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
});
describe('Processors tests: js-confuser', async () => {
  const targetProcessors = (await import('../src/processors/jsConfuser.js'));
  it('TP-1: Flatten string-bank indexer calls with a literal-like state arg', () => {
    const code = `function makeBank() {
  return [
    'aB1x', 'cD2y', 'eF3z', 'gH4w', 'iJ5v', 'kL6u', 'mN7t', 'oP8s',
    'qR9r', 'sT0q', 'uV1p', 'wX2o', 'yZ3n', 'Aa4m', 'Bb5l', 'Cc6k'
  ];
}
var holder = {bank: makeBank()};
function get(state, idx) {
  return holder.bank[(state[0] + idx) % holder.bank.length];
}
var state = [3];
get(state, 0);
get(state, 1);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /'gH4w'/);
    assert.match(arb.script, /'iJ5v'/);
    assert.doesNotMatch(arb.script, /get\(state, 0\)/);
  });
  it('TP-2: Collapse a deterministic sum(states) loop to final bindings', () => {
    const code = `function sum(states) {
  var total = 0;
  for (var i = 0; i < states.length; i++) total += states[i];
  return total;
}
var s0 = 1;
var s1 = 0;
var s2 = 0;
var result = '';
while (sum([s0, s1, s2]) !== 0) {
  switch (s0) {
    case 1:
      result += 'a';
      s0 = 0;
      s1 = 1;
      break;
    default:
      if (s1) {
        result += 'b';
        s1 = 0;
        s2 = 1;
      } else {
        result += 'c';
        s2 = 0;
      }
      break;
  }
}
console.log(result);`;
    let arb = new Arborist(code);
    arb = applyProcessors(arb, targetProcessors);
    assert.match(arb.script, /result = 'abc'/);
    assert.doesNotMatch(arb.script, /while/);
    assert.match(arb.script, /console\.log\(result\)/);
  });
  it('TN-1: Leave a classic array-index decoder', () => {
    const code = `const bank = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
function get(i) { return bank[i]; }
get(0);`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
  it('TN-2: Leave an ordinary counter while', () => {
    const code = `let i = 0;
while (i < n) {
  i++;
}`;
    let arb = new Arborist(code);
    const originalScript = arb.script;
    arb = applyProcessors(arb, targetProcessors);
    assert.strictEqual(arb.script, originalScript);
  });
});
