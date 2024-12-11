# String Splitting
A basic obfuscation technique, String Splitting is a tactic that makes reverse engineering slightly more tedious.
It's easy to tell what the password is when you've got `'password=hackMe94!'`, but it gets more annoying the more you break it up:
```JavaScript
  'password' + '=' + 'hackMe94!';
  'pass' + 'word' + '=' + 'h' + 'ackMe9' + '4!';
  'p' + 'a' + 's' + 's' + 'w' + 'o' + 'r' + 'd' + '=' + 'h' + 'a' + 'c' + 'k' + 'M' + 'e' + 9 + 4 + '!';
```

This simple technique is sometimes used to bypass security filters (`'<scr' + 'ipt>a' + 'lert(' + ');</' + 'sc' + 'rip' + 't>'`),
but there are also valid uses like making a calculation clear like `sleep(5 * 1000); // Sleep for 5 seconds` or `const twoDays = 2 * 24 * 60 * 60 * 1000;`.

From AST perspective, turning `'ab'` into `'a' + 'b'` changes a Literal node into a Binary Expression where the left and right nodes
are [Literals](https://en.wikipedia.org/wiki/Literal_(computer_programming)). Reversing this technique is simple:
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
