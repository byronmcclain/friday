import { z } from "zod";
import type { ToolParameter } from "../modules/types.ts";

/**
 * Convert FridayTool ToolParameter[] to a Zod object schema
 * for use with the Vercel AI SDK tool() function.
 */
export function toZodSchema(params: ToolParameter[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
	const shape: Record<string, z.ZodTypeAny> = {};

	for (const param of params) {
		let field: z.ZodTypeAny;

		switch (param.type) {
			case "string":
				field = z.string().describe(param.description);
				break;
			case "number":
				field = z.number().describe(param.description);
				break;
			case "boolean":
				field = z.boolean().describe(param.description);
				break;
			case "array":
				field = z.array(z.unknown()).describe(param.description);
				break;
			case "object":
				field = z.record(z.string(), z.unknown()).describe(param.description);
				break;
			default:
				throw new Error(`toZodSchema: unsupported parameter type '${(param as ToolParameter).type}'`);
		}

		if (!param.required) {
			field = field.optional();
			if (param.default !== undefined) {
				field = field.default(param.default);
			}
		}

		shape[param.name] = field;
	}

	return z.object(shape);
}
