import type { ToolParameter } from "../modules/types.ts";

export interface JsonSchema {
  type: "object";
  properties: Record<string, object>;
  required: string[];
}

export function toJsonSchema(params: ToolParameter[]): JsonSchema {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const param of params) {
    const prop: Record<string, unknown> = {
      type: param.type,
      description: param.description,
    };
    if (param.type === "array") {
      prop.items = {};
    }
    if (param.type === "object") {
      prop.additionalProperties = true;
    }
    if (param.default !== undefined) {
      prop.default = param.default;
    }
    properties[param.name] = prop;
    if (param.required) {
      required.push(param.name);
    }
  }

  return { type: "object", properties, required };
}
