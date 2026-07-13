using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Real-time client over octo-server WebSocket. Receives pushed messages,
/// presence, and channel updates; sends outgoing chat text.
/// </summary>
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
    public event Action<string, string>? StreamChunkReceived;  // (messageId, chunk)
    public event Action<string>? StreamStarted;  // messageId
    public event Action<string>? StreamEnded;    // messageId
    public event Action? ChannelUpdated;
    public event Action<Exception>? ConnectionClosed;

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
            await _socket.ConnectAsync(new Uri(_options.WebSocketUrl), _cts.Token);

            _receiveLoop = Task.Run(ReceiveLoopAsync, _cts.Token);
        }
        finally
        {
            _connectionLock.Release();
        }
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
        var sb = new StringBuilder();
        try
        {
            while (!_cts!.IsCancellationRequested && _socket!.State == WebSocketState.Open)
            {
                sb.Clear();
                WebSocketReceiveResult result;
                do
                {
                    result = await _socket.ReceiveAsync(buffer, _cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        ConnectionClosed?.Invoke(new InvalidOperationException("Server closed the connection."));
                        return;
                    }
                    sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                } while (!result.EndOfMessage);

                HandleIncoming(sb.ToString());
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
