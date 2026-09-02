//go:build linux

package pick

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func dialog(mode Mode) ([]string, error) {
	if paths, err := zenity(mode); err == nil || isCancelErr(err) {
		return paths, errIfNotCancel(err)
	} else if look("zenity") {
		return nil, err
	}
	if paths, err := kdialog(mode); err == nil || isCancelErr(err) {
		return paths, errIfNotCancel(err)
	} else if look("kdialog") {
		return nil, err
	}
	return nil, fmt.Errorf("no file dialog (install zenity or kdialog)")
}

func look(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func zenity(mode Mode) ([]string, error) {
	args := []string{"--file-selection", "--multiple", "--separator=\n", "--title=Attach"}
	if mode == ModeFolders {
		args = append(args, "--directory")
	}
	cmd := exec.Command("zenity", args...)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
			return nil, nil
		}
		return nil, err
	}
	return ParsePaths(string(out)), nil
}

func kdialog(mode Mode) ([]string, error) {
	home, _ := os.UserHomeDir()
	if home == "" {
		home = "."
	}
	var cmd *exec.Cmd
	if mode == ModeFolders {
		cmd = exec.Command("kdialog", "--getexistingdirectory", home)
	} else {
		cmd = exec.Command("kdialog", "--getopenfilename", home, "*", "--multiple", "--separate-output")
	}
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok && (ee.ExitCode() == 1 || ee.ExitCode() == 2) {
			return nil, nil
		}
		// older kdialog may not support --separate-output
		if mode != ModeFolders {
			cmd = exec.Command("kdialog", "--getopenfilename", home, "*", "--multiple")
			out, err = cmd.Output()
			if err != nil {
				if ee, ok := err.(*exec.ExitError); ok && (ee.ExitCode() == 1 || ee.ExitCode() == 2) {
					return nil, nil
				}
				return nil, err
			}
			return splitKDialog(string(out)), nil
		}
		return nil, err
	}
	return ParsePaths(string(out)), nil
}

func splitKDialog(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	if strings.Contains(text, "\n") {
		return ParsePaths(text)
	}
	return ParsePaths(strings.ReplaceAll(text, "  ", "\n"))
}

func isCancelErr(err error) bool {
	return err == nil
}

func errIfNotCancel(err error) error {
	return err
}
