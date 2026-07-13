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
    // Non-sensitive user profile fields persisted to Preferences (mirrors
    // the web client's LoginInfo.save() which stores uid/name/sex etc. in
    // localStorage). The token goes to SecureStorage separately.
    private const string PrefUid = "octo.auth.uid";
    private const string PrefName = "octo.auth.name";
    private const string PrefSex = "octo.auth.sex";
    private const string PrefShortNo = "octo.auth.short_no";
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
            _user = result.ToUser();
            await SecureStorage.Default.SetAsync(TokenKey, _token);
            PersistUser(_user);
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
                    _user = new User { Id = r.Uid, Name = r.Name, Sex = r.Sex, ShortNo = r.ShortNo ?? string.Empty };
                    await SecureStorage.Default.SetAsync(TokenKey, _token);
                    PersistUser(_user);
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
        ClearUserPrefs();
        RaiseChanged();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Hydrate CurrentUser after a cold start when a saved token exists.
    /// Mirrors the web client which persists the login response and restores
    /// from local storage — does NOT call <c>GET /v1/user/current</c> (that
    /// endpoint is PUT-only for profile updates).
    /// </summary>
    public async Task<bool> HydrateCurrentUserAsync(CancellationToken ct = default)
    {
        if (!IsAuthenticated) return false;
        _user = RestoreUser();
        if (_user is null)
        {
            // No persisted user profile (e.g. upgrading from a version that
            // didn't persist user info). Force re-login to populate it.
            await LogoutAsync();
            return false;
        }
        return true;
    }

    private void RaiseChanged()
        => MainThread.BeginInvokeOnMainThread(
            () => AuthStateChanged?.Invoke(this, EventArgs.Empty));

    /// <summary>
    /// Persist non-sensitive user profile fields to <see cref="Preferences"/>.
    /// Mirrors the web client's <c>LoginInfo.save()</c>.
    /// </summary>
    private void PersistUser(User? user)
    {
        if (user is null)
        {
            ClearUserPrefs();
            return;
        }
        Preferences.Default.Set(PrefUid, user.Id);
        Preferences.Default.Set(PrefName, user.Name);
        Preferences.Default.Set(PrefSex, user.Sex);
        Preferences.Default.Set(PrefShortNo, user.ShortNo);
    }

    /// <summary>Restore the user from <see cref="Preferences"/> (cold start).</summary>
    private User? RestoreUser()
    {
        var uid = Preferences.Default.Get(PrefUid, string.Empty);
        if (string.IsNullOrEmpty(uid)) return null;
        return new User
        {
            Id = uid,
            Name = Preferences.Default.Get(PrefName, string.Empty),
            Sex = Preferences.Default.Get(PrefSex, 0),
            ShortNo = Preferences.Default.Get(PrefShortNo, string.Empty),
        };
    }

    private void ClearUserPrefs()
    {
        Preferences.Default.Remove(PrefUid);
        Preferences.Default.Remove(PrefName);
        Preferences.Default.Remove(PrefSex);
        Preferences.Default.Remove(PrefShortNo);
    }
}
