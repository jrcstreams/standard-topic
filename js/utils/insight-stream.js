// Streaming client for /api/insight (revamp962).
//
// A cached brief comes back in ~160ms, but a MISS costs a live grounded Gemini
// call — about ten seconds — and the user spent all of it staring at a spinner.
// This asks the endpoint for Server-Sent Events instead: answer text arrives as
// the model writes it, so the brief starts painting in a second or two.
//
// The resolved value is the SAME object the plain JSON endpoint returns
// ({ content, summary, sources, headlines, cached, … }), so a call site can be
// converted by swapping the fetch and adding an onToken renderer — nothing
// downstream of the await needs to change.
//
// The timeout guards the CONNECTION and any subsequent stall between frames,
// not total duration: a long generation that keeps producing tokens is healthy
// and must not be aborted mid-answer.

const DEFAULT_STALL_MS = 45000;

export function streamInsight(payload, opts = {}) {
  const { onToken, onReset, stallMs = DEFAULT_STALL_MS, signal } = opts;

  return new Promise((resolve, reject) => {
    const ctl = new AbortController();
    let timer = null;
    let settled = false;

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!settled) { settled = true; ctl.abort(); reject(new Error('insight stream stalled')); } }, stallMs);
    };
    const disarm = () => { if (timer) clearTimeout(timer); timer = null; };
    const fail = (err) => { if (settled) return; settled = true; disarm(); reject(err); };
    const ok = (v) => { if (settled) return; settled = true; disarm(); resolve(v); };

    if (signal) {
      if (signal.aborted) return fail(new Error('aborted'));
      signal.addEventListener('abort', () => { ctl.abort(); fail(new Error('aborted')); }, { once: true });
    }

    arm();

    fetch('/api/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ ...payload, stream: 1 }),
      signal: ctl.signal,
    }).then(async (res) => {
      if (!res.ok) throw new Error(`insight ${res.status}`);
      if (!res.body) throw new Error('no stream body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();                       // progress — push the stall deadline out
        buf += decoder.decode(value, { stream: true });

        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          let event = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed; try { parsed = JSON.parse(data); } catch (_) { continue; }

          if (event === 'token') {
            if (onToken && parsed && typeof parsed.t === 'string') {
              try { onToken(parsed.t); } catch (_) { /* a render fault must not kill the stream */ }
            }
          } else if (event === 'reset') {
            // The grounded attempt came back empty and an ungrounded retry is
            // starting — throw away whatever has been painted so far.
            if (onReset) { try { onReset(); } catch (_) {} }
          } else if (event === 'done') {
            ok(parsed);
            return;
          } else if (event === 'error') {
            throw new Error((parsed && parsed.error) || 'insight error');
          }
        }
      }
      // Stream ended without a `done` frame — treat as failure so the caller
      // can fall back rather than render a half-written brief as final.
      throw new Error('insight stream ended early');
    }).catch(fail);
  });
}
