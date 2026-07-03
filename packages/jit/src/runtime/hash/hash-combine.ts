export function combineHash(left: number, right: number): number {
  return ((left << 5) - left + right) | 0;
}
