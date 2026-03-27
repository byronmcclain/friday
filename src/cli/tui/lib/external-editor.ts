export interface EditorOptions {
	editorCommand?: string;
	editorArgs?: (path: string) => string[];
	onTempPath?: (path: string) => void;
}

export async function openExternalEditor(
	_initialContent: string,
	_options?: EditorOptions,
): Promise<string | null> {
	throw new Error("Not implemented");
}
