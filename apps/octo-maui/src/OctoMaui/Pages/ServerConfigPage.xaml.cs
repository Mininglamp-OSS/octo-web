using OctoMaui.ViewModels;

namespace OctoMaui.Pages;

public partial class ServerConfigPage : ContentPage
{
    private readonly ServerConfigViewModel _vm;

    public ServerConfigPage(ServerConfigViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        BindingContext = _vm;
    }

    protected override void OnNavigatedFrom(NavigatedFromEventArgs args)
    {
        base.OnNavigatedFrom(args);
        // Release singleton service event subscriptions held by the
        // Transient ViewModel to avoid memory leaks.
        _vm.Dispose();
    }
}
