import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __dirname } from "../__dirname.js";
import semver from "semver";

const packageJsonPath = join(__dirname, "./packages/jit/package.json");

try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const version = packageJson.version;

  if (!version) {
    throw new Error("Version field is missing in package.json");
  }

  if (!semver.valid(version)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  const semverRegex = /^\d+\.\d+\.\d+$/;
  if (!semverRegex.test(version)) {
    throw new Error(`Version ${version} does not match x.y.z format`);
  }

  console.log(`Valid semver version: ${version}`);
} catch (error: any) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
