import { useCallback, useEffect } from "react";
import { VoiceOrb } from "./VoiceOrb.tsx";
import { VoiceStatus } from "./VoiceStatus.tsx";
import { VoiceControls } from "./VoiceControls.tsx";
import { useVoiceSession } from "../../hooks/useVoiceSession.ts";
import { useVoiceAudio } from "../../hooks/useVoiceAudio.ts";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort =
  window.location.port ||
  (window.location.protocol === "https:" ? "443" : "80");
const WS_URL = `${wsProtocol}//${window.location.hostname}:${wsPort}/ws`;

export function VoiceMode() {
  const voice = useVoiceSession({ wsUrl: WS_URL });

  const handleAudioChunk = useCallback(
    (pcmBuffer: ArrayBuffer) => {
      voice.sendAudio(pcmBuffer);
    },
    [voice.sendAudio],
  );

  const audio = useVoiceAudio(handleAudioChunk);

  // Wire audio playback to voice session
  useEffect(() => {
    voice.onAudioReceived((base64) => {
      audio.playAudio(base64);
    });
  }, [voice.onAudioReceived, audio.playAudio]);

  // Barge-in: flush playback when user starts speaking
  useEffect(() => {
    if (voice.state === "listening") {
      audio.stopPlayback();
    }
  }, [voice.state, audio.stopPlayback]);

  // Auto-start voice session when connected
  useEffect(() => {
    if (voice.isConnected && !voice.sessionActive) {
      voice.startSession();
    }
  }, [voice.isConnected, voice.sessionActive, voice.startSession]);

  // Auto-start mic capture when session is active
  useEffect(() => {
    if (voice.sessionActive && !audio.isCapturing) {
      audio.startCapture().catch(console.error);
    }
    if (!voice.sessionActive && audio.isCapturing) {
      audio.stopCapture();
      audio.stopPlayback();
    }
  }, [voice.sessionActive, audio.isCapturing, audio.startCapture, audio.stopCapture, audio.stopPlayback]);

  const voiceName = !voice.sessionActive
    ? "Voice \u00B7 Off"
    : voice.voiceMode === "whisper"
      ? "Voice \u00B7 Whisper"
      : "Voice \u00B7 On";

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at center, #0D1117 0%, #090C12 100%)",
      }}
    >
      {/* Vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-[1]"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.6) 100%)",
        }}
      />

      {/* Title */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-10 text-center select-none">
        <div
          className="text-[1.4rem] font-light"
          style={{ letterSpacing: "0.3em", color: "#E8943A" }}
        >
          F.R.I.D.A.Y.
        </div>
        <div className="text-[0.85rem] mt-1" style={{ color: "#6B5540" }}>
          {voiceName}
        </div>
      </div>

      {/* Canvas orb */}
      <VoiceOrb
        state={voice.state}
        whisperMode={voice.voiceMode === "whisper"}
        muted={voice.muted}
        speedMultiplier={1}
        sessionEnded={!voice.sessionActive}
      />

      {/* Status text */}
      <VoiceStatus
        text={voice.statusText}
        isTyping={voice.isTyping}
        speedMultiplier={1}
      />

      {/* Controls */}
      <VoiceControls
        whisperMode={voice.voiceMode === "whisper"}
        muted={voice.muted}
        sessionEnded={!voice.sessionActive}
        onToggleWhisper={() =>
          voice.setMode(voice.voiceMode === "whisper" ? "on" : "whisper")
        }
        onToggleMute={voice.toggleMute}
        onEndSession={voice.endSession}
      />
    </div>
  );
}
