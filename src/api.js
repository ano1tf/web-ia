import { useEffect, useState } from 'react';

const TOKEN_KEY = 'webia.token';

export function useToken() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || 'dev-token');
  useEffect(() => localStorage.setItem(TOKEN_KEY, token), [token]);
  return [token, setToken];
}

export function makeApi(token) {
  const headers = () => ({ 'content-type': 'application/json', 'x-webia-token': token });

  const req = async (path, options = {}) => {
    const res = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  };

  return {
    health: () => req('/api/health'),
    sessions: () => req('/api/sessions'),
    closeSession: (site) => req(`/api/sessions/${encodeURIComponent(site)}/close`, { method: 'POST' }),
    loginDone: (site) => req(`/api/sessions/${encodeURIComponent(site)}/login-done`, { method: 'POST' }),
    policies: () => req('/api/policies'),
    setPolicy: (site, level) =>
      req(`/api/policies/${encodeURIComponent(site)}`, { method: 'PUT', body: JSON.stringify({ level }) }),
    approvals: () => req('/api/approvals'),
    decide: (id, decision, remember) =>
      req(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision, remember }) }),
    activity: (limit = 80) => req(`/api/activity?limit=${limit}`),
    tools: () => req('/api/tools'),
    callTool: (name, args) => req(`/api/tools/${name}`, { method: 'POST', body: JSON.stringify(args) }),
  };
}

/** Flux SSE d'activité. */
export function useActivity(token, onEntry) {
  useEffect(() => {
    if (!token) return undefined;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    es.addEventListener('activity', (e) => {
      try {
        onEntry(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [token]);
}
