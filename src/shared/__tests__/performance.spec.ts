import { describe, expect, it } from "vitest";

import { BoundedLatencyRecorder, percentile } from "../performance";

describe("performance statistics", () => {
  it("computes first, warm, and tail latency distributions", () => {
    const recorder = new BoundedLatencyRecorder();

    [100, 10, 20, 30, 40].forEach((duration) => recorder.record(duration));

    expect(recorder.summary()).toEqual({
      averageDurationMs: 40,
      count: 5,
      firstDurationMs: 100,
      maxDurationMs: 100,
      minDurationMs: 10,
      p50DurationMs: 30,
      p95DurationMs: 100,
      p99DurationMs: 100,
      sampleCount: 5,
      warmAverageDurationMs: 25,
      warmCount: 4,
      warmP50DurationMs: 20,
      warmP95DurationMs: 40,
      warmP99DurationMs: 40,
    });
  });

  it("bounds percentile samples without losing all-time aggregates", () => {
    const recorder = new BoundedLatencyRecorder(3);

    [100, 10, 20, 30, 40].forEach((duration) => recorder.record(duration));
    const summary = recorder.summary();

    expect(summary.count).toBe(5);
    expect(summary.firstDurationMs).toBe(100);
    expect(summary.averageDurationMs).toBe(40);
    expect(summary.maxDurationMs).toBe(100);
    expect(summary.sampleCount).toBe(3);
    expect(summary.p50DurationMs).toBe(30);
    expect(summary.p95DurationMs).toBe(40);
    expect(summary.warmP50DurationMs).toBe(30);
  });

  it("handles empty, invalid, and out-of-range samples", () => {
    const recorder = new BoundedLatencyRecorder(0);

    recorder.record(Number.NaN);
    recorder.record(-1);
    expect(recorder.summary()).toMatchObject({ count: 0, p50DurationMs: 0 });
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 2)).toBe(3);

    recorder.record(5);
    recorder.reset();
    expect(recorder.summary()).toMatchObject({ count: 0, sampleCount: 0 });
  });
});
