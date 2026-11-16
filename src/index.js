import { EmailMessage } from "cloudflare:email";

const EMPFAENGER = "danlia@gmx.ch";
const ABSENDER = "formular@herzog-grafik.ch";
const MAX_DATEI = 5 * 1024 * 1024;
const ERLAUBT = ["eps", "ai", "cdr", "pdf"];

const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/.{76}/g, "$&\r\n");
};
const utf8b64 = (t) => b64(new TextEncoder().encode(t)).replace(/\r\n/g, "");
const kopf = (t) => `=?UTF-8?B?${utf8b64(t)}?=`;
const clean = (v, max = 200) => String(v || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function antwort(req, ok, status = 200) {
  if ((req.headers.get("Accept") || "").includes("application/json")) {
    return Response.json({ ok }, { status });
  }
  return Response.redirect(new URL(ok ? "/kontakt/?gesendet=1" : "/kontakt/?fehler=1", req.url).toString(), 303);
}

async function kontakt(req, env) {
  let f;
  try { f = await req.formData(); } catch { return antwort(req, false, 400); }
  if (clean(f.get("_honey"))) return antwort(req, true);

  const name = clean(f.get("Name"), 100);
  const firma = clean(f.get("Firma"), 100);
  const tel = clean(f.get("Telefon"), 50);
  const mail = clean(f.get("email"), 120);
  const betreff = clean(f.get("Betreff"), 150);
  const text = String(f.get("Nachricht") || "").trim().slice(0, 5000);
  if (!name || !tel || !text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return antwort(req, false, 400);

  const zeilen = [
    ["Name", name], ["Firma", firma || "–"], ["Telefon", tel], ["E-Mail", mail], ["Betreff", betreff || "–"],
  ];
  const plain = zeilen.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nNachricht:\n${text}\n`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<h2 style="color:#ed1c24;margin:0 0 15px">Neue Anfrage über herzog-grafik.ch</h2>
<table cellpadding="6" style="border-collapse:collapse">${zeilen.map(([k, v]) =>
    `<tr><td style="font-weight:bold;border-bottom:1px solid #eee">${k}</td><td style="border-bottom:1px solid #eee">${esc(v)}</td></tr>`).join("")}</table>
<p style="font-weight:bold;margin:20px 0 5px">Nachricht:</p>
<p style="white-space:pre-wrap;margin:0">${esc(text)}</p></div>`;

  const datei = f.get("Datei");
  let anhang = "";
  if (datei && typeof datei === "object" && datei.size > 0) {
    const endung = (datei.name.split(".").pop() || "").toLowerCase();
    if (datei.size > MAX_DATEI || !ERLAUBT.includes(endung)) return antwort(req, false, 400);
    const dname = clean(datei.name, 100).replace(/"/g, "");
    anhang = `--MIX\r\nContent-Type: application/octet-stream; name="${kopf(dname)}"\r\n` +
      `Content-Disposition: attachment; filename="${kopf(dname)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      b64(new Uint8Array(await datei.arrayBuffer())) + "\r\n";
  }

  const raw =
    `From: ${kopf("Herzog Webseite")} <${ABSENDER}>\r\n` +
    `To: <${EMPFAENGER}>\r\n` +
    `Reply-To: ${kopf(name)} <${mail}>\r\n` +
    `Subject: ${kopf("Neue Anfrage: " + (betreff || name))}\r\n` +
    `Date: ${new Date().toUTCString()}\r\n` +
    `Message-ID: <${crypto.randomUUID()}@herzog-grafik.ch>\r\n` +
    `MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="MIX"\r\n\r\n` +
    `--MIX\r\nContent-Type: multipart/alternative; boundary="ALT"\r\n\r\n` +
    `--ALT\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(new TextEncoder().encode(plain))}\r\n` +
    `--ALT\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(new TextEncoder().encode(html))}\r\n` +
    `--ALT--\r\n` + anhang + `--MIX--\r\n`;

  try {
    await env.KONTAKT.send(new EmailMessage(ABSENDER, EMPFAENGER, raw));
    return antwort(req, true);
  } catch (e) {
    console.log("Mailfehler:", e && e.message);
    return antwort(req, false, 500);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/kontakt") {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      return kontakt(req, env);
    }
    return env.ASSETS.fetch(req);
  },
};
