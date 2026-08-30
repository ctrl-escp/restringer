import {applyIteratively, applyIterativelySafely} from 'flast';
import * as normalizeComputed from '../safe/normalizeComputed.js';
import * as normalizeEmptyStatements from '../safe/normalizeEmptyStatements.js';
import * as normalizeRedundantNotOperator from '../safe/normalizeRedundantNotOperator.js';

/**
 * Normalizes JavaScript code to improve readability without affecting functionality.
 * This function applies a series of safe transformations that make code more readable
 * while preserving the original behavior. It's designed for preprocessing scripts
 * before deobfuscation or analysis.
 *
 * Applied transformations (in order):
 * 1. normalizeComputed - Converts bracket notation to dot notation where safe (obj['prop'] → obj.prop)
 * 2. normalizeRedundantNotOperator - Simplifies double negations and NOT operations on literals
 * 3. normalizeEmptyStatements - Removes unnecessary empty statements and semicolons
 *
 * Uses flast's applyIteratively to ensure all transformations are applied until no more
 * changes occur, handling cases where one transformation enables another.
 *
 * @param {string} script - JavaScript source code to normalize
 * @param {Object} [options] Iteration state from an in-progress deobfuscate() so this pass continues the same log sequence and hard cap. The mark cap is not forwarded; normalize is not a deob slice.
 * @param {number} [options.currentIteration]
 * @param {number} [options.maxIterations]
 * @param {boolean} [options.safely] Use applyIterativelySafely and return its `.script`
 * @return {string} The normalized script with improved readability
 *
 * @example
 * // Input: obj['method'](); !!true; ;;;
 * // Output: obj.method(); true;
 */
export function normalizeScript(script, options = {}) {
  const methods = [
    normalizeComputed.default,
    normalizeRedundantNotOperator.default,
    normalizeEmptyStatements.default,
  ];
  const applyOptions = {};
  if (options.currentIteration !== undefined) applyOptions.currentIteration = options.currentIteration;
  if (options.maxIterations !== undefined) applyOptions.maxIterations = options.maxIterations;
  const apply = options.safely ? applyIterativelySafely : applyIteratively;
  const result = Object.keys(applyOptions).length ? apply(script, methods, applyOptions) : apply(script, methods);
  return options.safely ? result.script : result;
}