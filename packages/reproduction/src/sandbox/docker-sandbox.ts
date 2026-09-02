import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SandboxConfig } from './sandbox-config';
import type { SandboxExecutionResult } from './sandbox-result';

interface DockerCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Spawns `docker` with a minimal explicit env (never the parent process's
 * full environment — that's exactly the secret-leak vector this exists to
 * prevent) and an optional hard-kill safety net on top of the docker CLI
 * process itself.
 */
function runDocker(args: string[], timeoutMs?: number): Promise<DockerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env: { PATH: process.env.PATH ?? '' } });
    let stdout = '';
    let stderr = '';
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;

    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

function truncate(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString('utf8')}\n... (truncated, ${buf.length - maxBytes} more bytes)`;
}

/**
 * Manages one ephemeral, isolated container for a single reproduction run.
 *
 * Isolation posture (see packages/reproduction/README.md for the full
 * rationale): --network none, explicit CPU/memory/pids limits, all
 * capabilities dropped, no-new-privileges, no bind mounts to the host (code
 * enters only via `docker cp`, a one-way copy — never a live shared mount),
 * and the Docker socket is never referenced, let alone mounted.
 */
export class DockerSandbox {
  private containerId: string | null = null;

  constructor(private readonly config: SandboxConfig) {}

  async create(): Promise<void> {
    if (this.containerId) throw new Error('Sandbox container already created');

    const name = `incident-ai-repro-${randomUUID()}`;
    // A quiet keep-alive process so the container has something to run while
    // we `docker cp` files in and `docker exec` the real command afterward.
    const keepAliveSeconds = Math.ceil(this.config.timeoutMs / 1000) + 30;

    const result = await runDocker([
      'create',
      '--name',
      name,
      '--network',
      'none',
      '--memory',
      this.config.memoryLimit,
      '--cpus',
      this.config.cpuLimit,
      '--pids-limit',
      String(this.config.pidsLimit),
      '--security-opt',
      'no-new-privileges',
      '--cap-drop',
      'ALL',
      '--workdir',
      '/workspace',
      this.config.image,
      'sleep',
      String(keepAliveSeconds),
    ]);

    if (result.exitCode !== 0) {
      throw new Error(`docker create failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    this.containerId = result.stdout.trim();
  }

  /** Copies a host directory's contents into the (not-yet-started) container. No live mount is ever created. */
  async copyIn(hostDirectory: string, containerPath = '/workspace'): Promise<void> {
    const id = this.requireContainer();
    const result = await runDocker(['cp', `${hostDirectory}/.`, `${id}:${containerPath}`]);
    if (result.exitCode !== 0) {
      throw new Error(`docker cp failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }

  /** Runs one backend-constructed argv command inside the container and captures its output. */
  async run(command: string[]): Promise<SandboxExecutionResult> {
    const id = this.requireContainer();
    const startedAt = Date.now();

    const startResult = await runDocker(['start', id]);
    if (startResult.exitCode !== 0) {
      throw new Error(`docker start failed: ${startResult.stderr.trim() || startResult.stdout.trim()}`);
    }

    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      // Kills every process in the container (not just detaching the CLI client),
      // which is what actually stops a runaway test.
      runDocker(['kill', id]).catch(() => {});
    }, this.config.timeoutMs);

    // Outer safety net well past the intended timeout, in case `docker kill` itself hangs.
    const execResult = await runDocker(['exec', id, ...command], this.config.timeoutMs + 15000);
    clearTimeout(killTimer);

    const durationMs = Date.now() - startedAt;
    return {
      stdout: truncate(execResult.stdout, this.config.maxOutputBytes),
      stderr: truncate(execResult.stderr, this.config.maxOutputBytes),
      exitCode: timedOut ? null : execResult.exitCode,
      timedOut,
      durationMs,
    };
  }

  /** Force-removes the container. Safe to call multiple times; never throws. */
  async destroy(): Promise<void> {
    if (!this.containerId) return;
    const id = this.containerId;
    this.containerId = null;
    await runDocker(['rm', '-f', id]).catch(() => {});
  }

  isCreated(): boolean {
    return this.containerId !== null;
  }

  private requireContainer(): string {
    if (!this.containerId) throw new Error('Sandbox container has not been created yet');
    return this.containerId;
  }
}
