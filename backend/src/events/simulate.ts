export interface SimulateOutcome {
  shouldFail: boolean;
  delayMs: number;
}


// Interprets the `simulate` field from the incoming webhook's `data` object.
// `attemptNumber` is 1-indexed: the attempt about to run.

export function resolveSimulate(simulate: string | undefined, attemptNumber: number): SimulateOutcome {
  const value = simulate ?? 'ok';

  if (value === 'ok') return { shouldFail: false, delayMs: 0 };
  if (value === 'always_fail') return { shouldFail: true, delayMs: 0 };

  const failThen = value.match(/^fail_then_succeed:(\d+)$/);
  if (failThen) {
    const failCount = Number(failThen[1]);
    return { shouldFail: attemptNumber <= failCount, delayMs: 0 };
  }

  const slow = value.match(/^slow:(\d+)$/);
  if (slow) {
    return { shouldFail: false, delayMs: Number(slow[1]) * 1000 };
  }

  return { shouldFail: false, delayMs: 0 };
}
