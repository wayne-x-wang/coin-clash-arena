export type MusicMode = "select" | "armory" | "fight" | "victory";

export type MusicTrack = Readonly<{
  label: string;
  stepMs: number;
  wave: OscillatorType;
  lead: readonly (string | null)[];
  bass: readonly (string | null)[];
  beatEvery: number;
  loop: boolean;
}>;

export const musicTracks: Readonly<Record<MusicMode, MusicTrack>>;

export function noteToFrequency(note: string | null): number | null;

export class GameMusicEngine {
  readonly isPlaying: boolean;
  play(mode: MusicMode): Promise<boolean>;
  stop(): void;
  dispose(): Promise<void>;
}
