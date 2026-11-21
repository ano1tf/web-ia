import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { makeApi, useToken } from './api.js';
import Viewer from './Viewer.jsx';

const LEVEL_LABEL = { readonly: 'lecture seule', confirm: 'validation requise', full: 'autonome' };

export default function App() {
  const [token, setToken] = useToken();
  const api = useMemo(() => makeApi(token), [token]);
  const [tab, setTab] = useState('sessions');
  const [health, setHealth] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [activity, setActivity] = useState([]);
  const [openUrl, setOpenUrl] = useState('https://');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [h, s, a, act] = await Promise.all([api.health(), api.sessions(), api.approvals(), api.activity()]);
      setHealth(h);
      setSessions(s.sessions || []);
      setApprovals(a.approvals || []);
      setActivity(act.activity || []);
      setNotice('');
    } catch (e) {
      setNotice(e.message);
    }
  }, [api]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const open = async (e) => {
    e?.preventDefault();
    setNotice('ouverture…');
    try {
      const out = await api.callTool('browse_open', { url: openUrl });
      if (out.handoff) {
        setNotice(`Connexion humaine requise sur ${out.site}. Ouvre le viewer et connecte-toi.`);
        const site = out.site;
        setSelected(site);
      } else {
        setSnapshot(out.snapshot || '');
        setSelected(out.site);
        setNotice(out.security_warning || `Page ouverte (${out.engine})`);
      }
      refresh();
    } catch (err) {
      setNotice(err.message);
    }
  };

  const decide = async (id, decision, remember = false) => {
    await api.decide(id, decision, remember);
    refresh();
  };

  const sessionSites = sessions.map((s) => s.site);
  const chosen = selected || sessionSites[0];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          <strong>web-ia</strong>
          <span className="muted">navigateur pour IA</span>
        </div>
        <div className="engine">
          {health ? (
            <span className={`pill ${health.engine.engine === 'chromium' ? 'ok' : 'warn'}`}>
              moteur : {health.engine.engine}
            </span>
          ) : (
            <span className="pill warn">hors ligne</span>
          )}
          <input
            className="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            title="Jeton d'API (WEBIA_TOKEN)"
          />
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <main className="grid">
        {/* Colonne gauche */}
        <section className="col">
          <form className="open-form" onSubmit={open}>
            <input value={openUrl} onChange={(e) => setOpenUrl(e.target.value)} placeholder="https://exemple.com" />
            <button type="submit">Ouvrir</button>
          </form>

          <div className="card">
            <div className="card-head">
              <h2>Sessions</h2>
              <span className="muted">{sessions.length}</span>
            </div>
            {sessions.length === 0 && <p className="muted">Aucune session. Ouvre une URL pour commencer.</p>}
            {sessions.map((s) => (
              <div key={s.site} className={`session ${chosen === s.site ? 'sel' : ''}`}>
                <button className="session-main" onClick={() => setSelected(s.site)}>
                  <span className="site">{s.site}</span>
                  <span className="muted small">{s.url || 'aucune page'}</span>
                </button>
                <select
                  value={s.policy?.level || 'confirm'}
                  onChange={async (e) => {
                    await api.setPolicy(s.site, e.target.value);
                    refresh();
                  }}
                  title="Politique du site"
                >
                  {Object.entries(LEVEL_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <button
                  className="ghost"
                  title="Fermer la session"
                  onClick={async () => {
                    await api.closeSession(s.site);
                    refresh();
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Validations</h2>
              <span className="muted">{approvals.length}</span>
            </div>
            {approvals.length === 0 && <p className="muted">Rien en attente.</p>}
            {approvals.map((a) => (
              <div key={a.id} className="approval">
                <div>
                  <strong>{a.summary}</strong>
                  <div className="muted small">{a.site}</div>
                </div>
                <div className="row">
                  <button onClick={() => decide(a.id, 'approve')}>Autoriser</button>
                  <button className="ghost" onClick={() => decide(a.id, 'deny')}>
                    Refuser
                  </button>
                  <button className="ghost" onClick={() => decide(a.id, 'approve', true)} title="Ne plus demander pour ce site">
                    Toujours
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Colonne centre : viewer */}
        <section className="col wide">
          {chosen ? (
            <>
              <Viewer token={token} site={chosen} onStatus={(m) => setNotice(m)} />
              <div className="row">
                <button
                  onClick={async () => {
                    await api.loginDone(chosen);
                    setNotice(`Connexion confirmée pour ${chosen}`);
                  }}
                >
                  J’ai terminé de me connecter
                </button>
                <button
                  className="ghost"
                  onClick={async () => {
                    try {
                      const out = await api.callTool('browse_snapshot', { site: chosen });
                      setSnapshot(out.snapshot || '');
                    } catch (e) {
                      setNotice(e.message);
                    }
                  }}
                >
                  Voir ce que l’IA lit
                </button>
              </div>
              {snapshot && <pre className="snapshot">{snapshot.slice(0, 6000)}</pre>}
            </>
          ) : (
            <div className="empty">
              <h2>Aucune session ouverte</h2>
              <p className="muted">
                Ouvre un site à gauche, connecte-toi dans le viewer, puis branche ton agent (MCP) : il agira dans cette
                même session.
              </p>
            </div>
          )}
        </section>

        {/* Colonne droite : activité */}
        <section className="col">
          <div className="card tall">
            <div className="card-head">
              <h2>Activité de l’IA</h2>
              <span className="muted">{activity.length}</span>
            </div>
            <div className="feed">
              {activity
                .slice()
                .reverse()
                .map((a) => (
                  <div key={a.id} className={`entry ${a.level || 'info'}`}>
                    <span className="time">{a.at?.slice(11, 19)}</span>
                    <span className="etype">{a.type}</span>
                    <span className="emsg">{a.message}</span>
                  </div>
                ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
