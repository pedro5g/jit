import { Errors } from "../../index.js";

describe("JITError", () => {
  it("is an Error subclass with a stable name", () => {
    const error = new Errors.JITError("INVALID_QUERY", "bad query");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(Errors.JITError);
    expect(error.name).toBe("JITError");
    expect(error.message).toBe("bad query");
  });

  it("carries the machine-readable code", () => {
    const codes = [
      "INVALID_QUERY",
      "INVALID_UPDATE",
      "INVALID_MAPPER",
      "INVALID_OPERATION",
      "UNSUPPORTED_SCHEMA",
      "READONLY_FIELD",
      "REFINE_FAILED",
      "VALIDATION_FAILED",
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "JIT_AOT_002_CAPTURED_RUNTIME_VALUE",
      "JIT_AOT_003_DUPLICATE_EXPORT",
      "JIT_AOT_004_UNSERIALIZABLE_DESCRIPTOR",
      "JIT_AOT_005_EXTERNAL_REFERENCE_INVALID",
      "JIT_AOT_006_GENERATED_PACKAGE_STALE",
      "JIT_AOT_007_OUTPUT_WRITE_FAILED",
      "JIT_AOT_008_IMPORT_MAPPING_MISSING",
      "JIT_AOT_009_ARTIFACT_NAME_COLLISION",
      "JIT_AOT_010_UNSUPPORTED_TARGET",
      "JIT_AOT_011_COLLECTION_TIMEOUT",
      "JIT_AOT_012_INVALID_GENERATED_DECLARATION",
    ] as const;

    for (const code of codes) {
      expect(new Errors.JITError(code, "msg").code).toBe(code);
    }

    expectTypeOf<Errors.JITErrorCode>().toEqualTypeOf<
      | "INVALID_QUERY"
      | "INVALID_UPDATE"
      | "INVALID_MAPPER"
      | "INVALID_OPERATION"
      | "UNSUPPORTED_SCHEMA"
      | "READONLY_FIELD"
      | "REFINE_FAILED"
      | "VALIDATION_FAILED"
      | "JIT_AOT_001_ARTIFACT_EXECUTED"
      | "JIT_AOT_002_CAPTURED_RUNTIME_VALUE"
      | "JIT_AOT_003_DUPLICATE_EXPORT"
      | "JIT_AOT_004_UNSERIALIZABLE_DESCRIPTOR"
      | "JIT_AOT_005_EXTERNAL_REFERENCE_INVALID"
      | "JIT_AOT_006_GENERATED_PACKAGE_STALE"
      | "JIT_AOT_007_OUTPUT_WRITE_FAILED"
      | "JIT_AOT_008_IMPORT_MAPPING_MISSING"
      | "JIT_AOT_009_ARTIFACT_NAME_COLLISION"
      | "JIT_AOT_010_UNSUPPORTED_TARGET"
      | "JIT_AOT_011_COLLECTION_TIMEOUT"
      | "JIT_AOT_012_INVALID_GENERATED_DECLARATION"
    >();
  });

  it("defaults path and meta to undefined when options are omitted", () => {
    const error = new Errors.JITError("REFINE_FAILED", "predicate rejected");

    expect(error.path).toBeUndefined();
    expect(error.meta).toBeUndefined();
  });

  it("stores path and meta from options", () => {
    const error = new Errors.JITError("READONLY_FIELD", "cannot write", {
      path: ["profile", "id"],
      meta: { field: "id" },
    });

    expect(error.path).toEqual(["profile", "id"]);
    expect(error.meta).toEqual({ field: "id" });
  });

  it("rejects unknown codes at the type level", () => {
    const assertInvalidCode = () => {
      // @ts-expect-error "UNKNOWN" is not a JITErrorCode
      new Errors.JITError("UNKNOWN", "msg");
    };

    expect(assertInvalidCode).toBeTypeOf("function");
  });
});
