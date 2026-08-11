import { describe, it, expect } from 'vitest';
import {
  earliestJoinAtMs,
  isTooEarly,
  isWithinReconnectGrace,
  isEmptyTimeoutElapsed,
  isWithinReminderWindow,
  EARLY_JOIN_WINDOW_SECONDS,
  RECONNECT_GRACE_SECONDS,
  EMPTY_TIMEOUT_SECONDS,
} from './timing';

describe('early-join window (B-2, FD-07): 599s allowed / 601s too early', () => {
  const start = 10_000_000; // scheduled_start_at (ms)
  it('earliest_join_at = start - 600s', () => {
    expect(earliestJoinAtMs(start)).toBe(start - EARLY_JOIN_WINDOW_SECONDS * 1000);
  });
  it('601s before start → too early', () => {
    expect(isTooEarly(start, start - 601_000)).toBe(true);
  });
  it('599s before start → allowed', () => {
    expect(isTooEarly(start, start - 599_000)).toBe(false);
  });
  it('exactly at the 600s boundary → allowed', () => {
    expect(isTooEarly(start, start - 600_000)).toBe(false);
  });
});

describe('reconnect grace (B-3, FD-13/FD-29): 14.9s exempt / 15.1s re-evaluate', () => {
  const leaveAtMs = 5_000_000;
  const dev = 'device-hash-A';
  it('14.9s after server leave_at, same endpoint → within grace', () => {
    expect(
      isWithinReconnectGrace({
        leaveAtMs,
        serverNowMs: leaveAtMs + 14_900,
        originalDeviceIdHash: dev,
        currentDeviceIdHash: dev,
      }),
    ).toBe(true);
  });
  it('15.1s after server leave_at → outside grace (re-evaluate)', () => {
    expect(
      isWithinReconnectGrace({
        leaveAtMs,
        serverNowMs: leaveAtMs + 15_100,
        originalDeviceIdHash: dev,
        currentDeviceIdHash: dev,
      }),
    ).toBe(false);
  });
  it('different device_id_hash within 14.9s → NOT exempt (endpoint change)', () => {
    expect(
      isWithinReconnectGrace({
        leaveAtMs,
        serverNowMs: leaveAtMs + 14_900,
        originalDeviceIdHash: dev,
        currentDeviceIdHash: 'device-hash-B',
      }),
    ).toBe(false);
  });
  it('unknown leave_at → NOT exempt (client clock is not authoritative)', () => {
    expect(
      isWithinReconnectGrace({
        leaveAtMs: undefined,
        serverNowMs: 9_999_999,
        originalDeviceIdHash: dev,
        currentDeviceIdHash: dev,
      }),
    ).toBe(false);
  });
  it('grace constant is 15s', () => expect(RECONNECT_GRACE_SECONDS).toBe(15));
});

describe('empty-room timeout (B-4, FD-22): server empty_since anchor, 300s', () => {
  const emptySince = 20_000_000;
  it('elapsed exactly at 300s', () => {
    expect(isEmptyTimeoutElapsed(emptySince, emptySince + 300_000)).toBe(true);
  });
  it('not elapsed at 299s', () => {
    expect(isEmptyTimeoutElapsed(emptySince, emptySince + 299_000)).toBe(false);
  });
  it('no empty_since anchor → never elapsed (frontend cannot derive it)', () => {
    expect(isEmptyTimeoutElapsed(undefined, 99_999_999)).toBe(false);
  });
  it('timeout constant is 300s', () => expect(EMPTY_TIMEOUT_SECONDS).toBe(300));
});

describe('reminder window (E2E-2, 15 min)', () => {
  const start = 30_000_000;
  it('inside 15 min before start', () => {
    expect(isWithinReminderWindow(start, start - 900_000 + 1)).toBe(true);
  });
  it('outside 15 min before start', () => {
    expect(isWithinReminderWindow(start, start - 900_001)).toBe(false);
  });
  it('after start → not in window', () => {
    expect(isWithinReminderWindow(start, start + 1)).toBe(false);
  });
});
