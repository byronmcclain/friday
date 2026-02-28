import type { VoiceStatusProps } from "./types.ts";

export function VoiceStatus({ text, isTyping }: VoiceStatusProps) {
  const isListening = text === "Listening..." || text === "Listening";
  const visible = text.length > 0;

  return (
    <div
      className="font-mono-friday fixed left-1/2 -translate-x-1/2 text-center text-[0.9rem] min-h-[1.4em] z-10 transition-opacity duration-300 px-5 py-1.5 rounded-full"
      style={{
        bottom: "140px",
        color: "var(--color-friday-text, #F0E6D8)",
        opacity: visible ? 1 : 0,
        background: "rgba(13, 17, 23, 0.55)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(232, 148, 58, 0.08)",
      }}
    >
      {isListening ? (
        <>
          Listening
          <span className="voice-ellipsis">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </>
      ) : (
        <>
          {text}
          {isTyping && <span className="animate-pulse">|</span>}
        </>
      )}
    </div>
  );
}
