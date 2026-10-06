const MAX_ENTRIES = 50_000;

/**
 * measureText is slow, and the same (font, text) pairs repeat every frame
 * while scrolling, so results are cached. The cache is dropped wholesale at a
 * size cap, which is cheaper than LRU bookkeeping in the hot path.
 */
export class TextMeasurer {
  private readonly cache = new Map<string, Map<string, number>>();
  private entries = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  measure(font: string, text: string): number {
    let byText = this.cache.get(font);
    if (byText === undefined) {
      byText = new Map();
      this.cache.set(font, byText);
    }
    const cached = byText.get(text);
    if (cached !== undefined) return cached;
    if (this.entries >= MAX_ENTRIES) {
      this.cache.clear();
      this.entries = 0;
      byText = new Map();
      this.cache.set(font, byText);
    }
    this.ctx.font = font;
    const width = this.ctx.measureText(text).width;
    byText.set(text, width);
    this.entries++;
    return width;
  }
}
