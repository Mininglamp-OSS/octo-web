using System.Text.Json;
using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Stores recently-connected server URLs in <see cref="Preferences"/> as a
/// JSON array. Keeps at most 5 entries, most-recent-first.
/// </summary>
public sealed class ServerHistoryService : IServerHistoryService
{
    private const string PrefKey = "server.history";
    private const int MaxEntries = 5;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly List<ServerHistoryEntry> _entries = new();

    public IReadOnlyList<ServerHistoryEntry> Entries => _entries;

    public event EventHandler? Changed;

    public Task InitializeAsync()
    {
        var raw = Preferences.Default.Get(PrefKey, string.Empty);
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try
            {
                var list = JsonSerializer.Deserialize<List<ServerHistoryEntry>>(raw, Json);
                if (list is not null)
                    _entries.AddRange(list.Where(e => !string.IsNullOrWhiteSpace(e.Url)));
            }
            catch
            {
                // Corrupted JSON — start fresh.
                Preferences.Default.Remove(PrefKey);
            }
        }
        RaiseChanged();
        return Task.CompletedTask;
    }

    public Task AddAsync(string url)
    {
        var normalized = ApiService.NormalizeUrl(url);

        // Remove existing entry with the same URL (will re-add at top).
        _entries.RemoveAll(e => e.Url.Equals(normalized, StringComparison.OrdinalIgnoreCase));

        _entries.Insert(0, new ServerHistoryEntry
        {
            Url = normalized,
            LastUsedMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });

        // Trim to max.
        if (_entries.Count > MaxEntries)
            _entries.RemoveRange(MaxEntries, _entries.Count - MaxEntries);

        Persist();
        RaiseChanged();
        return Task.CompletedTask;
    }

    public Task RemoveAsync(string url)
    {
        _entries.RemoveAll(e => e.Url.Equals(url, StringComparison.OrdinalIgnoreCase));
        Persist();
        RaiseChanged();
        return Task.CompletedTask;
    }

    private void Persist()
    {
        var raw = JsonSerializer.Serialize(_entries, Json);
        Preferences.Default.Set(PrefKey, raw);
    }

    private void RaiseChanged()
        => MainThread.BeginInvokeOnMainThread(
            () => Changed?.Invoke(this, EventArgs.Empty));
}
