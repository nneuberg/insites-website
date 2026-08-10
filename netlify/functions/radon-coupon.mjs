const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export default async (request) => {
  if (request.method !== "POST") return json({ ok: false }, 405);

  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("COUPON_FROM_EMAIL") || "InSites Offers <offers@insites.services>";
  if (!apiKey) return json({ ok: false, error: "Email delivery is not configured" }, 503);

  let data;
  try { data = await request.json(); } catch { return json({ ok: false }, 400); }
  if (data.company) return json({ ok: true });

  const email = String(data.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ ok: false, error: "Enter a valid email" }, 400);
  }

  const html = `<!doctype html><html><body style="margin:0;background:#f3f0e8;font-family:Arial,sans-serif;color:#111"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#101010;border:1px solid #d8bd68;border-radius:20px;overflow:hidden"><tr><td style="padding:42px 34px;text-align:center"><img src="https://www.insites.services/insites-logo-tan.png" width="64" alt="InSites" style="display:block;margin:0 auto 18px"><div style="color:#d8bd68;font-size:12px;font-weight:bold;letter-spacing:3px;text-transform:uppercase">Your exclusive offer</div><h1 style="margin:14px 0 2px;color:#d8bd68;font-size:64px;line-height:1">$50 OFF</h1><h2 style="margin:8px 0 22px;color:#fff;font-size:34px;text-transform:uppercase">Radon testing</h2><p style="margin:0 auto 24px;max-width:440px;color:#d6d2c9;font-size:17px;line-height:1.6">Save $50 when you add radon testing to your complete home inspection.</p><div style="display:inline-block;border:1px dashed #d8bd68;border-radius:10px;padding:13px 20px;color:#d8bd68;font-size:23px;font-weight:bold;letter-spacing:1px">RADON50OFF</div><p style="margin:24px auto 0;max-width:460px;color:#8e8a82;font-size:12px;line-height:1.5">Mention this code when scheduling. Valid with a complete home inspection. One coupon per property. Cannot be combined with other offers.</p></td></tr></table></td></tr></table></body></html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      bcc: ["neal@insites.services"],
      subject: "Your $50 radon testing coupon from InSites",
      html,
      text: "Your InSites coupon code is RADON50OFF. Save $50 when radon testing is booked with a complete home inspection. One coupon per property; cannot be combined with other offers.",
      reply_to: "neal@insites.services",
    }),
  });

  if (!response.ok) return json({ ok: false, error: "Email delivery failed" }, 502);
  return json({ ok: true });
};
