using Foundation;
using Microsoft.Maui;
using Microsoft.Maui.Hosting;

namespace OctoMaui.Platforms.MacCatalyst;

[Register("AppDelegate")]
public class AppDelegate : MauiUIApplicationDelegate
{
    protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}
