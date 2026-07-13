using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Holds the current session. Persists the token to
/// <see cref="SecureStorage"/> (DPAPI / Keychain / KeyStore) so the user
/// stays signed in across launches without storing the bearer token in
/// plaintext. Supports both the local username/password login and
/// enterprise OIDC/SSO passport login.
/// </summary>
public sealed class AuthService : IAuthService
{
    private const string TokenKey = "octo.auth.token";
    private readonly IApiService _api;

    /// <summary>Poll interval for OIDC authstatus.</summary>
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(2);
    /// <summary>Maximum wait for the user to complete SSO in the browser.</summary>
    private static readonly TimeSpan PollTimeout = TimeSpan.FromMinutes(5);

    private string? _token;
    private User? _user;

    public AuthService(IApiService api)
    {
        _api = api;
        // Token is loaded asynchronously via InitializeAsync() from
        // SecureStorage — not in the constructor (SecureStorage is async-only).
    }

    /// <summary>
    /// Load the saved token from SecureStorage. Must be called once during
    /// app startup (before any auth-state check), typically from AppShell.
    /// </summary>
    public async Task InitializeAsync()
    {
        try
        {
            _token = await SecureStorage.Default.GetAsync(TokenKey);
        }
        catch
        {
            // SecureStorage may be unavailable in early launch / design-time.
            _token = null;
        }
    }

    public bool IsAuthenticated => !string.IsNullOrWhiteSpace(_token);

    public string? Token => _token;

    public User? CurrentUser => _user;

    public event EventHandler? AuthStateChanged;

    public async Task<bool> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        try
        {
            var result = await _api.LoginAsync(username, password, ct);
            _token = result.Token;
            _user = result.User;
            await SecureStorage.Default.SetAsync(TokenKey, _token);
            RaiseChanged();
            return true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            return false;
        }
    }

    public async Task<bool> LoginWithOidcAsync(OidcProvider provider, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        try
        {
            // 1. Request a one-time authcode from the server.
            progress?.Report("正在获取授权码…");
            var authCode = await _api.GetAuthCodeAsync(ct);
            if (string.IsNullOrWhiteSpace(authCode))
            {
                progress?.Report("✗ 无法获取授权码");
                return false;
            }

            // 2. Open the IdP authorize URL in the system browser.
            var authorizeUrl = _api.BuildAuthorizeUrl(provider, authCode);
            progress?.Report($"正在打开浏览器，请在企业登录页面完成认证…");
            await Browser.OpenAsync(authorizeUrl, BrowserLaunchMode.SystemPreferred);

            // 3. Poll the server for login completion (the IdP calls back to
            //    the server, which updates the authcode status).
            progress?.Report("等待企业登录完成…");
            var deadline = DateTimeOffset.UtcNow + PollTimeout;
            while (DateTimeOffset.UtcNow < deadline)
            {
                ct.ThrowIfCancellationRequested();
                await Task.Delay(PollInterval, ct);

                var status = await _api.PollAuthStatusAsync(authCode, ct);
                if (status.IsSuccess && status.Result is { } r)
                {
                    _token = r.Token;
                    _user = new User { Id = r.Uid, Name = r.Name };
                    await SecureStorage.Default.SetAsync(TokenKey, _token);
                    progress?.Report("✓ 登录成功");
                    RaiseChanged();
                    return true;
                }
                if (status.IsFailure)
                {
                    progress?.Report($"✗ {status.Msg ?? "登录失败"}");
                    return false;
                }
                // status.IsPending — keep polling.
            }

            progress?.Report("✗ 登录超时，请重试");
            return false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            progress?.Report($"✗ {ex.Message}");
            return false;
        }
    }

    public Task LogoutAsync()
    {
        _token = null;
        _user = null;
        SecureStorage.Default.Remove(TokenKey);
        RaiseChanged();
        return Task.CompletedTask;
    }

    /// <summary>Hydrate CurrentUser after a cold start when a saved token exists.</summary>
    public async Task<bool> HydrateCurrentUserAsync(CancellationToken ct = default)
    {
        if (!IsAuthenticated) return false;
        try
        {
            _user = await _api.GetCurrentUserAsync(_token!, ct);
            return true;
        }
        catch
        {
            // Token invalid — force logout.
            await LogoutAsync();
            return false;
        }
    }

    private void RaiseChanged()
        => MainThread.BeginInvokeOnMainThread(
            () => AuthStateChanged?.Invoke(this, EventArgs.Empty));
}
