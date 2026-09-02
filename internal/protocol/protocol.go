package protocol

const (
	HostName    = "com.opensider.host"
	ExtensionID       = "gcblddgaifebccglndkaccmibhechimj"
	PackedExtensionID = "clnpnldmjaklambmaglpckjlgkicmcpb"
)

var PageMethods = []string{
	"getMeta", "getReadable", "getInteractive", "getUnsavedChanges", "getSelection",
	"getLinks", "getOutline", "queryText", "queryAll", "getAttribute", "getValue",
	"exists", "click", "dblclick", "hover", "focus", "fill", "type", "clear",
	"fillForm", "select", "check", "press", "scroll", "scrollIntoView", "waitFor",
	"navigate", "goBack", "goForward", "reload", "runScript", "screenshot",
	"screenshotElement", "listTabs", "switchTab", "openTab", "closeTab",
	"moveTabsToWindow",
}

var HostMethods = []string{"reportArtifacts"}

type AttachmentKind string

const (
	KindImage   AttachmentKind = "image"
	KindFile    AttachmentKind = "file"
	KindFolder  AttachmentKind = "folder"
	KindElement AttachmentKind = "element"
)

type AttachmentItem struct {
	Path string         `json:"path"`
	Name string         `json:"name"`
	Kind AttachmentKind `json:"kind"`
}

type AgentModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type AgentPolicy string

const (
	PolicyAsk        AgentPolicy = "ask"
	PolicyWorkspace  AgentPolicy = "workspace"
	PolicyAuto       AgentPolicy = "auto"
	PolicyUnattended AgentPolicy = "unattended"
)

type AgentMark string

type AgentCaps struct {
	Models    bool `json:"models"`
	Questions bool `json:"questions"`
	Plans     bool `json:"plans"`
	Todos     bool `json:"todos"`
}

type AgentInfo struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Mark      AgentMark `json:"mark"`
	Command   string    `json:"command,omitempty"`
	Installed bool      `json:"installed"`
	Hint      string    `json:"hint,omitempty"`
	Caps      AgentCaps `json:"caps"`
}

type AgentProgress struct {
	Phase string `json:"phase"`
	Index int    `json:"index"`
	Total int    `json:"total"`
	Label string `json:"label"`
}

type CurrentPage struct {
	TabID       int    `json:"tabId"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	UpdatedAt   string `json:"updatedAt"`
	Readable    string `json:"readable,omitempty"`
	Interactive string `json:"interactive,omitempty"`
	FavIconURL  string `json:"favIconUrl,omitempty"`
}

type TabRecord struct {
	TabID      int    `json:"tabId"`
	WindowID   int    `json:"windowId"`
	Index      int    `json:"index"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	Active     bool   `json:"active"`
	Pinned     bool   `json:"pinned"`
	Restricted bool   `json:"restricted"`
}

type WindowRecord struct {
	WindowID int         `json:"windowId"`
	Focused  bool        `json:"focused"`
	State    string      `json:"state,omitempty"`
	Tabs     []TabRecord `json:"tabs"`
}

type TabsSnapshot struct {
	UpdatedAt string         `json:"updatedAt"`
	Windows   []WindowRecord `json:"windows"`
}

type BrowserCommand struct {
	ID     string         `json:"id"`
	Method string         `json:"method"`
	Args   map[string]any `json:"args,omitempty"`
}

type BrowserResult struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Method string `json:"method"`
	Data   any    `json:"data,omitempty"`
	Error  string `json:"error,omitempty"`
}

type ScreenshotPayload struct {
	ImageBase64 string `json:"imageBase64"`
	Mime        string `json:"mime"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
}

type PickMode string

const (
	PickMixed   PickMode = "mixed"
	PickFiles   PickMode = "files"
	PickFolders PickMode = "folders"
)

type ToolEntry struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Args    string `json:"args"`
	Summary string `json:"summary"`
}

var ToolCatalog = []ToolEntry{
	{Name: "getMeta", Kind: "read", Args: "", Summary: "url, title, description"},
	{Name: "getReadable", Kind: "read", Args: "", Summary: "main text extract"},
	{Name: "getInteractive", Kind: "read", Args: "", Summary: "numbered interactive controls; prefer args.index from this list"},
	{Name: "getUnsavedChanges", Kind: "read", Args: "", Summary: "detect unsaved form/editor edits before navigate/close"},
	{Name: "getSelection", Kind: "read", Args: "", Summary: "highlighted text"},
	{Name: "getLinks", Kind: "read", Args: "", Summary: "same-origin links"},
	{Name: "getOutline", Kind: "read", Args: "", Summary: "h1–h3 headings"},
	{Name: "queryText", Kind: "read", Args: "index|selector|label|text, nth?", Summary: "one node's text"},
	{Name: "queryAll", Kind: "read", Args: "index|selector|label|text?", Summary: "matching node summaries; empty args = interactive list"},
	{Name: "getAttribute", Kind: "read", Args: "index|selector|label|text, attribute", Summary: "element attribute"},
	{Name: "getValue", Kind: "read", Args: "index|selector|label|text", Summary: "input/textarea/select value"},
	{Name: "exists", Kind: "read", Args: "index|selector|label|text", Summary: "whether a match exists"},
	{Name: "click", Kind: "act", Args: "index|selector|label|text, nth?", Summary: "click an element"},
	{Name: "dblclick", Kind: "act", Args: "index|selector|label|text, nth?", Summary: "double-click"},
	{Name: "hover", Kind: "act", Args: "index|selector|label|text, nth?", Summary: "hover"},
	{Name: "focus", Kind: "act", Args: "index|selector|label|text, nth?", Summary: "focus"},
	{Name: "fill", Kind: "act", Args: "index|label|selector, value", Summary: "set field value (native, contenteditable, or combobox)"},
	{Name: "type", Kind: "act", Args: "index|label|selector, text", Summary: "append text"},
	{Name: "clear", Kind: "act", Args: "index|label|selector", Summary: "clear a field"},
	{Name: "fillForm", Kind: "act", Args: "fields[{index|label|name, value}]", Summary: "fill many fields in one call"},
	{Name: "select", Kind: "act", Args: "index|label|selector, value", Summary: "choose a select/combobox option by value or text"},
	{Name: "check", Kind: "act", Args: "index|label|selector, checked?", Summary: "checkbox/radio/switch"},
	{Name: "press", Kind: "act", Args: "key, index|selector?", Summary: "keydown/keyup, e.g. Enter"},
	{Name: "scroll", Kind: "act", Args: "index|selector|text or x,y", Summary: "scroll window or element"},
	{Name: "scrollIntoView", Kind: "act", Args: "index|selector|label|text", Summary: "scroll element into view"},
	{Name: "waitFor", Kind: "act", Args: "index|selector|label|text, timeoutMs?", Summary: "wait until element exists"},
	{Name: "navigate", Kind: "act", Args: "url, force?", Summary: "http(s) navigation; blocked if unsaved unless force"},
	{Name: "goBack", Kind: "act", Args: "force?", Summary: "history back; blocked if unsaved unless force"},
	{Name: "goForward", Kind: "act", Args: "force?", Summary: "history forward; blocked if unsaved unless force"},
	{Name: "reload", Kind: "act", Args: "force?", Summary: "reload tab; blocked if unsaved unless force"},
	{Name: "runScript", Kind: "act", Args: "code, world?, timeoutMs?", Summary: "run async page script for batch DOM work; world=ISOLATED|MAIN"},
	{Name: "screenshot", Kind: "vision", Args: "x?,y?,width?,height?", Summary: "JPEG of the visible viewport or a region"},
	{Name: "screenshotElement", Kind: "vision", Args: "index|selector|label|text, nth?", Summary: "JPEG of one element; Read the file at data.path"},
	{Name: "listTabs", Kind: "read", Args: "", Summary: "all normal windows and tabs; same shape as browser/tabs.json"},
	{Name: "switchTab", Kind: "act", Args: "tabId", Summary: "activate a tab and focus its window"},
	{Name: "openTab", Kind: "act", Args: "url, windowId?", Summary: "open http(s) in a new tab without touching the current page"},
	{Name: "closeTab", Kind: "act", Args: "tabId?, force?", Summary: "close a tab; blocked if unsaved unless force"},
	{Name: "moveTabsToWindow", Kind: "act", Args: "tabIds, windowId?", Summary: "pull tabs into a new window, or into windowId"},
	{Name: "reportArtifacts", Kind: "workspace", Args: "files[{path, name?}] | paths[] | path", Summary: "replace the sidebar artifact list with these local files after you finish writing outputs"},
}

func IsPageMethod(method string) bool {
	for _, item := range PageMethods {
		if item == method {
			return true
		}
	}
	return false
}

func IsHostMethod(method string) bool {
	for _, item := range HostMethods {
		if item == method {
			return true
		}
	}
	return false
}

func IsWatchedMethod(method string) bool {
	return IsPageMethod(method) || IsHostMethod(method)
}
