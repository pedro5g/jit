import type { GenerationModel } from "./catalog";
import { TRANSFORMERS_CACHE_KEY } from "./catalog";

/**
 * What is actually on this machine, and what a download would still cost.
 *
 * transformers.js stores every file it fetches in Cache Storage under the
 * repository's own URL, so the cache is a truthful record of what was already
 * downloaded — far better than a localStorage flag, which lies the moment the
 * browser evicts storage or the reader clears site data. Reading it lets a
 * second visit start with zero bytes, and an interrupted download resume from
 * exactly the files that completed.
 */

const HF_HOST = "https://huggingface.co";

export interface ModelFile {
  path: string;
  bytes: number;
  url: string;
  /** Its absence means the model cannot load; other files may never be fetched. */
  essential: boolean;
}

export interface ModelManifest {
  repo: string;
  files: ModelFile[];
  totalBytes: number;
}

export interface ModelPresence {
  /** Bytes already in Cache Storage for this model. */
  cachedBytes: number;
  totalBytes: number;
  /** Every required file is present: loading it downloads nothing. */
  complete: boolean;
  /** Some files present: a download resumes rather than restarts. */
  partial: boolean;
}

interface TreeEntry {
  type: string;
  path: string;
  size?: number;
  lfs?: { size?: number };
}

const manifests = new Map<string, Promise<ModelManifest>>();

function fileUrl(repo: string, path: string) {
  return `${HF_HOST}/${repo}/resolve/main/${path}`;
}

/**
 * The files a text-generation pipeline cannot start without. Everything else a
 * repository carries is optional: `chat_template.jinja`, for instance, is only
 * fetched by a Processor, and a tokenizer reads its template out of
 * `tokenizer_config.json` instead — so requiring it would leave a fully
 * downloaded model reporting itself as incomplete forever.
 */
const ESSENTIAL_ROOT_FILES = new Set(["config.json", "tokenizer.json", "tokenizer_config.json"]);

/**
 * The files a text-generation pipeline may fetch: the repository's
 * configuration and tokenizer, plus only the ONNX weights for the chosen
 * quantization. A repo carries every dtype at once, so counting all of them
 * would report a download five times larger than the real one.
 */
function requiredFiles(repo: string, dtype: string, entries: TreeEntry[]): ModelFile[] {
  const files: ModelFile[] = [];

  for (const entry of entries) {
    if (entry.type !== "file") continue;
    const bytes = entry.lfs?.size ?? entry.size ?? 0;
    const path = entry.path;

    const isRootConfig = !path.includes("/") && (path.endsWith(".json") || path.endsWith(".jinja"));
    // model_q4f16.onnx and its external-data siblings, never another dtype's
    const isWeight = /^onnx\//.test(path) && new RegExp(`_${dtype}\\.onnx(_data(_\\d+)?)?$`).test(path);

    if (isRootConfig || isWeight) {
      files.push({ path, bytes, url: fileUrl(repo, path), essential: isWeight || ESSENTIAL_ROOT_FILES.has(path) });
    }
  }

  return files;
}

/** Reads the repository file list once per session. */
export function loadManifest(model: GenerationModel): Promise<ModelManifest> {
  const existing = manifests.get(model.id);
  if (existing) return existing;

  const promise = fetch(`${HF_HOST}/api/models/${model.repo}/tree/main?recursive=1`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not read the model manifest (${response.status}).`);
      const entries = (await response.json()) as TreeEntry[];
      const files = requiredFiles(model.repo, model.dtype, entries);
      if (files.length === 0) throw new Error("The model manifest lists no files for this quantization.");

      return { repo: model.repo, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    })
    .catch((error: unknown) => {
      manifests.delete(model.id);
      throw error;
    });

  manifests.set(model.id, promise);
  return promise;
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  return caches.open(TRANSFORMERS_CACHE_KEY).catch(() => null);
}

/** How much of this model is already on the machine. */
export async function inspectModel(model: GenerationModel): Promise<ModelPresence> {
  const fallback = { cachedBytes: 0, totalBytes: model.approximateBytes, complete: false, partial: false };

  const cache = await openCache();
  if (!cache) return fallback;

  const manifest = await loadManifest(model).catch(() => null);
  // Without the manifest the cache is still the truth, just less precise: a
  // reader who downloaded the model and came back offline must not be told to
  // download it again because an API call failed.
  if (!manifest) return inspectWithoutManifest(cache, model);

  let cachedBytes = 0;
  let present = 0;
  let essentialPresent = 0;
  let essentialTotal = 0;

  for (const file of manifest.files) {
    if (file.essential) essentialTotal += 1;

    const hit = await cache.match(file.url);
    if (!hit) continue;

    present += 1;
    cachedBytes += file.bytes;
    if (file.essential) essentialPresent += 1;
  }

  return {
    cachedBytes,
    totalBytes: manifest.totalBytes,
    // completeness is decided by the essential files only
    complete: essentialTotal > 0 && essentialPresent === essentialTotal,
    partial: present > 0 && essentialPresent < essentialTotal,
  };
}

/**
 * Completeness judged from the cache alone. The weights are the file that
 * takes the time, so their presence is what "already downloaded" means here.
 */
async function inspectWithoutManifest(cache: Cache, model: GenerationModel): Promise<ModelPresence> {
  const prefix = `${HF_HOST}/${model.repo}/`;
  const requests = await cache.keys().catch(() => []);
  const mine = requests.filter((request) => request.url.startsWith(prefix));
  const weights = mine.filter((request) => request.url.includes(`_${model.dtype}.onnx`));

  return {
    cachedBytes: weights.length > 0 ? model.approximateBytes : 0,
    totalBytes: model.approximateBytes,
    complete: weights.length > 0,
    partial: mine.length > 0 && weights.length === 0,
  };
}

/** Frees the space a model occupies, so the picker can offer to remove it. */
export async function deleteModel(model: GenerationModel): Promise<void> {
  const cache = await openCache();
  if (!cache) return;

  const manifest = await loadManifest(model).catch(() => null);
  if (manifest) {
    await Promise.all(manifest.files.map((file) => cache.delete(file.url)));
    return;
  }

  // no manifest: fall back to matching this repository's URLs in the cache
  const prefix = `${HF_HOST}/${model.repo}/`;
  const requests = await cache.keys();
  await Promise.all(
    requests.filter((request) => request.url.startsWith(prefix)).map((request) => cache.delete(request))
  );
}

/** Rough headroom check, so a 3 GB download does not start against a full disk. */
export async function hasRoomFor(bytes: number): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return true;

  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  if (!quota) return true;

  return quota - usage > bytes * 1.15;
}
