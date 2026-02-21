import type { FridayModule } from "./types.ts";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateModule(mod: FridayModule): ValidationResult {
  if (!mod.name || mod.name.trim() === "") {
    return { valid: false, error: "Module must have a non-empty name" };
  }
  if (!mod.version || mod.version.trim() === "") {
    return { valid: false, error: "Module must have a non-empty version" };
  }
  if (!mod.description || mod.description.trim() === "") {
    return { valid: false, error: "Module must have a non-empty description" };
  }
  return { valid: true };
}

export async function discoverModules(modulesDir: string): Promise<FridayModule[]> {
  const modules: FridayModule[] = [];
  const { resolve } = await import("node:path");
  const glob = new Bun.Glob("*/index.ts");
  const resolvedDir = resolve(modulesDir);

  try {
    for await (const match of glob.scan({ cwd: resolvedDir, onlyFiles: true })) {
      const indexPath = `${resolvedDir}/${match}`;

      if (!resolve(indexPath).startsWith(`${resolvedDir}/`)) {
        console.warn(`Skipping module with path traversal: ${match}`);
        continue;
      }

      try {
        const mod = await import(indexPath);
        const manifest: FridayModule = mod.default ?? mod;
        const validation = validateModule(manifest);
        if (validation.valid) {
          modules.push(manifest);
        } else {
          console.warn(`Skipping invalid module at ${indexPath}: ${validation.error}`);
        }
      } catch (err) {
        console.warn(`Failed to load module at ${indexPath}:`, err);
      }
    }
  } catch {
    return [];
  }

  return modules;
}
