//go:build darwin

package addonenv

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
)

// prepareRuntime trusts native code that lives outside the Agent's TMPDIR.
// The fast TMPDIR sweeper cannot see Hermes' managed Python venv, and that
// venv is where Gatekeeper's prompt for charset_normalizer/cd.*.so comes from.
func prepareRuntime(agentID string) {
	if strings.TrimSpace(agentID) != "hermes" {
		return
	}
	trustHermesRuntime()
}

// trustHermesRuntime walks Hermes' stable runtime roots once before launch.
// It is deliberately not part of startSweep: those trees are large and stable,
// so walking them on every 40ms tick would be wasteful.
func trustHermesRuntime() {
	roots := hermesRuntimeRoots()
	if len(roots) == 0 {
		return
	}
	hermesTrustMu.Lock()
	defer hermesTrustMu.Unlock()
	disableCharSetNormalizerNative(roots)
	walkSignable(roots, trustFile)
}

// disableCharSetNormalizerNative gets rid of the one native module pair that
// macOS 26 keeps rejecting even after an ad-hoc signature. Hermes/uv wheels
// carry com.apple.provenance, and syspolicyd denies those files (including the
// copies in the uv cache) every time a Python process imports them. The
// package ships pure-Python cd.py / md.py fallbacks, so moving the .so files
// out of the import path is safer than fighting Gatekeeper on every launch.
// The originals stay next to the package (suffix .opensider-disabled) for
// reversibility; a later dependency sync that restores them is handled again
// on the next launch.
func disableCharSetNormalizerNative(roots []string) {
	for _, root := range roots {
		if root == "" {
			continue
		}
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if filepath.Base(filepath.Dir(path)) != "charset_normalizer" {
				return nil
			}
			name := strings.ToLower(info.Name())
			if !strings.HasSuffix(name, ".so") ||
				!(strings.HasPrefix(name, "cd.") || strings.HasPrefix(name, "md.")) {
				return nil
			}
			disabled := path + ".opensider-disabled"
			if _, statErr := os.Stat(disabled); statErr == nil {
				if rmErr := os.Remove(path); rmErr != nil {
					log.Log("addonenv disable charset native: " + rmErr.Error() + " " + path)
				} else {
					log.Log("addonenv disabled restored charset native " + path)
				}
				return nil
			}
			if renameErr := os.Rename(path, disabled); renameErr != nil {
				log.Log("addonenv disable charset native: " + renameErr.Error() + " " + path)
			} else {
				log.Log("addonenv disabled charset native " + path)
			}
			return nil
		})
	}
}

func hermesRuntimeRoots() []string {
	home := strings.TrimSpace(os.Getenv("HERMES_HOME"))
	if home == "" {
		root := paths.Home()
		if root == "" {
			return nil
		}
		home = filepath.Join(root, ".hermes")
	}
	return []string{
		filepath.Join(home, "tools"),
		filepath.Join(home, "installs"),
		// uv keeps unpacked wheels here. Hermes may build an environment from
		// this cache, and those copies are not the ones under installs/.
		filepath.Join(home, "cache", "uv", "archive-v0"),
		filepath.Join(home, "cache", "uv", "wheels-v7"),
	}
}

var (
	hermesTrustMu sync.Mutex
	trustFileMu   sync.Mutex
	trustedNative sync.Map // path -> nativeFingerprint
)

// nativeFingerprint lets the background sweep skip native files it has already
// trusted. Without it every 40ms tick would re-run codesign and xattr on the
// same (sometimes 30MB) Mach-O files.
type nativeFingerprint struct {
	size int64
	mod  int64
}

func fingerprint(path string) (nativeFingerprint, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return nativeFingerprint{}, false
	}
	return nativeFingerprint{size: info.Size(), mod: info.ModTime().UnixNano()}, true
}

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
	cleanRoots(roots)
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

// cleanRoots 在快扫循环之前把既有残留一次性收拾掉。walkSignable 只处理
// .node/.dylib/.so 且不超过 64MB 的 Mach-O，像 opensider-art/ocr 里没有
// 这些扩展名的原生文件它碰不到，只能整目录清一遍。
func cleanRoots(roots []string) {
	for _, root := range roots {
		_ = exec.Command("xattr", "-cr", root).Run()
	}
}

// trustSteps 是让 Gatekeeper 放行 path 需要的动作，顺序有意义：先签名，后清
// 属性。
func trustSteps(path string) [][]string {
	return [][]string{
		{"codesign", "--force", "--sign", "-", path},
		{"xattr", "-cr", path},
	}
}

// trustFile makes path loadable under Gatekeeper. A valid signature is left
// alone (only quarantine is cleared); an unsigned or linker-signed Mach-O is
// ad-hoc signed and then cleaned. The clean step must stay after codesign:
// when the Agent's launch chain carries quarantine, codesign itself rewrites
// the file as a quarantined process and stamps com.apple.quarantine again
// (measured 0081;…;Chrome; → 0281;…;;), so cleaning first is always undone.
//
// Hermes' uv-installed modules have no quarantine at all, only the protected
// com.apple.provenance attribute. xattr cannot remove provenance, so the
// signature itself is what lets syspolicyd approve the dlopen.
//
// Signing failures are logged with codesign's output; otherwise the host log
// only says "exit status 1" and the cause is lost.
func trustFile(path string) {
	fp, ok := fingerprint(path)
	if !ok {
		return
	}
	if cached, ok := trustedNative.Load(path); ok && cached == fp {
		return
	}
	trustFileMu.Lock()
	defer trustFileMu.Unlock()
	if cached, ok := trustedNative.Load(path); ok && cached == fp {
		return
	}
	if codeSignatureValid(path) {
		if clearAttributes(path) {
			storeFingerprint(path)
		}
		return
	}
	clear := true
	for _, step := range trustSteps(path) {
		args := step[1:]
		if out, err := exec.Command(step[0], args...).CombinedOutput(); err != nil {
			clear = false
			log.Log("addonenv " + step[0] + " skipped: " + path + " " + err.Error() + " " + strings.TrimSpace(string(out)))
		}
	}
	if clear && codeSignatureValid(path) {
		storeFingerprint(path)
	}
}

func codeSignatureValid(path string) bool {
	return exec.Command("codesign", "--verify", "--strict", "--verbose=0", path).Run() == nil
}

func clearAttributes(path string) bool {
	return exec.Command("xattr", "-cr", path).Run() == nil
}

func storeFingerprint(path string) {
	if fp, ok := fingerprint(path); ok {
		trustedNative.Store(path, fp)
	}
}
