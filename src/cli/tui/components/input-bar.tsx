import { PALETTE } from "../theme.ts";
import { CommandTypeahead } from "./command-typeahead.tsx";
import type { TypeaheadEntry } from "../filter-commands.ts";

interface InputBarProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
}

export function InputBar(props: InputBarProps) {
	return (
		<box
			flexShrink={0}
			border={["top"]}
			borderColor={PALETTE.copperAccent}
			backgroundColor={PALETTE.background}
			paddingLeft={2}
		>
			<CommandTypeahead {...props} />
		</box>
	);
}
