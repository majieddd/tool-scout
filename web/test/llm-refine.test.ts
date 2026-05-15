/**
 * Tests for the LLM refinement layer's JSON parsing + validation.
 *
 * Network-touching code (detectOllama, refineWithOllama) is integration-tested
 * separately when an Ollama instance is available; this file covers the
 * deterministic parts: prompt construction, JSON extraction, validation.
 */
import { describe, it, expect } from "vitest";
import { __test__ } from "@/lib/llm-refine";
import { extractFromDescription } from "@/lib/architect";

const { buildRefinementPrompt, extractJson, validateRefinement, preferredOllamaModel } = __test__;

describe("llm-refine: extractJson", () => {
  it("parses a clean JSON object", () => {
    const result = extractJson('{"refined_archetype_id":"ci-bot","additional_technical_parts":["x"],"suggested_tools":[],"rationale":"ok"}');
    expect(result).toMatchObject({ refined_archetype_id: "ci-bot" });
  });

  it("strips markdown fences (```json ... ```)", () => {
    const result = extractJson('Sure, here is the JSON:\n```json\n{"refined_archetype_id":"market-trader","rationale":"x","additional_technical_parts":[],"suggested_tools":[]}\n```');
    expect(result).toMatchObject({ refined_archetype_id: "market-trader" });
  });

  it("strips bare ``` fences without language", () => {
    const result = extractJson('```\n{"refined_archetype_id":null,"rationale":"x","additional_technical_parts":[],"suggested_tools":[]}\n```');
    expect(result).toMatchObject({ refined_archetype_id: null });
  });

  it("extracts the first {...} block when surrounded by prose", () => {
    const result = extractJson('Here is my analysis. {"refined_archetype_id":"rag-chatbot","rationale":"hi","additional_technical_parts":[],"suggested_tools":[]} Hope this helps!');
    expect(result).toMatchObject({ refined_archetype_id: "rag-chatbot" });
  });

  it("returns null on completely unparseable input", () => {
    expect(extractJson("not json at all")).toBeNull();
    expect(extractJson("")).toBeNull();
    expect(extractJson("{ unclosed")).toBeNull();
  });
});

describe("llm-refine: validateRefinement", () => {
  const validIds = new Set(["ci-bot", "market-trader", "rag-chatbot"]);

  it("accepts a valid full refinement", () => {
    const result = validateRefinement(
      {
        refined_archetype_id: "ci-bot",
        additional_technical_parts: ["GitHub App auth", "Rate-limit handling"],
        suggested_tools: ["Probot", "Octokit"],
        rationale: "This is a CI bot use case",
      },
      validIds,
    );
    expect(result).not.toBeNull();
    expect(result?.refinedArchetypeId).toBe("ci-bot");
    expect(result?.additionalTechnicalParts).toEqual(["GitHub App auth", "Rate-limit handling"]);
    expect(result?.suggestedTools).toEqual(["Probot", "Octokit"]);
    expect(result?.rationale).toBe("This is a CI bot use case");
  });

  it("drops archetype ids not in the valid set (LLM hallucination guard)", () => {
    const result = validateRefinement(
      {
        refined_archetype_id: "made-up-archetype-id",
        additional_technical_parts: ["x"],
        suggested_tools: [],
        rationale: "ok",
      },
      validIds,
    );
    expect(result?.refinedArchetypeId).toBeNull();
  });

  it("filters non-string entries from arrays", () => {
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: ["valid", null, 123, "also valid", { obj: 1 }],
        suggested_tools: ["tool-a", true, "tool-b"],
        rationale: "ok",
      },
      validIds,
    );
    expect(result?.additionalTechnicalParts).toEqual(["valid", "also valid"]);
    expect(result?.suggestedTools).toEqual(["tool-a", "tool-b"]);
  });

  it("caps array lengths to prevent runaway output", () => {
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: Array(20).fill("part"),
        suggested_tools: Array(20).fill("tool"),
        rationale: "ok",
      },
      validIds,
    );
    expect(result?.additionalTechnicalParts.length).toBeLessThanOrEqual(6);
    expect(result?.suggestedTools.length).toBeLessThanOrEqual(8);
  });

  it("returns an empty (but non-null) refinement when JSON parsed but every field is empty", () => {
    // Distinguishes "JSON parse failed" (real error → null) from "model
    // returned valid JSON with nothing useful" (graceful empty → object).
    // The latter lets the UI render a neutral "no additions" state instead
    // of a scary error banner. See validateRefinement comment.
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: [],
        suggested_tools: [],
        rationale: "",
      },
      validIds,
    );
    expect(result).not.toBeNull();
    expect(result?.refinedArchetypeId).toBeNull();
    expect(result?.additionalTechnicalParts).toEqual([]);
    expect(result?.suggestedTools).toEqual([]);
    expect(result?.rationale).toBe("");
  });

  it("returns null on non-object input", () => {
    expect(validateRefinement(null, validIds)).toBeNull();
    expect(validateRefinement("a string", validIds)).toBeNull();
    expect(validateRefinement([], validIds)).toBeNull();
  });

  it("truncates absurdly long rationale", () => {
    const longRationale = "x".repeat(5000);
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: ["a"],
        suggested_tools: [],
        rationale: longRationale,
      },
      validIds,
    );
    expect(result?.rationale.length).toBeLessThanOrEqual(600);
  });

  it("drops absurdly long array entries", () => {
    const tooLong = "x".repeat(300);
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: [tooLong, "valid"],
        suggested_tools: [],
        rationale: "ok",
      },
      validIds,
    );
    expect(result?.additionalTechnicalParts).toEqual(["valid"]);
  });

  // ── Hallucination filter (suggestedTools relevance) ───────────────────
  // Real-world failure mode: Qwen 0.5B suggested "N8n.io/N8n" for a
  // crypto-trading-bot prompt because n8n was in the catalog sample. With
  // the new ctx-aware filter, irrelevant catalog names get dropped.
  it("drops suggested tools with no token overlap with the project description/domains", () => {
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: [],
        // n8n is a workflow-automation tool — irrelevant to crypto-trading
        suggested_tools: ["n8n.io/n8n"],
        rationale: "",
      },
      validIds,
      {
        description: "i want to make an app that trades cryptocurrency for me",
        domains: ["financial", "backend", "automation", "observability", "database"],
        catalogSampleNames: ["n8n.io/n8n", "fastmcp", "playwright-mcp"],
      },
    );
    // n8n stays in the sample (proves it's not a name-validity reject) but
    // domain "automation" overlaps the suggestion's "n8n" token via... wait,
    // it doesn't. tokens of "n8n.io/n8n" → ["n8n", "io"]. Neither in haystack.
    expect(result?.suggestedTools).toEqual([]);
  });

  it("keeps suggested tools that DO share a token with the project", () => {
    // Token overlap is checked at >= 3 chars per token. "timescale/pg-aiguide"
    // tokenizes to [timescale, pg, aiguide] (pg dropped as 2 chars). The
    // description must contain one of those tokens — e.g. "timescale" itself
    // when the user explicitly named it.
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: [],
        suggested_tools: ["timescale/pg-aiguide"],
        rationale: "",
      },
      validIds,
      {
        description: "An automated crypto trader using Postgres with Timescale for time-series",
        domains: ["financial", "database"],
        catalogSampleNames: ["timescale/pg-aiguide", "fastmcp"],
      },
    );
    expect(result?.suggestedTools).toEqual(["timescale/pg-aiguide"]);
  });

  it("drops suggested tools that aren't even in the catalog sample (pure hallucinations)", () => {
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: [],
        suggested_tools: ["totally-made-up/never-existed"],
        rationale: "",
      },
      validIds,
      {
        description: "An automated crypto trader",
        domains: ["financial"],
        catalogSampleNames: ["fastmcp", "playwright-mcp"],
      },
    );
    expect(result?.suggestedTools).toEqual([]);
  });

  // ── Rationale filler detection ────────────────────────────────────────
  // Qwen 0.5B's most common failure mode is reflexive meta-commentary
  // about the regex matcher itself: "The deterministic detection did not
  // mention any specific architecture..." — text that adds zero info.
  it("drops rationale that's just meta-commentary about the regex detection", () => {
    const fillerRationale =
      "The deterministic detection did not mention any specific architecture or framework, " +
      "which could indicate a lack of focus on certain technologies such as n8n.";
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: ["valid part"],
        suggested_tools: [],
        rationale: fillerRationale,
      },
      validIds,
    );
    expect(result?.rationale).toBe("");
    // Other fields preserved
    expect(result?.additionalTechnicalParts).toEqual(["valid part"]);
  });

  it("keeps rationale that's actually about the project", () => {
    const goodRationale =
      "For a crypto trading bot, you'll need exchange API integration and risk management. " +
      "Backtesting against historical data is essential before live capital.";
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: [],
        suggested_tools: [],
        rationale: goodRationale,
      },
      validIds,
    );
    expect(result?.rationale).toBe(goodRationale);
  });
});

describe("llm-refine: preferredOllamaModel", () => {
  it("prefers gemma3:4b when available (the user's daily-crawl model)", () => {
    const m = preferredOllamaModel(["llama3.2:3b", "gemma3:4b", "qwen2.5:0.5b"]);
    expect(m).toBe("gemma3:4b");
  });

  it("falls back to qwen2.5:0.5b when gemma3 not available", () => {
    const m = preferredOllamaModel(["llama3.2:3b", "qwen2.5:0.5b", "phi3:3.8b"]);
    expect(m).toBe("qwen2.5:0.5b");
  });

  it("returns first model when nothing matches preference order", () => {
    const m = preferredOllamaModel(["weird-custom:latest"]);
    expect(m).toBe("weird-custom:latest");
  });
});

describe("llm-refine: buildRefinementPrompt", () => {
  it("includes the user's description, detected profile, and archetype list", () => {
    const profile = extractFromDescription("Build a Rust CLI that wraps ripgrep");
    const { system, user } = buildRefinementPrompt(
      "Build a Rust CLI that wraps ripgrep",
      profile,
      ["ci-bot", "market-trader"],
      ["fastmcp", "playwright-mcp", "tdd-guard"],
    );
    expect(system).toContain("software architect");
    expect(system).toContain("JSON");
    expect(user).toContain("Build a Rust CLI that wraps ripgrep");
    expect(user).toContain("ci-bot");
    expect(user).toContain("market-trader");
    expect(user).toContain("fastmcp");
    // Profile fields surfaced so the LLM has context
    expect(user).toContain("rust");
    // The detected goal (whatever it is) is surfaced
    expect(user).toContain(`archetype = ${profile.archetype?.id ?? "(none)"}`);
  });

  it("requires JSON-only output in the user message", () => {
    const profile = extractFromDescription("anything");
    const { user } = buildRefinementPrompt("anything", profile, [], []);
    expect(user).toMatch(/return ONLY the JSON/i);
  });
});
