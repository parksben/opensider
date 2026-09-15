//go:build darwin

package addonenv

import (
	"os/exec"
	"sync"
	"time"

	"github.com/parksben/opensider/internal/log"
)

func startSweep(command, tmpdir string) func() {
	stopCh := make(chan struct{})
	var once sync.Once
	go runSweep(command, tmpdir, stopCh)
	return func() {
		once.Do(func() { close(stopCh) })
	}
}

func runSweep(command, tmpdir string, stopCh <-chan struct{}) {
	roots := sweepRoots(command, tmpdir)
	sweep(roots)
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.Now().Add(20 * time.Second)
	slow := false
	for {
		select {
		case <-stopCh:
			sweep(roots)
			return
		case <-ticker.C:
			sweep(roots)
			if !slow && time.Now().After(deadline) {
				ticker.Reset(time.Second)
				slow = true
			}
		}
	}
}

func sweep(roots []string) {
	walkSignable(roots, trustFile)
}

func trustFile(path string) {
	_ = exec.Command("xattr", "-cr", path).Run()
	if err := exec.Command("codesign", "--force", "--sign", "-", path).Run(); err != nil {
		log.Log("addonenv codesign skipped: " + path + " " + err.Error())
	}
}
