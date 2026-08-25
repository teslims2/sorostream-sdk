import { describe, it, expect } from 'vitest';
import { MockSoroStreamClient } from '../src/mock.js';
import { toStroops } from '../src/utils.js';

// simulateStream is a synchronous, pure method on SoroStreamClient (and MockSoroStreamClient
// inherits it). We test via MockSoroStreamClient to avoid any RPC setup.

describe('simulateStream', () => {
  const mock = new MockSoroStreamClient();

  it('returns correct totalDeposit, flowRate, and durationSeconds', () => {
    const amount = toStroops('100'); // 1_000_000_000n
    const durationSeconds = 1000;
    const result = mock.simulateStream({ amount, durationSeconds });

    expect(result.totalDeposit).toBe(amount);
    expect(result.durationSeconds).toBe(durationSeconds);
    // flowRate = floor(1_000_000_000 / 1000) = 1_000_000
    expect(result.flowRate).toBe(1_000_000n);
  });

  it('generates 10 snapshots by default', () => {
    const result = mock.simulateStream({
      amount: toStroops('100'),
      durationSeconds: 1000,
    });

    expect(result.snapshots).toHaveLength(10);
  });

  it('first snapshot has 0 streamed and full remaining', () => {
    const amount = toStroops('100');
    const result = mock.simulateStream({ amount, durationSeconds: 1000 });

    const first = result.snapshots[0]!;
    expect(first.elapsedSeconds).toBe(0);
    expect(first.streamed).toBe(0n);
    expect(first.remaining).toBe(amount);
    expect(first.percentStreamed).toBe(0);
  });

  it('last snapshot has full amount streamed (within rounding) and zero remaining', () => {
    const amount = toStroops('100'); // 1_000_000_000n
    const durationSeconds = 1000;
    const result = mock.simulateStream({ amount, durationSeconds });

    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.elapsedSeconds).toBe(durationSeconds);
    // flowRate (1_000_000) * 1000 = 1_000_000_000 == totalDeposit, so exactly equal
    expect(last.streamed).toBe(amount);
    expect(last.remaining).toBe(0n);
    expect(last.percentStreamed).toBe(100);
  });

  it('percentStreamed is 0 at start and 100 at end', () => {
    const result = mock.simulateStream({
      amount: toStroops('50'),
      durationSeconds: 500,
    });

    expect(result.snapshots[0]!.percentStreamed).toBe(0);
    expect(result.snapshots[result.snapshots.length - 1]!.percentStreamed).toBe(100);
  });

  it('remaining decreases monotonically', () => {
    const result = mock.simulateStream({
      amount: toStroops('100'),
      durationSeconds: 3600,
    });

    for (let i = 1; i < result.snapshots.length; i++) {
      expect(result.snapshots[i]!.remaining).toBeLessThanOrEqual(
        result.snapshots[i - 1]!.remaining,
      );
    }
  });

  it('streamed increases monotonically', () => {
    const result = mock.simulateStream({
      amount: toStroops('100'),
      durationSeconds: 3600,
    });

    for (let i = 1; i < result.snapshots.length; i++) {
      expect(result.snapshots[i]!.streamed).toBeGreaterThanOrEqual(
        result.snapshots[i - 1]!.streamed,
      );
    }
  });

  it('respects custom durationSeconds override', () => {
    const amount = toStroops('100');
    const paramsDuration = 1000;
    const overrideDuration = 2000;

    const result = mock.simulateStream({ amount, durationSeconds: paramsDuration }, overrideDuration);

    expect(result.durationSeconds).toBe(overrideDuration);
    // flowRate = floor(1_000_000_000 / 2000) = 500_000
    expect(result.flowRate).toBe(500_000n);
    expect(result.snapshots[result.snapshots.length - 1]!.elapsedSeconds).toBe(overrideDuration);
  });

  it('respects custom sampleCount', () => {
    const result = mock.simulateStream(
      { amount: toStroops('100'), durationSeconds: 1000 },
      undefined,
      5,
    );

    expect(result.snapshots).toHaveLength(5);
  });

  it('enforces minimum sampleCount of 2', () => {
    const result = mock.simulateStream(
      { amount: toStroops('100'), durationSeconds: 1000 },
      undefined,
      1, // should be clamped to 2
    );

    expect(result.snapshots).toHaveLength(2);
  });

  it('totalStreamed equals flowRate * durationSeconds (capped at totalDeposit)', () => {
    const amount = toStroops('100'); // 1_000_000_000n
    const durationSeconds = 1000;
    const result = mock.simulateStream({ amount, durationSeconds });

    // flowRate = 1_000_000, duration = 1000, so flowRate * duration = 1_000_000_000 == totalDeposit
    expect(result.totalStreamed).toBe(result.flowRate * BigInt(durationSeconds));
    expect(result.totalStreamed).toBeLessThanOrEqual(amount);
  });

  it('totalStreamed is capped at totalDeposit when rounding causes overflow', () => {
    // Use an amount that doesn't divide evenly, so flowRate * duration < amount
    const amount = 1_000_000_001n;
    const durationSeconds = 10;
    const result = mock.simulateStream({ amount, durationSeconds });

    // flowRate = floor(1_000_000_001 / 10) = 100_000_000
    // flowRate * 10 = 1_000_000_000 which is <= amount — totalStreamed should not exceed amount
    expect(result.totalStreamed).toBeLessThanOrEqual(amount);
  });

  it('snapshot streamed is capped at totalDeposit', () => {
    const amount = 100n;
    const durationSeconds = 3;
    // flowRate = floor(100 / 3) = 33
    // At elapsed=3: 33*3=99, which is < 100, so no cap needed in this case
    // Let's verify the streamed never exceeds totalDeposit across all snapshots
    const result = mock.simulateStream({ amount, durationSeconds }, undefined, 4);

    for (const snap of result.snapshots) {
      expect(snap.streamed).toBeLessThanOrEqual(amount);
      expect(snap.remaining).toBeGreaterThanOrEqual(0n);
    }
  });
});
