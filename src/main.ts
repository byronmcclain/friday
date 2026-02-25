#!/usr/bin/env bun
import { program } from "./cli/index.ts";

process.on("SIGINT", () => { process.exit(130); });
process.on("SIGTERM", () => { process.exit(143); });

await program.parseAsync(process.argv);
