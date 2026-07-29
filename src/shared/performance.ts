export interface LatencyDistribution {
  averageDurationMs: number;
  count: number;
  firstDurationMs?: number;
  maxDurationMs: number;
  minDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  sampleCount: number;
  warmAverageDurationMs: number;
  warmCount: number;
  warmP50DurationMs: number;
  warmP95DurationMs: number;
  warmP99DurationMs: number;
}

export class BoundedLatencyRecorder {
  readonly #limit: number;
  readonly #samples: number[] = [];
  readonly #warmSamples: number[] = [];
  #count = 0;
  #firstDurationMs: number | undefined;
  #maxDurationMs = 0;
  #minDurationMs = Number.POSITIVE_INFINITY;
  #totalDurationMs = 0;
  #warmTotalDurationMs = 0;

  constructor(limit = 128) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  record(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    this.#count += 1;
    this.#totalDurationMs += durationMs;
    this.#maxDurationMs = Math.max(this.#maxDurationMs, durationMs);
    this.#minDurationMs = Math.min(this.#minDurationMs, durationMs);
    appendBounded(this.#samples, durationMs, this.#limit);

    if (this.#firstDurationMs === undefined) {
      this.#firstDurationMs = durationMs;
      return;
    }

    this.#warmTotalDurationMs += durationMs;
    appendBounded(this.#warmSamples, durationMs, this.#limit);
  }

  reset(): void {
    this.#samples.length = 0;
    this.#warmSamples.length = 0;
    this.#count = 0;
    this.#firstDurationMs = undefined;
    this.#maxDurationMs = 0;
    this.#minDurationMs = Number.POSITIVE_INFINITY;
    this.#totalDurationMs = 0;
    this.#warmTotalDurationMs = 0;
  }

  summary(): LatencyDistribution {
    const warmCount = Math.max(0, this.#count - 1);

    return {
      averageDurationMs: this.#count > 0 ? this.#totalDurationMs / this.#count : 0,
      count: this.#count,
      ...(this.#firstDurationMs === undefined
        ? {}
        : { firstDurationMs: this.#firstDurationMs }),
      maxDurationMs: this.#count > 0 ? this.#maxDurationMs : 0,
      minDurationMs: this.#count > 0 ? this.#minDurationMs : 0,
      p50DurationMs: percentile(this.#samples, 0.5),
      p95DurationMs: percentile(this.#samples, 0.95),
      p99DurationMs: percentile(this.#samples, 0.99),
      sampleCount: this.#samples.length,
      warmAverageDurationMs:
        warmCount > 0 ? this.#warmTotalDurationMs / warmCount : 0,
      warmCount,
      warmP50DurationMs: percentile(this.#warmSamples, 0.5),
      warmP95DurationMs: percentile(this.#warmSamples, 0.95),
      warmP99DurationMs: percentile(this.#warmSamples, 0.99),
    };
  }
}

export const percentile = (values: readonly number[], quantile: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const boundedQuantile = Math.min(1, Math.max(0, quantile));
  const index = Math.max(0, Math.ceil(boundedQuantile * sorted.length) - 1);

  return sorted[index] ?? 0;
};

const appendBounded = (values: number[], value: number, limit: number): void => {
  values.push(value);

  if (values.length > limit) {
    values.splice(0, values.length - limit);
  }
};
