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

  it("returns null when EVERYTHING is empty/missing (no signal at all)", () => {
    const result = validateRefinement(
      {
        refined_archetype_id: null,
        additional_technical_parts: [],
        suggested_tools: [],
        rationale: "",
      },
      validIds,
    );
    expect(result).toBeNull();
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
