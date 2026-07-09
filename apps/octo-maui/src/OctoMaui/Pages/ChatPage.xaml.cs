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

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        // Initialize channels + websocket once the page is first shown.
        await _vm.InitializeAsync();
    }
}
