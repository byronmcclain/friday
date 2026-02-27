import type { VoiceState, StateColor } from "./types.ts";

export const VOICE_STATES: Record<string, VoiceState> = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  ERROR: "error",
} as const;

export const COLORS = {
  deep: "#0D1117",
  amber: "#E8943A",
  amberLight: "#FFD090",
  copper: "#C47A3A",
  text: "#F0E6D8",
  textDim: "#6B5540",
  error: "#F87171",
} as const;

export const PARTICLE_COUNT = 1000;
export const SPHERE_RADIUS = 0.35;
export const SPRITE_SIZE = 64;
export const TRANSITION_SPEED = 0.002;

export const ARC_SEGMENTS = 6;
export const ARC_MAX_LIFE = 12;

export const STATE_COLORS: Record<VoiceState, StateColor> = {
  idle: { r: 232, g: 148, b: 58 },
  listening: { r: 232, g: 148, b: 58 },
  thinking: { r: 196, g: 122, b: 58 },
  speaking: { r: 255, g: 208, b: 144 },
  error: { r: 248, g: 113, b: 113 },
};

export const SPARK_COLOR = { r: 139, g: 94, b: 60 };

export const DEMO_RESPONSES = [
  "I found 3 unread emails from today.",
  "Your Docker containers are all healthy.",
  "The build passed. 957 tests, zero failures.",
  "Checking your calendar... you're free until 3pm.",
  "I've summarized the PR — 4 files changed, 2 comments.",
];

export const DEMO_SCHEDULE: Array<{
  state: VoiceState;
  duration: number;
  status: string | null;
  typewriter: boolean;
}> = [
  { state: "idle", duration: 3000, status: "Ready.", typewriter: false },
  { state: "listening", duration: 3000, status: "Listening...", typewriter: false },
  { state: "thinking", duration: 2000, status: "Processing...", typewriter: false },
  { state: "speaking", duration: 4000, status: null, typewriter: true },
  { state: "idle", duration: 2000, status: "", typewriter: false },
];

export const STATUS_FOR_STATE: Record<VoiceState, string> = {
  idle: "Ready.",
  listening: "Listening...",
  thinking: "Processing...",
  speaking: "",
  error: "Error.",
};
