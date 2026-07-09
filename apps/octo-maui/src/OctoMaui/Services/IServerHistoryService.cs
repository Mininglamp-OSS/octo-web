using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Persists the list of servers the user has previously connected to, so they
/// can quickly re-connect without retyping the address.
/// </summary>
public interface IServerHistoryService
{
    /// <summary>Most-recent-first list of saved server entries (max 5).</summary>
    IReadOnlyList<ServerHistoryEntry> Entries { get; }

    /// <summary>Raised on the UI thread when the list changes.</summary>
    event EventHandler? Changed;

    /// <summary>Add or update a server URL (moves to top, updates timestamp).</summary>
    Task AddAsync(string url);

    /// <summary>Remove a specific server from history.</summary>
    Task RemoveAsync(string url);

    /// <summary>Load saved entries from preferences. Call once at startup.</summary>
    Task InitializeAsync();
}
