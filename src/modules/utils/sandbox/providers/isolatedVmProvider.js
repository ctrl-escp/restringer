import {BLOCKED_APIS, DEFAULT_MEMORY_LIMIT, DEFAULT_TIMEOUT} from '../constants.js';

/**
 * @return {Promise<Object>} Loaded isolated-vm module namespace
 */
async function loadIsolatedVm() {
  try {
    return await import('isolated-vm');
  } catch (error) {
    throw new Error(`Sandbox provider "isolated-vm" is not installed. Install the isolated-vm adapter/dependency to use it. (${error.message})`);
  }
}

/**
 * @return {Promise<Object>} isolated-vm-backed sandbox provider
 */
export async function createIsolatedVmProvider() {
  const pkg = await loadIsolatedVm();
  const {Isolate} = pkg.default || pkg;

  return {
    name: 'isolated-vm',
    capabilities: {
      reusableContext: true,
      strictIsolation: true,
      dockerReady: true,
      iframeReady: true,
    },
    createSession(options = {}) {
      const timeout = Number(options.timeout ?? DEFAULT_TIMEOUT);
      const memoryLimit = Number(options.memoryLimit ?? DEFAULT_MEMORY_LIMIT);
      const isolate = new Isolate({memoryLimit});
      const context = isolate.createContextSync();
      context.global.setSync('global', context.global.derefInto());

      const blockedApiNames = Object.keys(BLOCKED_APIS);
      for (let i = 0; i < blockedApiNames.length; i++) {
        const itemName = blockedApiNames[i];
        context.global.setSync(itemName, BLOCKED_APIS[itemName]);
      }

      return {
        providerName: 'isolated-vm',
        capabilities: {
          reusableContext: true,
          strictIsolation: true,
        },
        run(code) {
          const script = isolate.compileScriptSync('delete Math.random; delete Date;\n\n' + code);
          const result = script.runSync(context, {
            timeout,
            reference: true,
          });

          try {
            return typeof result?.copySync === 'function' ? result.copySync() : result;
          } catch {
            return undefined;
          }
        },
        exec(code) {
          const script = isolate.compileScriptSync('delete Math.random; delete Date;\n\n' + code);
          script.runSync(context, {timeout});
        },
        close() {
          try {
            context.release?.();
          } catch {}
          try {
            isolate.dispose?.();
          } catch {}
        },
      };
    },
  };
}
