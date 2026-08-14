(function () {
  "use strict";

  function arrangeServicePage() {
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
  }

  arrangeServicePage();
  window.addEventListener("load", arrangeServicePage, { once: true });
})();
