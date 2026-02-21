import type { FridayProtocol } from "./types.ts";

export interface ParsedProtocolInput {
  name: string;
  rawArgs: string;
}

export class ProtocolRegistry {
  private protocols = new Map<string, FridayProtocol>();
  private aliases = new Map<string, string>();

  register(protocol: FridayProtocol): void {
    this.protocols.set(protocol.name, protocol);
    for (const alias of protocol.aliases) {
      this.aliases.set(alias, protocol.name);
    }
  }

  get(nameOrAlias: string): FridayProtocol | undefined {
    return (
      this.protocols.get(nameOrAlias) ??
      this.protocols.get(this.aliases.get(nameOrAlias) ?? "")
    );
  }

  list(): FridayProtocol[] {
    return [...this.protocols.values()];
  }

  isProtocol(input: string): boolean {
    if (!input.startsWith("/")) return false;
    const name = input.slice(1).split(/\s+/)[0] ?? "";
    return this.get(name) !== undefined;
  }

  parseProtocolInput(input: string): ParsedProtocolInput | undefined {
    if (!input.startsWith("/")) return undefined;
    const parts = input.slice(1).split(/\s+/);
    const name = parts[0] ?? "";
    if (!this.get(name)) return undefined;
    return { name, rawArgs: parts.slice(1).join(" ") };
  }
}
