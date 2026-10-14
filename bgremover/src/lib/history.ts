/**
 * Bounded undo/redo stack. `sizeOf` lets big entries (mask patches) count against a byte budget,
 * so a long editing session can't eat all memory: the oldest entries are dropped first.
 */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private bytes = 0;

  constructor(
    private readonly limit = 50,
    private readonly budget = Infinity,
    private readonly sizeOf: (entry: T) => number = () => 0,
  ) {}

  push(entry: T): void {
    this.undoStack.push(entry);
    this.bytes += this.sizeOf(entry);
    for (const e of this.redoStack) this.bytes -= this.sizeOf(e);
    this.redoStack = [];
    while (this.undoStack.length > this.limit || (this.bytes > this.budget && this.undoStack.length > 1)) {
      this.bytes -= this.sizeOf(this.undoStack.shift()!);
    }
  }

  /** Returns the entry to revert, or undefined. */
  undo(): T | undefined {
    const e = this.undoStack.pop();
    if (e !== undefined) this.redoStack.push(e);
    return e;
  }

  /** Returns the entry to re-apply, or undefined. */
  redo(): T | undefined {
    const e = this.redoStack.pop();
    if (e !== undefined) this.undoStack.push(e);
    return e;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get size() {
    return { undo: this.undoStack.length, redo: this.redoStack.length, bytes: this.bytes };
  }
}
