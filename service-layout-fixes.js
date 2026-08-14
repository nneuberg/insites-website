(function () {
  "use strict";

  function arrangeServicePage() {
    if (/^\/services\/wdi\/?$/.test(window.location.pathname)) {
      document.body.classList.add("service-wdi");
      const title = document.querySelector(".service-detail-grid h1");
      if (title && !title.querySelector("br")) {
        title.replaceChildren("Wood-Destroying", document.createElement("br"), "Insect Inspection");
      }
    }

    const section = document.querySelector(".service-why");
    if (!section) return;

    const titleColumn = section.firstElementChild;
    const bodyColumn = section.querySelector(".service-summary-copy");
    if (!titleColumn || !bodyColumn) return;

    const label = titleColumn.querySelector(":scope > .eyebrow");
    if (label && label.textContent.toLowerCase().includes("what it is")) {
      bodyColumn.prepend(label);
    }

    if (/^\/services\/social-walkthrough\/?$/.test(window.location.pathname)) {
      const walkthrough = bodyColumn.querySelector(".social-walkthrough-example");
      if (walkthrough) titleColumn.appendChild(walkthrough);
    }

    if (/^\/services\/360-video\/?$/.test(window.location.pathname)) {
      const preview = bodyColumn.querySelector(".service-video-preview");
      if (preview) titleColumn.appendChild(preview);
    }

    if (/^\/services\/floor-plans\/?$/.test(window.location.pathname)) {
      let example = section.querySelector(".floor-plan-example");
      if (!example) {
        example = document.createElement("figure");
        example.className = "service-inline-example floor-plan-example";
        example.innerHTML = `
          <img src="/examples/digital-floor-plan-example.jpg" alt="Example digital floor plan with room labels and approximate dimensions" />
          <figcaption>Example digital floor plan</figcaption>`;
      }
      titleColumn.appendChild(example);
    }
  }

  arrangeServicePage();
  window.addEventListener("load", arrangeServicePage, { once: true });
})();
