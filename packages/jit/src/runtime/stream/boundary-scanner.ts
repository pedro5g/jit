/**
 * Incremental JSON boundary scanner — the finite state machine behind
 * streaming validation. It never parses values; it only tracks enough
 * lexical state (inside-string, escape, bracket depth) to know where
 * complete top-level elements end, surviving chunks that cut a token in
 * half (`{"name": "Andr` + `ez"}` stays buffered until the quote closes).
 *
 * Structural violations (unbalanced closers, content after the root) are
 * reported immediately via the `fail` callback so callers can drop the
 * connection without waiting for the document to finish.
 */

export interface ScannerHooks {
  /** Called with each complete top-level array element (array mode). */
  readonly onElement: (text: string) => void;
  /** Called on a structural violation; must throw. */
  readonly fail: (message: string) => never;
}

/** Scanner over the elements of a root JSON array. */
export class ArrayBoundaryScanner {
  private buffer = "";
  private scanPos = 0;
  private elementStart = -1;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private rootStarted = false;
  private rootClosed = false;

  constructor(private readonly hooks: ScannerHooks) {}

  get done(): boolean {
    return this.rootClosed;
  }

  get hasOpenElement(): boolean {
    return this.elementStart !== -1 || (this.rootStarted && !this.rootClosed);
  }

  push(text: string): void {
    this.buffer += text;

    const buf = this.buffer;
    const len = buf.length;
    let pos = this.scanPos;

    for (; pos < len; pos++) {
      const code = buf.charCodeAt(pos);

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (code === 92) {
          this.escaped = true;
        } else if (code === 34) {
          this.inString = false;
        }
        continue;
      }

      // Whitespace: space, tab, newline, carriage return.
      if (code === 32 || code === 9 || code === 10 || code === 13) continue;

      if (this.rootClosed) {
        this.hooks.fail("unexpected content after the root array closed");
      }

      if (!this.rootStarted) {
        if (code !== 91) this.hooks.fail("expected the stream to start with an array");
        this.rootStarted = true;
        this.depth = 1;
        continue;
      }

      if (this.depth === 1) {
        if (code === 93) {
          // Root close: flush a pending trailing element.
          if (this.elementStart !== -1) {
            this.hooks.onElement(buf.slice(this.elementStart, pos));
            this.elementStart = -1;
          }
          this.depth = 0;
          this.rootClosed = true;
          continue;
        }

        if (code === 44) {
          if (this.elementStart === -1) this.hooks.fail("unexpected comma in the root array");
          this.hooks.onElement(buf.slice(this.elementStart, pos));
          this.elementStart = -1;
          continue;
        }

        if (this.elementStart === -1) this.elementStart = pos;
        if (code === 123 || code === 91) this.depth++;
        else if (code === 34) this.inString = true;
        else if (code === 125) this.hooks.fail("unbalanced '}' in the root array");
        continue;
      }

      // Inside a nested element.
      if (code === 34) this.inString = true;
      else if (code === 123 || code === 91) this.depth++;
      else if (code === 125 || code === 93) {
        this.depth--;
        if (this.depth < 1) this.hooks.fail("unbalanced closing bracket");
      }
    }

    // Compact: drop consumed input, keep only the open element (or nothing).
    if (this.elementStart !== -1) {
      this.buffer = buf.slice(this.elementStart);
      this.scanPos = this.buffer.length;
      this.elementStart = 0;
    } else {
      this.buffer = "";
      this.scanPos = 0;
    }
  }
}

/** Scanner for a single root value (object/scalar): completion tracking only. */
export class ValueBoundaryScanner {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private started = false;
  private closed = false;

  constructor(private readonly hooks: Pick<ScannerHooks, "fail">) {}

  /** True once a bracketed root has balanced back to depth zero. */
  get complete(): boolean {
    return this.closed;
  }

  push(text: string): void {
    const len = text.length;

    for (let pos = 0; pos < len; pos++) {
      const code = text.charCodeAt(pos);

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (code === 92) {
          this.escaped = true;
        } else if (code === 34) {
          this.inString = false;
          if (this.depth === 0 && this.started) this.closed = true;
        }
        continue;
      }

      if (code === 32 || code === 9 || code === 10 || code === 13) continue;

      if (this.closed) this.hooks.fail("unexpected content after the root value closed");

      if (code === 34) {
        this.inString = true;
        this.started = true;
      } else if (code === 123 || code === 91) {
        this.depth++;
        this.started = true;
      } else if (code === 125 || code === 93) {
        this.depth--;
        if (this.depth < 0) this.hooks.fail("unbalanced closing bracket");
        if (this.depth === 0) this.closed = true;
      } else {
        this.started = true;
      }
    }
  }
}
