export class SerialTaskQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task);
    const tracked = next.finally(() => {
      if (this.tails.get(key) === tracked) {
        this.tails.delete(key);
      }
    });
    this.tails.set(key, tracked);
    return next;
  }
}
