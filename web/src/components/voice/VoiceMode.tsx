import { VoiceOrb } from "./VoiceOrb.tsx";
import { VoiceStatus } from "./VoiceStatus.tsx";
import { VoiceControls } from "./VoiceControls.tsx";
import { VoiceDevControls } from "./VoiceDevControls.tsx";
import { useVoiceState } from "./useVoiceState.ts";

const showDevControls =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev"));

export function VoiceMode() {
  const voice = useVoiceState();

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: "radial-gradient(ellipse at center, #0D1117 0%, #090C12 100%)" }}>
      {/* Vignette */}
      <div className="fixed inset-0 pointer-events-none z-[1]" style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.6) 100%)" }} />

      {/* Title */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-10 text-center select-none">
        <div className="text-[1.4rem] font-light" style={{ letterSpacing: "0.3em", color: "#E8943A" }}>
          F.R.I.D.A.Y.
        </div>
        <div className="text-[0.85rem] mt-1" style={{ color: "#6B5540" }}>
          {voice.voiceName}
        </div>
      </div>

      {/* Canvas orb */}
      <VoiceOrb
        state={voice.state}
        whisperMode={voice.whisperMode}
        muted={voice.muted}
        speedMultiplier={voice.speedMultiplier}
        sessionEnded={voice.sessionEnded}
      />

      {/* Status text */}
      <VoiceStatus
        text={voice.statusText}
        isTyping={voice.isTyping}
        speedMultiplier={voice.speedMultiplier}
      />

      {/* Controls */}
      <VoiceControls
        whisperMode={voice.whisperMode}
        muted={voice.muted}
        sessionEnded={voice.sessionEnded}
        onToggleWhisper={voice.toggleWhisper}
        onToggleMute={voice.toggleMute}
        onEndSession={voice.endSession}
      />

      {/* Dev controls */}
      {showDevControls && (
        <VoiceDevControls
          currentState={voice.state}
          speedMultiplier={voice.speedMultiplier}
          onForceState={voice.forceState}
          onSetSpeed={voice.setSpeed}
          onResumeAutoDemo={voice.resumeAutoDemo}
        />
      )}
    </div>
  );
}
