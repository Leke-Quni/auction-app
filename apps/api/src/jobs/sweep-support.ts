// Runs `task` every `ms` milliseconds until the returned function is called. The timer never keeps the process alive.
export function runEvery(ms: number, task: () => unknown): () => void {
  const timer = setInterval(() => void task(), ms);
  timer.unref();
  return () => clearInterval(timer);
}

// Ids a sweep leaves out for a while after they failed, so a few broken ones cannot fill every batch. Kept in memory only:
// a machine that restarts simply tries them again.
export class FailureBackoff {
  private readonly until = new Map<string, number>();

  constructor(private readonly waitMs: number) {}

  fail(id: string) {
    this.until.set(id, Date.now() + this.waitMs);
  }

  // The ids to leave out of this pass. Ids whose wait is over are forgotten.
  skipping(): string[] {
    const now = Date.now();
    for (const [id, until] of this.until) if (until <= now) this.until.delete(id);
    return [...this.until.keys()];
  }
}
