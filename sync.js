import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_ITEMS = 5000;

let ready;
function init() {
  if (!ready) {
    ready = sql`
      CREATE TABLE IF NOT EXISTS flixora_sync (
        code        TEXT PRIMARY KEY,
        downloads   JSONB NOT NULL DEFAULT '[]',
        watchlist   JSONB NOT NULL DEFAULT '[]',
        updated_at  BIGINT NOT NULL DEFAULT 0
      )`;
  }
  return ready;
}

const clean = (a) =>
  Array.isArray(a)
    ? a
        .slice(0, MAX_ITEMS)
        .filter((x) => x && (x.type === "movie" || x.type === "tv") && /^\d+$/.test(String(x.id)))
        .map((x) => ({ id: String(x.id), type: x.type }))
    : [];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const code = String(req.query.code || "");
  if (!CODE_RE.test(code)) return res.status(400).json({ error: "bad code" });

  try {
    await init();

    if (req.method === "GET") {
      const rows = await sql`SELECT downloads, watchlist, updated_at FROM flixora_sync WHERE code = ${code}`;
      if (!rows.length) return res.status(200).json({ downloads: [], watchlist: [], updated_at: 0 });
      const r = rows[0];
      return res.status(200).json({
        downloads: r.downloads,
        watchlist: r.watchlist,
        updated_at: Number(r.updated_at),
      });
    }

    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const downloads = clean(body.downloads);
      const watchlist = clean(body.watchlist);
      const ts = Number(body.updated_at) || Date.now();
      // last-write-wins: only overwrite if the incoming data is newer
      await sql`
        INSERT INTO flixora_sync (code, downloads, watchlist, updated_at)
        VALUES (${code}, ${JSON.stringify(downloads)}::jsonb, ${JSON.stringify(watchlist)}::jsonb, ${ts})
        ON CONFLICT (code) DO UPDATE
          SET downloads = EXCLUDED.downloads,
              watchlist = EXCLUDED.watchlist,
              updated_at = EXCLUDED.updated_at
          WHERE flixora_sync.updated_at < EXCLUDED.updated_at`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
}
