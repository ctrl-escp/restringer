# Encoding
Encoding is another straightforward yet effective obfuscation tactic used to conceal data in JavaScript.
Common encoding schemes like [Base64](https://en.wikipedia.org/wiki/Base64) and [base-16 (hexadecimal)](https://en.wikipedia.org/wiki/Hexadecimal) transform readable strings into seemingly incomprehensible ones. For example:
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
		// Conditions for a relevant Call Expression type node:
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
Checking that the `atob` function isn't declared in the script (`!n.callee.declNode`) is meant to avoid cases where the `atob` function was re-implemented a bit differently,
which obfuscators might do in order to prevent automatic decoding of Base64 strings.
## Escaping
A subset of encoding that's worth mentioning is escaping.
Escaping is useful when there's a need to include special characters that might break the string.
For example:
- Quotes within quotes: 
  ```JavaScript
  "Hello, \"friend\""
  ```    
  The backslash is used to denote that the next character is not meant to instruct, but is a part of the string.    
  In this case, the next character - the double quote (`"`) - loses its meaning of terminating the string.


- Escaping the [escape character](https://en.wikipedia.org/wiki/Escape_character): 
  ```JavaScript
  `C:\\Users\\admin`
  ```
  A single backslash is a prefix for a special character like the backspace `\b`, newline `\n`, tab `\t`, etc.    
  If there's a need to use the backslash as a character in iteself and not as an escape prefix, it needs to be escaped in the same way - with a backslash prefix - `\\`.


- [Unicode](https://en.wikipedia.org/wiki/Unicode):
  ```JavaScript
  ['\u263A', '\u{1F600}']; // ☺, 😀
  ```
  The `\u` prefix takes 4 hexadecimal digits to denote a single Unicode character.

- [Hexadecimal](https://en.wikipedia.org/wiki/Hexadecimal)
  ```JavaScript
  const password = '\x68\x61\x63\x6b\x4d\x65\x39\x34\x21';
  ```
  This hex representation of a string can be easily resolved by pasting the string in the console.

- [URL encoding](https://en.wikipedia.org/wiki/Percent-encoding):
  ```JavaScript
  const url = 'https://example.com/search?q=hello%20world'; // The space character is escaped to %20
  ```
  
- HTML escaped [entities](https://www.freeformatter.com/html-entities.html):
  ```HTML
  <!-- An unescaped tag --><script>alert(1)</script>
  <!-- An escaped tag   -->&lt;&#115;&#99;&#114;&#105;&#112;&#116;&gt;&#97;&#108;&#101;&#114;&#116;&#40;&#49;&#41;&lt;&#47;&#115;&#99;&#114;&#105;&#112;&#116;&gt;
  ```
  The above HTML is rendered normally, but is actually written as `&lt;&#115;&#99;&#114;&#105;&#112;&#116;&gt;&#97;&#108;&#101;&#114;&#116;&#40;&#49;&#41;&lt;&#47;&#115;&#99;&#114;&#105;&#112;&#116;&gt;`