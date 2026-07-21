using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Real-time client over octo-server WebSocket. Receives pushed messages,
/// presence, and channel updates; sends outgoing chat text.
/// </summary>
/// <remarks>
/// WIP: The octo-server uses <b>WuKongIM</b> (wukongimjssdk) for real-time
/// messaging, not a plain JSON-over-/ws endpoint. The real connection flow
/// (mirrored from <c>packages/dmworkbase/src/App.tsx</c>) is:
/// <list type="number">
/// <item><c>GET /v1/users/{uid}/im</c> returns <c>{ wss_addr, ws_addr }</c>
/// (see <c>imConnectAddrs()</c> in
/// <c>packages/dmworkdatasource/src/datasource.ts</c>).</item>
/// <item>The WuKongIM SDK is configured with <c>uid</c>/<c>token</c> and the
/// returned address via <c>WKSDK.shared().config.provider.connectAddrCallback</c>.</item>
/// <item><c>WKSDK.shared().connect()</c> opens the socket and speaks the
/// WuKongIM cmd-based binary protocol.</item>
/// </list>
/// This implementation is a scaffold: <see cref="ConnectAsync"/> still uses
/// the static <see cref="ApiOptions.WebSocketUrl"/> and a JSON envelope that
/// does not match any server protocol. <see cref="GetImAddressAsync"/> is
/// provided so a future WuKongIM .NET client can fetch the real IM address
/// without duplicating the REST call. See the README "Limitations" section.
/// </remarks>
public sealed class WebSocketService : IWebSocketService, IAsyncDisposable
{
    private readonly ApiOptions _options;
    private ClientWebSocket? _socket;
    private CancellationTokenSource? _cts;
    private Task? _receiveLoop;
    private readonly SemaphoreSlim _connectionLock = new(1, 1);

    public WebSocketService(ApiOptions options) => _options = options;

    public bool IsConnected => _socket?.State == WebSocketState.Open;

    public event Action<Message>? MessageReceived;

    // NOTE: The Stream* / ChannelUpdated events below are part of the scaffold
    // JSON protocol. The real octo-server does not emit these event types —
    // streaming is driven by WuKongIM Message.streamOn/streamFlag (see the
    // NOTE on the corresponding cases in HandleIncoming).
    public event Action<string, string>? StreamChunkReceived;  // (messageId, chunk)
    public event Action<string>? StreamStarted;  // messageId
    public event Action<string>? StreamEnded;    // messageId
    public event Action? ChannelUpdated;
    public event Action<Exception>? ConnectionClosed;

    /// <summary>
    /// Scaffold connect: opens the static <see cref="ApiOptions.WebSocketUrl"/>
    /// and speaks a JSON envelope that does not match the WuKongIM protocol.
    /// </summary>
    /// <remarks>
    /// WIP: The real flow (see <c>App.tsx</c> <c>connectIM</c>) is to first
    /// call <see cref="GetImAddressAsync"/> to obtain the WuKongIM address
    /// (<c>wss_addr</c>/<c>ws_addr</c>), hand it to
    /// <c>WKSDK.shared().config.provider.connectAddrCallback</c>, then invoke
    /// <c>WKSDK.shared().connect()</c> with <c>uid</c>/<c>token</c> set on
    /// <c>WKSDK.shared().config</c>. Until a WuKongIM .NET binding exists,
    /// this method keeps the scaffold alive for the JSON-over-/ws shape that
    /// the rest of the client expects.
    /// </remarks>
    public async Task ConnectAsync(string token, CancellationToken ct = default)
    {
        await _connectionLock.WaitAsync(ct);
        try
        {
            if (IsConnected) return;

            _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            _socket = new ClientWebSocket();
            _socket.Options.SetRequestHeader("token", token);

            // Token is sent only via the `token` header — NOT in the URL
            // query string, which would leak into server/proxy access logs.
            // NOTE: scaffold only — the real WuKongIM address comes from
            // GetImAddressAsync, not from ApiOptions.WebSocketUrl.
            await _socket.ConnectAsync(new Uri(_options.WebSocketUrl), _cts.Token);

            _receiveLoop = Task.Run(ReceiveLoopAsync, _cts.Token);
        }
        finally
        {
            _connectionLock.Release();
        }
    }

    /// <summary>
    /// Fetch the WuKongIM WebSocket address for a user via
    /// <c>GET /v1/users/{uid}/im</c>. Returns <c>wss_addr</c> when present
    /// (preferred), falling back to <c>ws_addr</c>. Throws on non-2xx or when
    /// neither field is present.
    /// </summary>
    /// <remarks>
    /// WIP: Mirrors <c>imConnectAddrs()</c> in
    /// <c>packages/dmworkdatasource/src/datasource.ts</c>. A future WuKongIM
    /// .NET client should call this and feed the result to its connect
    /// callback instead of using <see cref="ApiOptions.WebSocketUrl"/>.
    /// </remarks>
    public async Task<string> GetImAddressAsync(string uid, string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(uid))
            throw new ArgumentException("uid cannot be empty.", nameof(uid));
        if (string.IsNullOrWhiteSpace(token))
            throw new ArgumentException("token cannot be empty.", nameof(token));

        using var http = CreateHttpClient();
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{ApiPaths.UsersIm}/{Uri.EscapeDataString(uid)}/im");
        req.Headers.Add("token", token);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();

        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), ct);
        string? addr = null;
        if (doc.RootElement.ValueKind == JsonValueKind.Object)
        {
            if (doc.RootElement.TryGetProperty("wss_addr", out var wss) && wss.ValueKind == JsonValueKind.String)
                addr = wss.GetString();
            if (string.IsNullOrEmpty(addr) &&
                doc.RootElement.TryGetProperty("ws_addr", out var ws) && ws.ValueKind == JsonValueKind.String)
                addr = ws.GetString();
        }
        if (string.IsNullOrWhiteSpace(addr))
            throw new InvalidOperationException(
                "IM address not found in /v1/users/{uid}/im response (expected wss_addr or ws_addr).");
        return addr!;
    }

    private HttpClient CreateHttpClient()
    {
        return HttpUtils.CreateHttpClient(_options.BaseUrl, _options.Timeout, _options.AllowInsecureSsl);
    }

    public async Task DisconnectAsync()
    {
        await _connectionLock.WaitAsync();
        try
        {
            _cts?.Cancel();
            if (_receiveLoop is { } loop)
            {
                try { await loop; } catch { /* cancellation expected */ }
            }
            if (_socket is null) return;
            try
            {
                if (_socket.State == WebSocketState.Open)
                    await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "client closing", CancellationToken.None);
            }
            catch { /* ignore close errors */ }
            _socket.Dispose();
            _socket = null;
        }
        finally
        {
            _connectionLock.Release();
        }
    }

    public async Task SendAsync(string channelId, string content, CancellationToken ct = default)
    {
        if (_socket is null || !IsConnected)
            throw new InvalidOperationException("WebSocket not connected.");

        var payload = JsonSerializer.Serialize(new
        {
            type = "message",
            channel_id = channelId,
            content,
            message_type = (int)MessageType.Text,
        });
        var bytes = Encoding.UTF8.GetBytes(payload);
        await _socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, ct);
    }

    private async Task ReceiveLoopAsync()
    {
        var buffer = new byte[65536];
        const int MaxMessageSize = 1 * 1024 * 1024;  // 1 MB — close if exceeded
        try
        {
            while (!_cts!.IsCancellationRequested && _socket!.State == WebSocketState.Open)
            {
                // Accumulate raw bytes across fragments and decode once after
                // EndOfMessage. Per-frame Encoding.UTF8.GetString is stateless
                // and would corrupt multi-byte chars (CJK/emoji) split across
                // the 64 KB buffer boundary.
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await _socket.ReceiveAsync(buffer, _cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        ConnectionClosed?.Invoke(new InvalidOperationException("Server closed the connection."));
                        return;
                    }
                    ms.Write(buffer, 0, result.Count);
                    // Guard against unbounded memory growth from a hostile or
                    // buggy server streaming an oversized message.
                    if (ms.Length > MaxMessageSize)
                    {
                        ConnectionClosed?.Invoke(new InvalidOperationException(
                            $"WebSocket message exceeded {MaxMessageSize / 1024}KB limit."));
                        try
                        {
                            await _socket.CloseAsync(WebSocketCloseStatus.MessageTooBig,
                                "Message size limit exceeded", CancellationToken.None);
                        }
                        catch { /* ignore close errors */ }
                        return;
                    }
                } while (!result.EndOfMessage);

                var message = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                HandleIncoming(message);
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex)
        {
            ConnectionClosed?.Invoke(ex);
        }
    }

    private void HandleIncoming(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var type = doc.RootElement.GetProperty("type").GetString();
            switch (type)
            {
                case "message":
                    var msg = JsonSerializer.Deserialize<Message>(raw, JsonCaseInsensitive);
                    if (msg is not null)
                        MainThread.BeginInvokeOnMainThread(() => MessageReceived?.Invoke(msg));
                    break;

                // NOTE: stream_start / stream_chunk / stream_end are a
                // HYPOTHETICAL JSON protocol invented for this scaffold —
                // the real octo-server does NOT push these events. Streaming
                // is driven by WuKongIM message flags: a Message arrives with
                // <c>streamOn=true</c> and <c>streamFlag</c> set to
                // <c>StreamFlag.START</c> / <c>StreamFlag.CONTINUE</c> /
                // <c>StreamFlag.END</c> (see
                // <c>packages/dmworkbase/src/Service/Model.tsx</c>:
                // <c>streamOn</c>, <c>isStreaming</c>, <c>fullStreamContent</c>).
                // Each stream item is a separate WuKongIM message appended to
                // <c>message.streams</c>. These cases remain so the scaffold
                // can render a preview until a WuKongIM .NET client lands.
                case "stream_start":
                    {
                        var msgId = doc.RootElement.TryGetProperty("message_id", out var mid) ? mid.GetString() ?? "" : "";
                        MainThread.BeginInvokeOnMainThread(() => StreamStarted?.Invoke(msgId));
                    }
                    break;

                case "stream_chunk":
                    {
                        var msgId = doc.RootElement.TryGetProperty("message_id", out var mid) ? mid.GetString() ?? "" : "";
                        var chunk = doc.RootElement.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
                        MainThread.BeginInvokeOnMainThread(() => StreamChunkReceived?.Invoke(msgId, chunk));
                    }
                    break;

                case "stream_end":
                    {
                        var msgId = doc.RootElement.TryGetProperty("message_id", out var mid) ? mid.GetString() ?? "" : "";
                        MainThread.BeginInvokeOnMainThread(() => StreamEnded?.Invoke(msgId));
                    }
                    break;

                // NOTE: channel_update is also a hypothetical scaffold event;
                // the real channel list is maintained by the WuKongIM SDK's
                // conversation manager.
                case "channel_update":
                    MainThread.BeginInvokeOnMainThread(() => ChannelUpdated?.Invoke());
                    break;
            }
        }
        catch
        {
            // Malformed payload — ignore rather than crash the receive loop.
        }
    }

    private static readonly JsonSerializerOptions JsonCaseInsensitive = new() { PropertyNameCaseInsensitive = true };

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        _cts?.Dispose();
        _cts = null;
        _connectionLock.Dispose();
    }
}
