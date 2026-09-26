export const SAMPLE_RATE = 24_000;
export const CHANNELS = 1;
export const BITS_PER_SAMPLE = 16;

export const HEADER_BYTES = 44;
export const BLOCK_ALIGN = (CHANNELS * BITS_PER_SAMPLE) / 8;
export const BYTE_RATE = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;

export const FORMAT_PCM = 1;

export function pcmToWav(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  if (pcm.byteLength % BLOCK_ALIGN !== 0) {
    throw new RangeError(
      `PCM payload must be a whole number of ${BLOCK_ALIGN}-byte samples, received ${pcm.byteLength} bytes.`,
    );
  }

  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);

  const ascii = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };

  const dataSize = pcm.byteLength;

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, BYTE_RATE, true);
  view.setUint16(32, BLOCK_ALIGN, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(HEADER_BYTES + dataSize);
  out.set(header, 0);
  out.set(pcm, HEADER_BYTES);
  return out;
}

export function wavDurationSeconds(wav: Uint8Array): number {
  if (wav.byteLength < HEADER_BYTES) {
    throw new RangeError(`Not a WAV file: ${wav.byteLength} bytes is shorter than a ${HEADER_BYTES}-byte header.`);
  }
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const byteRate = view.getUint32(28, true);
  if (byteRate === 0) return 0;
  return (wav.byteLength - HEADER_BYTES) / byteRate;
}
