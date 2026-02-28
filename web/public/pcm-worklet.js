class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._volume = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    // Calculate RMS volume for mic level indicator
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * input[i];
    }
    this._volume = Math.sqrt(sum / input.length);

    // Convert Float32 → Int16 PCM little-endian
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Post PCM buffer and volume level to main thread
    this.port.postMessage(
      { pcm: pcm.buffer, volume: this._volume },
      [pcm.buffer],
    );

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
