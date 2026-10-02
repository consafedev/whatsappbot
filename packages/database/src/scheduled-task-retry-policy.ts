export interface ScheduledTaskRetryPolicyOptions {
  readonly initialDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly maxDelayMs?: number;
  readonly jitterSeed?: string;
}

const DEFAULT_INITIAL_DELAY_MS = 5_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_DELAY_MS = 3_600_000;

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
}

/** Returns deterministic exponential backoff; retryCount 0 is the initial delay. */
export function calculateRetryDelayMs(
  retryCount: number,
  options: ScheduledTaskRetryPolicyOptions = {},
): number {
  if (!Number.isInteger(retryCount) || retryCount < 0) {
    throw new RangeError("retryCount must be a non-negative integer");
  }

  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const backoffMultiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  assertFinitePositive(initialDelayMs, "initialDelayMs");
  assertFinitePositive(backoffMultiplier, "backoffMultiplier");
  if (backoffMultiplier < 1) {
    throw new RangeError("backoffMultiplier must be at least 1");
  }
  assertFinitePositive(maxDelayMs, "maxDelayMs");

  const baseDelayMs = initialDelayMs * backoffMultiplier ** retryCount;
  if (options.jitterSeed === undefined) return Math.min(baseDelayMs, maxDelayMs);
  if (options.jitterSeed.length === 0) {
    throw new RangeError("jitterSeed must not be empty");
  }

  let hash = 2_166_136_261;
  for (const character of options.jitterSeed) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  hash = Math.imul(hash ^ retryCount, 16_777_619) >>> 0;
  const jitterWindowMs = Math.floor(baseDelayMs * 0.1);
  const jitterMs = jitterWindowMs === 0 ? 0 : hash % (jitterWindowMs + 1);
  return Math.min(baseDelayMs + jitterMs, maxDelayMs);
}
