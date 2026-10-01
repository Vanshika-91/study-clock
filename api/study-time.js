import { db, auth } from 'hatchable';

// GET  -> returns this user's sessions (client works out today/week stats in local time)
// POST -> saves one session {seconds, at} or a batch {sessions:[{seconds, at}]}
export const access = 'public';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  const user = await auth.getUser(req);
  if (!user) {
    return res.status(req.method === 'POST' ? 401 : 200).json({ signedIn: false });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const list = Array.isArray(body.sessions) ? body.sessions : [body];
    const now = Date.now();
    const clean = list
      .slice(0, 200)
      .map(s => ({ seconds: Math.floor(Number(s.seconds)), at: Number(s.at) || now }))
      .filter(s => s.seconds > 0 && s.seconds <= 86400 && s.at <= now + 60000);
    if (!clean.length) return res.status(400).json({ error: 'Invalid study duration.' });

    for (const s of clean) {
      await db.query(
        "INSERT INTO study_sessions (user_id, duration_seconds, created_at) VALUES ($1, $2, to_timestamp($3 / 1000.0) AT TIME ZONE 'UTC')",
        [user.id, s.seconds, s.at]
      );
    }
    return res.status(201).json({ ok: true, saved: clean.length });
  }

  // created_at is stored as UTC, so epoch maths here is timezone-safe
  const { rows } = await db.query(
    "SELECT duration_seconds AS seconds, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS at FROM study_sessions WHERE user_id = $1 AND created_at > now() - INTERVAL '400 days' ORDER BY created_at DESC LIMIT 5000",
    [user.id]
  );
  return res.json({
    signedIn: true,
    sessions: rows.map(r => ({ seconds: Number(r.seconds), at: Number(r.at) }))
  });
}
