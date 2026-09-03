(function () {
  try {
    var pref = localStorage.getItem("opensider/theme");
    if (pref !== "light" && pref !== "dark" && pref !== "system") {
      pref = "system";
      try {
        localStorage.setItem("opensider/theme", pref);
      } catch (writeErr) {}
    }
    var resolved =
      pref === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : pref;
    document.documentElement.dataset.theme = resolved;
    var locale = localStorage.getItem("opensider/locale");
    if (locale !== "zh" && locale !== "en") {
      var ui =
        typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function"
          ? chrome.i18n.getUILanguage()
          : navigator.language || "";
      locale = /^zh([-_]|$)/i.test(String(ui).trim()) ? "zh" : "en";
      try {
        localStorage.setItem("opensider/locale", locale);
      } catch (writeErr) {}
    }
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  } catch (e) {}
})();
