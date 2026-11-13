import { buildWsUrl } from '../config';

// Opens the signaling socket briefly BEFORE the room page starts, to find out whether the server will
// refuse this token (4001 invalid, 4002 expired, 4006 denied). The server only checks the signature,
// so the browser cannot know this by itself. The server accepts the socket, sends an error and closes
// it right away; a good token just stays open, so we close it ourselves after a short grace period.
// Resolves { ok: true } or { ok: false, code }. Never rejects: if the server cannot be reached we
// return ok so the normal room flow shows its usual "cannot reach server" message.
export function probeSocket(token, graceMs = 400) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let ws;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ws) { ws.onopen = ws.onclose = ws.onerror = null; try { ws.close(1000); } catch { /* noop */ } }
      resolve(result);
    };
    try { ws = new WebSocket(buildWsUrl(token)); } catch { return resolve({ ok: true }); }
    ws.onopen = () => { timer = setTimeout(() => finish({ ok: true }), graceMs); };
    ws.onclose = (ev) => finish(ev.code >= 4000 && ev.code <= 4006 ? { ok: false, code: ev.code } : { ok: true });
    ws.onerror = () => { /* onclose follows */ };
    timer = setTimeout(() => finish({ ok: true }), 3000); // server did not answer: let the normal flow handle it
  });
}
