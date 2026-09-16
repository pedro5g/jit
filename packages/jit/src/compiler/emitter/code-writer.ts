export class CodeWriter {
  readonly #lines: string[] = [];
  #indent = 0;

  public line(text: string = ""): void {
    this.#lines.push(`${"  ".repeat(this.#indent)}${text}`);
  }

  public dynamicLine(text: string): void {
    this.line(text);
  }

  public indent(fn: () => void): void {
    this.#indent++;
    fn();
    this.#indent--;
  }

  public toString(): string {
    return this.#lines.join("\n");
  }
}
