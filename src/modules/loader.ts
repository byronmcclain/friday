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
  const { readdir } = await import("node:fs/promises");

  let entries: string[];
  try {
    entries = await readdir(modulesDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const indexPath = `${modulesDir}/${entry}/index.ts`;
    const file = Bun.file(indexPath);
    if (!(await file.exists())) continue;

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

  return modules;
}
