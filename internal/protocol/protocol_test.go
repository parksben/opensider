package protocol

import "testing"

func TestPageMethodsStayWatchedAndAreNotHostOnly(t *testing.T) {
	for _, method := range []string{"getMeta", "getReadable", "getInteractive", "click", "screenshot"} {
		if !IsPageMethod(method) {
			t.Fatalf("%s should be a page method", method)
		}
		if IsHostMethod(method) {
			t.Fatalf("%s must not be stolen by HostMethods", method)
		}
		if !IsWatchedMethod(method) {
			t.Fatalf("%s should still be watched", method)
		}
	}
}

func TestReportArtifactsIsHostOnly(t *testing.T) {
	if IsPageMethod("reportArtifacts") {
		t.Fatal("reportArtifacts must not be treated as a page method")
	}
	if !IsHostMethod("reportArtifacts") {
		t.Fatal("reportArtifacts should be a host method")
	}
	if !IsWatchedMethod("reportArtifacts") {
		t.Fatal("reportArtifacts should still be watched")
	}
}
