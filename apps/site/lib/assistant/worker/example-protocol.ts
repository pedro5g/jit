import type { ExampleFailure } from "../example";

/** One example to run. */
export interface ExampleRequest {
  id: number;
  code: string;
}

/** What running it proved. `failure: null` means the example works. */
export interface ExampleResponse {
  id: number;
  failure: ExampleFailure | null;
}
