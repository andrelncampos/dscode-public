export function correlateLoadErrors(
  stdout: string[],
  stderr: string[],
): { file: string; stderrLines: string[] }[];

export function findTestFailures(
  stdout: string[],
  sentinel?: RegExp,
): { file: string; lines: string[] }[];

export function buildFailureSummary(workers: Array<{
  idx: number;
  workerCount: number;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  signalCode: string | null;
  spawnError: string | null;
}>): {
  loadErrors: string[];
  testFailures: string[];
  workerErrors: string[];
};
