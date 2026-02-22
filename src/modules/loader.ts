import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
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

      // Resolve symlinks before checking containment
      const realIndexPath = await realpath(indexPath).catch(() => indexPath);
      const realDir = await realpath(resolvedDir).catch(() => resolvedDir);
      if (!realIndexPath.startsWith(`${realDir}/`)) {
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

export interface ForgeLoadResult {
	loaded: FridayModule[];
	failed: { name: string; error: string }[];
}

export async function discoverForgeModules(
	forgeDir: string,
): Promise<ForgeLoadResult> {
	const result: ForgeLoadResult = { loaded: [], failed: [] };
	const resolvedDir = resolve(forgeDir);
	const glob = new Bun.Glob("*/index.ts");

	try {
		for await (const match of glob.scan({
			cwd: resolvedDir,
			onlyFiles: true,
		})) {
			const moduleName = match.split("/")[0]!;

			// Skip dotfiles (.backups directory)
			if (moduleName.startsWith(".")) continue;

			const indexPath = `${resolvedDir}/${match}`;

			// Resolve symlinks before checking containment
			const realIndexPath = await realpath(indexPath).catch(
				() => indexPath,
			);
			const realDir = await realpath(resolvedDir).catch(
				() => resolvedDir,
			);
			if (!realIndexPath.startsWith(`${realDir}/`)) {
				result.failed.push({
					name: moduleName,
					error: "Path traversal detected",
				});
				continue;
			}

			try {
				// Cache-bust for re-imports after patches
				const mod = await import(`${indexPath}?t=${Date.now()}`);
				const manifest: FridayModule = mod.default ?? mod;
				const validation = validateModule(manifest);
				if (validation.valid) {
					result.loaded.push(manifest);
				} else {
					result.failed.push({
						name: moduleName,
						error: validation.error ?? "Invalid manifest",
					});
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				result.failed.push({ name: moduleName, error: msg });
			}
		}
	} catch {
		// Directory doesn't exist or isn't readable — return empty result
	}

	return result;
}
