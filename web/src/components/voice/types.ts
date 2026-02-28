export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceOrbProps {
  state: VoiceState;
  whisperMode: boolean;
  muted: boolean;
  speedMultiplier: number;
  sessionEnded: boolean;
}

export interface VoiceControlsProps {
  whisperMode: boolean;
  muted: boolean;
  sessionEnded: boolean;
  onToggleWhisper: () => void;
  onToggleMute: () => void;
  onEndSession: () => void;
}

export interface VoiceStatusProps {
  text: string;
  isTyping: boolean;
  speedMultiplier: number;
}

export interface StateColor {
  r: number;
  g: number;
  b: number;
}
