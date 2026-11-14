// A short 660 Hz tone as a WAV blob URL - used by "Test speaker" so we need no audio asset.
let url = null;
export function beepUrl() {
  if (url) return url;
  const rate = 16000, dur = 0.6, n = Math.floor(rate * dur);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 20, (dur - t) * 20); // fade in/out, no click
    v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 660 * t) * env * 0.3 * 32767, true);
  }
  url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return url;
}
