// Decides the colour scheme before anything is drawn.

(function () {
  {
    var palette = "facet";
    var mode =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    try {
      var stored = JSON.parse(localStorage.getItem("facet.atlas.theme") || "null");
      var known = stored && (stored.theme === "facet" || stored.theme === "paper");
      var plugin =
        stored &&
        typeof stored.theme === "string" &&
        /^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$/.test(stored.theme);
      if ((known || plugin) && (stored.mode === "dark" || stored.mode === "light")) {
        if (known) palette = stored.theme;
        // A palette that follows the system keeps the system's mode from above.
        if (stored.system !== true) mode = stored.mode;
      }
    } catch {
      /** Without storage the default stands. */
    }
    document.documentElement.setAttribute("data-t-theme", palette);
    document.documentElement.setAttribute("data-t-mode", mode);
  }
})();
