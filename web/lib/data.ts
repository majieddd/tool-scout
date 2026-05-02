import { promises as fs } from "node:fs";
import path from "node:path";

export type Grade = {
  letter: string;
  total: number;
  axes: {
    R: number | null;
    Q: number | null;
    N: number | null;
    I: number | null;
    F: number | null;
  };
};

export type Tool = {
  id: string;
  name: string;
  url: string;
  source: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  readme_excerpt: string | null;
  language: string | null;
  stars: number;
  license: string | null;
  last_updated: string | null;
  first_seen: string | null;
  compatibility: string | null;
  install_hint: string;
  tags: string[];
  grade: Grade | null;
};

export type Recommendation = {
  rank: number;
  tool_id: string;
  name: string;
  url: string;
  category: string | null;
  letter: string;
  score: number;
  reasoning: string;
};

export type Meta = {
  generated_at: string;
  live_tools: number;
  last_crawl?: {
    started_at: string | null;
    ended_at: string | null;
    new_tools: number;
    errors: string | null;
  };
  last_llm_call_at?: string | null;
};

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(path.join(DATA_DIR, name), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function loadTools(): Promise<Tool[]> {
  return readJson<Tool[]>("tools.json", []);
}

export async function loadRecommendations(): Promise<Recommendation[]> {
  return readJson<Recommendation[]>("recommendations.json", []);
}

export async function loadMeta(): Promise<Meta> {
  return readJson<Meta>("meta.json", {
    generated_at: new Date().toISOString(),
    live_tools: 0,
  });
}

export async function loadToolById(id: string): Promise<Tool | null> {
  const tools = await loadTools();
  return tools.find((t) => t.id === id) ?? null;
}

export const LETTER_HEX: Record<string, string> = {
  S: "#8B5CF6",
  A: "#10B981",
  B: "#3B82F6",
  C: "#F59E0B",
  D: "#F97316",
  F: "#6B7280",
};
