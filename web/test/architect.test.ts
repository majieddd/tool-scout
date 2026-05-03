import { describe, it, expect } from "vitest";
import { extractFromDescription } from "@/lib/architect";

describe("architect: signal extraction from description", () => {
  describe("primary language detection", () => {
    it("detects Python from 'in Python'", () => {
      const p = extractFromDescription("Building an MCP server in Python");
      expect(p.primaryLanguage).toBe("python");
    });

    it("detects TypeScript", () => {
      const p = extractFromDescription("Writing a TypeScript app");
      expect(p.primaryLanguage).toBe("typescript");
    });

    it("detects Rust from cargo mention", () => {
      const p = extractFromDescription("rust crate using cargo");
      expect(p.primaryLanguage).toBe("rust");
    });

    it("does NOT confuse Java mentions for JavaScript", () => {
      const p = extractFromDescription("Building a Java spring boot app");
      expect(p.primaryLanguage).toBe("java");
    });

    it("returns null when no language is mentioned", () => {
      const p = extractFromDescription("I'm building something cool");
      expect(p.primaryLanguage).toBe(null);
    });
  });

  describe("target agent detection", () => {
    it("detects claude-code from 'Claude Code'", () => {
      const p = extractFromDescription("Building for Claude Code");
      expect(p.targetAgent).toBe("claude-code");
    });

    it("detects codex-cli from 'OpenAI Codex'", () => {
      const p = extractFromDescription("Building an OpenAI Codex extension");
      expect(p.targetAgent).toBe("codex-cli");
    });

    it("detects cursor from .cursorrules mention", () => {
      const p = extractFromDescription("project with .cursorrules");
      expect(p.targetAgent).toBe("cursor");
    });

    it("returns unknown when no agent mentioned", () => {
      const p = extractFromDescription("just a CLI tool");
      expect(p.targetAgent).toBe("unknown");
    });
  });

  describe("platform detection", () => {
    it("detects windows from 'Windows 11'", () => {
      const p = extractFromDescription("running on Windows 11");
      expect(p.platform).toBe("windows");
    });

    it("detects macos from 'macOS'", () => {
      const p = extractFromDescription("running on macOS Sequoia");
      expect(p.platform).toBe("macos");
    });

    it("detects wsl from 'WSL2'", () => {
      const p = extractFromDescription("dev on WSL2");
      expect(p.platform).toBe("wsl");
    });
  });

  describe("goal detection", () => {
    it("detects build_mcp_server", () => {
      const p = extractFromDescription("I'm building an MCP server");
      expect(p.goal).toBe("build_mcp_server");
    });

    it("detects build_skill", () => {
      const p = extractFromDescription("I want to author a SKILL.md skill");
      expect(p.goal).toBe("build_skill");
    });

    it("detects wrap_cli", () => {
      const p = extractFromDescription("wrapper for the ripgrep CLI");
      expect(p.goal).toBe("wrap_cli");
    });
  });

  describe("domain detection", () => {
    it("detects database + auth + docker for the canonical Python+Postgres prompt", () => {
      const p = extractFromDescription(
        "Building a Claude Code MCP server in Python that lets the agent query our Postgres database with row-level auth. Running on Windows 11 with Docker."
      );
      expect(p.domains).toContain("database");
      expect(p.domains).toContain("auth");
      expect(p.domains).toContain("docker");
    });

    it("detects scraping + browser-automation", () => {
      const p = extractFromDescription("scraping web pages with playwright");
      expect(p.domains).toContain("scraping");
      expect(p.domains).toContain("browser-automation");
    });
  });

  describe("boolean markers from description", () => {
    it("sets hasTests=true when 'test-driven' appears", () => {
      const p = extractFromDescription("test-driven development");
      expect(p.hasTests).toBe(true);
    });

    it("sets hasDocker=true when Docker mentioned", () => {
      const p = extractFromDescription("running in Docker");
      expect(p.hasDocker).toBe(true);
    });

    it("sets hasMcp=true when MCP mentioned", () => {
      const p = extractFromDescription("an MCP server");
      expect(p.hasMcp).toBe(true);
    });
  });

  describe("the canonical Python+Postgres+Claude+Windows+TDD prompt", () => {
    const PROMPT =
      "I'm building a Claude Code MCP server in Python that lets the agent query our Postgres database with row-level auth. Running on Windows 11 with Docker. I want test-driven development.";

    it("extracts the full expected profile", () => {
      const p = extractFromDescription(PROMPT);
      expect(p.primaryLanguage).toBe("python");
      expect(p.targetAgent).toBe("claude-code");
      expect(p.platform).toBe("windows");
      expect(p.goal).toBe("build_mcp_server");
      expect(p.hasTests).toBe(true);
      expect(p.hasDocker).toBe(true);
      expect(p.hasMcp).toBe(true);
      expect(p.domains).toContain("database");
      expect(p.domains).toContain("auth");
      expect(p.domains).toContain("docker");
    });
  });
});
