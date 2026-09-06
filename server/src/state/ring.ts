// Bounded time series: keeps at most `cap` points, oldest evicted first.

export interface RingPoint<T> {
  at: number;
  value: T;
}

export class Ring<T = number> {
  private items: RingPoint<T>[] = [];

  constructor(private cap = 600) {}

  push(value: T, at = Date.now()): void {
    this.items.push({ at, value });
    if (this.items.length > this.cap) {
      this.items.splice(0, this.items.length - this.cap);
    }
  }

  get length(): number {
    return this.items.length;
  }

  last(): RingPoint<T> | undefined {
    return this.items[this.items.length - 1];
  }

  series(): Array<[number, T]> {
    return this.items.map((p) => [p.at, p.value]);
  }

  /** Downsample to at most n points for cheap ws payloads. */
  spark(n = 24): Array<[number, T]> {
    const s = this.series();
    if (s.length <= n) return s;
    const out: Array<[number, T]> = [];
    const step = s.length / n;
    for (let i = 0; i < n; i++) {
      const p = s[Math.floor(i * step)];
      if (p) out.push([p[0], p[1]]);
    }
    return out;
  }
}
