(function () {
  "use strict";

  if (!/^\/services\/social-walkthrough\/?$/.test(window.location.pathname)) return;

  function addExample() {
    const summary = document.querySelector(".service-summary-copy");
    if (!summary || summary.querySelector(".social-walkthrough-example")) return;

    const figure = document.createElement("figure");
    figure.className = "service-inline-example social-walkthrough-example";
    figure.innerHTML = `
      <video controls playsinline preload="metadata" poster="/examples/social-walkthrough-poster.jpg">
        <source src="/examples/social-walkthrough-example.mp4" type="video/mp4" />
        Your browser does not support embedded video.
      </video>
      <figcaption>Example social walkthrough</figcaption>`;
    summary.appendChild(figure);
  }

  addExample();
  window.addEventListener("load", addExample, { once: true });
})();
