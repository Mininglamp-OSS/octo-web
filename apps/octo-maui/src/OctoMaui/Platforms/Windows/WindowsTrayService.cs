using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.UI.Xaml;
using OctoMaui.Services;
using WinRT.Interop;

namespace OctoMaui.Platforms.Windows;

/// <summary>
/// Windows-specific tray icon implementation using Win32 Shell_NotifyIconW
/// via P/Invoke. Provides minimize-to-tray and a right-click context menu
/// (Show Window / Exit). Uses a message-only window to receive tray callbacks.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsTrayService : ITrayService, IDisposable
{
    // === Win32 message constants ===
    private const int WM_USER = 0x0400;
    private const int WM_TRAY_CALLBACK = WM_USER + 0x2000;
    private const int WM_COMMAND = 0x0111;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONUP = 0x0205;

    // === Shell_NotifyIconW message/flag constants ===
    private const uint NIM_ADD = 0x00000000;
    private const uint NIM_MODIFY = 0x00000001;
    private const uint NIM_DELETE = 0x00000002;
    private const uint NIF_MESSAGE = 0x00000001;
    private const uint NIF_ICON = 0x00000002;
    private const uint NIF_TIP = 0x00000004;

    // === TrackPopupMenu flags ===
    private const uint TPM_RIGHTBUTTON = 0x0002;
    private const uint TPM_LEFTALIGN = 0x0000;
    private const uint TPM_BOTTOMALIGN = 0x0020;
    private const uint TPM_RETURNCMD = 0x0100;
    private const uint TPM_NONOTIFY = 0x0080;

    // === ShowWindow commands ===
    private const int SW_HIDE = 0;
    private const int SW_RESTORE = 9;

    // === Standard LoadIcon / LoadCursor IDs ===
    private const int IDI_INFORMATION = 32516;
    private const int IDC_ARROW = 32512;

    // === Window class constants ===
    private const uint CS_HREDRAW = 0x0002;
    private const uint CS_VREDRAW = 0x0001;
    private const int COLOR_WINDOW = 5;
    private static readonly IntPtr HWND_MESSAGE = new(-3);

    // === Menu flags ===
    private const uint MF_STRING = 0x00000000;
    private const uint MF_SEPARATOR = 0x00000800;

    // === Context menu command IDs ===
    private const int CMD_SHOW = 1001;
    private const int CMD_EXIT = 1002;

    private const string WindowClassName = "OctoMauiTrayListener";

    // --- P/Invoke signatures ---
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassExW(ref WNDCLASSEXW lpwcx);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(
        uint dwExStyle, string lpClassName, string lpWindowName,
        uint dwStyle, int x, int y, int nWidth, int nHeight,
        IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProcW(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadIconW(IntPtr hInstance, IntPtr lpIconName);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadCursorW(IntPtr hInstance, IntPtr lpCursorName);

    [DllImport("shell32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Shell_NotifyIconW(uint dwMessage, ref NOTIFYICONDATAW lpData);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int TrackPopupMenu(IntPtr hMenu, uint uFlags,
        int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AppendMenuW(IntPtr hMenu, uint uFlags, uint uIDNewItem, string lpNewItem);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr GetModuleHandleW(string? lpModuleName);

    // --- Native structs ---

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEXW
    {
        public uint cbSize;
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string? lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATAW
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;
        public uint dwInfoFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    // --- WndProc delegate; stored as a field to prevent GC collection ---
    // while native code holds the function pointer.
    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    // --- Instance state ---
    private IntPtr _messageWindow = IntPtr.Zero;
    private IntPtr _trayIcon = IntPtr.Zero;
    private readonly WndProcDelegate _wndProcDelegate;
    private bool _initialized;
    private bool _disposed;

    public bool IsSupported => OperatingSystem.IsWindows();

    public WindowsTrayService()
    {
        // Allocate the delegate once and keep it alive for the lifetime of
        // this instance so the GC doesn't reclaim it while native code still
        // holds the function pointer.
        _wndProcDelegate = new WndProcDelegate(TrayWndProc);
    }

    public Task InitializeAsync()
    {
        if (!IsSupported || _initialized) return Task.CompletedTask;

        // Tray window must be created on the UI thread. Use a
        // TaskCompletionSource so callers can await real completion rather
        // than just the dispatch of the work.
        var tcs = new TaskCompletionSource<bool>();
        MainThread.BeginInvokeOnMainThread(() =>
        {
            try
            {
                CreateListenerWindow();
                AddTrayIcon();
                _initialized = _messageWindow != IntPtr.Zero;
                tcs.TrySetResult(true);
            }
            catch (Exception ex)
            {
                // Tray is best-effort; surface the failure to the awaiter
                // rather than crashing the app on init failure.
                tcs.TrySetException(ex);
            }
        });

        return tcs.Task;
    }

    private void CreateListenerWindow()
    {
        var hInstance = GetModuleHandleW(null);

        var wc = new WNDCLASSEXW
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEXW>(),
            style = CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProcDelegate),
            cbClsExtra = 0,
            cbWndExtra = 0,
            hInstance = hInstance,
            hIcon = IntPtr.Zero,
            hCursor = LoadCursorW(IntPtr.Zero, new IntPtr(IDC_ARROW)),
            hbrBackground = new IntPtr(COLOR_WINDOW + 1),
            lpszMenuName = null,
            lpszClassName = WindowClassName,
            hIconSm = IntPtr.Zero,
        };

        // RegisterClassExW returns 0 on failure (e.g. class already exists);
        // CreateWindowExW will still work if the class is already registered.
        RegisterClassExW(ref wc);

        _messageWindow = CreateWindowExW(
            0, WindowClassName, "OctoMauiTray",
            0, 0, 0, 0, 0,
            HWND_MESSAGE, IntPtr.Zero, hInstance, IntPtr.Zero);
    }

    private void AddTrayIcon()
    {
        if (_messageWindow == IntPtr.Zero) return;

        // Use the standard system information icon (zero dependency).
        _trayIcon = LoadIconW(IntPtr.Zero, new IntPtr(IDI_INFORMATION));

        var nid = new NOTIFYICONDATAW
        {
            cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATAW>(),
            hWnd = _messageWindow,
            uID = 1,
            uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage = WM_TRAY_CALLBACK,
            hIcon = _trayIcon,
            szTip = "OCTO",
            szInfo = string.Empty,
            szInfoTitle = string.Empty,
        };

        Shell_NotifyIconW(NIM_ADD, ref nid);
    }

    private IntPtr TrayWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_TRAY_CALLBACK)
        {
            // LOWORD(lParam) contains the mouse message identifier.
            var mouseMsg = (uint)(lParam.ToInt64() & 0xFFFF);
            switch (mouseMsg)
            {
                case WM_LBUTTONUP:
                    ToggleWindow();
                    break;
                case WM_RBUTTONUP:
                    ShowContextMenu();
                    break;
            }
            return IntPtr.Zero;
        }

        if (msg == WM_COMMAND)
        {
            // LOWORD(wParam) contains the menu item identifier.
            var cmdId = (uint)(wParam.ToInt64() & 0xFFFF);
            switch (cmdId)
            {
                case CMD_SHOW:
                    ShowWindowCore();
                    break;
                case CMD_EXIT:
                    ExitApp();
                    break;
            }
            return IntPtr.Zero;
        }

        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }

    private void ShowContextMenu()
    {
        var hMenu = CreatePopupMenu();
        if (hMenu == IntPtr.Zero) return;

        try
        {
            AppendMenuW(hMenu, MF_STRING, CMD_SHOW, "显示窗口");
            AppendMenuW(hMenu, MF_SEPARATOR, 0, string.Empty);
            AppendMenuW(hMenu, MF_STRING, CMD_EXIT, "退出");

            GetCursorPos(out var pt);

            // SetForegroundWindow is required so the menu dismisses correctly
            // when the user clicks outside of it (Win32 quirk).
            SetForegroundWindow(_messageWindow);

            var cmd = TrackPopupMenu(
                hMenu,
                TPM_RIGHTBUTTON | TPM_LEFTALIGN | TPM_BOTTOMALIGN | TPM_RETURNCMD | TPM_NONOTIFY,
                pt.X, pt.Y, 0, _messageWindow, IntPtr.Zero);

            if (cmd != 0)
            {
                // Forward the selected command to our WndProc via WM_COMMAND so
                // the handler runs in the normal message loop context.
                PostMessage(_messageWindow, WM_COMMAND, new IntPtr(cmd), IntPtr.Zero);
            }
        }
        finally
        {
            DestroyMenu(hMenu);
        }
    }

    private void ToggleWindow()
    {
        if (TryGetMainWindowHandle(out var hwnd) && hwnd != IntPtr.Zero)
        {
            if (IsIconic(hwnd) || !IsWindowVisible(hwnd))
                ShowWindowCore();
            else
                HideWindowCore();
        }
        else
        {
            ShowWindowCore();
        }
    }

    private static bool TryGetMainWindowHandle(out IntPtr hwnd)
    {
        hwnd = IntPtr.Zero;
        if (Application.Current?.Windows.FirstOrDefault() is not { } mauiWindow)
            return false;

        try
        {
            if (mauiWindow.Handler?.PlatformView is Microsoft.UI.Xaml.Window platformWindow)
            {
                hwnd = WindowNative.GetWindowHandle(platformWindow);
                return hwnd != IntPtr.Zero;
            }
        }
        catch
        {
            // Handler not ready yet; ignore.
        }
        return false;
    }

    public void ShowWindow()
    {
        if (MainThread.IsMainThread)
            ShowWindowCore();
        else
            MainThread.BeginInvokeOnMainThread(ShowWindowCore);
    }

    private void ShowWindowCore()
    {
        if (Application.Current?.Windows.FirstOrDefault() is not { } mauiWindow)
            return;

        mauiWindow.IsVisible = true;

        if (TryGetMainWindowHandle(out var hwnd) && hwnd != IntPtr.Zero)
        {
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }

    public void HideWindow()
    {
        if (MainThread.IsMainThread)
            HideWindowCore();
        else
            MainThread.BeginInvokeOnMainThread(HideWindowCore);
    }

    private void HideWindowCore()
    {
        if (Application.Current?.Windows.FirstOrDefault() is not { } mauiWindow)
            return;

        mauiWindow.IsVisible = false;

        if (TryGetMainWindowHandle(out var hwnd) && hwnd != IntPtr.Zero)
        {
            ShowWindow(hwnd, SW_HIDE);
        }
    }

    private void ExitApp()
    {
        // Post to the message queue so we don't destroy the listener window
        // while still inside its WndProc.
        MainThread.BeginInvokeOnMainThread(() =>
        {
            Remove();
            if (Application.Current?.Windows.FirstOrDefault() is { } window)
            {
                window.Close();
            }
        });
    }

    public void Remove()
    {
        if (!_initialized) return;
        _initialized = false;

        // DestroyWindow must be called from the thread that created the window.
        if (MainThread.IsMainThread)
            RemoveCore();
        else
            MainThread.BeginInvokeOnMainThread(RemoveCore);
    }

    private void RemoveCore()
    {
        if (_messageWindow == IntPtr.Zero) return;

        var nid = new NOTIFYICONDATAW
        {
            cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATAW>(),
            hWnd = _messageWindow,
            uID = 1,
            szTip = string.Empty,
            szInfo = string.Empty,
            szInfoTitle = string.Empty,
        };
        Shell_NotifyIconW(NIM_DELETE, ref nid);

        DestroyWindow(_messageWindow);
        _messageWindow = IntPtr.Zero;
    }

    /// <summary>
    /// Releases the native tray icon and listener window. Safe to call
    /// multiple times.
    /// </summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        // DestroyWindow must be called from the thread that created the window.
        // Route teardown through the same MainThread marshal as Remove().
        if (MainThread.IsMainThread)
            RemoveCore();
        else
            MainThread.BeginInvokeOnMainThread(RemoveCore);
        GC.SuppressFinalize(this);
    }

    // Finalizer ensures native resources are released even if Dispose was
    // never called. RemoveCore is guarded against re-entry.
    ~WindowsTrayService()
    {
        Dispose();
    }
}
