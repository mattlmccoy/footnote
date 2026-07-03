// One-click "Connect GitHub" via GitHub App device flow, proxied through the CORS relay
// (GitHub's device endpoints don't send CORS headers, so a static site can't call them directly).
// Device flow uses only the PUBLIC client_id — no client secret — so the relay stores nothing.
//
// TO ENABLE: after provisioning (register the GitHub App + deploy relay/worker.js), fill these two
// constants. While either is blank, isConfigured() is false and the UI keeps the manual-token path.
export const CLIENT_ID = '';   // GitHub App client id (public; safe to embed), e.g. 'Iv23li...'
export const RELAY_URL = '';   // deployed Worker URL, e.g. 'https://diss-relay.example.workers.dev'

export const isConfigured = () => !!(CLIENT_ID && RELAY_URL);

async function post(path, params){
  const r = await fetch(RELAY_URL.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  if (!r.ok) throw new Error('relay ' + r.status);
  return r.json();
}

// Begin device flow. Returns { user_code, verification_uri, device_code, interval, expires_in }.
export async function startDeviceLogin(){
  return post('/device/code', { client_id: CLIENT_ID, scope: '' });
}

// Pure: map a token-poll response to a state. Unit-tested — the polling loop is thin around this.
export function classifyPoll(j){
  if (j && j.access_token) return { state: 'ok', token: j.access_token };
  switch (j && j.error){
    case 'authorization_pending': return { state: 'pending' };
    case 'slow_down':             return { state: 'slow', interval: j.interval };
    case 'expired_token':         return { state: 'expired' };
    case 'access_denied':         return { state: 'denied' };
    default:                      return { state: 'error', error: (j && j.error) || 'unknown' };
  }
}

// Poll the relay until the user authorizes (or it expires). onState(state) drives UI updates.
// Returns the access token, or throws with a terminal reason ('expired' | 'denied' | 'device flow: …').
export async function pollForToken(device_code, intervalSec, onState){
  let wait = Math.max(5, intervalSec || 5) * 1000;
  const deadline = Date.now() + 15 * 60 * 1000;   // device codes live ~15 min
  while (Date.now() < deadline){
    await new Promise(r => setTimeout(r, wait));
    const j = await post('/device/token', {
      client_id: CLIENT_ID, device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const s = classifyPoll(j);
    if (onState) onState(s);
    if (s.state === 'ok') return s.token;
    if (s.state === 'slow'){ wait += 5000; continue; }           // back off per GitHub's request
    if (s.state === 'expired' || s.state === 'denied') throw new Error(s.state);
    if (s.state === 'error') throw new Error('device flow: ' + s.error);
    // 'pending' → keep polling
  }
  throw new Error('expired');
}
