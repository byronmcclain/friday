export type ClearanceName =
  | "read-fs"
  | "write-fs"
  | "delete-fs"
  | "exec-shell"
  | "network"
  | "git-read"
  | "git-write"
  | "provider"
  | "system"
  | "forge-modify"
  | "email-send"
  | "audio-output";

export interface ClearanceCheck {
  granted: boolean;
  reason?: string;
}

export class ClearanceManager {
  private permissions: Set<ClearanceName>;

  constructor(granted: ClearanceName[] = []) {
    this.permissions = new Set(granted);
  }

  check(name: ClearanceName): ClearanceCheck {
    if (this.permissions.has(name)) {
      return { granted: true };
    }
    return { granted: false, reason: `Clearance denied: ${name} is not authorized` };
  }

  checkAll(names: ClearanceName[]): ClearanceCheck {
    for (const name of names) {
      const result = this.check(name);
      if (!result.granted) return result;
    }
    return { granted: true };
  }

  grant(name: ClearanceName): void {
    this.permissions.add(name);
  }

  revoke(name: ClearanceName): void {
    this.permissions.delete(name);
  }

  get granted(): ClearanceName[] {
    return [...this.permissions];
  }
}
