// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code stripping requires matching control characters
const ANSI_RE =
	/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, "");
}
