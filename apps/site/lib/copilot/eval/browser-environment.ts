/**
 * What a browser run has to record about the machine it ran on — §PART 27.
 *
 * A latency number without a device is not a measurement, it is a rumour. But
 * the platform is uneven about what it will tell a page: `deviceMemory` and
 * `performance.memory` are Chrome-only, and an adapter's vendor and
 * architecture are empty strings on several builds. Every field here is
 * therefore optional and *absent* when unavailable — never zero, never
 * "unknown", never inferred from the user agent, because a guessed field is
 * indistinguishable from a measured one once it is in the manifest.
 *
 * Pure on purpose: the page passes its globals in, and the test passes fakes.
 */
import type { RunManifest } from "./artifacts";

export type BrowserBlock = NonNullable<RunManifest["browser"]>;

/** The shape of `GPUAdapterInfo`, minus the parts nothing here reads. */
export interface AdapterInfoLike {
  vendor?: string;
  architecture?: string;
  description?: string;
}

export interface NavigatorLike {
  userAgent: string;
  hardwareConcurrency?: number;
  /** Chrome-only, and rounded by the browser to a coarse ladder. */
  deviceMemory?: number;
}

export interface EnvironmentInput {
  navigator: NavigatorLike;
  adapterInfo?: AdapterInfoLike | null;
  /** `performance.memory.usedJSHeapSize`, in bytes. Chrome-only. */
  usedHeapBytes?: number | null;
}

/** Drops empty strings, which is what a build with no adapter details reports. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function compact<T extends object>(entries: T): Partial<T> | undefined {
  const kept = Object.entries(entries).filter(([, value]) => value !== undefined);
  return kept.length > 0 ? (Object.fromEntries(kept) as Partial<T>) : undefined;
}

export function describeBrowser(input: EnvironmentInput): BrowserBlock {
  const adapter = compact({
    vendor: present(input.adapterInfo?.vendor),
    architecture: present(input.adapterInfo?.architecture),
    description: present(input.adapterInfo?.description),
  });

  const deviceClass = compact({
    cores: input.navigator.hardwareConcurrency,
    memoryGb: input.navigator.deviceMemory,
  });

  return {
    userAgent: input.navigator.userAgent,
    ...(adapter ? { adapter } : {}),
    ...(deviceClass ? { deviceClass } : {}),
    ...(typeof input.usedHeapBytes === "number"
      ? { peakMemoryMb: Math.round((input.usedHeapBytes / (1024 * 1024)) * 10) / 10 }
      : {}),
  };
}

/**
 * Reads the environment out of a live browser, tolerating every absence.
 *
 * `requestAdapter()` can reject on a machine with no WebGPU at all, and
 * `adapter.info` does not exist on older builds — neither is a reason to lose
 * a run that otherwise completed.
 */
/**
 * The heap right now, in MB, or null where the browser will not say.
 *
 * Sampled after every case rather than read once at the end: a run's peak is
 * usually mid-generation, and the number left behind after the last answer is
 * whatever survived a collection.
 */
export function usedHeapMb(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round((memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null;
}

export async function readBrowserEnvironment(): Promise<BrowserBlock> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: AdapterInfoLike } | null> } }).gpu;

  const adapterInfo = await gpu
    ?.requestAdapter()
    .then((adapter) => adapter?.info ?? null)
    .catch(() => null);

  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;

  return describeBrowser({
    navigator: {
      userAgent: navigator.userAgent,
      ...(typeof navigator.hardwareConcurrency === "number"
        ? { hardwareConcurrency: navigator.hardwareConcurrency }
        : {}),
      ...(typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
        ? { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory }
        : {}),
    },
    adapterInfo: adapterInfo ?? null,
    usedHeapBytes: memory ? memory.usedJSHeapSize : null,
  });
}
