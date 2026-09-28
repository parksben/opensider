/** Minimal `chrome.*` stubs so the real side panel can render outside the extension. */
const ev = () => ({
  addListener() {},
  removeListener() {},
  hasListener() {
    return false;
  },
});

const area = () => ({
  async get() {
    return {};
  },
  async set() {},
  async remove() {},
});

const chromeStub = {
  storage: { local: area(), session: area(), onChanged: ev() },
  tabs: {
    async query() {
      return [];
    },
    async create() {
      return undefined;
    },
    async sendMessage() {
      return undefined;
    },
    async captureVisibleTab() {
      return "";
    },
    onCreated: ev(),
    onUpdated: ev(),
    onActivated: ev(),
    onRemoved: ev(),
    onReplaced: ev(),
    onAttached: ev(),
    onDetached: ev(),
  },
  runtime: {
    id: "opensider-shots",
    async sendMessage() {
      return undefined;
    },
    connect() {
      return { onMessage: ev(), postMessage() {}, disconnect() {} };
    },
    onMessage: ev(),
    onConnect: ev(),
    getURL: (value: string) => value,
  },
  i18n: { getUILanguage: () => "en" },
  windows: { WINDOW_ID_NONE: -1, onFocusChanged: ev() },
};

try {
  Object.defineProperty(globalThis, "chrome", { value: chromeStub, configurable: true, writable: true });
} catch {
  // A read-only `chrome` (real Chromium): the panel only needs storage, which the page has.
}
