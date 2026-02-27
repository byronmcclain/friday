import type { VoiceDevControlsProps, VoiceState } from "./types.ts";

const STATE_BUTTONS: Array<{ state: VoiceState; label: string }> = [
  { state: "idle", label: "IDLE" },
  { state: "listening", label: "LIST" },
  { state: "thinking", label: "THNK" },
  { state: "speaking", label: "SPKR" },
];

export function VoiceDevControls({
  currentState,
  speedMultiplier,
  onForceState,
  onSetSpeed,
  onResumeAutoDemo,
}: VoiceDevControlsProps) {
  return (
    <div
      className="fixed bottom-5 left-5 flex items-center gap-2.5 z-10 px-4 py-2 rounded-xl"
      style={{
        background: "#1A2332",
        border: "1px solid rgba(232, 148, 58, 0.15)",
      }}
    >
      {STATE_BUTTONS.map(({ state, label }) => (
        <button
          key={state}
          type="button"
          onClick={() => onForceState(state)}
          className={`w-7 h-7 rounded-full border text-[0.55rem] cursor-pointer flex items-center justify-center transition-colors duration-200
            ${currentState === state
              ? "border-[#E8943A] bg-[#E8943A] text-[#0D1117]"
              : "border-[#6B5540] bg-transparent text-[#6B5540] hover:border-[#E8943A] hover:text-[#E8943A]"
            }`}
        >
          {label}
        </button>
      ))}

      <div className="w-px h-5 bg-[#6B5540] opacity-30" />

      <button
        type="button"
        onClick={onResumeAutoDemo}
        className="bg-transparent border border-[#6B5540] text-[#6B5540] px-3 py-1 rounded-full text-[0.7rem] cursor-pointer hover:border-[#E8943A] hover:text-[#E8943A] transition-colors duration-200"
      >
        Resume
      </button>

      <div className="w-px h-5 bg-[#6B5540] opacity-30" />

      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={speedMultiplier}
          onChange={(e) => onSetSpeed(parseFloat(e.target.value))}
          className="w-20 accent-[#E8943A]"
        />
        <span className="text-[#6B5540] text-[0.7rem] min-w-[30px]">
          {speedMultiplier.toFixed(1)}x
        </span>
      </div>
    </div>
  );
}
