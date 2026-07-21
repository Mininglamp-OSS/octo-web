using System.Collections.ObjectModel;
using System.Windows.Input;
using OctoMaui.Models;
using OctoMaui.Services;

namespace OctoMaui.ViewModels;

public sealed class LoginViewModel : ViewModelBase, IDisposable
{
    private readonly IAuthService _auth;
    private readonly IApiService _api;
    private readonly IThemeService _theme;
    private readonly IServerConfigService _server;
    private readonly EventHandler _themeChangedHandler;
    private readonly EventHandler _serverInfoChangedHandler;
    private bool _disposed;

    // Commands stored once (not re-created on each access) so that
    // ChangeCanExecute and binding identity remain predictable.
    private readonly ICommand _loginCommand;
    private readonly ICommand _toggleThemeCommand;
    private readonly ICommand _switchServerCommand;
    private readonly ICommand _loginWithOidcCommand;

    // --- email login / register / forget-password commands ---
    private readonly Command _emailLoginCommand;
    private readonly Command _registerCommand;
    private readonly Command _emailRegisterCommand;
    private readonly Command _sendCodeCommand;
    private readonly Command _forgetSendCodeCommand;
    private readonly Command _forgetPasswordCommand;
    private readonly Command _switchToRegisterCommand;
    private readonly Command _switchToLoginCommand;
    private readonly Command _switchToForgetCommand;
    // --- QR code login command (basic state machine) ---
    private readonly Command _loadQrCodeCommand;

    // Countdown cancellation sources — cancelled (and replaced) when the
    // user re-requests a code or when the ViewModel is disposed.
    private CancellationTokenSource? _emailCodeCountdownCts;
    private CancellationTokenSource? _forgetCodeCountdownCts;
    // QR-poll cancellation — cancelled on dispose or when a new QR is requested.
    private CancellationTokenSource? _qrPollCts;

    public LoginViewModel(IAuthService auth, IApiService api, IThemeService theme, IServerConfigService server)
    {
        _auth = auth;
        _api = api;
        _theme = theme;
        _server = server;

        _loginCommand = CreateCommand(async () => await LoginAsync(), () => !IsBusy);
        _toggleThemeCommand = CreateCommand(async () => await ToggleThemeAsync());
        _switchServerCommand = CreateCommand(() => SwitchServer());
        _loginWithOidcCommand = CreateCommand<OidcProvider>(async p => await LoginWithOidcAsync(p!), _ => !IsBusy);

        _emailLoginCommand = CreateCommand(async () => await EmailLoginAsync(), () => !IsBusy);
        _registerCommand = CreateCommand(async () => await RegisterAsync(), () => !IsBusy);
        _emailRegisterCommand = CreateCommand(async () => await EmailRegisterAsync(), () => !IsBusy);
        _sendCodeCommand = CreateCommand(async () => await SendEmailCodeAsync(), () => !IsBusy && EmailCodeCountdown <= 0);
        _forgetSendCodeCommand = CreateCommand(async () => await SendForgetCodeAsync(), () => !IsBusy && ForgetCodeCountdown <= 0);
        _forgetPasswordCommand = CreateCommand(async () => await ForgetPasswordAsync(), () => !IsBusy);
        _switchToRegisterCommand = CreateCommand(() => SwitchMode(register: true, forget: false));
        _switchToLoginCommand = CreateCommand(() => SwitchMode(register: false, forget: false));
        _switchToForgetCommand = CreateCommand(() => SwitchMode(register: false, forget: true));
        _loadQrCodeCommand = CreateCommand(async () => await LoadQrCodeAsync(), () => !IsBusy);

        _themeChangedHandler = (_, _) => MainThread.BeginInvokeOnMainThread(RefreshThemeLabel);
        _serverInfoChangedHandler = (_, _) => MainThread.BeginInvokeOnMainThread(RefreshOidcProviders);
        _theme.ThemeChanged += _themeChangedHandler;
        _server.ServerInfoChanged += _serverInfoChangedHandler;

        RefreshThemeLabel();
        RefreshOidcProviders();
    }

    // --- local login ---

    public string ThemeLabel { get => Get<string>(); set => Set(value); }

    public string Username { get => Get<string>(); set => Set(value); }
    public string Password { get => Get<string>(); set => Set(value); }
    public string ErrorMessage { get => Get<string>(); set => Set(value); }
    public bool IsBusy { get => Get<bool>(); set => Set(value); }

    public ICommand LoginCommand => _loginCommand;
    public ICommand ToggleThemeCommand => _toggleThemeCommand;
    public ICommand SwitchServerCommand => _switchServerCommand;

    // --- email login ---

    /// <summary>Email used for email-password login.</summary>
    public string Email { get => Get<string>(); set => Set(value); }
    public string EmailPassword { get => Get<string>(); set => Set(value); }

    // --- username registration ---

    public string RegisterUsername { get => Get<string>(); set => Set(value); }
    public string RegisterName { get => Get<string>(); set => Set(value); }
    public string RegisterPassword { get => Get<string>(); set => Set(value); }
    public string RegisterConfirmPassword { get => Get<string>(); set => Set(value); }

    // --- email registration ---

    public string RegisterEmail { get => Get<string>(); set => Set(value); }
    public string RegisterEmailPassword { get => Get<string>(); set => Set(value); }
    public string RegisterEmailName { get => Get<string>(); set => Set(value); }
    public string RegisterEmailCode { get => Get<string>(); set => Set(value); }
    /// <summary>Cooldown (seconds) for the register "send code" button.</summary>
    public int EmailCodeCountdown
    {
        get => Get<int>();
        set
        {
            Set(value);
            _sendCodeCommand.ChangeCanExecute();
        }
    }

    // --- forget password ---

    public string ForgetEmail { get => Get<string>(); set => Set(value); }
    public string ForgetCode { get => Get<string>(); set => Set(value); }
    public string ForgetNewPassword { get => Get<string>(); set => Set(value); }
    public string ForgetConfirmPassword { get => Get<string>(); set => Set(value); }
    /// <summary>Cooldown (seconds) for the forget-password "send code" button.</summary>
    public int ForgetCodeCountdown
    {
        get => Get<int>();
        set
        {
            Set(value);
            _forgetSendCodeCommand.ChangeCanExecute();
        }
    }

    // --- UI mode flags ---

    /// <summary>True when the register panel is visible (username or email).</summary>
    public bool IsRegisterMode { get => Get<bool>(); set => Set(value); }
    /// <summary>True when the forget-password panel is visible.</summary>
    public bool IsForgetMode { get => Get<bool>(); set => Set(value); }

    // --- QR code login (basic state machine) ---

    /// <summary>QR code payload (URL) rendered into the QR image.</summary>
    public string QrCode { get => Get<string>(); set => Set(value); }
    /// <summary>True while fetching a new QR code.</summary>
    public bool QrCodeLoading { get => Get<bool>(); set => Set(value); }
    /// <summary>Status text shown under the QR code (waitScan/scanned/authed/expired).</summary>
    public string QrLoginStatusText { get => Get<string>(); set => Set(value); }

    // --- OIDC / enterprise passport ---

    /// <summary>SSO providers advertised by the server's appconfig.</summary>
    public ObservableCollection<OidcProvider> OidcProviders { get; } = new();

    /// <summary>True when at least one OIDC provider is available.</summary>
    public bool HasOidcProviders { get => Get<bool>(); set => Set(value); }

    /// <summary>Status message during OIDC login (authcode / polling).</summary>
    public string OidcStatus
    {
        get => Get<string>();
        set
        {
            Set(value);
            OnPropertyChanged(nameof(HasOidcStatus));
        }
    }
    public bool HasOidcStatus => !string.IsNullOrWhiteSpace(OidcStatus);

    /// <summary>Parameterized command: receives an <see cref="OidcProvider"/>.</summary>
    public ICommand LoginWithOidcCommand => _loginWithOidcCommand;

    // --- new command properties ---

    public ICommand EmailLoginCommand => _emailLoginCommand;
    public ICommand RegisterCommand => _registerCommand;
    public ICommand EmailRegisterCommand => _emailRegisterCommand;
    public ICommand SendCodeCommand => _sendCodeCommand;
    public ICommand ForgetSendCodeCommand => _forgetSendCodeCommand;
    public ICommand ForgetPasswordCommand => _forgetPasswordCommand;
    public ICommand SwitchToRegisterCommand => _switchToRegisterCommand;
    public ICommand SwitchToLoginCommand => _switchToLoginCommand;
    public ICommand SwitchToForgetCommand => _switchToForgetCommand;
    public ICommand LoadQrCodeCommand => _loadQrCodeCommand;

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

    private async Task EmailLoginAsync()
    {
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrWhiteSpace(EmailPassword))
        {
            ErrorMessage = "请输入邮箱和密码";
            return;
        }

        IsBusy = true;
        ErrorMessage = string.Empty;
        try
        {
            var ok = await _auth.EmailLoginAsync(Email, EmailPassword);
            if (!ok)
                ErrorMessage = "邮箱登录失败，请检查邮箱和密码";
        }
        catch (Exception ex)
        {
            ErrorMessage = $"邮箱登录异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task RegisterAsync()
    {
        if (string.IsNullOrWhiteSpace(RegisterUsername) || string.IsNullOrWhiteSpace(RegisterPassword))
        {
            ErrorMessage = "请输入用户名和密码";
            return;
        }
        if (!string.Equals(RegisterPassword, RegisterConfirmPassword, StringComparison.Ordinal))
        {
            ErrorMessage = "两次输入的密码不一致";
            return;
        }

        IsBusy = true;
        ErrorMessage = string.Empty;
        try
        {
            var ok = await _auth.RegisterAsync(RegisterUsername, RegisterName, RegisterPassword);
            if (!ok)
                ErrorMessage = "注册失败，用户名可能已存在";
        }
        catch (Exception ex)
        {
            ErrorMessage = $"注册异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task SendEmailCodeAsync()
    {
        if (string.IsNullOrWhiteSpace(RegisterEmail))
        {
            ErrorMessage = "请输入注册邮箱";
            return;
        }

        IsBusy = true;
        ErrorMessage = string.Empty;
        try
        {
            // code_type: 0 = register (mirrors requestEmailSendCode in login_vm.tsx)
            var ok = await _auth.SendEmailCodeAsync(RegisterEmail, codeType: 0);
            if (ok)
            {
                _emailCodeCountdownCts?.Cancel();
                _emailCodeCountdownCts?.Dispose();
                _emailCodeCountdownCts = new CancellationTokenSource();
                await StartCountdownAsync(
                    v => EmailCodeCountdown = v,
                    _sendCodeCommand,
                    _emailCodeCountdownCts.Token);
            }
            else
            {
                ErrorMessage = "验证码发送失败，请稍后重试";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = $"发送验证码异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task SendForgetCodeAsync()
    {
        if (string.IsNullOrWhiteSpace(ForgetEmail))
        {
            ErrorMessage = "请输入邮箱";
            return;
        }

        IsBusy = true;
        ErrorMessage = string.Empty;
        try
        {
            // code_type: 2 = forget password (mirrors requestEmailSendCode in login.tsx)
            var ok = await _auth.SendEmailCodeAsync(ForgetEmail, codeType: 2);
            if (ok)
            {
                _forgetCodeCountdownCts?.Cancel();
                _forgetCodeCountdownCts?.Dispose();
                _forgetCodeCountdownCts = new CancellationTokenSource();
                await StartCountdownAsync(
                    v => ForgetCodeCountdown = v,
                    _forgetSendCodeCommand,
                    _forgetCodeCountdownCts.Token);
            }
            else
            {
                ErrorMessage = "验证码发送失败，请稍后重试";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = $"发送验证码异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task EmailRegisterAsync()
    {
        if (string.IsNullOrWhiteSpace(RegisterEmail) || string.IsNullOrWhiteSpace(RegisterEmailPassword))
        {
            ErrorMessage = "请输入邮箱和密码";
            return;
        }
        if (string.IsNullOrWhiteSpace(RegisterEmailCode))
        {
            ErrorMessage = "请输入邮箱验证码";
            return;
        }

        IsBusy = true;
        ErrorMessage = string.Empty;
        try
        {
            var ok = await _auth.EmailRegisterAsync(RegisterEmail, RegisterEmailPassword, RegisterEmailName, RegisterEmailCode);
            if (!ok)
                ErrorMessage = "邮箱注册失败，验证码可能无效或邮箱已被注册";
        }
        catch (Exception ex)
        {
            ErrorMessage = $"邮箱注册异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task ForgetPasswordAsync()
    {
        if (string.IsNullOrWhiteSpace(ForgetEmail) || string.IsNullOrWhiteSpace(ForgetCode) || string.IsNullOrWhiteSpace(ForgetNewPassword))
        {
            ErrorMessage = "请输入邮箱、验证码和新密码";
            return;
        }
        if (!string.Equals(ForgetNewPassword, ForgetConfirmPassword, StringComparison.Ordinal))
        {
            ErrorMessage = "两次输入的密码不一致";
            return;
        }

        IsBusy = true;
        ErrorMessage = string.Empty;
        try
        {
            var ok = await _auth.ForgetPasswordAsync(ForgetEmail, ForgetCode, ForgetNewPassword);
            if (ok)
            {
                ErrorMessage = "密码重置成功，请使用新密码登录";
                // Clear sensitive fields (mirrors clearSensitiveFields in login_vm.tsx)
                ForgetCode = string.Empty;
                ForgetNewPassword = string.Empty;
                ForgetConfirmPassword = string.Empty;
                // Switch back to login view
                SwitchMode(register: false, forget: false);
            }
            else
            {
                ErrorMessage = "密码重置失败，验证码可能无效";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = $"密码重置异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void SwitchMode(bool register, bool forget)
    {
        IsRegisterMode = register;
        IsForgetMode = forget;
        ErrorMessage = string.Empty;
    }

    /// <summary>
    /// Run a 60-second countdown on the UI thread (mirrors the
    /// <c>emailCodeCountdown</c> / <c>registerCodeCountdown</c> timers in
    /// <c>login_vm.tsx</c>). The caller is responsible for cancelling the
    /// previous countdown's <see cref="CancellationTokenSource"/> before
    /// invoking this method.
    /// </summary>
    private async Task StartCountdownAsync(Action<int> setCountdown, Command refreshCmd, CancellationToken token)
    {
        refreshCmd.ChangeCanExecute();
        try
        {
            for (var i = 60; i > 0; i--)
            {
                token.ThrowIfCancellationRequested();
                setCountdown(i);
                await Task.Delay(1000, token);
            }
            setCountdown(0);
            refreshCmd.ChangeCanExecute();
        }
        catch (OperationCanceledException)
        {
            // Expected when a new countdown supersedes this one or on dispose.
        }
    }

    // --- QR code login (basic state machine, no full UI) ---

    /// <summary>
    /// Fetch a fresh QR code and start polling
    /// <c>GET /v1/user/loginstatus?uuid=...</c>. Mirrors
    /// <c>requestUUID</c> + <c>pullLoginStatus</c> in <c>login_vm.tsx</c>.
    /// Polling continues until the status reaches <c>authed</c> (login
    /// via <see cref="IAuthService.LoginWithAuthCodeAsync"/>) or
    /// <c>expired</c>.
    /// </summary>
    private async Task LoadQrCodeAsync()
    {
        IsBusy = true;
        QrCodeLoading = true;
        ErrorMessage = string.Empty;
        try
        {
            _qrPollCts?.Cancel();
            _qrPollCts?.Dispose();
            _qrPollCts = new CancellationTokenSource();
            var info = await _api.GetQrCodeAsync(_qrPollCts.Token);
            QrCode = info.QrCode;
            QrLoginStatusText = "请使用移动端扫码登录";
            // Fire-and-forget the polling loop; it updates QrLoginStatusText
            // and calls LoginWithAuthCodeAsync when authed.
            _ = PollQrLoginAsync(info.Uuid, _qrPollCts.Token);
        }
        catch (OperationCanceledException)
        {
            // Suppressed — cancelled by a new request or dispose.
        }
        catch (Exception ex)
        {
            QrLoginStatusText = $"二维码获取失败: {ex.Message}";
        }
        finally
        {
            QrCodeLoading = false;
            IsBusy = false;
        }
    }

    /// <summary>
    /// Poll the QR login status every 2 seconds (matching the web client's
    /// <c>pullLoginStatus</c> cadence). Stops on <c>authed</c> or
    /// <c>expired</c>. Transient errors are swallowed and the loop retries
    /// up to <see cref="QrPollMaxErrors"/> times before bailing.
    /// </summary>
    private async Task PollQrLoginAsync(string uuid, CancellationToken ct)
    {
        var errCount = 0;
        var startTime = DateTime.UtcNow;
        while (!ct.IsCancellationRequested)
        {
            if (DateTime.UtcNow - startTime > QrPollMaxDuration)
            {
                QrLoginStatusText = "二维码已过期，请刷新";
                return;
            }

            try
            {
                await Task.Delay(2000, ct);
                var status = await _api.PollQrLoginStatusAsync(uuid, ct);
                errCount = 0;

                if (status.IsScanned)
                {
                    QrLoginStatusText = "已扫码，请在手机上确认登录";
                }
                else if (status.IsAuthed && !string.IsNullOrEmpty(status.AuthCode))
                {
                    QrLoginStatusText = "已授权，正在登录…";
                    var ok = await _auth.LoginWithAuthCodeAsync(status.AuthCode!, ct);
                    if (!ok)
                        QrLoginStatusText = "登录失败，请刷新二维码重试";
                    return;
                }
                else if (status.IsExpired)
                {
                    QrLoginStatusText = "二维码已过期，请刷新";
                    return;
                }
                // waitScan — keep polling.
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch
            {
                errCount++;
                if (errCount >= QrPollMaxErrors)
                {
                    QrLoginStatusText = "网络异常，请刷新二维码重试";
                    return;
                }
            }
        }
    }

    /// <summary>Max consecutive poll errors before bailing (mirrors _pullMaxErrCount).</summary>
    private const int QrPollMaxErrors = 5;

    /// <summary>Max polling duration before client-side expiry (5 minutes, mirrors server expiry).</summary>
    private static readonly TimeSpan QrPollMaxDuration = TimeSpan.FromMinutes(5);

    private async Task LoginWithOidcAsync(OidcProvider provider)
    {
        IsBusy = true;
        ErrorMessage = string.Empty;
        OidcStatus = string.Empty;

        var progress = new Progress<string>(msg => MainThread.BeginInvokeOnMainThread(() => OidcStatus = msg));
        try
        {
            var ok = await _auth.LoginWithOidcAsync(provider, progress);
            if (!ok && string.IsNullOrWhiteSpace(OidcStatus))
                ErrorMessage = "企业登录失败，请重试";
        }
        catch (Exception ex)
        {
            ErrorMessage = $"企业登录异常: {ex.Message}";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void RefreshOidcProviders()
    {
        OidcProviders.Clear();
        if (_server.ServerInfo is { } info)
        {
            foreach (var p in info.OidcProviders)
                OidcProviders.Add(p);
        }
        HasOidcProviders = OidcProviders.Count > 0;
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

    private static void SwitchServer()
    {
        Shell.Current.GoToAsync("//server-config");
    }

    // --- IDisposable ---

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _theme.ThemeChanged -= _themeChangedHandler;
        _server.ServerInfoChanged -= _serverInfoChangedHandler;
        _emailCodeCountdownCts?.Cancel();
        _emailCodeCountdownCts?.Dispose();
        _forgetCodeCountdownCts?.Cancel();
        _forgetCodeCountdownCts?.Dispose();
        _qrPollCts?.Cancel();
        _qrPollCts?.Dispose();
        GC.SuppressFinalize(this);
    }
}
