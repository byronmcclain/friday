export interface TypeaheadEntry {
	name: string;
	description: string;
	aliases: string[];
}

export function filterCommands(
	commands: TypeaheadEntry[],
	query: string,
): TypeaheadEntry[] {
	if (!query) return commands;
	const q = query.toLowerCase();
	return commands.filter(
		(cmd) =>
			cmd.name.toLowerCase().startsWith(q) ||
			cmd.aliases.some((a) => a.toLowerCase().startsWith(q)),
	);
}
