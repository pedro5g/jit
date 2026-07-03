export function buildIndex<TItem, TKey extends keyof TItem>(
  items: readonly TItem[],
  key: TKey
): Map<TItem[TKey], TItem> {
  const index = new Map<TItem[TKey], TItem>();

  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i];
    index.set(item[key], item);
  }

  return index;
}
