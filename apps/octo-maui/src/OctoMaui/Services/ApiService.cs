using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// REST client for octo-server. The internal <see cref="HttpClient"/> can be
/// rebuilt at runtime via <see cref="UpdateBaseUrl"/> when the user switches
/// server domains.
/// </summary>
public sealed class ApiService : IApiService
{
    private readonly ApiOptions _options;
    private HttpClient _http;
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public ApiService(ApiOptions options)
    {
        _options = options;
        _http = CreateClient(options.BaseUrl, options.Timeout);
    }

    public string BaseUrl => _options.BaseUrl;

    /// <inheritdoc />
    public void UpdateBaseUrl(string url)
    {
        var normalized = NormalizeUrl(url);
        _options.BaseUrl = normalized;
        var oldClient = Interlocked.Exchange(ref _http, CreateClient(normalized, _options.Timeout));
        // Old instance is disposed after a delay to avoid ObjectDisposedException
        // for in-flight requests that still hold a reference to it.
        _ = Task.Delay(TimeSpan.FromSeconds(30)).ContinueWith(t =>
        {
            try { oldClient?.Dispose(); }
            catch { /* ignore dispose errors */ }
        }, TaskScheduler.Default);
    }

    /// <inheritdoc />
    public async Task<bool> PingAsync(string url, CancellationToken ct = default)
    {
        var normalized = NormalizeUrl(url);
        using var probe = CreateClient(normalized, TimeSpan.FromSeconds(5));
        try
        {
            // Probe the real octo-server capability endpoint. A 2xx response
            // means the server is reachable AND is an octo-server (not just
            // any HTTP listener that would 200 on "/"). This unifies the
            // reachability and capability checks — GetServerInfoAsync hits the
            // same endpoint for the full OIDC config.
            using var resp = await probe.GetAsync(ApiPaths.CommonAppconfig, ct);
            return resp.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public async Task<LoginResult> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx requestLoginWithUsernameAndPwd: the payload
        // includes flag (device type: 0=app, 1=web, 2=pc) and a device info
        // object. MAUI is a PC client, so flag=2.
        var payload = new
        {
            username,
            password,
            flag = ApiDefaults.DeviceFlagPc,
            device = GetDevice(),
        };
        var resp = await _http.PostAsJsonAsync(ApiPaths.UserLogin, payload, ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<LoginResult>(Json, ct)
                   ?? throw new InvalidOperationException("Empty login response.");
        return body;
    }

    /// <inheritdoc />
    public async Task<LoginResult> EmailLoginAsync(string email, string password, CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx requestEmailLogin: { email, password, flag, device }.
        // The web client uses flag=1; MAUI is a PC client so flag=2 (matches
        // the value sent in user/login).
        var payload = new
        {
            email,
            password,
            flag = ApiDefaults.DeviceFlagPc,
            device = GetDevice(),
        };
        var resp = await _http.PostAsJsonAsync(ApiPaths.UserEmailLogin, payload, ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<LoginResult>(Json, ct)
                   ?? throw new InvalidOperationException("Empty email login response.");
        return body;
    }

    /// <inheritdoc />
    public async Task<LoginResult> RegisterAsync(string username, string name, string password, CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx requestRegister: { username, name, password, flag, device }.
        // On success the server returns a LoginResult (auto-login after register).
        var payload = new
        {
            username,
            name,
            password,
            flag = ApiDefaults.DeviceFlagPc,
            device = GetDevice(),
        };
        var resp = await _http.PostAsJsonAsync(ApiPaths.UserUsernameRegister, payload, ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<LoginResult>(Json, ct)
                   ?? throw new InvalidOperationException("Empty register response.");
        return body;
    }

    /// <inheritdoc />
    public async Task SendEmailCodeAsync(string email, int codeType, CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx requestEmailSendCode: { email, code_type }.
        // code_type: 0 = register, 2 = forget password (matches login.tsx).
        var payload = new
        {
            email,
            code_type = codeType,
        };
        var resp = await _http.PostAsJsonAsync(ApiPaths.UserEmailSendCode, payload, ct);
        resp.EnsureSuccessStatusCode();
        // No structured response body — success is indicated by 2xx status.
    }

    /// <inheritdoc />
    public async Task<LoginResult> EmailRegisterAsync(string email, string password, string name, string code, CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx requestEmailRegister:
        // { email, password, name, code, flag, device }.
        var payload = new
        {
            email,
            password,
            name,
            code,
            flag = ApiDefaults.DeviceFlagPc,
            device = GetDevice(),
        };
        var resp = await _http.PostAsJsonAsync(ApiPaths.UserEmailRegister, payload, ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<LoginResult>(Json, ct)
                   ?? throw new InvalidOperationException("Empty email register response.");
        return body;
    }

    /// <inheritdoc />
    public async Task ForgetPasswordAsync(string email, string code, string newPassword, CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx requestForgetPassword:
        // { email, code, new_password }.
        var payload = new
        {
            email,
            code,
            new_password = newPassword,
        };
        var resp = await _http.PostAsJsonAsync(ApiPaths.UserEmailForgetPwd, payload, ct);
        resp.EnsureSuccessStatusCode();
        // No structured response body — success is indicated by 2xx status.
    }

    // --- QR code login (state machine driven, see login_vm.tsx advance) ---
    // These endpoints use the /v1/* path prefix and do not require a token —
    // they're pre-authentication (same as the OIDC endpoints above).

    /// <inheritdoc />
    public async Task<QrCodeInfo> GetQrCodeAsync(CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx requestUUID: GET user/loginuuid with the device
        // info sent as query params (web client uses { param: device }).
        var query = GetDeviceQuery();
        using var resp = await _http.GetAsync($"{ApiPaths.UserLoginUuid}?{query}", ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<QrCodeInfo>(Json, ct)
                   ?? throw new InvalidOperationException("Empty loginuuid response.");
        return body;
    }

    /// <inheritdoc />
    public async Task<QrLoginStatus> PollQrLoginStatusAsync(string uuid, CancellationToken ct = default)
    {
        // Mirrors login_vm.tsx pullLoginStatus:
        // GET user/loginstatus?uuid=${uuid}.
        using var resp = await _http.GetAsync($"{ApiPaths.UserLoginStatus}?uuid={Uri.EscapeDataString(uuid)}", ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<QrLoginStatus>(Json, ct)
                   ?? new QrLoginStatus { Status = "expired" };
        return body;
    }

    /// <inheritdoc />
    public async Task<LoginResult> LoginWithAuthCodeAsync(string authCode, CancellationToken ct = default)
    {
        using var resp = await _http.PostAsync($"{ApiPaths.UserLoginAuthcode}/{Uri.EscapeDataString(authCode)}", content: null, ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<LoginResult>(Json, ct)
                   ?? throw new InvalidOperationException("Empty authcode login response.");
        return body;
    }

    /// <remarks>
    /// WIP: The web client never calls <c>GET /v1/user/current</c> to fetch
    /// the current user — it persists the login response and hydrates from
    /// local storage (see <c>loginSession.ts</c> <c>applyLoginResp</c>).
    /// The <c>/v1/user/current</c> endpoint is used with PUT to update the
    /// user's profile, not GET. <see cref="AuthService.HydrateCurrentUserAsync"/>
    /// restores from Preferences instead of calling this method. Retained for
    /// potential future server-side support.
    /// </remarks>
    public async Task<User> GetCurrentUserAsync(string token, CancellationToken ct = default)
    {
        using var req = Authed(token, HttpMethod.Get, ApiPaths.UserCurrent);
        return await SendAsync<User>(req, ct);
    }

    /// <remarks>
    /// WIP: The octo-server does not expose a REST endpoint for listing
    /// channels — conversation sync is handled by the WuKongIM SDK
    /// (<c>wkstore.sync</c>), which has no .NET binding yet. This method
    /// returns an empty list until WuKongIM .NET support is implemented.
    /// See the README "Limitations" section.
    /// </remarks>
    public Task<List<Channel>> GetChannelsAsync(string token, CancellationToken ct = default)
    {
        return Task.FromResult(new List<Channel>());
    }

    /// <remarks>
    /// WIP: The octo-server does not expose a REST endpoint for message
    /// history — messages are fetched via the WuKongIM sync API. This method
    /// returns an empty list until WuKongIM .NET support is implemented.
    /// See the README "Limitations" section.
    /// </remarks>
    public Task<List<Message>> GetMessagesAsync(string token, string channelId, int limit = 50, long? beforeTimestamp = null, CancellationToken ct = default)
    {
        return Task.FromResult(new List<Message>());
    }

    /// <remarks>
    /// WIP: The octo-server does NOT expose a REST endpoint for sending
    /// messages — outgoing messages go through the WuKongIM SDK
    /// (<c>chatManager.send</c>) over the IM WebSocket, not HTTP. The
    /// <c>/v1/message/send</c> endpoint used previously was a fabricated
    /// assumption with no counterpart in octo-web/octo-server. The MAUI
    /// client sends messages via <see cref="IWebSocketService.SendAsync"/>
    /// (see <c>ChatViewModel.SendAsync</c>); this REST method is retained
    /// only to satisfy the interface contract and will throw until a real
    /// REST send path is introduced. See the README "Limitations" section.
    /// </remarks>
    public Task<Message> SendMessageAsync(string token, string channelId, string content, CancellationToken ct = default)
    {
        throw new NotImplementedException(
            "REST message send is not supported by octo-server. Use IWebSocketService.SendAsync (WuKongIM) instead.");
    }

    /// <inheritdoc />
    public async Task<string> UploadFileAsync(string token, string channelId, ChannelType channelType, Stream fileStream, string fileName, string contentType, CancellationToken ct = default)
    {
        // Two-step presigned direct upload (matches packages/dmworkbase/src/
        // Service/UploadCredentials.ts — uploadChatMedia):
        // 1. GET /v1/file/upload/credentials?path=...&type=chat&... → credentials
        // 2. PUT raw file body to credentials.uploadUrl → return downloadUrl
        var ext = Path.GetExtension(fileName);
        var path = $"/{(int)channelType}/{channelId}/{Guid.NewGuid():N}{ext}";
        var fileSize = fileStream.CanSeek ? fileStream.Length : 0;

        var query = $"path={Uri.EscapeDataString(path)}"
                  + "&type=chat"
                  + $"&filename={Uri.EscapeDataString(fileName)}"
                  + $"&contentType={Uri.EscapeDataString(contentType)}"
                  + $"&fileSize={fileSize}";

        using var credReq = Authed(token, HttpMethod.Get, $"{ApiPaths.FileUploadCredentials}?{query}");
        var cred = await SendAsync<UploadCredentials>(credReq, ct);

        // Step 2: PUT raw body to the presigned uploadUrl. No token header —
        // the presigned URL carries its own signature; adding auth headers
        // could break signature validation on some object stores.
        using var putReq = new HttpRequestMessage(HttpMethod.Put, cred.UploadUrl);
        var body = new StreamContent(fileStream);
        body.Headers.ContentType = new MediaTypeHeaderValue(cred.ContentType);
        if (!string.IsNullOrEmpty(cred.ContentDisposition))
        {
            // Content-Disposition is a restricted header in .NET — add it
            // without validation to preserve the server-provided value verbatim.
            body.Headers.TryAddWithoutValidation("Content-Disposition", cred.ContentDisposition);
        }
        putReq.Content = body;
        using var putResp = await _http.SendAsync(putReq, ct);
        putResp.EnsureSuccessStatusCode();

        return cred.DownloadUrl;
    }

    /// <summary>
    /// Presigned upload credentials returned by
    /// <c>GET /v1/file/upload/credentials</c>. Matches the
    /// <c>UploadCredentials</c> interface in
    /// packages/dmworkbase/src/Service/UploadCredentials.ts (camelCase).
    /// </summary>
    private sealed class UploadCredentials
    {
        [JsonPropertyName("uploadUrl")]
        public string UploadUrl { get; set; } = string.Empty;

        [JsonPropertyName("downloadUrl")]
        public string DownloadUrl { get; set; } = string.Empty;

        [JsonPropertyName("contentType")]
        public string ContentType { get; set; } = string.Empty;

        [JsonPropertyName("contentDisposition")]
        public string? ContentDisposition { get; set; }
    }

    // --- OIDC / enterprise passport (SSO) ---
    // These endpoints use the /v1/* path prefix (matching the web client's
    // oidc/http.ts) and do not require a token — they're pre-authentication.

    public async Task<ServerInfo> GetServerInfoAsync(CancellationToken ct = default)
    {
        try
        {
            using var resp = await _http.GetAsync(ApiPaths.CommonAppconfig, ct);
            if (!resp.IsSuccessStatusCode) return new ServerInfo();
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), ct);
            var info = new ServerInfo();

            // legacy_password_login_off: when true, the server has disabled
            // username/password login (backend field in appconfig).
            if (doc.RootElement.TryGetProperty("legacy_password_login_off", out var lplo) && lplo.ValueKind == JsonValueKind.True)
            {
                info.LegacyPasswordLoginOff = true;
            }

            if (doc.RootElement.TryGetProperty("oidc_providers", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in arr.EnumerateArray())
                {
                    // id and name must be non-empty strings — skip otherwise.
                    var id = item.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String
                        ? idEl.GetString() ?? "" : "";
                    var name = item.TryGetProperty("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String
                        ? nameEl.GetString() ?? "" : "";
                    if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(name)) continue;

                    // authorize_path must be a safe in-site relative path
                    // (starts with /, not //) — mirrors isSafeAuthorizePath
                    // in OidcConfig.ts. Skip unsafe entries.
                    var authorizePath = item.TryGetProperty("authorize_path", out var apEl) && apEl.ValueKind == JsonValueKind.String
                        ? apEl.GetString() ?? "" : "";
                    if (!IsSafeAuthorizePath(authorizePath)) continue;

                    info.OidcProviders.Add(new OidcProvider
                    {
                        Id = id,
                        Name = name,
                        AuthorizePath = authorizePath,
                        // account_url / reset_password_url must be http/https —
                        // mirrors sanitizeHttpUrl in OidcConfig.ts.
                        AccountUrl = SanitizeHttpUrl(item, "account_url"),
                        ResetPasswordUrl = SanitizeHttpUrl(item, "reset_password_url"),
                    });
                }
            }
            return info;
        }
        catch
        {
            // Server doesn't expose appconfig (older / simplified deployment)
            // — fall back to local-only login.
            return new ServerInfo();
        }
    }

    public async Task<string> GetAuthCodeAsync(CancellationToken ct = default)
    {
        using var resp = await _http.GetAsync(ApiPaths.UserThirdLoginAuthcode, ct);
        resp.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), ct);
        return doc.RootElement.TryGetProperty("authcode", out var ac) ? ac.GetString() ?? "" : "";
    }

    public async Task<OidcAuthStatus> PollAuthStatusAsync(string authCode, CancellationToken ct = default)
    {
        using var resp = await _http.GetAsync($"{ApiPaths.UserThirdLoginAuthstatus}?authcode={Uri.EscapeDataString(authCode)}", ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<OidcAuthStatus>(Json, ct)
               ?? new OidcAuthStatus { Status = 2, Msg = "Empty response" };
    }

    /// <summary>
    /// Build the full authorize URL for a given OIDC provider, appending the
    /// <c>authcode</c>, <c>return_to</c>, and <c>flag</c> query parameters
    /// (mirrors <c>buildAuthorizeURL</c> in <c>oidc/url.ts</c>). MAUI is a PC
    /// client so <c>flag=2</c> (matching the value sent in <c>user/login</c>).
    /// If <paramref name="provider.AuthorizePath"/> is already absolute, it's
    /// used as-is; otherwise it's resolved against the current server origin.
    /// </summary>
    public string BuildAuthorizeUrl(OidcProvider provider, string authCode, string returnTo = "/login")
    {
        var path = provider.AuthorizePath;
        // Determine absolute-vs-relative via Uri.TryCreate instead of
        // StartsWith("http") which would also match "httpevil://…" and
        // other scheme-launch primitives. Only http/https are allowed.
        string full;
        if (Uri.TryCreate(path, UriKind.Absolute, out var abs) &&
            (abs.Scheme == "https" || abs.Scheme == "http"))
        {
            full = path;
        }
        else
        {
            full = new Uri(new Uri(_options.BaseUrl), path).ToString();
        }
        var sep = full.Contains('?') ? "&" : "?";
        return $"{full}{sep}authcode={Uri.EscapeDataString(authCode)}&return_to={Uri.EscapeDataString(returnTo)}&flag=2";
    }

    // --- helpers ---

    private HttpClient CreateClient(string baseUrl, TimeSpan timeout)
    {
        return HttpUtils.CreateHttpClient(baseUrl, timeout, _options.AllowInsecureSsl);
    }

    /// <summary>
    /// Normalize a user-entered server URL: ensure a scheme is present, trim
    /// trailing slashes, and strip any path component (we only want the origin).
    /// </summary>
    internal static string NormalizeUrl(string url)
    {
        var s = url.Trim();
        if (string.IsNullOrEmpty(s))
            throw new ArgumentException("Server URL cannot be empty.");

        // Add https:// if no scheme present.
        if (!s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !s.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            s = "https://" + s;
        }

        // Strip everything after the origin (path / query / fragment).
        // We only store the scheme + host + port.
        if (Uri.TryCreate(s, UriKind.Absolute, out var uri))
        {
            // Reject cleartext HTTP for non-loopback hosts to prevent
            // token / message interception over the wire.
            if (uri.Scheme == "http" && !IsLoopback(uri.Host))
                throw new ArgumentException(
                    "HTTP is only allowed for localhost. Use HTTPS for remote servers.");

            var builder = new UriBuilder(uri.Scheme, uri.Host, uri.Port);
            return builder.ToString().TrimEnd('/');
        }

        throw new ArgumentException($"Invalid server URL: {url}");
    }

    /// <summary>True for localhost / 127.0.0.1 / ::1.</summary>
    private static bool IsLoopback(string host)
    {
        return HttpUtils.IsLoopback(host);
    }

    /// <summary>
    /// Build the device info payload sent with login (mirrors
    /// <c>login_vm.tsx</c> <c>getDevice()</c>). MAUI Essentials provides
    /// <see cref="DeviceInfo.Current"/> for platform/model/name. Returned as
    /// a dictionary so the same structure can be serialized into JSON
    /// payloads (snake_case keys) and URL-encoded into query strings for
    /// <c>GET /v1/user/loginuuid</c>.
    /// </summary>
    private static readonly Lazy<Dictionary<string, string>> DeviceInfoCache = new(() => new Dictionary<string, string>
    {
        ["device_id"] = GetOrCreateDeviceId(),
        ["device_name"] = DeviceInfo.Current.Name,
        ["device_model"] = DeviceInfo.Current.Model,
    });

    private static Dictionary<string, string> GetDevice()
    {
        return DeviceInfoCache.Value;
    }

    /// <summary>
    /// Build a URL-encoded query string from the device info (used by
    /// <c>GET /v1/user/loginuuid</c> which expects the device fields as
    /// query parameters, mirroring the web client's
    /// <c>{ param: device }</c> form).
    /// </summary>
    private static string GetDeviceQuery()
    {
        var device = GetDevice();
        return string.Join("&", device.Select(kv =>
            $"{kv.Key}={Uri.EscapeDataString(kv.Value ?? string.Empty)}"));
    }

    /// <summary>
    /// Generate (and persist) a stable per-install device identifier. The web
    /// client stores a UUID in localStorage; MAUI uses Preferences.
    /// </summary>
    private static string GetOrCreateDeviceId()
    {
        const string key = "octo.device.id";
        var id = Preferences.Default.Get(key, string.Empty);
        if (string.IsNullOrEmpty(id))
        {
            id = Guid.NewGuid().ToString("N");
            Preferences.Default.Set(key, id);
        }
        return id;
    }

    /// <summary>
    /// True when <paramref name="value"/> is a server-relative path (starts
    /// with a single <c>/</c>, not <c>//</c>). Mirrors
    /// <c>isSafeAuthorizePath</c> in
    /// <c>packages/dmworkbase/src/Service/OidcConfig.ts</c> — authorize_path
    /// is used to build a URL opened in the browser, so only in-site paths
    /// are allowed to prevent javascript:/data:/protocol-relative redirects.
    /// </summary>
    internal static bool IsSafeAuthorizePath(string? value)
    {
        return !string.IsNullOrEmpty(value)
               && value.Length >= 2
               && value[0] == '/'
               && value[1] != '/';
    }

    /// <summary>
    /// Return the string value of <paramref name="propertyName"/> from
    /// <paramref name="element"/> only when it's a valid http/https URL.
    /// Mirrors <c>sanitizeHttpUrl</c> in
    /// <c>packages/dmworkbase/src/Service/OidcConfig.ts</c>.
    /// </summary>
    internal static string? SanitizeHttpUrl(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var el) || el.ValueKind != JsonValueKind.String)
            return null;
        var value = el.GetString();
        if (string.IsNullOrEmpty(value)) return null;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
            (uri.Scheme == "https" || uri.Scheme == "http"))
        {
            return value;
        }
        return null;
    }

    private HttpRequestMessage Authed(string token, HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, path);
        req.Headers.Add("token", token);
        return req;
    }

    private async Task<T> SendAsync<T>(HttpRequestMessage req, CancellationToken ct)
    {
        using var resp = await _http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<T>(Json, ct)
               ?? throw new InvalidOperationException($"Empty response from {req.RequestUri}.");
    }
}

/// <summary>
/// Login response from octo-server. The server returns a flat structure
/// (<c>{ token, uid, name, sex, ... }</c>), not a nested
/// <c>{ token, user: { id, ... } }</c> — so we map the fields directly.
/// Mirrors <c>LoginRespFields</c> in <c>loginSession.ts</c>.
/// </summary>
public sealed class LoginResult
{
    [JsonPropertyName("token")]
    public string Token { get; set; } = string.Empty;

    [JsonPropertyName("uid")]
    public string Uid { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("app_id")]
    public string? AppId { get; set; }

    [JsonPropertyName("short_no")]
    public string? ShortNo { get; set; }

    [JsonPropertyName("sex")]
    public int Sex { get; set; }

    /// <summary>
    /// Realname verification status. The backend may send a boolean, an
    /// int (0/1), or a string — captured as <see cref="JsonElement"/> to
    /// avoid deserialization failures. Mirrors the tri-state handling in
    /// <c>loginSession.ts</c> <c>applyLoginResp</c>.
    /// </summary>
    [JsonPropertyName("realname_verified")]
    public JsonElement? RealnameVerified { get; set; }

    [JsonPropertyName("real_name")]
    public string? RealName { get; set; }

    [JsonPropertyName("realname_verified_at")]
    public long? RealnameVerifiedAt { get; set; }

    [JsonPropertyName("language")]
    public string? Language { get; set; }

    /// <summary>Constructs a <see cref="User"/> from the flat login response.</summary>
    public User ToUser() => new()
    {
        Id = Uid,
        Name = Name,
        Sex = Sex,
        ShortNo = ShortNo ?? string.Empty,
    };
}
