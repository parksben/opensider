package version

import "testing"

func TestDisplayStripsTagPrefix(t *testing.T) {
	cases := map[string]string{
		"v0.2.2": "0.2.2",
		"0.2.2":  "0.2.2",
		"dev":    "dev",
		"":       "",
	}
	for raw, want := range cases {
		Version = raw
		if got := Display(); got != want {
			t.Fatalf("Display() of %q = %q, want %q", raw, got, want)
		}
	}
	Version = "dev"
}

func TestIsDevCoversEmpty(t *testing.T) {
	Version = ""
	if !IsDev() {
		t.Fatal("empty version should count as dev")
	}
	Version = "v0.2.2"
	if IsDev() {
		t.Fatal("a release tag should not count as dev")
	}
	Version = "dev"
}
