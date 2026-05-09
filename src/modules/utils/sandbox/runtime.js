/**
 * @return {'node'|'deno'|'bun'} Runtime currently hosting REstringer
 */
export function detectCurrentRuntime() {
  if (typeof process !== 'undefined' && process?.versions?.bun) return 'bun';
  if (typeof Deno !== 'undefined' || (typeof process !== 'undefined' && process?.versions?.deno)) return 'deno';
  return 'node';
}

/**
 * @return {string|undefined} Executable path for the current host runtime
 */
export function getCurrentRuntimeExecutablePath() {
  if (typeof process !== 'undefined' && typeof process.execPath === 'string' && process.execPath.length > 0) {
    return process.execPath;
  }

  if (typeof Deno !== 'undefined' && typeof Deno.execPath === 'function') {
    return Deno.execPath();
  }

  return undefined;
}

/**
 * @return {{provider: 'process', options: {runtime: 'node'|'deno'|'bun', executablePath?: string}}}
 */
export function createHostRuntimeSandboxConfig() {
  const runtime = detectCurrentRuntime();
  const executablePath = getCurrentRuntimeExecutablePath();

  return {
    provider: 'process',
    options: {
      runtime,
      ...(executablePath ? {executablePath} : {}),
    },
  };
}
