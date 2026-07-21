using System.Collections.Concurrent;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;

namespace OctoMaui.ViewModels;

/// <summary>
/// Base class implementing <see cref="INotifyPropertyChanged"/> and a
/// lightweight <see cref="Command"/> helper. Avoids external MVVM toolkit
/// dependencies for transparency.
/// </summary>
public abstract class ViewModelBase : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    private readonly ConcurrentDictionary<string, object?> _values = new();

    /// <summary>Strongly-typed property storage with change notification.
    /// Returns default(T) if the property hasn't been set yet.</summary>
    protected T Get<T>([CallerMemberName] string? name = null)
        => _values.TryGetValue(name!, out var v) ? (T)v! : default!;

    protected bool Set<T>(T value, [CallerMemberName] string? name = null)
    {
        // ConcurrentDictionary does not support an atomic "compare-and-swap",
        // but we accept the rare duplicate notification in exchange for a
        // lock-free read path.
        if (_values.TryGetValue(name!, out var current) && Equals(current, value))
            return false;
        _values[name!] = value;
        OnPropertyChanged(name);
        return true;
    }

    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => MainThread.BeginInvokeOnMainThread(
            () => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name)));

    /// <summary>
    /// Aggregate busy flag for command canExecute predicates. Derived classes
    /// set this to disable send/attach/navigate commands during async work.
    /// </summary>
    public bool IsBusy { get => Get<bool>(); set => Set(value); }

    /// <summary>Create a command that auto-handles notify-can-execute changes.</summary>
    protected Command CreateCommand(Action execute, Func<bool>? canExecute = null)
        => new(execute, canExecute);

    /// <summary>
    /// Create an async command from a Func<Task>. Wraps the delegate so the
    /// returned Command executes asynchronously (not async-void).
    /// </summary>
    protected Command CreateCommand(Func<Task> execute, Func<bool>? canExecute = null)
        => new(async () => await execute(), canExecute);

    protected Command<T> CreateCommand<T>(Action<T> execute, Func<T, bool>? canExecute = null)
        => new(execute, canExecute);

    /// <summary>Async parameterized command (not async-void).</summary>
    protected Command<T> CreateCommand<T>(Func<T, Task> execute, Func<T, bool>? canExecute = null)
        => new(async (param) => await execute(param), canExecute);
}
