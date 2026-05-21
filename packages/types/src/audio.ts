/**
 * Audio format constants shared between the browser AudioWorklet capture path
 * and the backend provider adapters. Both Deepgram streaming STT and the
 * OpenAI Realtime API expect 16 kHz mono PCM-16, so this is the canonical
 * format the workbench captures, transports, and plays back.
 */

/** Sample rate (Hz) for all captured and synthesised audio. */
export const AUDIO_SAMPLE_RATE = 16_000;

/** Number of channels. Interpretation audio is always mono. */
export const AUDIO_CHANNELS = 1;

/** Bit depth of the PCM samples sent over the wire. */
export const AUDIO_BIT_DEPTH = 16;

/** Size of each audio chunk emitted by the capture worklet, in milliseconds. */
export const AUDIO_CHUNK_MS = 100;

/** Samples per chunk at the canonical sample rate (16000 * 0.1 = 1600). */
export const AUDIO_SAMPLES_PER_CHUNK = (AUDIO_SAMPLE_RATE * AUDIO_CHUNK_MS) / 1000;
