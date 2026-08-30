#!/usr/bin/env node
import {REstringer} from '../src/restringer.js';
import {getHelpText, parseArgs} from '../src/utils/parseArgs.js';
import {preloadSandboxProvider} from '../src/modules/utils/sandbox/index.js';

try {
  const args = parseArgs(process.argv.slice(2));

  // Skip processing if help was displayed
  if (args.help) {
    console.log(getHelpText());
    process.exit(0);
  }

  const fs = await import('node:fs');
  const content = fs.readFileSync(args.inputFilename, 'utf-8');
  const startTime = Date.now();
  await preloadSandboxProvider(args.sandbox);

  const restringer = new REstringer(content, {
    clean: args.clean,
    detectObfuscationType: args.detectObfuscationType,
    maxIterations: args.maxIterations || undefined,
    methods: args.methods.length ? args.methods : undefined,
    runPreprocessors: args.runPreprocessors,
    runPostprocessors: args.runPostprocessors,
    maxMarkedNodes: args.maxMarkedNodes || undefined,
    safely: args.safely,
    sandbox: args.sandbox,
  });
  if (args.quiet) restringer.logger.setLogLevelNone();
  else if (args.verbose) restringer.logger.setLogLevelDebug();
  restringer.logger.log(`[!] REstringer v${REstringer.__version__}`);
  restringer.logger.log(`[!] Deobfuscating ${args.inputFilename}...`);
  const runtimeName = args.sandbox.options?.runtime ? ` (${args.sandbox.options.runtime})` : '';
  restringer.logger.log(`[!] Sandbox: ${args.sandbox.provider}${runtimeName}`);
  if (args.sandbox.options?.executablePath) {
    restringer.logger.log(`[!] Sandbox executable: ${args.sandbox.options.executablePath}`);
  }
  if (args.maxIterations) {
    restringer.logger.log(`[!] Running at most ${args.maxIterations} iterations`);
  }
  if (args.methods.length) {
    restringer.logger.log(`[!] Methods: ${args.methods.join(', ')}`);
  }
  if (args.maxMarkedNodes) {
    restringer.logger.log(`[!] Max marked nodes per method: ${args.maxMarkedNodes}`);
  }
  if (args.safely) {
    restringer.logger.log('[!] Using safely apply');
  }
  if (restringer.deobfuscate()) {
    restringer.logger.log(`[+] Saved ${args.outputFilename}`);
    restringer.logger.log(`[!] Deobfuscation took ${(Date.now() - startTime) / 1000} seconds.`);
    if (args.outputToFile) fs.writeFileSync(args.outputFilename, restringer.script, {encoding: 'utf-8'});
    else console.log(restringer.script);
  } else restringer.logger.log('[-] Nothing was deobfuscated  ¯\\_(ツ)_/¯');
} catch (e) {
  console.error(`[-] Critical Error: ${e}`);
}
