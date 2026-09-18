package release

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/parksben/opensider/internal/paths"
)

func swapEndpoints(api, web string) (restore func()) {
	oldAPI, oldWeb := apiLatest, webLatest
	apiLatest, webLatest = api, web
	return func() { apiLatest, webLatest = oldAPI, oldWeb }
}

func TestTagFromLocation(t *testing.T) {
	good := map[string]string{
		"https://github.com/parksben/opensider/releases/tag/v0.2.12":    "v0.2.12",
		"https://github.com/parksben/opensider/releases/tag/v0.3.0?x=1": "v0.3.0",
		"https://github.com/parksben/opensider/releases/tag/v0.3.0/":    "v0.3.0",
	}
	for location, want := range good {
		got, err := tagFromLocation(location)
		if err != nil || got != want {
			t.Fatalf("tagFromLocation(%q) = %q, %v; want %q", location, got, err, want)
		}
	}
	for _, bad := range []string{
		"",
		"%%%",
		"https://github.com/parksben/opensider/releases",
		"https://github.com/login?return_to=%2Fparksben",
	} {
		if tag, err := tagFromLocation(bad); err == nil {
			t.Fatalf("tagFromLocation(%q) = %q; want an error", bad, tag)
		}
	}
}

// 共享出口 IP 把 API 的 60 次/小时打满（403）时，要能退回网页端 302 拿 tag——这正是
// 2026-09-18 侧栏「检查失败 / 未知」事故的直接修法。
func TestLatestFallsBackToWebRedirect(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message":"API rate limit exceeded"}`, http.StatusForbidden)
	}))
	defer api.Close()
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Cache-Control"); got != "no-cache" {
			t.Errorf("web fallback should ask for no-cache, got %q", got)
		}
		http.Redirect(w, r, "/parksben/opensider/releases/tag/v9.9.9", http.StatusFound)
	}))
	defer web.Close()
	defer swapEndpoints(api.URL, web.URL)()

	info, err := Latest(2 * time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if info.Tag != "v9.9.9" {
		t.Fatalf("got tag %q", info.Tag)
	}
	if _, ok := Cached(); !ok {
		t.Fatal("a successful fallback must count as a fresh cache")
	}
}

func TestLatestErrorsWhenBothEndpointsFail(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusForbidden)
	}))
	defer api.Close()
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no redirect", http.StatusOK)
	}))
	defer web.Close()
	defer swapEndpoints(api.URL, web.URL)()

	if _, err := Latest(2 * time.Second); err == nil {
		t.Fatal("both endpoints failing must surface an error")
	}
}

func TestCachedAnyIgnoresTTL(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.MkdirAll(filepath.Join(home, ".opensider"), 0o755); err != nil {
		t.Fatal(err)
	}
	stale := `{"tag":"v0.0.1","checkedAt":"2020-01-01T00:00:00Z"}` + "\n"
	if err := os.WriteFile(paths.ReleaseCheckPath(), []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := Cached(); ok {
		t.Fatal("a stale cache must not count as fresh")
	}
	info, ok := CachedAny()
	if !ok || info.Tag != "v0.0.1" {
		t.Fatalf("CachedAny() = %v, %v; want the stale tag", info, ok)
	}
}
