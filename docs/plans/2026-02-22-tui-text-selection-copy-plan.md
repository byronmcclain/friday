# TUI Text Selection & Copy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable free-form text selection and auto-copy-to-clipboard in Friday's TUI using OpenTUI's built-in mouse, selection, and OSC 52 clipboard systems.

**Architecture:** Enable `useMouse` on the CliRenderer, mark text-bearing elements as `selectable` with themed highlight colors, and hook mouseUp on the root box to auto-copy selected text via OSC 52 with a brief visual flash before clearing.

**Tech Stack:** OpenTUI (`@opentui/core`, `@opentui/react`) — `useMouse`, `selectable`, `selectionBg`/`selectionFg`, `copyToClipboardOSC52`, `Selection.getSelectedText()`

---

### Task 1: Add Selection Colors to Theme

**Files:**
- Modify: `src/cli/tui/theme.ts:3-17`

**Step 1: Write the failing test**

No test needed — this is a pure constant addition. Skip to implementation.

**Step 2: Add selection colors to PALETTE**

In `src/cli/tui/theme.ts`, add two new entries to the `PALETTE` object:

```typescript
export const PALETTE = {
	background: "#0D1117",
	surface: "#161B22",
	surfaceLight: "#1C2333",
	amberPrimary: "#F0A030",
	amberGlow: "#FFD080",
	amberDim: "#8B6914",
	copperAccent: "#C07020",
	textPrimary: "#E6EDF3",
	textMuted: "#7D8590",
	borderDim: "#30363D",
	success: "#3FB950",
	error: "#F85149",
	warning: "#D29922",
	selectionBg: "#5C3D00",
	selectionFg: "#FFFFFF",
} as const;
```

**Step 3: Commit**

```bash
git add src/cli/tui/theme.ts
git commit -m "feat(tui): add selection highlight colors to palette"
```

---

### Task 2: Mark Message Content as Selectable

**Files:**
- Modify: `src/cli/tui/components/message.tsx`

**Step 1: Add selectable props to user message text**

In the user message branch of `Message`, add `selectable`, `selectionBg`, `selectionFg` to the `<text>` element:

```tsx
if (role === "user") {
	return (
		<box flexDirection="column" paddingLeft={1} gap={0} marginBottom={1}>
			<RoleBadge label="You" fg={PALETTE.amberGlow} />
			<box paddingLeft={1}>
				<text
					fg={PALETTE.textPrimary}
					selectable
					selectionBg={PALETTE.selectionBg}
					selectionFg={PALETTE.selectionFg}
				>
					{content}
				</text>
			</box>
		</box>
	);
}
```

**Step 2: Add selectable props to assistant message markdown**

In the assistant message branch, add `selectable`, `selectionBg`, `selectionFg` to the `<markdown>` element:

```tsx
return (
	<box flexDirection="column" paddingLeft={1} gap={0} marginTop={1}>
		<RoleBadge label="Friday" fg={PALETTE.amberPrimary} />
		<box
			border
			borderStyle="rounded"
			borderColor={PALETTE.copperAccent}
			backgroundColor={PALETTE.surface}
			paddingLeft={1}
			paddingRight={1}
			marginLeft={1}
		>
			<markdown
				content={content}
				syntaxStyle={FRIDAY_SYNTAX_STYLE}
				selectable
				selectionBg={PALETTE.selectionBg}
				selectionFg={PALETTE.selectionFg}
			/>
		</box>
	</box>
);
```

**Step 3: Add selectable props to system message text**

In the system message branch, add to the `<text>` element:

```tsx
if (role === "system") {
	const isError =
		content.toLowerCase().startsWith("error") ||
		content.toLowerCase().startsWith("boot failed");
	return (
		<box paddingLeft={1}>
			<text
				fg={isError ? PALETTE.error : PALETTE.amberDim}
				attributes={DIM}
				selectable
				selectionBg={PALETTE.selectionBg}
				selectionFg={PALETTE.selectionFg}
			>
				{`──── ${content} ────`}
			</text>
		</box>
	);
}
```

**Step 4: Commit**

```bash
git add src/cli/tui/components/message.tsx
git commit -m "feat(tui): mark message text and markdown as selectable"
```

---

### Task 3: Enable Mouse and Wire Auto-Copy

**Files:**
- Modify: `src/cli/tui/app.tsx`

**Step 1: Enable mouse on renderer**

In `launchTui()`, change the `createCliRenderer` call to enable mouse:

```typescript
const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });
```

**Step 2: Pass renderer to FridayApp**

Update the `FridayAppProps` interface and pass the renderer:

```typescript
interface FridayAppProps {
	options: {
		provider: string;
		model?: string;
		fastModel?: string;
		fresh?: boolean;
	};
	renderer: Awaited<ReturnType<typeof createCliRenderer>>;
}
```

Update the render call:

```typescript
root.render(<FridayApp options={options} renderer={renderer} />);
```

Update the `FridayApp` function signature:

```typescript
function FridayApp({ options, renderer }: FridayAppProps) {
```

**Step 3: Add mouseUp handler for auto-copy**

Add a `useCallback` hook in `FridayApp` that handles auto-copy on selection end:

```typescript
const handleMouseUp = useCallback(() => {
	// Defer to next tick so OpenTUI's internal selection processing completes first
	setTimeout(() => {
		if (!renderer.hasSelection) return;
		const selection = renderer.getSelection();
		if (!selection) return;
		const text = selection.getSelectedText();
		if (!text) {
			renderer.clearSelection();
			return;
		}
		renderer.copyToClipboardOSC52(text);
		toast("Copied!");
		// Clear selection after brief visual flash
		setTimeout(() => {
			renderer.clearSelection();
		}, 500);
	}, 0);
}, [renderer]);
```

**Step 4: Attach handler to root box**

Add `onMouseUp={handleMouseUp}` to the main layout `<box>` in the return JSX (the one wrapping Header, ChatArea, InputBar):

```tsx
return (
	<box
		flexDirection="column"
		width="100%"
		height="100%"
		backgroundColor={PALETTE.background}
		shouldFill
		onMouseUp={handleMouseUp}
	>
		<Header provider={provider} model={model} />
		<ChatArea
			messages={state.messages}
			isThinking={state.isThinking}
			welcomeInfo={state.welcomeInfo}
		/>
		<InputBar
			commands={commandsRef.current}
			disabled={inputDisabled}
			placeholder={placeholder}
			onSubmit={handleSubmit}
			onExit={handleShutdown}
		/>
	</box>
);
```

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 6: Commit**

```bash
git add src/cli/tui/app.tsx
git commit -m "feat(tui): enable mouse and auto-copy on text selection"
```

---

### Task 4: Manual Testing

**Step 1: Run Friday TUI**

```bash
bun run dev
```

**Step 2: Test selection**

1. Wait for boot to complete
2. Type a message and get a response
3. Click and drag across any text in the chat area
4. Verify: selected text highlights with dark amber background
5. Verify: on mouse release, toast "Copied!" appears
6. Verify: selection clears after ~500ms
7. Verify: pasting (Cmd+V / Ctrl+V) in another app produces the selected text

**Step 3: Test scrollbox interaction**

1. Generate enough messages to require scrolling
2. Verify: mouse scroll still works in the chat area
3. Verify: selection works on scrolled content

**Step 4: Test edge cases**

1. Click without dragging — no copy, no toast
2. Select across multiple messages — verify text is captured
3. Select system messages — verify they're selectable too
