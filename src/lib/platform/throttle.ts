// Time-window coalescer. Hot paths (per-segment progress, per-segment resume
// checkpoints) would otherwise flood IPC and rewrite whole storage keys once
// per segment — thousands of times for a long VOD.
//
// `call` records the newest args and fires at most once per window; `flush`
// emits the pending call immediately (use before a terminal event so the last
// state is never lost); `cancel` drops it.
export interface Throttled<A extends unknown[]> {
  call(...args: A): void;
  flush(): void;
  cancel(): void;
}

export function throttled<A extends unknown[]>(intervalMs: number, fn: (...a: A) => void): Throttled<A> {
  let pending: A | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    timer = null;
    if (!pending) return;
    const args = pending;
    pending = null;
    fn(...args);
  };

  return {
    call(...args: A) {
      pending = args;
      if (timer === null) timer = setTimeout(fire, intervalMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      fire();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
