(() => {
  const triggerText = "schedule listing media";
  let modal;
  let opener;
  let previousOverflow = "";

  const services = [
    "Listing photography",
    "Aerial / drone photography",
    "Cinematic video",
    "Social media walkthrough video",
    "Immersive 3D tour",
    "Floor plan",
  ];

  function closeModal(updateHistory = true) {
    if (!modal) return;
    modal.remove();
    modal = null;
    document.body.style.overflow = previousOverflow;
    if (updateHistory && location.hash === "#media-request") history.back();
    opener?.focus();
  }

  function formMarkup() {
    return `<form class="media-form">
      <div class="form-field full"><label for="property-address">Property address</label><input id="property-address" name="property_address" type="text" autocomplete="street-address" required></div>
      <div class="form-field"><label for="realtor-name">Your name</label><input id="realtor-name" name="realtor_name" type="text" autocomplete="name" required></div>
      <div class="form-field"><label for="brokerage">Brokerage</label><input id="brokerage" name="brokerage" type="text" autocomplete="organization" required></div>
      <div class="form-field"><label for="media-email">Email</label><input id="media-email" name="email" type="email" autocomplete="email" required></div>
      <div class="form-field"><label for="media-phone">Phone</label><input id="media-phone" name="phone" type="tel" autocomplete="tel" required></div>
      <fieldset class="form-field full service-options"><legend>Services you’re interested in</legend><div>${services.map((service) => `<label><input type="checkbox" name="services" value="${service}"><span>${service}</span></label>`).join("")}</div></fieldset>
      <div class="form-field"><label for="preferred-date">Date you’re hoping for</label><input id="preferred-date" name="preferred_date" type="date"></div>
      <div class="form-field"><label for="date-flexibility">How flexible is the date?</label><select id="date-flexibility" name="date_flexibility"><option>That date is important</option><option selected>A few days</option><option>Very flexible</option></select></div>
      <div class="form-field full"><label for="media-notes">Anything else I should know?</label><textarea id="media-notes" name="notes" rows="4" placeholder="Square footage, occupancy, special features, timing details, or questions…"></textarea></div>
      <input class="form-honey" type="text" name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="form-submit full"><button class="button button-dark" type="submit">Request listing media</button><p class="media-form-status" role="status"></p></div>
    </form>`;
  }

  function openModal(pushHistory = true) {
    if (modal) return;
    previousOverflow = document.body.style.overflow;
    modal = document.createElement("div");
    modal.className = "media-modal-backdrop";
    modal.innerHTML = `<section class="media-request" id="media-request" role="dialog" aria-modal="true" aria-labelledby="media-request-title" tabindex="-1">
      <button class="media-modal-close" type="button" aria-label="Close listing media request">×</button>
      <div class="media-request-grid">
        <div class="media-request-intro"><p class="eyebrow">Listing media request</p><h2 id="media-request-title">Tell me about the property.</h2><p>Send the details you have, including the services you’re considering and the day you’re hoping for. I’ll follow up personally to confirm the nearest available date and time.</p><p class="media-contact-note">Need a quicker answer?<br><a href="tel:+13309909700">Call or text 330-990-9700</a></p></div>
        ${formMarkup()}
      </div>
    </section>`;
    document.body.appendChild(modal);
    document.body.style.overflow = "hidden";
    modal.querySelector(".media-modal-close").addEventListener("click", () => closeModal());
    modal.addEventListener("mousedown", (event) => { if (event.target === modal) closeModal(); });
    modal.querySelector("form").addEventListener("submit", submitForm);
    if (pushHistory && location.hash !== "#media-request") history.pushState({ listingMediaRequest: true }, "", "#media-request");
    requestAnimationFrame(() => modal.querySelector(".media-request").focus());
  }

  function bindTriggers() {
    document.querySelectorAll("[data-media-request-trigger], #listing-media-trigger").forEach((trigger) => {
      if (trigger.dataset.mediaRequestBound === "true") return;
      trigger.dataset.mediaRequestBound = "true";
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        opener = trigger;
        openModal();
      });
    });
  }

  async function submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("company_website")) return;
    const button = form.querySelector("button[type=submit]");
    const status = form.querySelector(".media-form-status");
    button.disabled = true;
    button.textContent = "Sending…";
    status.textContent = "";
    const payload = {
      _subject: `New listing media request — ${data.get("property_address")}`,
      _template: "table",
      name: data.get("realtor_name"), email: data.get("email"), phone: data.get("phone"), brokerage: data.get("brokerage"),
      property_address: data.get("property_address"), requested_services: data.getAll("services").join(", "),
      preferred_date: data.get("preferred_date") || "No specific date", date_flexibility: data.get("date_flexibility"), notes: data.get("notes") || "None provided",
    };
    try {
      const response = await fetch("https://formsubmit.co/ajax/neal@insites.services", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error();
      form.outerHTML = `<div class="media-success"><p class="eyebrow">Request received</p><h3>Thanks—I’ll be in touch.</h3><p>Your listing information has been sent to Neal. He’ll contact you directly to coordinate timing and confirm the services.</p></div>`;
    } catch {
      status.innerHTML = `The form couldn’t send. Please call or text <a href="tel:+13309909700">330-990-9700</a>.`;
      button.disabled = false;
      button.textContent = "Request listing media";
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target || !target.textContent.trim().toLowerCase().includes(triggerText)) return;
    event.preventDefault();
    opener = target;
    openModal();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
  addEventListener("popstate", () => location.hash === "#media-request" ? openModal(false) : closeModal(false));
  addEventListener("hashchange", () => location.hash === "#media-request" ? openModal(false) : closeModal(false));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindTriggers);
  else bindTriggers();
  addEventListener("load", bindTriggers);
  if (location.hash === "#media-request") openModal(false);
})();
