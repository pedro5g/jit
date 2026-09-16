/** Combines two signed 32-bit hash fragments into one signed 32-bit hash. */
export function combineHash(left: number, right: number): number {
  return ((left << 5) - left + right) | 0;
}
