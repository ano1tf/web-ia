import React, { useEffect, useRef, useState } from 'react';

/**
 * Viewer live : reçoit les frames JPEG du Chromium distant (screencast CDP) et
 * renvoie les clics/frappes. C'est ici que l'humain se connecte "pour de vrai",
 * sans que l'IA voie jamais le mot de passe.
 */
export default function Viewer({ token, site, onStatus }) {
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const [state, setState] = useState('connexion…');
  const [dims, setDims] = useState({ w: 1280, h: 800 });

  useEffect(() => {
    if (!site) return undefined;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/viewer?site=${encodeURIComponent(site)}&token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'frame') {
        if (imgRef.current) imgRef.current.src = `data:image/jpeg;base64,${msg.data}`;
        if (msg.w && msg.h) setDims({ w: msg.w, h: msg.h });
        setState('live');
      } else if (msg.type === 'ready') {
        setState('live');
        onStatus?.(`session ouverte — ${msg.url || site}`);
      } else if (msg.type === 'error') {
        setState(`erreur : ${msg.message}`);
        onStatus?.(msg.message);
      }
    };
    ws.onerror = () => setState('connexion impossible');
    ws.onclose = () => setState('déconnecté');
    return () => ws.close();
  }, [site, token]);

  const coords = (e) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * dims.w;
    const y = ((e.clientY - rect.top) / rect.height) * dims.h;
    return { x: Math.round(x), y: Math.round(y) };
  };

  const sendInput = (event) => wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify({ type: 'input', event }));

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <input
          className="viewer-url"
          placeholder="https://…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              wsRef.current?.send(JSON.stringify({ type: 'navigate', url: e.currentTarget.value }));
              e.currentTarget.value = '';
            }
          }}
        />
        <span className={`pill ${state === 'live' ? 'ok' : 'warn'}`}>{state}</span>
      </div>
      <div className="viewer-screen" tabIndex={0}>
        <img
          ref={imgRef}
          alt="écran du navigateur"
          onClick={(e) => {
            const c = coords(e);
            if (c) sendInput({ type: 'click', ...c });
          }}
          onMouseMove={(e) => {
            if (e.buttons) return; // pas de drag pour l'instant
          }}
          onWheel={(e) => {
            e.preventDefault();
            sendInput({ type: 'wheel', y: e.deltaY });
          }}
        />
        <canvas ref={canvasRef} hidden />
      </div>
      <div className="viewer-foot">
        <span className="muted">Cliquez dans l’écran pour agir. La saisie clavier va au champ sélectionné.</span>
        <input
          className="viewer-type"
          placeholder="Taper du texte puis Entrée…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              sendInput({ type: 'type', text: e.currentTarget.value });
              sendInput({ type: 'key', key: 'Enter' });
              e.currentTarget.value = '';
            } else if (e.key.length === 1) {
              sendInput({ type: 'type', text: e.key });
            }
          }}
        />
      </div>
    </div>
  );
}
