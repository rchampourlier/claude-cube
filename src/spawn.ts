import { join, normalize } from "node:path";
import { existsSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

export type ResolveResult =
  | { kind: "resolved"; path: string }
  | { kind: "ambiguous"; matches: string[] }
  | { kind: "error"; message: string };

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

export function resolvePath(input: string, searchPaths: string[]): ResolveResult {
  if (searchPaths.length === 0) {
    return { kind: "error", message: "Spawn not configured. Add searchPaths to orchestrator.yaml." };
  }

  if (input.includes("..")) {
    return { kind: "error", message: "Path traversal (..) is not allowed." };
  }
  if (input.startsWith("/")) {
    return { kind: "error", message: "Absolute paths are not allowed." };
  }
  if (input.startsWith("~")) {
    return { kind: "error", message: "Home directory paths (~) are not allowed." };
  }
  if (input.includes("$")) {
    return { kind: "error", message: "Environment variable references ($) are not allowed." };
  }

  const matches: string[] = [];
  const expandedSearchPaths = searchPaths.map(expandHome);

  for (const sp of expandedSearchPaths) {
    const candidate = normalize(join(sp, input));
    // Defense-in-depth: verify resolved path is under the search path
    if (!candidate.startsWith(sp)) continue;
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        matches.push(candidate);
      }
    } catch {
      // stat failed, skip
    }
  }

  if (matches.length === 1) return { kind: "resolved", path: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", matches };

  // No exact match — try shallow fuzzy if input has no path separators
  if (!input.includes("/")) {
    const fuzzy: string[] = [];
    for (const sp of expandedSearchPaths) {
      try {
        const entries = readdirSync(sp, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          // Match: */input (subdirectory named exactly input) or input* (prefix match)
          if (entry.name === input || entry.name.startsWith(input)) {
            fuzzy.push(join(sp, entry.name));
          }
        }
        // Also check one level deeper: */input pattern
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          try {
            const subEntries = readdirSync(join(sp, entry.name), { withFileTypes: true });
            for (const sub of subEntries) {
              if (!sub.isDirectory()) continue;
              if (sub.name === input) {
                fuzzy.push(join(sp, entry.name, sub.name));
              }
            }
          } catch {
            // can't read subdirectory, skip
          }
        }
      } catch {
        // can't read search path, skip
      }
    }

    if (fuzzy.length > 0) {
      // Deduplicate
      const unique = [...new Set(fuzzy)];
      return { kind: "ambiguous", matches: unique };
    }
  }

  return { kind: "error", message: `No directory found for "${input}".` };
}
