import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttled } from '../src/lib/platform/throttle';

describe('throttled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces many calls inside one window into a single emit', () => {
    const fn = vi.fn();
    const t = throttled<[number]>(200, fn);
    t.call(1);
    t.call(2);
    t.call(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3); // newest args win
  });

  it('emits once per window when calls keep arriving', () => {
    const fn = vi.fn();
    const t = throttled<[number]>(200, fn);
    t.call(1);
    vi.advanceTimersByTime(200);
    t.call(2);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('flush emits the pending call immediately and clears the timer', () => {
    const fn = vi.fn();
    const t = throttled<[number]>(200, fn);
    t.call(7);
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(7);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1); // no duplicate fire
  });

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const t = throttled<[number]>(200, fn);
    t.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel drops the pending call', () => {
    const fn = vi.fn();
    const t = throttled<[number]>(200, fn);
    t.call(1);
    t.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
