export interface AudioPlayer {
	cmd: string[];
	volumeArgs: (volume: number) => string[];
}

/**
 * Detect the OS audio player. Accepts optional platform override for testing.
 */
export function detectPlayer(platform?: string): AudioPlayer {
	const p = platform ?? process.platform;
	switch (p) {
		case "darwin":
			return {
				cmd: ["afplay"],
				volumeArgs: (v) => ["--volume", String(v)],
			};
		case "linux":
			return {
				cmd: ["paplay"],
				volumeArgs: (v) => [`--volume=${Math.round(v * 65536)}`],
			};
		case "win32":
			return {
				cmd: ["powershell", "-c"],
				volumeArgs: () => [],
			};
		default:
			throw new Error(`Unsupported platform: ${p}`);
	}
}

/**
 * Play an audio buffer using the OS audio player.
 * Returns the Bun subprocess so callers can kill it for cancellation.
 */
export async function playAudio(
	audioBuffer: Buffer,
	volume: number,
	platform?: string,
): Promise<{ proc: ReturnType<typeof Bun.spawn>; tmpFile: string }> {
	const player = detectPlayer(platform);
	const tmpFile = `/tmp/friday-vox-${Date.now()}.wav`;
	await Bun.write(tmpFile, audioBuffer);

	const args = [...player.cmd, ...player.volumeArgs(volume), tmpFile];
	const proc = Bun.spawn(args);

	return { proc, tmpFile };
}

/**
 * Clean up a temp audio file. Best-effort, never throws.
 */
export async function cleanupTempFile(path: string): Promise<void> {
	try {
		const { unlink } = await import("node:fs/promises");
		await unlink(path);
	} catch {
		// best-effort cleanup
	}
}
