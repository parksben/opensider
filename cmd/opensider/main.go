package main

import (
	"fmt"
	"os"

	"github.com/parksben/opensider/internal/host"
	"github.com/parksben/opensider/internal/install"
	"github.com/parksben/opensider/internal/pick"
)

func main() {
	if len(os.Args) < 2 {
		host.Run()
		return
	}
	switch os.Args[1] {
	case "install":
		local := false
		for _, arg := range os.Args[2:] {
			if arg == "--local" {
				local = true
			}
		}
		if err := install.Run(local); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "pick":
		if err := pick.RunCLI(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		os.Exit(2)
	}
}
