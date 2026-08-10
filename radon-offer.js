(function () {
  "use strict";

  const SESSION_KEY = "insites-radon-offer-seen";
  if (sessionStorage.getItem(SESSION_KEY)) return;

  const style = document.createElement("style");
  style.textContent = `
    .radon-offer-backdrop{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:rgba(8,8,8,.74);backdrop-filter:blur(8px);opacity:0;transition:opacity .25s ease}
    .radon-offer-backdrop.is-open{opacity:1}
    .radon-offer{position:relative;width:min(560px,100%);max-height:calc(100vh - 40px);overflow:auto;border:1px solid #d8bd68;border-radius:24px;background:#101010;color:#fff;box-shadow:0 30px 90px rgba(0,0,0,.55);font-family:var(--font-body),Arial,sans-serif}
    .radon-offer:before{content:"";position:absolute;inset:10px;border:1px solid rgba(216,189,104,.42);border-radius:17px;pointer-events:none}
    .radon-offer-inner{position:relative;padding:42px 44px 38px;text-align:center}
    .radon-offer-mark{width:58px;height:58px;object-fit:contain;margin:0 auto 15px}
    .radon-offer-kicker{margin:0 0 8px;color:#d8bd68;font-size:12px;font-weight:800;letter-spacing:.2em;text-transform:uppercase}
    .radon-offer-amount{margin:0;color:#d8bd68;font-family:var(--font-display),Arial,sans-serif;font-size:clamp(62px,14vw,96px);font-weight:750;line-height:.92;letter-spacing:-.065em}
    .radon-offer-title{margin:9px 0 10px;font-family:var(--font-display),Arial,sans-serif;font-size:clamp(28px,7vw,43px);font-weight:750;line-height:1;text-transform:uppercase}
    .radon-offer-copy{max-width:430px;margin:0 auto 24px;color:#d3d0c9;font-size:16px;line-height:1.55}
    .radon-offer-copy strong{color:#fff}
    .radon-offer-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 auto;max-width:460px;text-align:left}
    .radon-offer-form input{min-width:0;border:1px solid #514c42;border-radius:12px;background:#1a1a1a;color:#fff;padding:15px 16px;font:inherit;outline:none}
    .radon-offer-form input:focus{border-color:#d8bd68;box-shadow:0 0 0 3px rgba(216,189,104,.15)}
    .radon-offer-form input[type=email],.radon-offer-form button{grid-column:1/-1}
    .radon-offer-form button{border:0;border-radius:12px;background:#d8bd68;color:#101010;padding:15px 19px;font:inherit;font-weight:800;cursor:pointer}
    .radon-offer-form button:disabled{cursor:wait;opacity:.7}
    .radon-offer-hp{position:absolute!important;left:-10000px!important}
    .radon-offer-status{grid-column:1/-1;min-height:20px;margin:1px 3px 0;color:#e9dec0;font-size:13px;line-height:1.4;text-align:center}
    .radon-offer-fine{margin:17px auto 0;max-width:450px;color:#8e8a82;font-size:11px;line-height:1.45}
    .radon-offer-close{position:absolute;right:15px;top:15px;z-index:2;width:38px;height:38px;border:1px solid #45423c;border-radius:50%;background:#171717;color:#fff;font-size:23px;line-height:1;cursor:pointer}
    .radon-offer-success{padding:14px 0 2px}
    @media(max-width:580px){.radon-offer-inner{padding:38px 24px 30px}.radon-offer-form{grid-template-columns:1fr}.radon-offer-form button{width:100%}.radon-offer-status{grid-column:1}.radon-offer-copy{font-size:15px}}
    @media(prefers-reduced-motion:reduce){.radon-offer-backdrop{transition:none}}
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.className = "radon-offer-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "radon-offer-title");
  backdrop.innerHTML = `
    <section class="radon-offer">
      <button class="radon-offer-close" type="button" aria-label="Close offer">×</button>
      <div class="radon-offer-inner">
        <img class="radon-offer-mark" src="/insites-logo-tan.png" alt="" />
        <p class="radon-offer-kicker">Exclusive offer</p>
        <p class="radon-offer-amount">$50 OFF</p>
        <h2 class="radon-offer-title" id="radon-offer-title">Radon testing</h2>
        <p class="radon-offer-copy">Add radon testing to your <strong>complete home inspection</strong> and save $50. Enter your email and we’ll send your coupon immediately.</p>
        <form class="radon-offer-form">
          <label class="radon-offer-hp">Company<input name="company" tabindex="-1" autocomplete="off" /></label>
          <input type="text" name="firstName" placeholder="First name" aria-label="First name" autocomplete="given-name" required />
          <input type="text" name="lastName" placeholder="Last name" aria-label="Last name" autocomplete="family-name" required />
          <input type="email" name="email" placeholder="Your email address" aria-label="Your email address" autocomplete="email" required />
          <button type="submit">Send my coupon</button>
          <p class="radon-offer-status" role="status" aria-live="polite"></p>
        </form>
        <p class="radon-offer-fine">Valid when radon testing is booked with a complete home inspection. One coupon per property. Cannot be combined with other offers.</p>
      </div>
    </section>`;

  function closeOffer() {
    sessionStorage.setItem(SESSION_KEY, "1");
    backdrop.classList.remove("is-open");
    setTimeout(() => backdrop.remove(), 250);
  }

  backdrop.querySelector(".radon-offer-close").addEventListener("click", closeOffer);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeOffer(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && backdrop.isConnected) closeOffer(); });

  const form = backdrop.querySelector("form");
  const status = backdrop.querySelector(".radon-offer-status");
  const submit = form.querySelector("button");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Sending your coupon…";
    const data = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/.netlify/functions/radon-coupon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Unable to send coupon");
      sessionStorage.setItem(SESSION_KEY, "1");
      backdrop.querySelector(".radon-offer-inner").innerHTML = `
        <img class="radon-offer-mark" src="/insites-logo-tan.png" alt="" />
        <p class="radon-offer-kicker">Check your inbox</p>
        <h2 class="radon-offer-title">Your coupon is on its way.</h2>
        <p class="radon-offer-copy">Check your email for the offer details and scheduling code.</p>`;
    } catch {
      status.textContent = "We couldn’t send that just yet. Please try again or call 330-990-9700.";
      submit.disabled = false;
    }
  });

  setTimeout(() => {
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("is-open"));
    setTimeout(() => backdrop.querySelector("input[type=email]")?.focus(), 300);
  }, 1100);
})();
