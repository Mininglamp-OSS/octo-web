/** Serialize remote draft writes per channel across Conversation instances. */
export class ComposeDraftWriteQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(channelKey: string, write: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(channelKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(write);
    this.tails.set(channelKey, current);
    void current
      .finally(() => {
        if (this.tails.get(channelKey) === current) {
          this.tails.delete(channelKey);
        }
      })
      .catch(() => undefined);
    return current;
  }
}
