package main

import (
	"fmt"
	"os"
	"strings"
	"unicode"

	"github.com/parksben/opensider/internal/host"
	"github.com/parksben/opensider/internal/install"
	"github.com/parksben/opensider/internal/pick"
)

func main() {
	args := stripNativeClientArgs(os.Args[1:])
	if len(args) == 0 {
		host.Run()
		return
	}
	switch args[0] {
	case "install":
		local := false
		for _, arg := range args[1:] {
			if arg == "--local" {
				local = true
			}
		}
		if err := install.Run(local); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "pick":
		if err := pick.RunCLI(args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	default:
		// Chrome already passed only the origin (stripped above). Any other
		// leftover still means "run as the native host" so we never write to
		// stderr and kill the Native Messaging pipe.
		host.Run()
	}
}

// Chrome Native Messaging starts the host as:
//
//	opensider chrome-extension://<id>/
//
// Windows also appends a parent HWND (integer or --parent-window=N).
func stripNativeClientArgs(args []string) []string {
	kept := make([]string, 0, len(args))
	for _, arg := range args {
		if arg == "" {
			continue
		}
		if strings.HasPrefix(arg, "chrome-extension://") {
			continue
		}
		if strings.HasPrefix(arg, "--parent-window=") {
			continue
		}
		if isWindowHandle(arg) {
			continue
		}
		kept = append(kept, arg)
	}
	return kept
}

func isWindowHandle(arg string) bool {
	if arg == "" {
		return false
	}
	for _, r := range arg {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
