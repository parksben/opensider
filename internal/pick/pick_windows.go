//go:build windows

package pick

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ole32                = windows.NewLazySystemDLL("ole32.dll")
	procCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	procCoUninitialize   = ole32.NewProc("CoUninitialize")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")
	procCoTaskMemFree    = ole32.NewProc("CoTaskMemFree")
)

var (
	clsidFileOpenDialog = windows.GUID{0xDC1C5A9C, 0xE88A, 0x4DDE, [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidIFileOpenDialog  = windows.GUID{0xD57C7288, 0xD4AD, 0x4768, [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}
)

const (
	COINIT_APARTMENTTHREADED = 0x2
	CLSCTX_INPROC_SERVER     = 0x1
	FOS_PICKFOLDERS          = 0x20
	FOS_FORCEFILESYSTEM      = 0x40
	FOS_ALLOWMULTISELECT     = 0x200
	FOS_PATHMUSTEXIST        = 0x800
	FOS_FILEMUSTEXIST        = 0x1000
	SIGDN_FILESYSPATH        = 0x80058000
	HRESULT_CANCELLED        = 0x800704C7
)

type iUnknownVtbl struct {
	QueryInterface uintptr
	AddRef         uintptr
	Release        uintptr
}

type iFileOpenDialogVtbl struct {
	iUnknownVtbl
	Show                uintptr
	SetFileTypes        uintptr
	SetFileTypeIndex    uintptr
	GetFileTypeIndex    uintptr
	Advise              uintptr
	Unadvise            uintptr
	SetOptions          uintptr
	GetOptions          uintptr
	SetDefaultFolder    uintptr
	SetFolder           uintptr
	GetFolder           uintptr
	GetCurrentSelection uintptr
	SetFileName         uintptr
	GetFileName         uintptr
	SetTitle            uintptr
	SetOkButtonLabel    uintptr
	SetFileNameLabel    uintptr
	SetDefaultExtension uintptr
	Close               uintptr
	SetClientGuid       uintptr
	ClearClientData     uintptr
	SetFilter           uintptr
	GetResults          uintptr
	GetSelectedItems    uintptr
}

type iFileOpenDialog struct {
	lpVtbl *iFileOpenDialogVtbl
}

type iShellItemArrayVtbl struct {
	iUnknownVtbl
	BindToHandler              uintptr
	GetPropertyStore           uintptr
	GetPropertyDescriptionList uintptr
	GetAttributes              uintptr
	GetCount                   uintptr
	GetItemAt                  uintptr
	EnumItems                  uintptr
}

type iShellItemArray struct {
	lpVtbl *iShellItemArrayVtbl
}

type iShellItemVtbl struct {
	iUnknownVtbl
	BindToHandler  uintptr
	GetParent      uintptr
	GetDisplayName uintptr
	GetAttributes  uintptr
	Compare        uintptr
}

type iShellItem struct {
	lpVtbl *iShellItemVtbl
}

func dialog(mode Mode) ([]string, error) {
	hr, _, _ := procCoInitializeEx.Call(0, COINIT_APARTMENTTHREADED)
	if hr != 0 && hr != 1 {
		// S_FALSE or RPC_E_CHANGED_MODE is acceptable on a reused thread.
	}
	defer procCoUninitialize.Call()

	var dlg *iFileOpenDialog
	hr, _, _ = procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidFileOpenDialog)),
		0,
		CLSCTX_INPROC_SERVER,
		uintptr(unsafe.Pointer(&iidIFileOpenDialog)),
		uintptr(unsafe.Pointer(&dlg)),
	)
	if hr != 0 || dlg == nil {
		return nil, fmt.Errorf("CoCreateInstance IFileOpenDialog failed: 0x%x", hr)
	}
	defer syscall.SyscallN(dlg.lpVtbl.Release, uintptr(unsafe.Pointer(dlg)))

	opts := uintptr(FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT | FOS_PATHMUSTEXIST)
	if mode == ModeFolders {
		opts |= FOS_PICKFOLDERS
	} else {
		opts |= FOS_FILEMUSTEXIST
	}
	hr, _, _ = syscall.SyscallN(dlg.lpVtbl.SetOptions, uintptr(unsafe.Pointer(dlg)), opts)
	if hr != 0 {
		return nil, fmt.Errorf("SetOptions failed: 0x%x", hr)
	}
	title, err := windows.UTF16PtrFromString("Attach")
	if err == nil {
		_, _, _ = syscall.SyscallN(dlg.lpVtbl.SetTitle, uintptr(unsafe.Pointer(dlg)), uintptr(unsafe.Pointer(title)))
	}

	hr, _, _ = syscall.SyscallN(dlg.lpVtbl.Show, uintptr(unsafe.Pointer(dlg)), 0)
	if hr == HRESULT_CANCELLED {
		return nil, nil
	}
	if hr != 0 {
		return nil, fmt.Errorf("Show failed: 0x%x", hr)
	}

	var results *iShellItemArray
	hr, _, _ = syscall.SyscallN(dlg.lpVtbl.GetResults, uintptr(unsafe.Pointer(dlg)), uintptr(unsafe.Pointer(&results)))
	if hr != 0 || results == nil {
		return nil, fmt.Errorf("GetResults failed: 0x%x", hr)
	}
	defer syscall.SyscallN(results.lpVtbl.Release, uintptr(unsafe.Pointer(results)))

	var count uint32
	hr, _, _ = syscall.SyscallN(results.lpVtbl.GetCount, uintptr(unsafe.Pointer(results)), uintptr(unsafe.Pointer(&count)))
	if hr != 0 {
		return nil, fmt.Errorf("GetCount failed: 0x%x", hr)
	}

	var out []string
	for i := uint32(0); i < count; i++ {
		var item *iShellItem
		hr, _, _ = syscall.SyscallN(results.lpVtbl.GetItemAt, uintptr(unsafe.Pointer(results)), uintptr(i), uintptr(unsafe.Pointer(&item)))
		if hr != 0 || item == nil {
			continue
		}
		var name *uint16
		hr, _, _ = syscall.SyscallN(item.lpVtbl.GetDisplayName, uintptr(unsafe.Pointer(item)), SIGDN_FILESYSPATH, uintptr(unsafe.Pointer(&name)))
		syscall.SyscallN(item.lpVtbl.Release, uintptr(unsafe.Pointer(item)))
		if hr != 0 || name == nil {
			continue
		}
		out = append(out, windows.UTF16PtrToString(name))
		procCoTaskMemFree.Call(uintptr(unsafe.Pointer(name)))
	}
	return out, nil
}
