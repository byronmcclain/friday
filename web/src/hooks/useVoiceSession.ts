import { useState, useRef, useCallback, useEffect } from "react";
import type { VoiceState } from "../components/voice/types.ts";

interface UseVoiceSessionOptions {
  wsUrl: string;
}

export interface UseVoiceSessionReturn {
  state: VoiceState;
  statusText: string;
  isTyping: boolean;
  isConnected: boolean;
  voiceMode: "on" | "whisper";
  muted: boolean;
  sessionActive: boolean;
  startSession: () => void;
  endSession: () => void;
  setMode: (mode: "on" | "whisper") => void;
  toggleMute: () => void;
  sendAudio: (pcmBuffer: ArrayBuffer) => void;
  onAudioReceived: (handler: (base64: string) => void) => void;
}

export function useVoiceSession({ wsUrl }: UseVoiceSessionOptions): UseVoiceSessionReturn {
  const [state, setState] = useState<VoiceState>("idle");
  const [statusText, setStatusText] = useState("Ready.");
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"on" | "whisper">("on");
  const [muted, setMuted] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioHandlerRef = useRef<((base64: string) => void) | null>(null);
  const transcriptBufferRef = useRef("");

  useEffect(() => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({
        type: "session:identify",
        id: crypto.randomUUID(),
        clientType: "voice",
      }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      setIsConnected(false);
      setSessionActive(false);
    };

    ws.onerror = () => ws.close();
    wsRef.current = ws;

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "voice:stop",
          id: crypto.randomUUID(),
        }));
      }
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl]);

  const handleServerMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case "voice:state":
        setState(msg.state);
        if (msg.state === "idle") {
          setIsTyping(false);
        } else if (msg.state === "listening") {
          setStatusText("Listening...");
          setIsTyping(false);
          transcriptBufferRef.current = "";
        } else if (msg.state === "thinking") {
          setStatusText("Processing...");
          setIsTyping(false);
        } else if (msg.state === "reconnecting") {
          setStatusText("Reconnecting\u2026");
          setIsTyping(false);
        } else if (msg.state === "error") {
          // Soft/transient failures may still emit this state while the server
          // session remains alive. Do not clear sessionActive here — terminal
          // death is signaled via voice:error (RECONNECT_FAILED / START_FAILED).
          setStatusText("Something went wrong. Still listening\u2026");
          setIsTyping(false);
        }
        break;

      case "voice:transcript":
        if (msg.role === "assistant") {
          if (msg.done) {
            setIsTyping(false);
          } else {
            transcriptBufferRef.current += msg.delta;
            setStatusText(transcriptBufferRef.current);
            setIsTyping(true);
          }
        } else if (msg.role === "user" && msg.done) {
          setStatusText(msg.delta);
        }
        break;

      case "voice:audio":
        audioHandlerRef.current?.(msg.delta);
        break;

      case "voice:started":
        setSessionActive(true);
        setState("idle");
        setStatusText("Ready.");
        break;

      case "voice:stopped":
        setSessionActive(false);
        setState("idle");
        setStatusText("Session ended.");
        break;

      case "voice:error":
        setState("error");
        setStatusText(msg.message ?? "Error.");
        // Only terminal session death should clear the client session.
        // SESSION_IN_USE (and any future soft codes) must leave it alone.
        if (msg.code === "RECONNECT_FAILED" || msg.code === "START_FAILED") {
          setSessionActive(false);
        }
        break;
    }
  }, []);

  const startSession = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "voice:start",
      id: crypto.randomUUID(),
    }));
  }, []);

  const endSession = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "voice:stop",
      id: crypto.randomUUID(),
    }));
  }, []);

  const setMode = useCallback((mode: "on" | "whisper") => {
    setVoiceMode(mode);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "voice:mode",
      id: crypto.randomUUID(),
      mode,
    }));
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  const sendAudio = useCallback((pcmBuffer: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || muted) return;
    ws.send(pcmBuffer);
  }, [muted]);

  const onAudioReceived = useCallback((handler: (base64: string) => void) => {
    audioHandlerRef.current = handler;
  }, []);

  return {
    state,
    statusText,
    isTyping,
    isConnected,
    voiceMode,
    muted,
    sessionActive,
    startSession,
    endSession,
    setMode,
    toggleMute,
    sendAudio,
    onAudioReceived,
  };
}
