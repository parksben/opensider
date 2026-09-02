//go:build darwin

package pick

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit -framework Foundation
#include <stdlib.h>
#include <string.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

static char *opensider_pick_paths(int files, int folders) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp activateIgnoringOtherApps:YES];
    NSRunningApplication *app = [NSRunningApplication currentApplication];
    [app activateWithOptions:(NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps)];

    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = files ? YES : NO;
    panel.canChooseDirectories = folders ? YES : NO;
    panel.allowsMultipleSelection = YES;
    panel.canCreateDirectories = NO;
    panel.resolvesAliases = YES;
    panel.title = @"Attach";
    panel.prompt = @"Select";
    panel.message = @"Choose files or folders";
    panel.level = NSFloatingWindowLevel;
    [panel center];

    NSModalResponse resp = [panel runModal];
    if (resp != NSModalResponseOK) {
      return NULL;
    }
    NSMutableArray<NSString *> *paths = [NSMutableArray array];
    for (NSURL *url in panel.URLs) {
      if (url.path.length > 0) {
        [paths addObject:url.path];
      }
    }
    NSString *text = [paths componentsJoinedByString:@"\n"];
    return strdup(text.UTF8String);
  }
}
*/
import "C"
import "unsafe"

func dialog(mode Mode) ([]string, error) {
	files, folders := 1, 0
	switch mode {
	case ModeFolders:
		files, folders = 0, 1
	case ModeMixed:
		files, folders = 1, 1
	default:
		files, folders = 1, 0
	}
	out := C.opensider_pick_paths(C.int(files), C.int(folders))
	if out == nil {
		return nil, nil
	}
	defer C.free(unsafe.Pointer(out))
	return ParsePaths(C.GoString(out)), nil
}
