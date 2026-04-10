/**
 * Parses JSON from an LLM response that may include markdown fences or prose.
 */
export function parseModelJson<T>(raw: string): T {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s
      .replace(/^```[\w-]*\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/i, "")
      .trim();
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(s.slice(first, last + 1)) as T;
    }
    throw new Error("Could not parse model JSON.");
  }
}

export function clampScore(n: number, min = 0, max = 10): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
