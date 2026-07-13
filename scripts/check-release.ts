import { readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { __dirname } from "../__dirname.js";

interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string;
  repository?: { url?: string };
  publishConfig?: { access?: string; provenance?: boolean };
}

interface JsrManifest {
  name?: string;
  version?: string;
  exports?: unknown;
}

const packageDir = join(__dirname, "packages/jit");
const packageManifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as PackageManifest;
const jsrManifest = JSON.parse(readFileSync(join(packageDir, "jsr.json"), "utf8")) as JsrManifest;
const changelog = readFileSync(join(__dirname, "CHANGELOG.md"), "utf8");
const expectedNpmName = "@jit-compiler/jit";
const expectedJsrName = "@jit/compiler";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(packageManifest.name === expectedNpmName, `npm package must be named ${expectedNpmName}`);
check(jsrManifest.name === expectedJsrName, `JSR package must be named ${expectedJsrName}`);
check(packageManifest.version !== undefined, "package.json version is missing");
check(semver.valid(packageManifest.version), `invalid package version: ${packageManifest.version}`);
check(jsrManifest.version === packageManifest.version, "package.json and jsr.json versions must match");
check(packageManifest.private !== true, "the npm package cannot be private");
check(packageManifest.license === "MIT", "the release package must declare the MIT license");
check(packageManifest.repository?.url === "git+https://github.com/pedro5g/jit.git", "repository URL is invalid");
check(packageManifest.publishConfig?.access === "public", "npm publishConfig.access must be public");
check(packageManifest.publishConfig?.provenance === true, "npm provenance must remain enabled");
check(jsrManifest.exports !== undefined, "JSR exports are missing");
check(
  changelog.includes(`## [${packageManifest.version}]`),
  `CHANGELOG.md needs a section for ${packageManifest.version}`
);

const tag =
  process.env.RELEASE_TAG ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
if (tag !== undefined) {
  check(tag === `v${packageManifest.version}`, `tag ${tag} does not match version v${packageManifest.version}`);
}

console.log(
  `Release metadata is valid for npm ${expectedNpmName}@${packageManifest.version} and JSR ${expectedJsrName}@${packageManifest.version}${tag ? ` (${tag})` : ""}.`
);
