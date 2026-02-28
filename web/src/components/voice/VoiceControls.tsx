import type { VoiceControlsProps } from "./types.ts";

export function VoiceControls({
  whisperMode,
  muted,
  sessionEnded,
  onToggleWhisper,
  onToggleMute,
  onEndSession,
}: VoiceControlsProps) {
  return (
    <div
      className="fixed bottom-10 left-1/2 -translate-x-1/2 flex gap-3 z-10 opacity-25 hover:opacity-100 transition-opacity duration-300"
    >
      <button
        type="button"
        onClick={onToggleWhisper}
        disabled={sessionEnded}
        className={`px-5 py-2 rounded-full text-[0.85rem] cursor-pointer border transition-colors duration-200 select-none
          ${whisperMode
            ? "bg-[#E8943A] text-[#0D1117] border-[#E8943A]"
            : "bg-transparent text-[#E8943A] border-[#E8943A] hover:bg-[#E8943A] hover:text-[#0D1117]"
          } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        Whisper
      </button>
      <button
        type="button"
        onClick={onToggleMute}
        disabled={sessionEnded}
        className={`px-5 py-2 rounded-full text-[0.85rem] cursor-pointer border transition-colors duration-200 select-none
          ${muted
            ? "border-[#F87171] text-[#F87171] hover:bg-[#F87171] hover:text-[#0D1117]"
            : "bg-transparent text-[#E8943A] border-[#E8943A] hover:bg-[#E8943A] hover:text-[#0D1117]"
          } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        {muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        onClick={onEndSession}
        disabled={sessionEnded}
        className="px-5 py-2 rounded-full text-[0.85rem] cursor-pointer border border-[#F87171] text-[#F87171] bg-transparent hover:bg-[#F87171] hover:text-[#0D1117] transition-colors duration-200 select-none disabled:opacity-30 disabled:cursor-not-allowed"
      >
        End Session
      </button>
    </div>
  );
}
