using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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
        _ = Task.Delay(TimeSpan.FromSeconds(30)).ContinueWith(_ => oldClient?.Dispose(), TaskScheduler.Default);
    }

    /// <inheritdoc />
    public async Task<bool> PingAsync(string url, CancellationToken ct = default)
    {
        var normalized = NormalizeUrl(url);
        using var probe = CreateClient(normalized, TimeSpan.FromSeconds(5));
        try
        {
            // Any HTTP response (even 401/404) means the server is reachable.
            using var resp = await probe.GetAsync("/", ct);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<LoginResult> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var payload = new { username, password };
        var resp = await _http.PostAsJsonAsync("/api/v1/user/login", payload, ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<LoginResult>(Json, ct)
                   ?? throw new InvalidOperationException("Empty login response.");
        return body;
    }

    public async Task<User> GetCurrentUserAsync(string token, CancellationToken ct = default)
    {
        using var req = Authed(token, HttpMethod.Get, "/api/v1/user/current");
        return await SendAsync<User>(req, ct);
    }

    public async Task<List<Channel>> GetChannelsAsync(string token, CancellationToken ct = default)
    {
        using var req = Authed(token, HttpMethod.Get, "/api/v1/channel/list");
        return await SendAsync<List<Channel>>(req, ct);
    }

    public async Task<List<Message>> GetMessagesAsync(string token, string channelId, int limit = 50, long? beforeTimestamp = null, CancellationToken ct = default)
    {
        var path = $"/api/v1/channel/{Uri.EscapeDataString(channelId)}/messages?limit={limit}";
        if (beforeTimestamp is { } ts) path += $"&before={ts}";
        using var req = Authed(token, HttpMethod.Get, path);
        return await SendAsync<List<Message>>(req, ct);
    }

    public async Task<Message> SendMessageAsync(string token, string channelId, string content, CancellationToken ct = default)
    {
        var payload = new { channel_id = channelId, content, message_type = (int)MessageType.Text };
        using var req = Authed(token, HttpMethod.Post, $"/api/v1/channel/{Uri.EscapeDataString(channelId)}/message/send");
        req.Content = JsonContent.Create(payload);
        return await SendAsync<Message>(req, ct);
    }

    /// <inheritdoc />
    public async Task<Message> UploadFileAsync(string token, string channelId, Stream fileStream, string fileName, string contentType, CancellationToken ct = default)
    {
        using var req = Authed(token, HttpMethod.Post, $"/api/v1/channel/{Uri.EscapeDataString(channelId)}/message/upload");
        using var multipart = new MultipartFormDataContent();
        var fileContent = new StreamContent(fileStream);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        multipart.Add(fileContent, "file", fileName);
        multipart.Add(new StringContent(channelId), "channel_id");
        req.Content = multipart;
        return await SendAsync<Message>(req, ct);
    }

    // --- OIDC / enterprise passport (SSO) ---
    // These endpoints use the /v1/* path prefix (matching the web client's
    // oidc/http.ts) and do not require a token — they're pre-authentication.

    public async Task<ServerInfo> GetServerInfoAsync(CancellationToken ct = default)
    {
        try
        {
            using var resp = await _http.GetAsync("/v1/common/appconfig", ct);
            if (!resp.IsSuccessStatusCode) return new ServerInfo();
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), ct);
            var info = new ServerInfo();
            if (doc.RootElement.TryGetProperty("oidc_providers", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in arr.EnumerateArray())
                {
                    info.OidcProviders.Add(new OidcProvider
                    {
                        Id = item.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "",
                        Name = item.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "",
                        AuthorizePath = item.TryGetProperty("authorize_path", out var ap) ? ap.GetString() ?? "" : "",
                        AccountUrl = item.TryGetProperty("account_url", out var au) && au.ValueKind == JsonValueKind.String ? au.GetString() : null,
                        ResetPasswordUrl = item.TryGetProperty("reset_password_url", out var rp) && rp.ValueKind == JsonValueKind.String ? rp.GetString() : null,
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
        using var resp = await _http.GetAsync("/v1/user/thirdlogin/authcode", ct);
        resp.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), ct);
        return doc.RootElement.TryGetProperty("authcode", out var ac) ? ac.GetString() ?? "" : "";
    }

    public async Task<OidcAuthStatus> PollAuthStatusAsync(string authCode, CancellationToken ct = default)
    {
        using var resp = await _http.GetAsync($"/v1/user/thirdlogin/authstatus?authcode={Uri.EscapeDataString(authCode)}", ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<OidcAuthStatus>(Json, ct)
               ?? new OidcAuthStatus { Status = 2, Msg = "Empty response" };
    }

    /// <summary>
    /// Build the full authorize URL for a given OIDC provider. If
    /// <paramref name="provider.AuthorizePath"/> is already absolute, it's
    /// used as-is; otherwise it's resolved against the current server origin.
    /// </summary>
    public string BuildAuthorizeUrl(OidcProvider provider, string authCode)
    {
        var path = provider.AuthorizePath;
        var full = path.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? path
            : new Uri(new Uri(_options.BaseUrl), path).ToString();
        var sep = full.Contains('?') ? "&" : "?";
        return $"{full}{sep}authcode={Uri.EscapeDataString(authCode)}&flag=1";
    }

    // --- helpers ---

    private HttpClient CreateClient(string baseUrl, TimeSpan timeout)
    {
        var handler = new HttpClientHandler();
        if (_options.AllowInsecureSsl)
        {
            // Only bypass TLS validation for loopback (local development).
            // Remote hosts must always use valid certificates.
            handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) =>
            {
                if (message.RequestUri is { } uri && IsLoopback(uri.Host))
                    return true;  // Allow self-signed for localhost only
                return false;  // Remote hosts must have valid certs
            };
        }
        return new HttpClient(handler) { BaseAddress = new Uri(baseUrl), Timeout = timeout };
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
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return true;
        // IPAddress.IsLoopback handles both IPv4 (127.0.0.1) and IPv6 (::1)
        // without requiring bracket-stripping.
        if (IPAddress.TryParse(host, out var ip))
            return IPAddress.IsLoopback(ip);
        return false;
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

/// <summary>Login response from octo-server.</summary>
public sealed class LoginResult
{
    public string Token { get; set; } = string.Empty;
    public User User { get; set; } = new();
}
