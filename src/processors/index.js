/**
 * Mapping specific obfuscation type to their processors, which are lazily loaded.
 */
export const processors = {
  'caesar_plus': await import('./caesarp.js'),
  'obfuscator_io': await import('./obfuscator.io.js'),
  'augmented_array_replacements': await import('./augmentedArray.js'),
  'function_to_array_replacements': await import('./functionToArray.js'),
  'proxied_array_function_replacements': await import('./functionToArray.js'),
  'proxied_augmented_array_replacements': await import('./augmentedArray.js'),
  'augmented_array_function_replacements': await import('./augmentedArray.js'),
  'augmented_proxied_array_function_replacements': await import('./augmentedArray.js'),
  'cff_storage_object': await import('./cffFlattening.js'),
  'sequenced_index_switch': await import('./cffFlattening.js'),
  'js_confuser_string_bank': await import('./jsConfuser.js'),
  'js_confuser_state_machine': await import('./jsConfuser.js'),
};
