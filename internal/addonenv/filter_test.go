package addonenv

import "testing"

func TestShouldSign(t *testing.T) {
	if !shouldSign("/tmp/watcher.node", 40_000) {
		t.Fatal("watcher.node")
	}
	if !shouldSign("/tmp/.abc-00000001.node", 12_000) {
		t.Fatal("hashed .node")
	}
	if !shouldSign("/tmp/libfoo.dylib", 80_000) {
		t.Fatal("dylib")
	}
	if shouldSign("/tmp/opencode", 144_000_000) {
		t.Fatal("must skip CLI binary")
	}
	if shouldSign("/tmp/readme.txt", 100) {
		t.Fatal("must skip text")
	}
	if shouldSign("/tmp/empty.node", 0) {
		t.Fatal("must skip empty")
	}
}
