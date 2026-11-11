import { useEffect, useRef, useState } from 'react';
import { timeOf } from '../utils/format';

export default function ChatPanel({ state, session }) {
  const [text, setText] = useState('');
  const [transport, setTransport] = useState('ws');
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [state.messages.length]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    session?.sendChat(text, transport);
    setText('');
  };

  return (
    <div className="panel-col">
      <div className="chat-list">
        {state.messages.length === 0 && <p className="muted">No messages yet.</p>}
        {state.messages.map((m) => (
          <div key={m.id} className={`msg${m.mine ? ' mine' : ''}`}>
            <div className="msg-head">
              <b>{m.mine ? 'You' : m.username}</b>
              <span className={`badge ${m.transport}`}>{m.transport === 'ws' ? 'WebSocket' : m.transport === 'p2p' ? 'P2P DataChannel' : 'history'}</span>
              <span className="muted">{timeOf(m.ts)}</span>
            </div>
            <div className="msg-text">{m.text}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-form" onSubmit={submit}>
        <select value={transport} onChange={(e) => setTransport(e.target.value)} title="How to send this message">
          <option value="ws">via Server (WebSocket)</option>
          <option value="p2p">via P2P (DataChannel)</option>
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" maxLength={2000} />
        <button type="submit" disabled={state.status !== 'connected'}>Send</button>
      </form>
    </div>
  );
}
