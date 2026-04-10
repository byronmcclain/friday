# TUI Text Selection & Copy Design

## Summary

Enable free-form text selection and auto-copy in Friday's TUI by activating OpenTUI's built-in mouse, selection, and OSC 52 clipboard systems.

## Requirements

- User can select any visible text in the chat area by clicking and dragging
- Selected text is automatically copied to the system clipboard on mouse release
- Selection highlight briefly flashes (~500ms) as visual confirmation, then clears
- Selection colors match Friday's amber palette

## Approach

Use OpenTUI's existing infrastructure — no custom selection logic needed.

### Layer 1: Enable Mouse

Set `useMouse: true` on `createCliRenderer()`. This activates:
- Hit grid detection (which renderable is under the cursor)
- Drag-to-select via `startSelection()` / `updateSelection()` / `finishSelection()`
- Visual selection highlighting on selectable renderables

### Layer 2: Mark Content as Selectable

Add `selectable`, `selectionBg`, and `selectionFg` props to `<text>` and `<markdown>` elements in `message.tsx`. OpenTUI's `TextBufferRenderable` (backing both element types) already supports these props.

### Layer 3: Auto-Copy on Selection End

After mouse up on the root box, check if the renderer has an active selection:
1. Get text via `renderer.getSelection()?.getSelectedText()`
2. Copy via `renderer.copyToClipboardOSC52(text)`
3. Show toast ("Copied!")
4. Clear selection after 500ms via `renderer.clearSelection()`

### Selection Colors

- `selectionBg`: `#5C3D00` (dark amber) — visible against both background and surface colors
- `selectionFg`: `#FFFFFF` (white) — maximum contrast on dark amber

## Files Changed

| File | Change |
|------|--------|
| `src/cli/tui/app.tsx` | `useMouse: true` in renderer config; mouseUp handler for auto-copy + delayed clear |
| `src/cli/tui/components/message.tsx` | `selectable`, `selectionBg`, `selectionFg` on `<text>` and `<markdown>` |
| `src/cli/tui/theme.ts` | Add `selectionBg` and `selectionFg` to PALETTE |

## Out of Scope

- Keyboard shortcut for copy (auto-copy is sufficient)
- Copy button on code blocks (separate feature)
- Custom mouse handlers (OpenTUI handles selection globally)

## Dependencies

- OpenTUI `useMouse`, `selectable`, `selectionBg`/`selectionFg` props
- OSC 52 clipboard protocol (supported by iTerm2, Kitty, tmux, most modern terminals)
