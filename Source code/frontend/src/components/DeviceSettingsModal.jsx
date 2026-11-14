import { useEffect, useState } from 'react';
import Modal from './Modal';
import { beepUrl } from '../utils/beep';

// Live input level of the microphone track, so the user can see that the chosen device really picks up sound.
function MicMeter({ track }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!track || !AC) { setLevel(0); return undefined; }
    let raf = 0;
    let ctx = null;
    try {
      ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        setLevel(Math.min(1, peak / 50));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { return undefined; }
    return () => { cancelAnimationFrame(raf); ctx?.close().catch(() => {}); };
  }, [track]);
  return <div className="bar" aria-hidden="true"><div style={{ width: `${Math.round(level * 100)}%`, transition: 'width .06s linear' }} /></div>;
}

export default function DeviceSettingsModal({ state, session, onClose }) {
  const { devices, micId, speakerId, sinkSupported, micOn } = state;
  const track = state.localCamera?.getAudioTracks()[0] || null;
  const [testErr, setTestErr] = useState('');
  const canPickOutput = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.selectAudioOutput === 'function';

  useEffect(() => { session?.refreshDevices(); }, [session]);

  const testSpeaker = async () => {
    setTestErr('');
    try {
      const a = new Audio(beepUrl());
      if (speakerId && typeof a.setSinkId === 'function') await a.setSinkId(speakerId);
      await a.play();
    } catch (e) { setTestErr(`Could not play the test sound: ${e.message || e.name}`); }
  };

  // Firefox only lists output devices the user explicitly granted through this picker.
  const pickOutput = async () => {
    try {
      const d = await navigator.mediaDevices.selectAudioOutput();
      await session.refreshDevices();
      session.setSpeaker(d.deviceId);
    } catch { /* cancelled */ }
  };

  return (
    <Modal title="Audio devices" onClose={onClose} footer={<button onClick={onClose}>Done</button>}>
      <label>Microphone
        <select value={micId} onChange={(e) => session.setMic(e.target.value)}>
          <option value="">System default</option>
          {devices.mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </label>
      {track ? <MicMeter track={track} /> : <p className="muted small">No microphone is active yet. Pick a device above to start using it.</p>}
      {track && !micOn && <p className="muted small">Your microphone is muted, so the level bar stays empty. Switching device keeps it muted.</p>}

      <label style={{ marginTop: 18 }}>Speaker / headphones
        {!sinkSupported && <span className="hint">This browser cannot choose an output device (Safari, some mobile browsers). Change it in your system sound settings.</span>}
        {sinkSupported && devices.speakers.length > 0 && (
          <select value={speakerId} onChange={(e) => session.setSpeaker(e.target.value)}>
            <option value="">System default</option>
            {devices.speakers.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          </select>
        )}
        {sinkSupported && devices.speakers.length === 0 && (
          canPickOutput
            ? <button type="button" className="secondary" onClick={pickOutput}>Choose speaker…</button>
            : <span className="hint">No output devices were reported by the browser.</span>
        )}
      </label>
      {sinkSupported && <button type="button" className="secondary" onClick={testSpeaker}>Test speaker</button>}
      {testErr && <p className="muted small" style={{ color: 'var(--err)' }}>{testErr}</p>}
    </Modal>
  );
}
