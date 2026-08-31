export interface CodeExampleVerification {
  ok: boolean;
  error?: string;
}

/** Executes fenced answer examples in an isolated, disposable runtime. */
export interface CodeExampleVerifierPort {
  verify(answer: string, signal: AbortSignal): Promise<CodeExampleVerification>;
}
