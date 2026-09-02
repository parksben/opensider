package acp

import (
	"errors"
	"testing"
)

func TestIsBenignStreamClose(t *testing.T) {
	if !IsBenignStreamClose(errors.New(`{"code":-32603,"message":"RetriableError: WritableIterable is closed"}`)) {
		t.Fatal("expected rpc payload to match")
	}
	if IsBenignStreamClose(errors.New("Authentication required")) {
		t.Fatal("auth errors must stay visible")
	}
	if IsBenignStreamClose(nil) {
		t.Fatal("nil is not a stream close")
	}
}

func TestStripBenignStreamClose(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"Error: RetriableError: WritableIterable is closed", ""},
		{"RetriableError: WritableIterable is closed\n", ""},
		{"Here is the PDF.\n\nError: RetriableError: WritableIterable is closed", "Here is the PDF."},
		{"Error: RetriableError: WritableIterable is closed\n\nHere is the PDF.", "Here is the PDF."},
		{"The file is ready. Error: RetriableError: WritableIterable is closed", "The file is ready."},
		{"Error: something else failed", "Error: something else failed"},
		{"Agent mentioned an Error: line in prose", "Agent mentioned an Error: line in prose"},
	}
	for _, item := range cases {
		if got := StripBenignStreamClose(item.in); got != item.want {
			t.Fatalf("strip %q: got %q want %q", item.in, got, item.want)
		}
	}
	if !IsOnlyBenignStreamClose("Error: RetriableError: WritableIterable is closed\n") {
		t.Fatal("expected only-close chunk")
	}
	if IsOnlyBenignStreamClose("Here is the PDF.\nError: RetriableError: WritableIterable is closed") {
		t.Fatal("mixed content is not only-close")
	}
}
