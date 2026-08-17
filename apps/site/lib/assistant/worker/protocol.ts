export type AssistantWorkerRequest =
  | { id: number; type: "preload"; modelId: string; dtype: string }
  | {
      id: number;
      type: "generate-text";
      modelId: string;
      dtype: string;
      maxTokens: number;
      messages: { role: string; content: string }[];
    }
  | { id: number; type: "abort-generation" }
  | { id: number; type: "preload-embeddings" }
  | { id: number; type: "embed"; texts: string[] };

export type AssistantWorkerResponse =
  /** Bytes transferred so far; the client owns the total. */
  | { id: number; type: "progress"; loadedBytes: number }
  | { id: number; type: "delta"; text: string }
  /** Embedding vectors arrive flattened, with their width, to transfer as one buffer. */
  | { id: number; type: "vectors"; data: Float32Array; dimensions: number }
  | { id: number; type: "result" }
  | { id: number; type: "error"; message: string };
