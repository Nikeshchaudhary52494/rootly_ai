export interface SandboxConfig {
  image: string;
  cpuLimit: string;
  memoryLimit: string;
  timeoutMs: number;
  maxOutputBytes: number;
  pidsLimit: number;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  image: 'node:22-bookworm-slim',
  cpuLimit: '1',
  memoryLimit: '1g',
  timeoutMs: 60000,
  maxOutputBytes: 100000,
  pidsLimit: 256,
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Reads REPRODUCTION_* env vars, falling back to conservative defaults for anything unset or invalid. */
export function loadSandboxConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  return {
    image: env.REPRODUCTION_DOCKER_IMAGE || DEFAULT_SANDBOX_CONFIG.image,
    cpuLimit: env.REPRODUCTION_CPU_LIMIT || DEFAULT_SANDBOX_CONFIG.cpuLimit,
    memoryLimit: env.REPRODUCTION_MEMORY_LIMIT || DEFAULT_SANDBOX_CONFIG.memoryLimit,
    timeoutMs: parsePositiveInt(env.REPRODUCTION_TIMEOUT_MS, DEFAULT_SANDBOX_CONFIG.timeoutMs),
    maxOutputBytes: parsePositiveInt(env.REPRODUCTION_MAX_OUTPUT_BYTES, DEFAULT_SANDBOX_CONFIG.maxOutputBytes),
    pidsLimit: parsePositiveInt(env.REPRODUCTION_PIDS_LIMIT, DEFAULT_SANDBOX_CONFIG.pidsLimit),
  };
}
