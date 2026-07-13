using OctoMaui.Models;

namespace OctoMaui.Services;

public interface IWebSocketService
{
    bool IsConnected { get; }

    /// <summary>A full chat message arrived from the server.</summary>
    event Action<Message>? MessageReceived;

    /// <summary>A streaming chunk arrived (partial AI reply).</summary>
    /// <remarks>
    /// WIP: part of the scaffold JSON protocol — the real octo-server drives
    /// streaming via WuKongIM <c>Message.streamOn</c>/<c>streamFlag</c>.
    /// </remarks>
    event Action<string, string>? StreamChunkReceived;

    /// <summary>An agent started typing / streaming a reply.</summary>
    /// <remarks>
    /// WIP: part of the scaffold JSON protocol — see <see cref="StreamChunkReceived"/>.
    /// </remarks>
    event Action<string>? StreamStarted;

    /// <summary>A streaming reply completed.</summary>
    /// <remarks>
    /// WIP: part of the scaffold JSON protocol — see <see cref="StreamChunkReceived"/>.
    /// </remarks>
    event Action<string>? StreamEnded;

    /// <summary>Channel list / unread state changed.</summary>
    /// <remarks>
    /// WIP: part of the scaffold JSON protocol — the real channel list is
    /// maintained by the WuKongIM SDK conversation manager.
    /// </remarks>
    event Action? ChannelUpdated;

    /// <summary>Connection dropped unexpectedly.</summary>
    event Action<Exception>? ConnectionClosed;

    /// <summary>
    /// Scaffold connect using the static <see cref="ApiOptions.WebSocketUrl"/>.
    /// </summary>
    Task ConnectAsync(string token, CancellationToken ct = default);

    Task DisconnectAsync();

    Task SendAsync(string channelId, string content, CancellationToken ct = default);

    /// <summary>
    /// Fetch the WuKongIM WebSocket address for a user via
    /// <c>GET /v1/users/{uid}/im</c>. Returns <c>wss_addr</c> (preferred) or
    /// <c>ws_addr</c> (fallback). This is the REST step of the real IM
    /// connect flow; the actual socket is opened by the WuKongIM SDK, not by
    /// <see cref="ConnectAsync"/>.
    /// </summary>
    Task<string> GetImAddressAsync(string uid, string token, CancellationToken ct = default);
}
