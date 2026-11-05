/**
 * Phrase splitting for local dictation (owner, 2026-11-05). The mic worklet
 * delivers 16 kHz mono PCM frames; local Whisper transcribes whole phrases,
 * so a simple energy detector cuts the stream at pauses. Pure and
 * browser-safe so it can be tested without audio hardware.
 */

export const SPLIT_SAMPLE_RATE = 16_000;
/** A pause this long ends a phrase. */
export const PAUSE_MS = 700;
/** Whisper's window: a phrase is cut here even without a pause. */
export const MAX_PHRASE_MS = 29_000;
/** Frames kept from just before speech starts, so the first syllable survives. */
const PRE_ROLL_FRAMES = 3;
/** RMS (0..1) above which a frame counts as speech. */
export const SPEECH_RMS = 0.012;

export interface SplitterState {
	frames: Int16Array[];
	samples: number;
	speaking: boolean;
	silentSamples: number;
}

export function freshSplitter(): SplitterState {
	return { frames: [], samples: 0, speaking: false, silentSamples: 0 };
}

export function frameRms(frame: Int16Array): number {
	let sum = 0;
	for (let i = 0; i < frame.length; i++) sum += (frame[i]! / 32768) ** 2;
	return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

function join(frames: Int16Array[], samples: number): Int16Array {
	const out = new Int16Array(samples);
	let at = 0;
	for (const f of frames) { out.set(f, at); at += f.length; }
	return out;
}

/** Feed one frame; returns a finished phrase when a pause (or the length
 *  cap) ends one. Silence alone never produces a phrase. */
export function splitStep(state: SplitterState, frame: Int16Array): { state: SplitterState; phrase?: Int16Array } {
	const speech = frameRms(frame) >= SPEECH_RMS;
	if (!state.speaking) {
		if (!speech) {
			// Keep only a short pre-roll while waiting for speech.
			const frames = [...state.frames, frame].slice(-PRE_ROLL_FRAMES);
			return { state: { frames, samples: frames.reduce((n, f) => n + f.length, 0), speaking: false, silentSamples: 0 } };
		}
		const frames = [...state.frames, frame];
		return { state: { frames, samples: state.samples + frame.length, speaking: true, silentSamples: 0 } };
	}
	const frames = [...state.frames, frame];
	const samples = state.samples + frame.length;
	const silentSamples = speech ? 0 : state.silentSamples + frame.length;
	const paused = silentSamples >= (PAUSE_MS / 1000) * SPLIT_SAMPLE_RATE;
	const full = samples >= (MAX_PHRASE_MS / 1000) * SPLIT_SAMPLE_RATE;
	if (paused || full) return { state: freshSplitter(), phrase: join(frames, samples) };
	return { state: { frames, samples, speaking: true, silentSamples } };
}

/** At stop: whatever speech is in progress becomes the last phrase. */
export function splitFlush(state: SplitterState): Int16Array | undefined {
	return state.speaking && state.samples > 0 ? join(state.frames, state.samples) : undefined;
}
