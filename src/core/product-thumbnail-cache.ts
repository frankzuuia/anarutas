type Images = Map<number, Buffer | null>;
type Entry = { promise: Promise<Images>; expires: number; bytes: number };

/** Only image results are cached; authorization always runs outside this cache. */
export class ProductThumbnailCache {
  private entries = new Map<string, Entry>();
  constructor(private now = Date.now, private maximumEntries = 64, private maximumBytes = 16 * 1024 * 1024) {}

  async get(key: string, load: () => Promise<Images>): Promise<Images> {
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.now()) {
      this.entries.delete(key); this.entries.set(key, existing);
      return existing.promise;
    }
    this.entries.delete(key);
    const entry: Entry = { expires: Infinity, bytes: 0, promise: Promise.resolve(new Map()) };
    entry.promise = Promise.resolve().then(load).then(images => {
      entry.bytes = [...images.values()].reduce((sum, bytes) => sum + (bytes?.length ?? 0), 0);
      entry.expires = this.now() + 15 * 60_000;
      this.trim();
      return images;
    }, error => {
      // Share a short failure cooldown across every line of the same order.
      entry.expires = this.now() + 30_000;
      throw error;
    });
    this.entries.set(key, entry);
    this.trim();
    return entry.promise;
  }

  private trim() {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (this.entries.size > this.maximumEntries || bytes > this.maximumBytes) {
      const oldest = this.entries.keys().next().value!;
      bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}
