export interface EmitState {
  nextVar(prefix: string): string;
}

export function createEmitState(): EmitState {
  const counts = new Map<string, number>();

  return {
    nextVar(prefix: string): string {
      const next = counts.get(prefix) ?? 0;
      const name = next === 0 ? prefix : `${prefix}${next}`;
      counts.set(prefix, next + 1);
      return name;
    },
  };
}
