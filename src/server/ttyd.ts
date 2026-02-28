import { spawn, type Subprocess } from "bun";
import { which } from "bun";

export interface TtydConfig {
  port: number;
  basePath: string;
  command: string[];
  theme?: Record<string, string>;
  fontSize?: number;
}

const DEFAULT_THEME = {
  background: "#0D1117",
  foreground: "#F0E6D8",
  cursor: "#E8943A",
};

export async function spawnTtyd(config: TtydConfig): Promise<Subprocess | null> {
  const ttydPath = which("ttyd");
  if (!ttydPath) {
    console.warn("ttyd not found. Install ttyd for terminal-in-browser support.");
    console.warn("  macOS: brew install ttyd");
    console.warn("  Linux: apt install ttyd");
    return null;
  }

  const theme = config.theme ?? DEFAULT_THEME;
  const fontSize = config.fontSize ?? 14;

  const args = [
    "--port", String(config.port),
    "--writable",
    "--base-path", config.basePath,
    "-t", "titleFixed=F.R.I.D.A.Y.",
    "-t", `theme=${JSON.stringify(theme)}`,
    "-t", `fontSize=${fontSize}`,
    "-t", "disableLeaveAlert=true",
    ...config.command,
  ];

  const proc = spawn([ttydPath, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FRIDAY_CONTEXT: "browser" },
  });

  return proc;
}
