/**
 * Control-flow flattening extras for `cff_storage_object` and `sequenced_index_switch`.
 *
 * Same order as the obfuscator.io pack: operator objects, then `'n|n'.split('|')`,
 * then sequenced-index switch. Used when those labels fire without the composite.
 */
import inlineOperatorObjects from '../modules/safe/inlineOperatorObjects.js';
import resolvePureLiteralMethodCalls from '../modules/safe/resolvePureLiteralMethodCalls.js';
import rearrangeSwitches from '../modules/safe/rearrangeSwitches.js';

export const preprocessors = [
  inlineOperatorObjects,
  resolvePureLiteralMethodCalls,
  rearrangeSwitches,
];
export const postprocessors = [];
