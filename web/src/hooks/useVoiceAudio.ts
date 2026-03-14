import { useState, useRef, useCallback, useEffect } from "react";

export interface UseVoiceAudioReturn {
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  isCapturing: boolean;
  micLevel: number;
  playAudio: (pcmBase64: string) => void;
  stopPlayback: () => void;
}

export function useVoiceAudio(
  onAudioChunk: (pcmBuffer: ArrayBuffer) => void,
): UseVoiceAudioReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  // Cleanup mic resources on unmount — releases browser mic indicator
  useEffect(() => {
    return () => {
      workletRef.current?.disconnect();
      sourceRef.current?.disconnect();
      audioCtxRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startCapture = useCallback(async () => {
    if (isCapturing) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      },
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 48000 });
    audioCtxRef.current = audioCtx;

    await audioCtx.audioWorklet.addModule("/pcm-worklet.js");

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    const worklet = new AudioWorkletNode(audioCtx, "pcm-capture");
    workletRef.current = worklet;

    worklet.port.onmessage = (event) => {
      const { pcm, volume } = event.data;
      setMicLevel(volume);
      onAudioChunk(pcm);
    };

    source.connect(worklet);
    setIsCapturing(true);
  }, [isCapturing, onAudioChunk]);

  const stopCapture = useCallback(() => {
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    workletRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;

    setIsCapturing(false);
    setMicLevel(0);
  }, []);

  const playAudio = useCallback((pcmBase64: string) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 48000 });
      nextPlayTimeRef.current = playbackCtxRef.current.currentTime;
    }

    const ctx = playbackCtxRef.current;
    const raw = atob(pcmBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i]! / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 48000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close();
      playbackCtxRef.current = null;
      nextPlayTimeRef.current = 0;
    }
  }, []);

  return {
    startCapture,
    stopCapture,
    isCapturing,
    micLevel,
    playAudio,
    stopPlayback,
  };
}
