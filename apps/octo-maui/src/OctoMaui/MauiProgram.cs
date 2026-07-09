using Microsoft.Extensions.Logging;
using OctoMaui.Services;

namespace OctoMaui;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        // System default fonts; add custom fonts via ConfigureFonts if needed.
        builder.UseMauiApp<App>();

#if DEBUG
        builder.Logging.AddDebug();
#endif

        // --- Dependency injection: services ---
        // API base URL — override via OCTO_API_BASE env var.
        var apiBase = Environment.GetEnvironmentVariable("OCTO_API_BASE")
                      ?? "http://localhost:8080";

        builder.Services.AddSingleton(new ApiOptions { BaseUrl = apiBase });
        builder.Services.AddSingleton<IApiService, ApiService>();
        builder.Services.AddSingleton<IAuthService, AuthService>();
        builder.Services.AddSingleton<IWebSocketService, WebSocketService>();
        builder.Services.AddSingleton<IThemeService, ThemeService>();

        // --- ViewModels ---
        builder.Services.AddTransient<ViewModels.LoginViewModel>();
        builder.Services.AddTransient<ViewModels.ChatViewModel>();

        // --- Pages ---
        builder.Services.AddTransient<Pages.LoginPage>();
        builder.Services.AddTransient<Pages.ChatPage>();

        return builder.Build();
    }
}
