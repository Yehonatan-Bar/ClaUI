/**
 * Free-tier grouping for Bridge Provider models.
 *
 * Pure helpers shared by the extension host (BridgeProviderService builds the
 * picker options and tracks which free models the user has already seen) and
 * the webview (ModelSelector renders the "Free" optgroup). No vscode / DOM
 * imports so the module is testable with plain node.
 */

/** One entry of the Bridge Providers section of the model picker. */
export interface BridgeModelOption {
  label: string;
  value: string;
  /** True for models that cost nothing to run (shown under the "Free" group). */
  free?: boolean;
}

/**
 * Hosted gateways mark zero-cost variants with a `:free` suffix
 * (OpenRouter convention, e.g. `z-ai/glm-5.2:free`). Case-insensitive.
 */
const FREE_MODEL_ID_RE = /:free$/i;

/**
 * A model is free when its provider profile is flagged `free`, or when the
 * model id itself carries the `:free` suffix.
 */
export function isFreeBridgeModel(modelId: string, providerFree?: boolean): boolean {
  if (providerFree === true) return true;
  return FREE_MODEL_ID_RE.test(String(modelId || '').trim());
}

/** Split picker options into the paid "Bridge Providers" group and the "Free" group. */
export function splitBridgeModelOptions(options: readonly BridgeModelOption[]): {
  paid: BridgeModelOption[];
  free: BridgeModelOption[];
} {
  const paid: BridgeModelOption[] = [];
  const free: BridgeModelOption[] = [];
  for (const opt of options) {
    (opt.free ? free : paid).push(opt);
  }
  return { paid, free };
}

/**
 * Compare the free models offered now against the ones the user has already
 * been told about.
 *
 * - `seen === undefined` means this is the first time the picker is built on
 *   this machine: everything is recorded silently and nothing is announced
 *   (a toast for every pre-existing model on first run is noise, not news).
 * - Otherwise every free model whose value is not in `seen` is "new".
 *
 * `seenNext` is exactly the current free set, so a model that is removed from
 * settings and later re-added is announced again.
 */
export function diffNewFreeModels(
  seen: readonly string[] | undefined,
  options: readonly BridgeModelOption[],
): { newFree: BridgeModelOption[]; seenNext: string[] } {
  const free = splitBridgeModelOptions(options).free;
  const seenNext = free.map((opt) => opt.value);
  if (seen === undefined) {
    return { newFree: [], seenNext };
  }
  const seenSet = new Set(seen);
  const newFree = free.filter((opt) => !seenSet.has(opt.value));
  return { newFree, seenNext };
}
