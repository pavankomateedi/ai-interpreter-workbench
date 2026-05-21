/**
 * The microphone capture AudioWorklet, inlined as a source string and loaded via
 * a Blob URL (ADR-006). Running in the audio thread, it downsamples the browser's
 * native-rate float PCM to 16 kHz, packs it as little-endian PCM-16, and posts
 * fixed ~100 ms frames to the main thread. It also posts an RMS level for the
 * visualizer. ArrayBuffers are transferred (not copied) across the port.
 */

const WORKLET_SOURCE = /* js */ `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetSampleRate;
    this.ratio = sampleRate / this.targetRate;
    this.frameSamples = Math.round(this.targetRate / 10); // 100 ms at target rate
    this.acc = 0;
    this.out = [];
    this.tick = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let sumSquares = 0;
    for (let i = 0; i < channel.length; i++) sumSquares += channel[i] * channel[i];
    const rms = Math.sqrt(sumSquares / channel.length);

    // Decimate to the target rate by fractional accumulation.
    for (let i = 0; i < channel.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const s = Math.max(-1, Math.min(1, channel[i]));
        this.out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }

    while (this.out.length >= this.frameSamples) {
      const frame = this.out.splice(0, this.frameSamples);
      const pcm = new Int16Array(frame);
      this.port.postMessage({ type: 'audio', pcm: pcm.buffer, rms }, [pcm.buffer]);
    }

    // Throttle level updates to ~30 fps.
    if ((this.tick++ & 7) === 0) this.port.postMessage({ type: 'level', rms });
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

let cachedUrl: string | null = null;

/** Returns a stable Blob URL for the worklet module, created once. */
export function getWorkletUrl(): string {
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  }
  return cachedUrl;
}
