// Debounced per-key autosave queue (framework-free so it can be tested with fake timers).
export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error'; message: string };

export class Autosaver<V> {
  private pending = new Map<string, V>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight = 0;
  private failed = false;
  private lastSaved: Date | undefined;

  private write: (key: string, value: V) => Promise<void>;
  private onState: (s: SaveState) => void;
  private delay: number;

  constructor(write: (key: string, value: V) => Promise<void>, onState: (s: SaveState) => void, delay = 600) {
    this.write = write;
    this.onState = onState;
    this.delay = delay;
  }

  /** Queue the latest value for `key`; the write happens `delay` ms after the last change. */
  schedule(key: string, value: V) {
    this.pending.set(key, value);
    this.onState({ kind: 'saving' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** Write everything queued now. Failed writes stay queued so "Try again" (or the next change) resends them. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const batch = [...this.pending];
    this.pending.clear();
    if (batch.length === 0) return;
    this.inflight++;
    this.onState({ kind: 'saving' });
    let error: unknown;
    await Promise.all(batch.map(async ([key, value]) => {
      try {
        await this.write(key, value);
      } catch (e) {
        error ??= e;
        // Keep a newer value if one arrived meanwhile.
        if (!this.pending.has(key)) this.pending.set(key, value);
      }
    }));
    this.inflight--;
    if (error !== undefined) {
      this.failed = true;
      this.onState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not save.' });
    } else if (this.pending.size === 0 && this.inflight === 0) {
      this.failed = false;
      this.lastSaved = new Date();
      this.onState({ kind: 'saved', at: this.lastSaved });
    }
  }

  get hasPending() {
    return this.pending.size > 0 || this.inflight > 0;
  }

  get hasFailed() {
    return this.failed;
  }
}
