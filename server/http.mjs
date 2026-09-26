/**
 * Kurze HTTP-Helfer für den eingebauten ShortsFactory-Server.
 * Macht Node's `res` mit den `res.status().json()`-Gewohnheiten der alten
 * Vercel-Functions kompatibel — die Handler bleiben dadurch fast identisch.
 */

/** `res.status(code).json(payload)` Shim + JSON-Content-Type. */
export function wrapRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

/** Liest den Request-Body komplett ein (mit Größen-Bremse). */
export function readBody(req, maxBytes = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += buf.length;
      if (size > maxBytes) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Query-Parameter als plain object (aus `req.url`). */
export function parseQuery(url) {
  try {
    const q = new URL(url, "http://internal").searchParams;
    const out = {};
    for (const [key, value] of q) out[key] = value;
    return out;
  } catch {
    return {};
  }
}

/** JSON-Body sicher parsen (String oder Object). */
export function safeParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

/**
 * Liest eine einfache `.env`-Datei im Projektroot (KEY=VALUE pro Zeile).
 * Überschreibt niemals, was schon in `process.env` steht.
 */
export function loadDotEnv(rootDir, { readFileSync, join }) {
  const apply = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  };
  for (const name of [".env", ".env.local"]) {
    try {
      const text = readFileSync(join(rootDir, name), "utf8");
      for (const line of text.split(/\r?\n/)) apply(line);
    } catch {
      /* Datei fehlt — okay */
    }
  }
}
