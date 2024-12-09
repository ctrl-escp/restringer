# Obfuscation and Deobfuscation Techniques
* The distinction of Safe vs. Unsafe modules is based on whether any code is running through eval.

You can test the examples yourself by copying the deobfuscation functions' content into the testFunc:
```JavaScript
import {applyIteratively} from 'flast';
const code = `

`;

function testFunc(arb) {

	return arb;
}

let script = applyIteratively(code, [testFunc]);

if (script !== code) {
	console.log(`[+] Deobfuscated:\n${script}\n`);
} else console.log(`[-] Nothing was deobfuscated...`);
```

# Basic obfuscation methods
## String Splitting
A basic obfuscation technique, String Splitting is a tactic that makes reverse engineering slightly more tedious.
It's easy to tell what the password is when you've got `'password=hackMe94!'`, but it gets more annoying the more you break it up:
```JavaScript
  'password' + '=' + 'hackMe94!';
  'pass' + 'word' + '=' + 'h' + 'ackMe9' + '4!';
  'p' + 'a' + 's' + 's' + 'w' + 'o' + 'r' + 'd' + '=' + 'h' + 'a' + 'c' + 'k' + 'M' + 'e' + 9 + 4 + '!';
```

From AST perspective, turning `'ab'` into `'a' + 'b'` changes a Literal node into a Binary Expression where the left and right nodes
are Literals. Reversing this technique is simple:
```JavaScript
function resolveBinaryExpressionOfLiterals(arb) {
  function doOperation(v1, v2, op) {
    switch (op) {
      case '+':
        return v1 + v2;
      case '-':
        return v1 - v2;
      case '*':
		return v1 * v2;
      case '/':
		return v1 / v2;
    }
  }
  const supportedOps = ['+', '-', '*', '/'];  // Feel free to add support
  arb.ast[0].typeMap.BinaryExpression.forEach(n => {
    if (n.left.type === 'Literal' && n.right.type === 'Literal' && supportedOps.includes(n.operator)) {
	  const replacementNode = {
	    type: 'Literal',
        value: doOperation(n.left.value, n.right.value, n.operator),
      }
	arb.markNode(n, replacementNode);
    }
  });
  return arb;
}
```
## Encoding
Encoding is another straightforward yet effective obfuscation tactic used to conceal data in JavaScript.
Common encoding schemes like Base64 and hexadecimal transform readable strings into seemingly incomprehensible ones. For example:
```JavaScript
  const encoded = 'cGFzc3dvcmQ9aGFja01lOTQh'; // Base64 for 'password=hackMe94!'
  const decoded = atob(encoded);
```
Encoding is not encryption—it is fully reversible as long as the decoding mechanism is known.
This simplicity makes encoding a go-to technique for obfuscators seeking to add another layer of string obfuscation without significantly increasing code complexity.

In deobfuscation, detecting encoded strings and reversing them is a critical step.
One can identify patterns like Base64-like strings and apply the relevant decoding function, transforming obfuscated code into something more readable:
```JavaScript
function decodeBase64Literals(arb) {
  arb.ast[0].typeMap.Literal.forEach(n => {
    if (/^[A-Za-z0-9+/=]+$/.test(n.value)) {
      try {
        const decodedValue = atob(n.value);
        arb.markNode(n, {
          type: 'Literal',
          value: decodedValue,
        });
      } catch {}  // Ignore strings that aren't Base64 encoded
    }
  });
  return arb;
}
```
The naive method above is great in theory, but in actuality it will over-decode strings that match the pattern, but aren't actually Base64 encoded strings.
Another issue is that decoding the strings in place won't remove the obfuscated script's attempt to decode the string. 
Let's take the above example and make it more concise:
```JavaScript
  const decoded = atob('cGFzc3dvcmQ9aGFja01lOTQh');
```
Replacing the encoded string with it's decoded version in-place will mean that when executing `atob('password=hackMe94!')` an InvalidCharacterError exception will be thrown.
For this reason, it's better to look for the decoding calls and replace them with the decoded strings:

```JavaScript
function improvedDecodeBase64Literals(arb) {
  arb.ast[0].typeMap.CallExpression.forEach(n => {
		// Conditions for a relevant node:
		// - The callee's name is 'atob'
        // - The atob function isn't declared in the code (i.e. a builtin)
        // - There is one argument which is a Literal
    if (n.callee?.name === 'atob' && !n.callee.declNode && n.arguments?.[0]?.type === 'Literal') {
      try {
        const decodedValue = atob(n.arguments[0].value);
        arb.markNode(n, {
          type: 'Literal',
          value: decodedValue,
        });
      } catch {}
    }
  });
  return arb;
}
```
