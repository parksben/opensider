//go:build windows

package install

import (
	"golang.org/x/sys/windows/registry"
)

func writeRegistry(manifestPath string) error {
	keys := []string{
		`Software\Google\Chrome\NativeMessagingHosts\` + "com.opensider.host",
		`Software\Google\Chrome Beta\NativeMessagingHosts\` + "com.opensider.host",
		`Software\Chromium\NativeMessagingHosts\` + "com.opensider.host",
		`Software\Microsoft\Edge\NativeMessagingHosts\` + "com.opensider.host",
		`Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\` + "com.opensider.host",
	}
	for _, key := range keys {
		k, _, err := registry.CreateKey(registry.CURRENT_USER, key, registry.SET_VALUE)
		if err != nil {
			continue
		}
		_ = k.SetStringValue("", manifestPath)
		_ = k.Close()
	}
	return nil
}
