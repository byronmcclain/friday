/**
 * Wrap raw PCM16 mono LE data in a WAV header.
 */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = pcm.length;
	const headerSize = 44;

	const header = Buffer.alloc(headerSize);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + dataSize, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(numChannels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(dataSize, 40);

	return Buffer.concat([header, pcm]);
}

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
 * Play a WAV buffer using the OS audio player.
 * Returns the Bun subprocess so callers can kill it for cancellation.
 */
export async function playAudio(
	wavBuffer: Buffer,
	volume: number,
	platform?: string,
): Promise<{ proc: ReturnType<typeof Bun.spawn>; tmpFile: string }> {
	const player = detectPlayer(platform);
	const tmpFile = `/tmp/friday-vox-${Date.now()}.wav`;
	await Bun.write(tmpFile, wavBuffer);

	const args = [...player.cmd, ...player.volumeArgs(volume), tmpFile];
	const proc = Bun.spawn(args);

	return { proc, tmpFile };
}

/**
 * Clean up a temp WAV file. Best-effort, never throws.
 */
export async function cleanupTempFile(path: string): Promise<void> {
	try {
		const { unlink } = await import("node:fs/promises");
		await unlink(path);
	} catch {
		// best-effort cleanup
	}
}
