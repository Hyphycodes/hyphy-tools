// The local stack's stand-in for Supabase's API gateway (supabase/local/docker-compose.yml):
// /auth/v1 → Supabase Auth, /storage/v1 → Supabase Storage, CORS for the browser, and the
// publishable key swapped for the anon JWT the services understand — what the hosted gateway does
// with `sb_publishable_…` keys. Also serves the token-hash email templates docs/AUTH.md sets.
// Development only.
import http from 'node:http';

const { PUBLISHABLE_KEY, ANON_KEY, SITE_URL } = process.env;
const upstreams = { '/auth/v1': 'http://auth:9999', '/storage/v1': 'http://storage:5000' };

// The app asks for `…/auth/confirm?next=…` as the redirect; the link adds the token hash to it, so
// someone who signed up from an invitation comes back to that invitation.
const link = (type) =>
  `<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=${type}">Continue</a></p>`;
const templates = {
  '/templates/confirmation.html': `<h2>Confirm your email</h2>${link('email')}`,
  '/templates/recovery.html': `<h2>Reset your password</h2>${link('recovery')}`,
};

function cors(req, res) {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.setHeader(
    'access-control-allow-headers',
    req.headers['access-control-request-headers'] ?? 'authorization,apikey,content-type,x-upsert',
  );
  res.setHeader('access-control-expose-headers', 'content-length,content-range,etag');
}

http
  .createServer((req, res) => {
    const path = req.url ?? '/';
    if (templates[path]) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(templates[path]);
    }
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const prefix = Object.keys(upstreams).find((item) => path.startsWith(item));
    if (!prefix) return res.writeHead(404).end('Not found');

    const headers = { ...req.headers };
    delete headers.host;
    const bearer = headers.authorization?.replace(/^Bearer\s+/i, '');
    if (headers.apikey === PUBLISHABLE_KEY) headers.apikey = ANON_KEY;
    if (!bearer || bearer === PUBLISHABLE_KEY) headers.authorization = `Bearer ${ANON_KEY}`;
    headers['x-forwarded-prefix'] = prefix;
    headers['x-forwarded-host'] = req.headers.host ?? 'localhost:54421';
    headers['x-forwarded-proto'] = 'http';

    const target = new URL(path.slice(prefix.length) || '/', upstreams[prefix]);
    const proxied = http.request(target, { method: req.method, headers }, (upstream) => {
      const out = { ...upstream.headers };
      for (const key of Object.keys(out)) if (key.startsWith('access-control-')) delete out[key];
      res.writeHead(upstream.statusCode ?? 502, out);
      upstream.pipe(res);
    });
    proxied.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Upstream unavailable');
    });
    req.pipe(proxied);
  })
  .listen(8000, () => console.log(`gateway on :8000 for ${SITE_URL}`));
