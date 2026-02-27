import { useState, useRef, useEffect, useCallback } from "react";
import type { VoiceState } from "./types.ts";
import { DEMO_SCHEDULE, DEMO_RESPONSES, STATUS_FOR_STATE } from "./constants.ts";

export interface UseVoiceStateReturn {
  state: VoiceState;
  statusText: string;
  isTyping: boolean;
  whisperMode: boolean;
  muted: boolean;
  sessionEnded: boolean;
  speedMultiplier: number;
  voiceName: string;
  toggleWhisper: () => void;
  toggleMute: () => void;
  endSession: () => void;
  forceState: (state: VoiceState) => void;
  setSpeed: (speed: number) => void;
  resumeAutoDemo: () => void;
}

export function useVoiceState(): UseVoiceStateReturn {
  const [state, setState] = useState<VoiceState>("idle");
  const [statusText, setStatusText] = useState("Ready.");
  const [isTyping, setIsTyping] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  const autoDemoRef = useRef(true);
  const demoStepRef = useRef(0);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const responseIndexRef = useRef(0);
  const speedRef = useRef(1);

  // Keep speedRef in sync
  speedRef.current = speedMultiplier;

  const clearTypewriter = useCallback(() => {
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
  }, []);

  const clearDemoTimer = useCallback(() => {
    if (demoTimerRef.current) {
      clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  }, []);

  const setStatusWithTypewriter = useCallback((text: string, typewriter: boolean) => {
    clearTypewriter();
    if (typewriter && text.length > 0) {
      setIsTyping(true);
      let charIndex = 0;
      setStatusText("");
      typewriterTimerRef.current = setInterval(() => {
        charIndex++;
        setStatusText(text.slice(0, charIndex));
        if (charIndex >= text.length) {
          clearInterval(typewriterTimerRef.current!);
          typewriterTimerRef.current = null;
          setIsTyping(false);
        }
      }, 30 / speedRef.current);
    } else {
      setIsTyping(false);
      setStatusText(text);
    }
  }, [clearTypewriter]);

  const runDemoStep = useCallback(() => {
    if (!autoDemoRef.current) return;

    const step = DEMO_SCHEDULE[demoStepRef.current % DEMO_SCHEDULE.length]!;
    setState(step.state);

    if (step.state === "speaking") {
      const response = DEMO_RESPONSES[responseIndexRef.current % DEMO_RESPONSES.length]!;
      responseIndexRef.current++;
      setStatusWithTypewriter(response, true);
    } else {
      setStatusWithTypewriter(step.status ?? "", step.typewriter);
    }

    demoStepRef.current++;
    demoTimerRef.current = setTimeout(runDemoStep, step.duration / speedRef.current);
  }, [setStatusWithTypewriter]);

  // Start auto-demo on mount
  useEffect(() => {
    runDemoStep();
    return () => {
      clearDemoTimer();
      clearTypewriter();
    };
  }, [runDemoStep, clearDemoTimer, clearTypewriter]);

  const toggleWhisper = useCallback(() => {
    if (sessionEnded) return;
    setWhisperMode(prev => !prev);
  }, [sessionEnded]);

  const toggleMute = useCallback(() => {
    if (sessionEnded) return;
    setMuted(prev => {
      const newMuted = !prev;
      if (!autoDemoRef.current) {
        setStatusText(newMuted ? "Muted" : "Ready.");
      }
      return newMuted;
    });
  }, [sessionEnded]);

  const endSession = useCallback(() => {
    if (sessionEnded) return;
    setSessionEnded(true);
    autoDemoRef.current = false;
    clearDemoTimer();
    clearTypewriter();
    setState("error");
    setStatusText("Session ended.");
  }, [sessionEnded, clearDemoTimer, clearTypewriter]);

  const forceState = useCallback((newState: VoiceState) => {
    if (sessionEnded) return;
    autoDemoRef.current = false;
    clearDemoTimer();
    clearTypewriter();
    setState(newState);
    setStatusText(STATUS_FOR_STATE[newState]);
    setIsTyping(false);
  }, [sessionEnded, clearDemoTimer, clearTypewriter]);

  const setSpeed = useCallback((speed: number) => {
    setSpeedMultiplier(speed);
  }, []);

  const resumeAutoDemo = useCallback(() => {
    if (sessionEnded) return;
    autoDemoRef.current = true;
    demoStepRef.current = 0;
    clearDemoTimer();
    clearTypewriter();
    runDemoStep();
  }, [sessionEnded, clearDemoTimer, clearTypewriter, runDemoStep]);

  const voiceName = whisperMode ? "Eve \u00B7 Whisper" : "Eve \u00B7 On";

  return {
    state,
    statusText,
    isTyping,
    whisperMode,
    muted,
    sessionEnded,
    speedMultiplier,
    voiceName,
    toggleWhisper,
    toggleMute,
    endSession,
    forceState,
    setSpeed,
    resumeAutoDemo,
  };
}
