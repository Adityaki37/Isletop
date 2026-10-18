export type Grant = { granted: number; validForMs: number };
export class RequestLimitError extends Error {
  constructor(public retryAfter: number) {
    super(`Too many requests. Try again in ${retryAfter} seconds.`);
  }
}
type Bucket = { remaining: number; expires: number; pending?: Promise<void> };
// Local leases consume quota already reserved in the shared database. Cache
// eviction/cold starts waste reserved allowance; they never create allowance.
export class LeasedRequestLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    private reserve: (key: string) => Promise<Grant>,
    private now = () => performance.now(),
    private capacity = 1024,
  ) {}
  async acquire(key: string) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.capacity) {
        for (const [k, b] of this.buckets)
          if (!b.pending && b.expires <= this.now()) this.buckets.delete(k);
        if (this.buckets.size >= this.capacity) {
          const idle = [...this.buckets].find(([, b]) => !b.pending);
          if (idle) this.buckets.delete(idle[0]);
          else throw new RequestLimitError(1);
        }
      }
      bucket = { remaining: 0, expires: 0 };
      this.buckets.set(key, bucket);
    }
    while (true) {
      if (bucket.pending) {
        await bucket.pending;
        continue;
      }
      if (bucket.expires > this.now()) {
        if (bucket.remaining > 0) {
          bucket.remaining--;
          if (bucket.remaining === 0) bucket.expires = 0;
          return;
        }
        throw new RequestLimitError(
          Math.max(1, Math.ceil((bucket.expires - this.now()) / 1000)),
        );
      }
      const started = this.now();
      bucket.pending = this.reserve(key).then((grant) => {
        bucket!.remaining = grant.granted;
        bucket!.expires = started + grant.validForMs;
      });
      try {
        await bucket.pending;
      } finally {
        bucket.pending = undefined;
      }
      // Exhausting a successful lease must fetch another reservation. A denied
      // grant is cached to the window boundary, avoiding a database retry storm.
      if (bucket.remaining > 0 && bucket.expires > this.now()) {
        bucket.remaining--;
        if (bucket.remaining === 0) bucket.expires = 0;
        return;
      }
      if (bucket.expires > this.now())
        throw new RequestLimitError(
          Math.max(1, Math.ceil((bucket.expires - this.now()) / 1000)),
        );
      // A reservation that expired in transit is unusable. Fail closed rather
      // than spinning against storage or letting stale quota cross windows.
      throw new RequestLimitError(1);
    }
  }
}
