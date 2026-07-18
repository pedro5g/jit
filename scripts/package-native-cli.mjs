import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [packageDirectory, binaryPath] = process.argv.slice(2);
if (!packageDirectory || !binaryPath) {
  throw new Error("usage: node scripts/package-native-cli.mjs <package-dir> <binary>");
}

const destinationDirectory = path.join(packageDirectory, "bin");
const destination = path.join(destinationDirectory, path.basename(binaryPath));
await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });
await copyFile(binaryPath, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);
console.log(`packaged ${binaryPath} -> ${destination}`);
