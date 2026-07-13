using System.Collections.Specialized;
using OctoMaui.ViewModels;

namespace OctoMaui.Pages;

public partial class ChatPage : ContentPage
{
    private readonly ChatViewModel _vm;

    public ChatPage(ChatViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        BindingContext = _vm;

        // Auto-scroll to the newest message whenever the collection changes.
        _vm.Messages.CollectionChanged += OnMessagesChanged;
    }

    private void OnMessagesChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (_vm.Messages.Count == 0) return;
        // Defer until the new item has been rendered.
        MainThread.BeginInvokeOnMainThread(() =>
        {
            try
            {
                var last = _vm.Messages[^1];
                MessagesList.ScrollTo(last, position: ScrollToPosition.End, animate: false);
            }
            catch
            {
                // ScrollTo can throw if the item isn't yet realized; ignore.
            }
        });
    }

    // --- drag & drop file upload ---

    private void OnDragOver(object? sender, DragEventArgs e)
    {
        _vm.IsDragOver = true;
    }

    private void OnDragLeave(object? sender, DragEventArgs e)
    {
        _vm.IsDragOver = false;
    }

    private async void OnDrop(object? sender, DropEventArgs e)
    {
        _vm.IsDragOver = false;
        if (_vm.SelectedChannel is null) return;

        try
        {
            var view = e.DataPackage.View;
            // File drops on Windows provide paths as text; on other platforms
            // the text may contain a file URI. Parse defensively.
            if (view.Contains(StandardDataFormats.Text))
            {
                var text = await view.GetTextAsync();
                var files = text.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(s => s.Trim().TrimStart('"').TrimEnd('"'))
                    .Where(s => !string.IsNullOrEmpty(s) && File.Exists(s))
                    .ToList();
                if (files.Count > 0)
                    await _vm.HandleDropAsync(files);
            }
        }
        catch
        {
            // Drag-drop is best-effort; never crash on malformed payloads.
        }
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        // Initialize channels + websocket once the page is first shown.
        await _vm.InitializeAsync();
    }

    protected override void OnNavigatedFrom(NavigatedFromEventArgs args)
    {
        base.OnNavigatedFrom(args);
        // Release singleton service event subscriptions held by the
        // Transient ViewModel to avoid memory leaks.
        if (BindingContext is ChatViewModel vm)
            vm.Dispose();
    }
}
