/**
 * Name-to-function map for `--method` / `options.methods`.
 *
 * REstringer's default loop only runs a subset of safe and unsafe modules, in a
 * fixed order. Callers can instead name specific methods (including ones not on
 * that list, such as `removeDeadNodes` or `resolveFunctionToArray`) and run them
 * in the order given. This module is the single lookup: export name from
 * `src/modules/safe` or `src/modules/unsafe` → that module's default function.
 */
import {safe as safeMod, unsafe as unsafeMod} from '../modules/index.js';

/**
 * Collect default-export functions from a `src/modules` namespace object.
 *
 * @param {Object} mods Namespace of dynamically imported method modules
 * @return {Object<string, Function>} Default exports keyed by export name
 */
function collectDefaults(mods) {
  const registry = {};
  for (const name of Object.keys(mods)) {
    const fn = mods[name].default || mods[name];
    if (typeof fn === 'function') registry[name] = fn;
  }
  return registry;
}

export const deobMethodRegistry = {
  ...collectDefaults(safeMod),
  ...collectDefaults(unsafeMod),
};

/**
 * Sorted names for help text and "unknown method" errors.
 *
 * @return {string[]} Sorted registered deobfuscation method names
 */
export function listDeobMethods() {
  return Object.keys(deobMethodRegistry).sort();
}

/**
 * Turn caller-supplied names into Arborist modifiers, preserving order.
 * Throws if any name is missing so a typo fails before deobfuscation starts.
 *
 * @param {string[]} names Method names
 * @return {Function[]} Resolved modifier functions
 */
export function resolveDeobMethods(names) {
  const resolved = [];
  const unknown = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const fn = deobMethodRegistry[name];
    if (fn) resolved.push(fn);
    else unknown.push(name);
  }
  if (unknown.length) {
    throw new Error(`Unknown deobfuscation method(s): ${unknown.join(', ')}. Available: ${listDeobMethods().join(', ')}`);
  }
  return resolved;
}
