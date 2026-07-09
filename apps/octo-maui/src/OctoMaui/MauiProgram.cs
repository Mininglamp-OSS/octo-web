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
        // The initial BaseUrl is only a placeholder — the real URL is set by
        // the user via the server configuration page and loaded by
        // ServerConfigService.InitializeAsync on startup. The env var is kept
        // as a fallback for headless / CI scenarios.
        var apiBase = Environment.GetEnvironmentVariable("OCTO_API_BASE")
                      ?? "http://localhost:8080";

        builder.Services.AddSingleton(new ApiOptions { BaseUrl = apiBase });
        builder.Services.AddSingleton<IApiService, ApiService>();
        builder.Services.AddSingleton<IAuthService, AuthService>();
        builder.Services.AddSingleton<IWebSocketService, WebSocketService>();
        builder.Services.AddSingleton<IThemeService, ThemeService>();
        builder.Services.AddSingleton<IServerConfigService, ServerConfigService>();
        builder.Services.AddSingleton<IServerHistoryService, ServerHistoryService>();
        builder.Services.AddSingleton<ITrayService, TrayService>();
        builder.Services.AddSingleton<IUpdateService, UpdateService>();

        // --- ViewModels ---
        builder.Services.AddTransient<ViewModels.LoginViewModel>();
        builder.Services.AddTransient<ViewModels.ChatViewModel>();
        builder.Services.AddTransient<ViewModels.ServerConfigViewModel>();

        // --- Pages ---
        builder.Services.AddTransient<Pages.LoginPage>();
        builder.Services.AddTransient<Pages.ChatPage>();
        builder.Services.AddTransient<Pages.ServerConfigPage>();

        return builder.Build();
    }
}
