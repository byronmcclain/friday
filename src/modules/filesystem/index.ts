import type { FridayModule } from "../types.ts";
import { fsDelete } from "./delete.ts";
import { bashExec } from "./exec.ts";
import { fsList } from "./list.ts";
import { fsRead } from "./read.ts";
import { fsWrite } from "./write.ts";

const filesystemModule = {
  name: "filesystem",
  description: "File system operations (read, list, write, delete) and general shell execution",
  version: "1.0.0",
  tools: [fsRead, fsList, fsWrite, fsDelete, bashExec],
  protocols: [],
  knowledge: [],
  triggers: ["file:changed", "file:created", "file:deleted"],
  clearance: ["read-fs", "write-fs", "delete-fs", "exec-shell"],
} satisfies FridayModule;

export default filesystemModule;
