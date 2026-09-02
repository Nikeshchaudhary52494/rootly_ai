import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { InvestigationLLM } from '@rootly.ai/agent';
import { DockerSandbox } from '../sandbox/docker-sandbox';
import { loadSandboxConfig, type SandboxConfig } from '../sandbox/sandbox-config';
import { checkoutRepository, type CheckoutResult } from '../repository/repository-checkout';
import { generateReproductionTest } from '../test/test-generator';
import { buildInstallCommand, buildJestCommand } from '../test/test-runner';
import { requiresDependencyInstall } from '../test/test-validator';
import { classifyReproduction, type ReproductionClassification } from './reproduction-classifier';
import type { TestGenerationInput } from '../graph/generation.state';
import type { ReproductionTest } from '../schemas/reproduction.schema';

export type ReproductionEngineStage =
  | 'GENERATING_TEST'
  | 'CREATING_SANDBOX'
  | 'CHECKING_OUT'
  | 'INSTALLING'
  | 'RUNNING'
  | 'CLASSIFYING';

export interface ReproductionEngineInput {
  targetCommitSha: string;
  repositoryUrl: string;
  /** Decrypted token for a private repo only — never persisted, logged, or shown to the model. */
  accessToken?: string;
  testGenerationInput: TestGenerationInput;
}

export interface ReproductionEngineOptions {
  llm: InvestigationLLM;
  sandboxConfig?: SandboxConfig;
  onStage?: (stage: ReproductionEngineStage) => void | Promise<void>;
}

export interface ReproductionEngineResult {
  /** COMPLETED means the pipeline ran to some conclusion (possibly INCONCLUSIVE); FAILED means the pipeline itself broke. */
  status: 'COMPLETED' | 'FAILED';
  result: ReproductionClassification | null;
  test: ReproductionTest | null;
  targetCommitSha: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  errorMessage: string | null;
}

function completedResult(partial: Partial<ReproductionEngineResult> & { targetCommitSha: string }): ReproductionEngineResult {
  return {
    status: 'COMPLETED',
    result: null,
    test: null,
    stdout: '',
    stderr: '',
    exitCode: null,
    durationMs: 0,
    errorMessage: null,
    ...partial,
  };
}

function failedResult(errorMessage: string, targetCommitSha: string, test: ReproductionTest | null = null): ReproductionEngineResult {
  return {
    status: 'FAILED',
    result: null,
    test,
    targetCommitSha,
    stdout: '',
    stderr: '',
    exitCode: null,
    durationMs: 0,
    errorMessage,
  };
}

/**
 * GENERATE_TEST -> CHECK_OUT -> CREATE_SANDBOX -> (INSTALL) -> RUN -> CLASSIFY,
 * always destroying the sandbox and the host checkout in `finally`.
 *
 * FAILED is reserved for the reproduction *system* breaking (test generation
 * failed outright, or Docker itself couldn't create the container).
 * Everything that gets as far as attempting execution but can't produce a
 * reliable signal (checkout failure, dependency install failure, timeout)
 * resolves to status COMPLETED with result INCONCLUSIVE — a more useful
 * dashboard story than a bare failure with no classification at all.
 */
export async function runReproduction(
  input: ReproductionEngineInput,
  options: ReproductionEngineOptions,
): Promise<ReproductionEngineResult> {
  const config = options.sandboxConfig ?? loadSandboxConfig();
  const emit = async (stage: ReproductionEngineStage) => {
    await options.onStage?.(stage);
  };

  await emit('GENERATING_TEST');
  const generation = await generateReproductionTest(input.testGenerationInput, { llm: options.llm });
  if (generation.status !== 'COMPLETED' || !generation.test) {
    return failedResult(
      generation.errors.join(' | ') || 'REPRODUCTION_TEST_GENERATION_FAILED: no test was produced.',
      input.targetCommitSha,
    );
  }
  const test = generation.test;

  const sandbox = new DockerSandbox(config);
  let checkout: CheckoutResult | null = null;
  let stage: 'checkout' | 'sandbox-or-later' = 'checkout';

  try {
    await emit('CHECKING_OUT');
    checkout = await checkoutRepository({
      repositoryUrl: input.repositoryUrl,
      commitSha: input.targetCommitSha,
      accessToken: input.accessToken,
      timeoutMs: config.timeoutMs,
    });

    const testAbsolutePath = join(checkout.workspacePath, test.filePath);
    await mkdir(dirname(testAbsolutePath), { recursive: true });
    await writeFile(testAbsolutePath, test.content, 'utf8');

    stage = 'sandbox-or-later';
    await emit('CREATING_SANDBOX');
    await sandbox.create();
    await sandbox.copyIn(checkout.workspacePath);

    if (requiresDependencyInstall(test.content)) {
      await emit('INSTALLING');
      const hasLockfile = existsSync(join(checkout.workspacePath, 'package-lock.json'));
      const installResult = await sandbox.run(buildInstallCommand(hasLockfile));
      if (installResult.exitCode !== 0) {
        return completedResult({
          targetCommitSha: checkout.resolvedCommitSha,
          test,
          result: 'INCONCLUSIVE',
          stdout: installResult.stdout,
          stderr: installResult.stderr,
          exitCode: installResult.exitCode,
          durationMs: installResult.durationMs,
          errorMessage: 'DEPENDENCY_INSTALLATION_FAILED: could not install dependencies inside the network-disabled sandbox.',
        });
      }
    }

    await emit('RUNNING');
    const runResult = await sandbox.run(buildJestCommand(test.filePath));

    await emit('CLASSIFYING');
    const classification = classifyReproduction({
      exitCode: runResult.exitCode,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      timedOut: runResult.timedOut,
    });

    return completedResult({
      targetCommitSha: checkout.resolvedCommitSha,
      test,
      result: classification.result,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      durationMs: runResult.durationMs,
      errorMessage: classification.result === 'INCONCLUSIVE' ? classification.reason : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (stage === 'checkout') {
      return completedResult({
        targetCommitSha: input.targetCommitSha,
        test,
        result: 'INCONCLUSIVE',
        errorMessage: `REPOSITORY_CHECKOUT_FAILED: ${message}`,
      });
    }
    return failedResult(`SANDBOX_EXECUTION_FAILED: ${message}`, checkout?.resolvedCommitSha ?? input.targetCommitSha, test);
  } finally {
    await sandbox.destroy();
    if (checkout) await checkout.cleanup();
  }
}
