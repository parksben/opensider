(function () {
  try {
    var pref = localStorage.getItem("opensider/theme");
    if (pref !== "light" && pref !== "dark" && pref !== "system") pref = "dark";
    var resolved =
      pref === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : pref;
    document.documentElement.dataset.theme = resolved;
    var locale = localStorage.getItem("opensider/locale");
    if (locale === "zh" || locale === "en") {
      document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    }
  } catch (e) {}
})();
