// healthchecks.io dead-man pings for the cron handlers: each successful cron run
// pings its check URL; if a cron silently stops completing (schedule broken, env
// missing, handler crashing), the missed pings trigger an email alert — the
// failure mode nothing else surfaces.
//
// Ping URLs live in env vars (HC_PING_TRENDING / _NEWS / _EMBED / _PREGENERATE),
// NEVER in code — the repo is public and anyone holding a ping URL could fake
// "healthy" signals. Unset env → helper is a no-op (safe in dev/preview).

async function pingHealthcheck(envKey) {
  const url = process.env[envKey];
  if (!url) return;
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
  } catch (_) { /* a failed ping must never fail the cron itself */ }
}

// Wrap a cron handler: after it responds, ping on real success — a 200 whose
// body is { ok: true } and not a skipped no-op (skipped runs would otherwise
// mask a dead pipeline as healthy). Awaited before the wrapper resolves so the
// serverless runtime doesn't freeze the function before the ping lands.
function withHealthcheck(envKey, handler) {
  return async (req, res) => {
    let body;
    const origJson = res.json && res.json.bind(res);
    if (origJson) res.json = (b) => { body = b; return origJson(b); };
    await handler(req, res);
    if (res.statusCode === 200 && body && body.ok && !body.skipped) {
      await pingHealthcheck(envKey);
    }
  };
}

module.exports = { pingHealthcheck, withHealthcheck };
