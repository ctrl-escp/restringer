import {createIsolatedVmProvider} from './providers/isolatedVmProvider.js';
import {createProcessProvider} from './providers/processProvider.js';
import {createHostRuntimeSandboxConfig} from './runtime.js';

const PROVIDER_LOADERS = new Map([
  ['isolated-vm', createIsolatedVmProvider],
  ['process', createProcessProvider],
]);

const PROVIDER_CACHE = new Map();

function getDefaultSandboxConfigValue() {
  return createHostRuntimeSandboxConfig();
}

let currentSandboxConfig = getDefaultSandboxConfigValue();
let sandboxRunId = 0;

/**
 * @param {Object} [config=getDefaultSandboxConfigValue()] - Sandbox configuration to clone
 * @param {string|Object|Function} [config.provider] - Provider name, provider object, or loader target
 * @param {Object} [config.options] - Provider-specific options
 * @return {{provider: string|Object|Function, options: Object}} Cloned sandbox configuration
 */
function cloneSandboxConfig(config = getDefaultSandboxConfigValue()) {
  return {
    ...config,
    options: {...(config.options || {})},
  };
}

/**
 * @param {string|Object|Function} provider - Provider name or provider-like object
 * @return {string|Object|Function|undefined} Normalized provider identifier
 */
function normalizeProviderInput(provider) {
  if (typeof provider === 'string') return provider;
  return provider?.name || provider;
}

/**
 * @param {string|Object} [config={}] - Sandbox configuration or provider name
 * @return {{provider: string|Object|Function, options: Object}} Normalized sandbox configuration
 */
export function normalizeSandboxConfig(config = {}) {
  const defaultConfig = getDefaultSandboxConfigValue();

  if (typeof config === 'string') {
    return {provider: config, options: {}};
  }

  if (typeof config?.createSession === 'function') {
    return {provider: config, options: {}};
  }

  const configOptions = {...(config.options || {})};
  const runtime = configOptions.runtime || defaultConfig.options?.runtime;
  const shouldInheritExecutablePath = !configOptions.runtime || configOptions.runtime === defaultConfig.options?.runtime;
  const normalizedOptions = {
    ...defaultConfig.options,
    ...configOptions,
    runtime,
  };

  if (!shouldInheritExecutablePath && configOptions.executablePath === undefined) {
    delete normalizedOptions.executablePath;
  }

  return {
    provider: config.provider || defaultConfig.provider,
    options: normalizedOptions,
  };
}

/**
 * @param {string} name - Provider name to register
 * @param {Function} providerLoader - Async loader that returns a sandbox provider
 * @return {Promise<void>}
 */
export async function registerSandboxProvider(name, providerLoader) {
  if (!name || typeof providerLoader !== 'function') {
    throw new Error('registerSandboxProvider(name, providerLoader) requires a provider name and loader');
  }

  PROVIDER_LOADERS.set(name, providerLoader);
  PROVIDER_CACHE.delete(name);
}

/**
 * @return {string[]} Registered sandbox provider names
 */
export function listSandboxProviders() {
  return Array.from(PROVIDER_LOADERS.keys());
}

/**
 * @param {string|Object} config - Sandbox configuration or provider name
 * @return {void}
 */
export function setDefaultSandboxConfig(config) {
  currentSandboxConfig = normalizeSandboxConfig(config);
}

/**
 * @return {{provider: string|Object|Function, options: Object}} Active default sandbox configuration
 */
export function getDefaultSandboxConfig() {
  return cloneSandboxConfig(currentSandboxConfig);
}

/**
 * @template T
 * @param {string|Object} config - Sandbox configuration override
 * @param {() => T} fn - Callback executed with the override applied
 * @return {T} Callback result
 */
export function withSandboxConfig(config, fn) {
  const previousConfig = currentSandboxConfig;
  currentSandboxConfig = normalizeSandboxConfig(config || previousConfig);
  try {
    return fn();
  } finally {
    currentSandboxConfig = previousConfig;
  }
}

/**
 * @param {string|Object} [config=currentSandboxConfig] - Sandbox configuration or provider name
 * @return {Promise<Object>} Resolved sandbox provider
 */
export async function resolveSandboxProvider(config = currentSandboxConfig) {
  const normalizedConfig = normalizeSandboxConfig(config);
  const providerName = normalizeProviderInput(normalizedConfig.provider);

  if (typeof normalizedConfig.provider?.createSession === 'function') {
    return normalizedConfig.provider;
  }

  if (PROVIDER_CACHE.has(providerName)) return PROVIDER_CACHE.get(providerName);

  const loader = PROVIDER_LOADERS.get(providerName);
  if (!loader) {
    throw new Error(`Unknown sandbox provider "${providerName}". Available providers: ${listSandboxProviders().join(', ')}`);
  }

  const provider = await loader();
  PROVIDER_CACHE.set(providerName, provider);
  return provider;
}

/**
 * @param {string} providerName - Provider name to resolve from the preload cache
 * @return {Object} Cached sandbox provider
 */
function resolveSandboxProviderSync(providerName) {
  if (PROVIDER_CACHE.has(providerName)) return PROVIDER_CACHE.get(providerName);

  throw new Error(`Sandbox provider "${providerName}" has not been preloaded. Call preloadSandboxProvider("${providerName}") before using it.`);
}

/**
 * @param {string|Object} [config=currentSandboxConfig] - Sandbox configuration or provider name
 * @return {Promise<void>}
 */
export async function preloadSandboxProvider(config = currentSandboxConfig) {
  await resolveSandboxProvider(config);
}

/**
 * @param {string|Object} [config=currentSandboxConfig] - Sandbox configuration or provider name
 * @return {Object} Verified provider
 */
export function assertSandboxProviderAvailable(config = currentSandboxConfig) {
  const normalizedConfig = normalizeSandboxConfig(config);

  if (typeof normalizedConfig.provider?.createSession === 'function') {
    if (typeof normalizedConfig.provider.assertAvailable === 'function') {
      normalizedConfig.provider.assertAvailable(normalizedConfig.options || {});
    }

    return normalizedConfig.provider;
  }

  const providerName = normalizeProviderInput(normalizedConfig.provider);
  const provider = resolveSandboxProviderSync(providerName);

  if (typeof provider.assertAvailable === 'function') {
    provider.assertAvailable(normalizedConfig.options || {});
  }

  return provider;
}

export class SandboxReference {
  /**
   * @param {*} value - Wrapped sandbox value
   */
  constructor(value) {
    this.value = value;
  }

  /**
   * @return {*} Wrapped sandbox value
   */
  copySync() {
    return this.value;
  }
}

export class Sandbox {
  /**
   * @param {string|Object} [config] - Sandbox configuration override
   */
  constructor(config) {
    this.id = ++sandboxRunId;
    this.config = normalizeSandboxConfig(config || currentSandboxConfig);
    this.providerName = normalizeProviderInput(this.config.provider);
    this.provider = assertSandboxProviderAvailable(this.config);
    this.session = this.provider.createSession(this.config.options || {});
    this.capabilities = this.provider.capabilities || {};
  }

  /**
   * @param {string} code - Source code to evaluate
   * @return {SandboxReference} Reference wrapper for the evaluated value
   */
  run(code) {
    return new SandboxReference(this.runValue(code));
  }

  /**
   * @param {string} code - Source code to evaluate
   * @return {*} Evaluated value
   */
  runValue(code) {
    return this.session.run(code);
  }

  /**
   * @param {string} code - Source code to execute
   * @return {void}
   */
  exec(code) {
    if (typeof this.session.exec === 'function') {
      this.session.exec(code);
      return;
    }

    this.runValue(code);
  }

  close() {
    if (typeof this.session?.close === 'function') {
      this.session.close();
    }
  }

  /**
   * @param {*} obj - Value to test
   * @return {boolean} Whether the value is a sandbox reference
   */
  isReference(obj) {
    return obj instanceof SandboxReference;
  }
}

export const SANDBOX_EXTENSION_POINTS = {
  docker: {
    planned: true,
    protocol: 'provider-session',
    notes: 'Future Docker providers should implement the same createSession/run contract as process providers.',
  },
  iframe: {
    planned: true,
    protocol: 'provider-session',
    notes: 'Future iframe providers should match the same session contract for browser-hosted execution.',
  },
};

try {
  await preloadSandboxProvider(getDefaultSandboxConfigValue());
} catch {}

await preloadSandboxProvider({provider: 'process'});
