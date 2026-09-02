import { DockerSandbox, loadSandboxConfig, type SandboxConfig } from '@incident-ai/reproduction';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Same image/CPU/memory as Phase 6 (REPRODUCTION_DOCKER_IMAGE etc. — no
 * reason to duplicate those knobs), but its own timeout: fix validation runs
 * a before-fix check, a post-fix check, and regression tests in one
 * container, so it reasonably needs more time than a single reproduction run.
 */
export function loadFixSandboxConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  const base = loadSandboxConfig(env);
  return { ...base, timeoutMs: parsePositiveInt(env.FIX_VALIDATION_TIMEOUT_MS, base.timeoutMs) };
}

/**
 * Always a brand-new container — the fix engine never reuses a Phase 6
 * reproduction sandbox instance. That sandbox may carry the generated
 * reproduction test, whatever files it left behind, and cached state; a
 * fresh one guarantees what's being tested is exactly "baseline commit +
 * this patch," nothing else.
 */
export function createFixSandbox(config: SandboxConfig = loadFixSandboxConfig()): DockerSandbox {
  return new DockerSandbox(config);
}
