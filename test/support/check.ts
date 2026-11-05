/** Minimal result recorder shared by the suites and the safety report. */
export interface CheckResult {
  suite: string;
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

export class Checker {
  readonly results: CheckResult[] = [];

  constructor(readonly suite: string) {}

  record(id: string, title: string, passed: boolean, detail = '') {
    this.results.push({ suite: this.suite, id, title, passed, detail });
    if (passed) console.log(`✅ [PASS] ${title}${detail ? ` — ${detail}` : ''}`);
    else console.error(`❌ [FAIL] ${title}${detail ? ` — ${detail}` : ''}`);
    return passed;
  }

  /** Passes when `work` rejects with an error whose `code` (or message) equals `expected`. */
  async expectError(id: string, title: string, expected: string | string[], work: () => Promise<unknown>) {
    const accepted = Array.isArray(expected) ? expected : [expected];
    try {
      await work();
      return this.record(id, title, false, `expected ${accepted.join('|')}, but the call succeeded`);
    } catch (error) {
      const code = (error as { code?: string }).code ?? (error instanceof Error ? error.message : String(error));
      return this.record(id, title, accepted.includes(code), `blocked with ${code}`);
    }
  }

  get passed() {
    return this.results.every((result) => result.passed);
  }
}

/** Deterministic PRNG (mulberry32) so fuzz runs are reproducible from a seed. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
