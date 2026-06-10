import postgres from "postgres";

const COMPONENTS = [
  { name: "API", url: "https://api.korve.dev/v1/health" },
  { name: "Dashboard", url: "https://korve.dev/" },
  { name: "Agent gateway", url: "https://mcp.korve.dev/" },
];

async function checkAll() {
  return Promise.all(
    COMPONENTS.map(async ({ name, url }) => {
      const startedAt = Date.now();
      try {
        const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
        return { name, ok: response.status < 500, ms: Date.now() - startedAt };
      } catch {
        return { name, ok: false, ms: Date.now() - startedAt };
      }
    }),
  );
}

async function record(env, results) {
  if (!env.DATABASE_URL) return [];
  const sql = postgres(env.DATABASE_URL, { max: 1, ssl: "require" });
  try {
    await sql`CREATE TABLE IF NOT EXISTS checks (
      id serial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      component text NOT NULL,
      ok boolean NOT NULL,
      ms integer NOT NULL
    )`;
    for (const result of results) {
      await sql`INSERT INTO checks (component, ok, ms) VALUES (${result.name}, ${result.ok}, ${result.ms})`;
    }
    return await sql`SELECT at, component, ok, ms FROM checks ORDER BY at DESC LIMIT 30`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function render(results, history) {
  const allOk = results.every((r) => r.ok);
  const rows = history
    .map(
      (row) =>
        `<tr><td>${new Date(row.at).toISOString().slice(0, 19)}Z</td><td>${row.component}</td>` +
        `<td class="${row.ok ? "ok" : "down"}">${row.ok ? "operational" : "down"}</td><td>${row.ms}ms</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><title>Korve status</title><style>
    body{font-family:ui-monospace,monospace;background:#000;color:#eee;max-width:720px;margin:48px auto;padding:0 16px}
    h1{font-size:20px} .badge{padding:4px 10px;border-radius:6px;font-size:13px}
    .up{background:#052e16;color:#4ade80}.bad{background:#450a0a;color:#f87171}
    table{width:100%;border-collapse:collapse;margin-top:24px;font-size:13px}
    td,th{padding:6px 8px;border-bottom:1px solid #222;text-align:left}
    .ok{color:#4ade80}.down{color:#f87171}.cur{display:flex;gap:12px;margin:20px 0}
    .cur div{border:1px solid #222;border-radius:8px;padding:12px 16px;flex:1}
  </style></head><body>
  <h1>Korve status <span class="badge ${allOk ? "up" : "bad"}">${allOk ? "all systems operational" : "degraded"}</span></h1>
  <p>This page is itself a Korve app — deployed, stored, and metered on the platform it watches.</p>
  <div class="cur">${results.map((r) => `<div><strong>${r.name}</strong><br><span class="${r.ok ? "ok" : "down"}">${r.ok ? "operational" : "down"}</span> · ${r.ms}ms</div>`).join("")}</div>
  <table><tr><th>checked</th><th>component</th><th>state</th><th>latency</th></tr>${rows}</table>
  </body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    const results = await checkAll();
    let history = [];
    try {
      history = await record(env, results);
    } catch (error) {
      console.log(`history unavailable: ${error.message}`);
    }
    console.log(`status check: ${results.filter((r) => r.ok).length}/${results.length} ok`);
    return new Response(render(results, history), { headers: { "content-type": "text/html" } });
  },
};
