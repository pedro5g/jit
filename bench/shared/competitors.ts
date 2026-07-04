import { createRequire } from "node:module";
import fastEqual from "fast-deep-equal";
import { enableMapSet, produce } from "immer";
import microdiff from "microdiff";
import rfdcFactory from "rfdc";

// lodash packages are CJS-only; createRequire keeps the ESM suites working.
const require = createRequire(import.meta.url);

export const lodashIsEqual = require("lodash.isequal") as (left: unknown, right: unknown) => boolean;
export const lodashCloneDeep = require("lodash.clonedeep") as <T>(value: T) => T;

export const rfdcClone = rfdcFactory();

enableMapSet();

export { fastEqual, microdiff, produce };
