/** Fixed-capacity ring buffer of {at, value} samples. */
export class Ring {
  constructor(capacity) {
    this.cap = Math.max(1, capacity | 0);
    this.items = [];
  }

  push(value, at = Date.now()) {
    this.items.push({ at, value });
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }

  /** @returns {Array<[number, number]>} [timestamp, value] pairs, oldest first */
  series() {
    return this.items.map((p) => [p.at, p.value]);
  }

  last() {
    return this.items.length ? this.items[this.items.length - 1] : undefined;
  }

  get length() {
    return this.items.length;
  }
}

export default Ring;
