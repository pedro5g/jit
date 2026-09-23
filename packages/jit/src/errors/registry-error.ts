import { JITError } from "./jit-error.js";

/** Raised when two entries in one registry claim the same metadata id. */
export class RegistryDuplicateIdError extends JITError {
  readonly id: string;

  constructor(id: string) {
    super("REGISTRY_DUPLICATE_ID", `Registry metadata id is already registered: ${JSON.stringify(id)}`, {
      meta: { id },
    });
    this.name = "RegistryDuplicateIdError";
    this.id = id;
  }
}
