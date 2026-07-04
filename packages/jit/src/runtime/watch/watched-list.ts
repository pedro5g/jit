/** A reference-level update detected by a watched list. */
export interface WatchedListUpdate<TItem> {
  readonly previous: TItem;
  readonly current: TItem;
}

/** Immutable-by-convention snapshot of the current watched-list state. */
export interface WatchedListSnapshot<TItem> {
  readonly currentItems: TItem[];
  readonly initialItems: TItem[];
  readonly newItems: TItem[];
  readonly removedItems: TItem[];
  readonly updatedItems: WatchedListUpdate<TItem>[];
  readonly isChanged: boolean;
}

/** Options used to decide item identity inside a watched list. */
export interface WatchedListOptions<TItem> {
  readonly key?: Extract<keyof TItem, string>;
  readonly compare?: (left: TItem, right: TItem) => boolean;
}

type Indexed<TItem> = {
  readonly item: TItem;
  readonly index: number;
};

/**
 * DDD-style watched list for aggregate child collections.
 *
 * Use `key` for object identity, `compare` for custom identity, or no options
 * for primitive/Object.is identity. When a schema key is known, prefer
 * `JIT.watchedList(schema, items, { key })`, which returns the indexed
 * implementation automatically.
 */
export class WatchedList<TItem> {
  protected currentItems: TItem[];
  private readonly initialItems: TItem[];
  protected newItems: TItem[];
  protected removedItems: TItem[];
  protected updatedItems: WatchedListUpdate<TItem>[];
  protected readonly key: Extract<keyof TItem, string> | undefined;
  private readonly compare: ((left: TItem, right: TItem) => boolean) | undefined;

  public constructor(initialItems: readonly TItem[] = [], options: WatchedListOptions<TItem> = {}) {
    this.currentItems = [...initialItems];
    this.initialItems = [...initialItems];
    this.newItems = [];
    this.removedItems = [];
    this.updatedItems = [];
    this.key = options.key;
    this.compare = options.compare;
  }

  public compareItems(left: TItem, right: TItem): boolean {
    if (this.compare) return this.compare(left, right);
    if (this.key) return Object.is(left[this.key], right[this.key]);
    return Object.is(left, right);
  }

  public getItems(): TItem[] {
    return this.currentItems;
  }

  public getInitialItems(): TItem[] {
    return this.initialItems;
  }

  public getNewItems(): TItem[] {
    return this.newItems;
  }

  public getRemovedItems(): TItem[] {
    return this.removedItems;
  }

  public getUpdatedItems(): WatchedListUpdate<TItem>[] {
    return this.updatedItems;
  }

  public isChanged(): boolean {
    return this.newItems.length !== 0 || this.removedItems.length !== 0 || this.updatedItems.length !== 0;
  }

  public exists(item: TItem): boolean {
    return this.findIndex(this.currentItems, item) !== -1;
  }

  public add(item: TItem): void {
    const removedIndex = this.findIndex(this.removedItems, item);

    if (removedIndex !== -1) this.removeAt(this.removedItems, removedIndex);

    if (this.findIndex(this.newItems, item) === -1 && this.findIndex(this.initialItems, item) === -1) {
      this.newItems[this.newItems.length] = item;
    }

    if (this.findIndex(this.currentItems, item) === -1) {
      this.currentItems[this.currentItems.length] = item;
    }
  }

  public remove(item: TItem): void {
    const currentIndex = this.findIndex(this.currentItems, item);

    if (currentIndex !== -1) this.removeAt(this.currentItems, currentIndex);

    const newIndex = this.findIndex(this.newItems, item);

    if (newIndex !== -1) {
      this.removeAt(this.newItems, newIndex);
      return;
    }

    if (this.findIndex(this.removedItems, item) === -1) {
      this.removedItems[this.removedItems.length] = item;
    }
  }

  public update(items: readonly TItem[]): void {
    const previousItems = this.currentItems;
    const previousIndex = this.createIndex(previousItems);
    const nextIndex = this.createIndex(items);
    const newItems: TItem[] = [];
    const removedItems: TItem[] = [];
    const updatedItems: WatchedListUpdate<TItem>[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const previous = this.lookup(previousIndex, previousItems, item);

      if (!previous) {
        newItems[newItems.length] = item;
      } else if (previous.item !== item) {
        updatedItems[updatedItems.length] = { previous: previous.item, current: item };
      }
    }

    for (let index = 0; index < previousItems.length; index++) {
      const item = previousItems[index];
      const next = this.lookup(nextIndex, items, item);

      if (!next) removedItems[removedItems.length] = item;
    }

    this.currentItems = [...items];
    this.newItems = newItems;
    this.removedItems = removedItems;
    this.updatedItems = updatedItems;
  }

  public snapshot(): WatchedListSnapshot<TItem> {
    return {
      currentItems: this.currentItems,
      initialItems: this.initialItems,
      newItems: this.newItems,
      removedItems: this.removedItems,
      updatedItems: this.updatedItems,
      isChanged: this.isChanged(),
    };
  }

  protected findIndex(items: readonly TItem[], item: TItem): number {
    if (this.key || !this.compare) {
      const index = this.createIndex(items);
      const found = this.lookup(index, items, item);

      return found?.index ?? -1;
    }

    for (let index = 0; index < items.length; index++) {
      if (this.compareItems(item, items[index])) return index;
    }

    return -1;
  }

  protected createIndex(items: readonly TItem[]): Map<unknown, Indexed<TItem>> | undefined {
    if (this.compare && !this.key) return undefined;

    const index = new Map<unknown, Indexed<TItem>>();

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];

      index.set(this.identityOf(item), { item, index: itemIndex });
    }

    return index;
  }

  protected lookup(
    index: Map<unknown, Indexed<TItem>> | undefined,
    items: readonly TItem[],
    item: TItem
  ): Indexed<TItem> | undefined {
    if (index) return index.get(this.identityOf(item));

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const current = items[itemIndex];

      if (this.compareItems(item, current)) return { item: current, index: itemIndex };
    }

    return undefined;
  }

  protected identityOf(item: TItem): unknown {
    return this.key ? item[this.key] : item;
  }

  protected removeAt(items: TItem[], index: number): void {
    for (let next = index + 1; next < items.length; next++) {
      items[next - 1] = items[next];
    }

    items.length = items.length - 1;
  }
}

/**
 * WatchedList optimized for stable object identity keys.
 *
 * Maintains internal indexes for current, initial, new, and removed items so
 * common aggregate operations avoid repeated scans.
 */
export class KeyedWatchedList<TItem> extends WatchedList<TItem> {
  private readonly currentIndex = new Map<unknown, Indexed<TItem>>();
  private readonly initialIndex = new Map<unknown, Indexed<TItem>>();
  private readonly newIndex = new Map<unknown, Indexed<TItem>>();
  private readonly removedIndex = new Map<unknown, Indexed<TItem>>();

  public constructor(
    initialItems: readonly TItem[] = [],
    options: WatchedListOptions<TItem> & { readonly key: Extract<keyof TItem, string> }
  ) {
    super(initialItems, options);
    this.reindex(this.currentIndex, this.currentItems);
    this.reindex(this.initialIndex, this.getInitialItems());
  }

  public override exists(item: TItem): boolean {
    return this.currentIndex.has(this.identityOf(item));
  }

  public override add(item: TItem): void {
    const id = this.identityOf(item);
    const removed = this.removedIndex.get(id);

    if (removed) {
      this.removeAt(this.removedItems, removed.index);
      this.reindex(this.removedIndex, this.removedItems);
    }

    if (!this.newIndex.has(id) && !this.initialIndex.has(id)) {
      this.newItems[this.newItems.length] = item;
      this.newIndex.set(id, { item, index: this.newItems.length - 1 });
    }

    if (!this.currentIndex.has(id)) {
      this.currentItems[this.currentItems.length] = item;
      this.currentIndex.set(id, { item, index: this.currentItems.length - 1 });
    }
  }

  public override remove(item: TItem): void {
    const id = this.identityOf(item);
    const current = this.currentIndex.get(id);

    if (current) {
      this.removeAt(this.currentItems, current.index);
      this.reindex(this.currentIndex, this.currentItems);
    }

    const created = this.newIndex.get(id);

    if (created) {
      this.removeAt(this.newItems, created.index);
      this.reindex(this.newIndex, this.newItems);
      return;
    }

    if (!this.removedIndex.has(id)) {
      this.removedItems[this.removedItems.length] = item;
      this.removedIndex.set(id, { item, index: this.removedItems.length - 1 });
    }
  }

  public override update(items: readonly TItem[]): void {
    const previousItems = this.currentItems;
    const previousIndex = this.currentIndex;
    const nextIndex = new Map<unknown, Indexed<TItem>>();
    const newItems: TItem[] = [];
    const removedItems: TItem[] = [];
    const updatedItems: WatchedListUpdate<TItem>[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const id = this.identityOf(item);
      const previous = previousIndex.get(id);

      nextIndex.set(id, { item, index });

      if (!previous) {
        newItems[newItems.length] = item;
      } else if (previous.item !== item) {
        updatedItems[updatedItems.length] = { previous: previous.item, current: item };
      }
    }

    for (let index = 0; index < previousItems.length; index++) {
      const item = previousItems[index];
      const id = this.identityOf(item);

      if (!nextIndex.has(id)) removedItems[removedItems.length] = item;
    }

    this.currentItems = [...items];
    this.newItems = newItems;
    this.removedItems = removedItems;
    this.updatedItems = updatedItems;
    this.reindex(this.currentIndex, this.currentItems);
    this.reindex(this.newIndex, this.newItems);
    this.reindex(this.removedIndex, this.removedItems);
  }

  private reindex(index: Map<unknown, Indexed<TItem>>, items: readonly TItem[]): void {
    index.clear();

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];

      index.set(this.identityOf(item), { item, index: itemIndex });
    }
  }
}
