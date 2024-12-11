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

# Basic Obfuscation Methods
- [String Splitting](techniques/string-splitting.md)
- [Encoding](techniques/encoding.md)