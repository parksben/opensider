//go:build darwin

package addonenv

import "testing"

// codesign 会在写回 Mach-O 时把 com.apple.quarantine 重新挂上，所以清属性必须
// 排在签名之后，否则 sweep 每轮结束文件仍是隔离态。
func TestTrustStepsSignsBeforeClearingAttributes(t *testing.T) {
	steps := trustSteps("/tmp/x.dylib")
	if len(steps) < 2 {
		t.Fatalf("want at least 2 steps, got %d", len(steps))
	}
	if steps[0][0] != "codesign" {
		t.Fatalf("first step = %q, want codesign", steps[0][0])
	}
	if steps[1][0] != "xattr" {
		t.Fatalf("second step = %q, want xattr", steps[1][0])
	}
	for _, step := range steps {
		if last := step[len(step)-1]; last != "/tmp/x.dylib" {
			t.Fatalf("%s step target = %q, want the file path", step[0], last)
		}
	}
}
