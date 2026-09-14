//go:build windows

package install

import (
	"golang.org/x/sys/windows/registry"
)

func registryKeys() []string {
	return []string{
		`Software\Google\Chrome\NativeMessagingHosts\` + "com.opensider.host",
		`Software\Google\Chrome Beta\NativeMessagingHosts\` + "com.opensider.host",
		`Software\Chromium\NativeMessagingHosts\` + "com.opensider.host",
		`Software\Microsoft\Edge\NativeMessagingHosts\` + "com.opensider.host",
		`Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\` + "com.opensider.host",
	}
}

func writeRegistry(manifestPath string) error {
	for _, key := range registryKeys() {
		k, _, err := registry.CreateKey(registry.CURRENT_USER, key, registry.SET_VALUE)
		if err != nil {
			continue
		}
		_ = k.SetStringValue("", manifestPath)
		_ = k.Close()
	}
	return nil
}

// deleteRegistry 删掉 HKCU 下的注册表项，卸载时用。
func deleteRegistry() error {
	for _, key := range registryKeys() {
		_ = registry.DeleteKey(registry.CURRENT_USER, key)
	}
	return nil
}
