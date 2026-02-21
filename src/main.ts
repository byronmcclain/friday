#!/usr/bin/env bun
import { program } from "./cli/index.ts";

await program.parseAsync(process.argv);
