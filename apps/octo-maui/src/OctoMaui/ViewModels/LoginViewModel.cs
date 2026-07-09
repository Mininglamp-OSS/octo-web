using System.Windows.Input;
using OctoMaui.Services;

namespace OctoMaui.ViewModels;

public sealed class LoginViewModel : ViewModelBase
{
    private readonly IAuthService _auth;
    private readonly IThemeService _theme;

    public LoginViewModel(IAuthService auth, IThemeService theme)
    {
        _auth = auth;
        _theme = theme;
        _theme.ThemeChanged += (_, _) => MainThread.BeginInvokeOnMainThread(RefreshThemeLabel);
        RefreshThemeLabel();
    }

    public string Username { get => Get<string>(); set => Set(value); }
    public string Password { get => Get<string>(); set => Set(value); }
    public string ErrorMessage { get => Get<string>(); set => Set(value); }
    public bool IsBusy { get => Get<bool>(); set => Set(value); }

    /// <summary>Localized label for the theme toggle button.</summary>
    public string ThemeLabel { get => Get<string>(); set => Set(value); } = "主题";

    public ICommand LoginCommand => CreateCommand(async () => await LoginAsync(), () => !IsBusy);
    public ICommand ToggleThemeCommand => CreateCommand(async () => await ToggleThemeAsync());

    private async Task LoginAsync()
    {
        if (string.IsNullOrWhiteSpace(Username) || string.IsNullOrWhiteSpace(Password))
        {
            ErrorMessage = "请输入用户名和密码";
            return;
        }

        IsBusy = true;
        ErrorMessage = string.Empty;
        try
        {
            var ok = await _auth.LoginAsync(Username, Password);
            if (!ok)
                ErrorMessage = "登录失败，请检查用户名和密码";
        }
        catch (Exception ex)
        {
            ErrorMessage = $"登录异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task ToggleThemeAsync()
    {
        var next = _theme.Mode switch
        {
            AppTheme.Unspecified => AppTheme.Light,
            AppTheme.Light => AppTheme.Dark,
            _ => AppTheme.Unspecified,
        };
        await _theme.SetModeAsync(next);
        RefreshThemeLabel();
    }

    private void RefreshThemeLabel()
    {
        ThemeLabel = _theme.Mode switch
        {
            AppTheme.Light => "浅色",
            AppTheme.Dark => "深色",
            _ => "跟随系统",
        };
    }
}
