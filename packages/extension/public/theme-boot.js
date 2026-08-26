(function () {
  try {
    var pref = localStorage.getItem("cursor-sidebar/theme");
    if (pref !== "light" && pref !== "dark" && pref !== "system") pref = "dark";
    var resolved =
      pref === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : pref;
    document.documentElement.dataset.theme = resolved;
  } catch (e) {}
})();
