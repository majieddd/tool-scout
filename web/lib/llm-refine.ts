/**
 * llm-refine — optional AI augmentation for the architect.
 *
 * Why this module exists:
 * The deterministic archetype + regex layer (architect.ts / stack-builder.ts)
 * is fast, predictable, and works for ~85% of prompts. The remaining ~15% are
 * either edge cases the patterns missed or genuinely novel projects that
 * don't fit any pre-defined archetype. For those, an LLM can reason about
 * the prompt and suggest project shape, technical parts, and specific tools.
 *
 * Design principles:
 * 1. **Augments, never replaces**: the regex detection is authoritative.
 *    LLM output is shown as a separate "AI suggestions" section that
 *    supplements the deterministic breakdown.
 * 2. **Apache-2.0, no tokens, always-on**: works in the browser without API
 *    keys or accounts. Two execution paths:
 *    - Tier 1: locally-running Ollama (the user's own machine, any Ollama-
 *      hosted model — defaults to whatever `ollama list` returns first)
 *    - Tier 2: Transformers.js with a small Apache-2.0 instruct model
 *      (lazy-loaded, ~200-400MB, cached in IndexedDB after first download)
 * 3. **Strict JSON output**: the LLM is prompted to return a constrained
 *    JSON shape so we can render it deterministically. Anything unparseable
 *    or off-spec is dropped silently — no partial / weird states reach UI.
 * 4. **Privacy-preserving**: all inference is local. No data leaves the
 *    user's device unless they explicitly bring up a hosted endpoint.
 */
import type { ExtendedProfile, ProjectArchetype } from "./architect";

// ── Public types ──────────────────────────────────────────────────────────

export type LlmBackend =
  | { kind: "none"; reason: string }
  | { kind: "ollama"; baseUrl: string; model: string }
  | { kind: "browser"; modelId: string };

export type LlmRefinement = {
  /** Where the LLM thinks the project really fits — may match the regex's
   *  archetype, or suggest a different one. Not authoritative. */
  refinedArchetypeId: string | null;
  refinedArchetypeLabel: string | null;
  /** Technical parts the regex archetype's checklist might be missing. */
  additionalTechnicalParts: string[];
  /** Specific tool names from the catalog the LLM suggests. UI may
   *  cross-reference these against the catalog and link if found. */
  suggestedTools: string[];
  /** A 1-2 sentence rationale shown next to the suggestions. */
  rationale: string;
  /** The backend that produced the result. */
  backend: LlmBackend;
};

// ── Tier 1: Ollama detection + call ───────────────────────────────────────

const OLLAMA_DEFAULT_URL = "http://localhost:11434";

/**
 * Probe localhost for a running Ollama. Returns models list if reachable.
 * Note: requires Ollama to be started with `OLLAMA_ORIGINS=*` (or the
 * specific origin of this site) so the browser fetch passes CORS.
 */
export async function detectOllama(
  baseUrl: string = OLLAMA_DEFAULT_URL,
  timeoutMs: number = 1500,
): Promise<{ available: false; reason: string } | { available: true; models: string[] }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { available: false, reason: `Ollama returned HTTP ${res.status}` };
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (json.models || []).map((m) => m.name);
    if (models.length === 0) {
      return { available: false, reason: "Ollama is reachable but has no models pulled. Run `ollama pull gemma3:4b` (or any model)." };
    }
    return { available: true, models };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    // CORS-blocked fetches surface as TypeError "Failed to fetch" in browsers
    if (/fail(ed)?\s+to\s+fetch|networkerror|cors/i.test(msg)) {
      return {
        available: false,
        reason:
          "Ollama not reachable from the browser. If Ollama is running, restart it with `OLLAMA_ORIGINS=*` (or the origin of this site) so cross-origin fetches work.",
      };
    }
    return { available: false, reason: msg };
  }
}

/** Pick a sensible default model from a list — preferring small instruct ones. */
export function preferredOllamaModel(models: string[]): string {
  // Preference order — small, fast, instruction-tuned
  const preferences = [
    /^gemma3:4b/i,
    /^qwen2\.?5:0\.5b/i,
    /^qwen2\.?5:1\.5b/i,
    /^smollm2?:/i,
    /^phi3:/i,
    /^llama3\.2:1b/i,
    /^llama3\.2:3b/i,
    /^gemma2?:/i,
    /^qwen/i,
    /^llama/i,
  ];
  for (const rx of preferences) {
    const hit = models.find((m) => rx.test(m));
    if (hit) return hit;
  }
  return models[0];
}

// ── Prompt construction ───────────────────────────────────────────────────

/**
 * Build the system + user prompt for the refinement task.
 *
 * The prompt is constrained heavily — we ask for a single JSON object and
 * give the model an explicit schema. This works on small instruct models
 * (SmolLM2, Qwen 0.5B) that don't have native function-calling, because we
 * post-parse and validate the JSON ourselves.
 */
function buildRefinementPrompt(
  description: string,
  profile: ExtendedProfile,
  archetypeIds: string[],
  catalogSampleNames: string[],
): { system: string; user: string } {
  const detectedArchetype = profile.archetype?.id ?? "(none)";
  const detectedDomains = profile.domains.slice(0, 6).join(", ") || "(none)";
  const detectedFrameworks = [...profile.frameworks].slice(0, 4).join(", ") || "(none)";
  const detectedLang = profile.primaryLanguage ?? "(none)";

  const system =
    "You are an expert software architect helping a developer scope a project. " +
    "You will be given (1) a project description, (2) what a deterministic regex matcher already detected, " +
    "(3) the list of known project archetypes, and (4) a sample of available tools from a catalog. " +
    "Your job is to suggest refinements that the regex matcher might have missed — better archetype, " +
    "additional technical parts, specific tool names worth investigating. " +
    "You MUST respond with a single valid JSON object matching the schema. " +
    "Do not include any prose outside the JSON. Do not wrap the JSON in markdown.";

  const schema = `{
  "refined_archetype_id": "<one of the archetype ids OR null if you agree with the deterministic detection>",
  "additional_technical_parts": ["<short bullet>", "<short bullet>"],
  "suggested_tools": ["<exact tool name from the catalog sample if relevant, or generic name>"],
  "rationale": "<1-2 sentences explaining your suggestions>"
}`;

  const user = [
    `Project description: ${JSON.stringify(description)}`,
    ``,
    `Deterministic detection:`,
    `  archetype = ${detectedArchetype}`,
    `  primary language = ${detectedLang}`,
    `  domains = [${detectedDomains}]`,
    `  frameworks = [${detectedFrameworks}]`,
    ``,
    `Known archetype ids: ${archetypeIds.join(", ")}`,
    ``,
    `Catalog sample (first 30 of many): ${catalogSampleNames.slice(0, 30).join(", ")}`,
    ``,
    `Required JSON schema:`,
    schema,
    ``,
    `Return ONLY the JSON object. Do NOT include explanation, markdown, or anything else.`,
  ].join("\n");

  return { system, user };
}

// ── LLM call: Ollama ──────────────────────────────────────────────────────

async function callOllama(
  baseUrl: string,
  model: string,
  prompt: { system: string; user: string },
  timeoutMs: number = 30000,
): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        stream: false,
        format: "json",     // Ollama JSON mode — guarantees parseable output
        options: { temperature: 0.2, num_predict: 512 },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// ── JSON parsing + validation ─────────────────────────────────────────────

/**
 * Extract a JSON object from an LLM response. Small models often wrap their
 * output in markdown code fences or add extra text before/after — handle that.
 * Returns null on any parse error rather than throwing.
 */
function extractJson(raw: string): unknown {
  if (!raw) return null;
  // Try direct parse first (Ollama JSON mode usually gives clean output)
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  // Strip markdown fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  // Find the first {...} block and try parsing just that
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {
      return null;
    }
  }
  return null;
}

function validateRefinement(
  parsed: unknown,
  validArchetypeIds: Set<string>,
): Pick<LlmRefinement, "refinedArchetypeId" | "additionalTechnicalParts" | "suggestedTools" | "rationale"> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const refinedRaw = obj.refined_archetype_id;
  const refined =
    typeof refinedRaw === "string" && validArchetypeIds.has(refinedRaw) ? refinedRaw : null;
  const partsRaw = obj.additional_technical_parts;
  const parts =
    Array.isArray(partsRaw)
      ? partsRaw.filter((x) => typeof x === "string" && x.length > 0 && x.length < 240).slice(0, 6)
      : [];
  const toolsRaw = obj.suggested_tools;
  const tools =
    Array.isArray(toolsRaw)
      ? toolsRaw.filter((x) => typeof x === "string" && x.length > 0 && x.length < 200).slice(0, 8)
      : [];
  const rationaleRaw = obj.rationale;
  const rationale = typeof rationaleRaw === "string" ? rationaleRaw.slice(0, 600) : "";
  if (parts.length === 0 && tools.length === 0 && !refined && !rationale) return null;
  return {
    refinedArchetypeId: refined,
    refinedArchetypeLabel: null, // filled by caller from the archetype catalog
    additionalTechnicalParts: parts,
    suggestedTools: tools,
    rationale,
  } as any;
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Refine a profile using a locally-running Ollama. Throws on failure so the
 * caller can show the user what went wrong (CORS, no model, timeout, etc.)
 * and decide whether to fall back to the browser-LLM tier.
 */
export async function refineWithOllama(
  description: string,
  profile: ExtendedProfile,
  archetypes: ProjectArchetype[],
  catalogSampleNames: string[],
  ollama: { baseUrl: string; model: string },
): Promise<LlmRefinement> {
  const archetypeIds = archetypes.map((a) => a.id);
  const validIds = new Set(archetypeIds);
  const prompt = buildRefinementPrompt(description, profile, archetypeIds, catalogSampleNames);
  const raw = await callOllama(ollama.baseUrl, ollama.model, prompt);
  const parsed = extractJson(raw);
  const validated = validateRefinement(parsed, validIds);
  if (!validated) {
    throw new Error(
      "LLM returned an unparseable response. Try a different model or a more specific prompt.",
    );
  }
  // Resolve the archetype label for UI display
  const refinedLabel = validated.refinedArchetypeId
    ? archetypes.find((a) => a.id === validated.refinedArchetypeId)?.label ?? null
    : null;
  return {
    ...validated,
    refinedArchetypeLabel: refinedLabel,
    backend: { kind: "ollama", baseUrl: ollama.baseUrl, model: ollama.model },
  };
}

// ── Tier 2: Browser-side LLM via @huggingface/transformers ────────────────
//
// For users without a local Ollama, we fall back to a small instruct model
// running entirely in the browser. The model is downloaded from HuggingFace
// on first use (~250-400MB depending on quantization) and cached in
// IndexedDB by the browser. Subsequent visits are instant.
//
// Default model: Qwen2.5-0.5B-Instruct (Apache 2.0). Why this choice:
//   - 500M params: enough to follow strict-JSON output formatting
//   - Apache 2.0 license: matches "no tokens, no proprietary"
//   - ONNX Runtime Web: works on WASM (any browser) AND WebGPU (faster)
//   - q4 quantized: ~400MB download, ~600MB RAM
//
// We use the high-level `pipeline('text-generation', ...)` API which
// handles tokenization, generation, and chat-template application
// automatically.

export type BrowserLlmProgress = {
  status: "downloading" | "loading" | "ready" | "running" | "done" | "error";
  /** 0..1 for download/load phases */
  progress: number;
  /** Bytes downloaded so far (only set during download phase) */
  loaded?: number;
  /** Total bytes to download (only set during download phase) */
  total?: number;
  /** Currently-downloading file (only set during download phase) */
  file?: string;
  /** Error message when status === "error" */
  message?: string;
};

const BROWSER_MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const BROWSER_DTYPE = "q4"; // q4 is ~250MB; q4f16 is ~400MB (better quality)

// Lazy-loaded pipeline. Cached at module level so we don't re-load.
let browserPipelinePromise: Promise<unknown> | null = null;

/**
 * Initialize (or return the already-initialized) text-generation pipeline.
 * The first call downloads model weights — subsequent calls are instant.
 */
async function getBrowserPipeline(
  onProgress?: (p: BrowserLlmProgress) => void,
): Promise<unknown> {
  if (browserPipelinePromise) return browserPipelinePromise;
  browserPipelinePromise = (async () => {
    onProgress?.({ status: "loading", progress: 0 });
    // Dynamic import: the transformers.js bundle (~600KB) is only loaded
    // when AI refinement actually runs, not on every page view.
    const { pipeline, env } = await import("@huggingface/transformers");
    // Force CDN-hosted models (we don't ship weights locally)
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    return pipeline("text-generation", BROWSER_MODEL_ID, {
      dtype: BROWSER_DTYPE,
      device: "auto", // WebGPU if available, WASM otherwise
      progress_callback: (data: {
        status: string;
        progress?: number;
        loaded?: number;
        total?: number;
        file?: string;
      }) => {
        if (data.status === "progress") {
          onProgress?.({
            status: "downloading",
            progress: typeof data.progress === "number" ? data.progress / 100 : 0,
            loaded: data.loaded,
            total: data.total,
            file: data.file,
          });
        } else if (data.status === "ready") {
          onProgress?.({ status: "ready", progress: 1 });
        }
      },
    });
  })();
  return browserPipelinePromise;
}

/**
 * Run refinement using the browser-side LLM. First call may take 30-60s
 * to download the model; subsequent calls are typically 5-15s for inference.
 */
export async function refineWithBrowserLLM(
  description: string,
  profile: ExtendedProfile,
  archetypes: ProjectArchetype[],
  catalogSampleNames: string[],
  onProgress?: (p: BrowserLlmProgress) => void,
): Promise<LlmRefinement> {
  const archetypeIds = archetypes.map((a) => a.id);
  const validIds = new Set(archetypeIds);
  const prompt = buildRefinementPrompt(description, profile, archetypeIds, catalogSampleNames);

  const pipe = (await getBrowserPipeline(onProgress)) as (
    msgs: Array<{ role: string; content: string }>,
    opts: Record<string, unknown>,
  ) => Promise<Array<{ generated_text: Array<{ role: string; content: string }> }>>;

  onProgress?.({ status: "running", progress: 0 });
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  const out = await pipe(messages, {
    max_new_tokens: 384,
    temperature: 0.2,
    do_sample: true,
    return_full_text: false,
  });

  // The pipeline returns the full chat history; the last message is the assistant's reply.
  const generated = out?.[0]?.generated_text;
  let text = "";
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    text = last?.content ?? "";
  } else if (typeof generated === "string") {
    text = generated;
  }

  const parsed = extractJson(text);
  const validated = validateRefinement(parsed, validIds);
  if (!validated) {
    throw new Error(
      "Browser model returned an unparseable response. The local model is small (0.5B params); try refining your prompt with more specifics.",
    );
  }
  const refinedLabel = validated.refinedArchetypeId
    ? archetypes.find((a) => a.id === validated.refinedArchetypeId)?.label ?? null
    : null;
  onProgress?.({ status: "done", progress: 1 });
  return {
    ...validated,
    refinedArchetypeLabel: refinedLabel,
    backend: { kind: "browser", modelId: BROWSER_MODEL_ID },
  };
}

// ── Re-export internals for tests ─────────────────────────────────────────

export const __test__ = {
  buildRefinementPrompt,
  extractJson,
  validateRefinement,
  preferredOllamaModel,
};
