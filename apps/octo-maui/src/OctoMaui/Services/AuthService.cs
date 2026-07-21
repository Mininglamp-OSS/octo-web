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
    private const string TokenKey = PreferencesKeys.Token;
    // Non-sensitive user profile fields persisted to Preferences (mirrors
    // the web client's LoginInfo.save() which stores uid/name/sex etc. in
    // localStorage). The token goes to SecureStorage separately.
    private const string PrefUid = PreferencesKeys.AuthUid;
    private const string PrefName = PreferencesKeys.AuthName;
    private const string PrefSex = PreferencesKeys.AuthSex;
    private const string PrefShortNo = PreferencesKeys.AuthShortNo;
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
            await PersistSession(result);
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

    /// <inheritdoc />
    public async Task<bool> EmailLoginAsync(string email, string password, CancellationToken ct = default)
    {
        try
        {
            var result = await _api.EmailLoginAsync(email, password, ct);
            await PersistSession(result);
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

    /// <inheritdoc />
    public async Task<bool> RegisterAsync(string username, string name, string password, CancellationToken ct = default)
    {
        try
        {
            var result = await _api.RegisterAsync(username, name, password, ct);
            await PersistSession(result);
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

    /// <inheritdoc />
    public async Task<bool> SendEmailCodeAsync(string email, int codeType, CancellationToken ct = default)
    {
        try
        {
            await _api.SendEmailCodeAsync(email, codeType, ct);
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

    /// <inheritdoc />
    public async Task<bool> EmailRegisterAsync(string email, string password, string name, string code, CancellationToken ct = default)
    {
        try
        {
            var result = await _api.EmailRegisterAsync(email, password, name, code, ct);
            await PersistSession(result);
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

    /// <inheritdoc />
    public async Task<bool> ForgetPasswordAsync(string email, string code, string newPassword, CancellationToken ct = default)
    {
        try
        {
            await _api.ForgetPasswordAsync(email, code, newPassword, ct);
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

    /// <inheritdoc />
    public async Task<bool> LoginWithAuthCodeAsync(string authCode, CancellationToken ct = default)
    {
        try
        {
            var result = await _api.LoginWithAuthCodeAsync(authCode, ct);
            await PersistSession(result);
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

    public async Task LogoutAsync()
    {
        _token = null;
        _user = null;
        await SecureStorage.Default.RemoveAsync(TokenKey);
        ClearUserPrefs();
        RaiseChanged();
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
    /// Apply a successful <see cref="LoginResult"/>: store the token in
    /// <see cref="SecureStorage"/>, persist the user profile to
    /// <see cref="Preferences"/>, and raise
    /// <see cref="AuthStateChanged"/>. Shared by all login/register paths
    /// (password, email, register, email-register, QR authcode) that return
    /// a <see cref="LoginResult"/>. Mirrors <c>loginSuccess</c> /
    /// <c>applyLoginResp</c> in the web client.
    /// </summary>
    private async Task PersistSession(LoginResult result)
    {
        _token = result.Token;
        _user = result.ToUser();
        await SecureStorage.Default.SetAsync(TokenKey, _token);
        PersistUser(_user);
        RaiseChanged();
    }

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
