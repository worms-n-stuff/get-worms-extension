export type ObserverStartOptions = {
  /** Called whenever observers detect the DOM/layout needs a rerender. */
  scheduleRender: () => void;
  /** Returns true when a mutation target belongs to PageWorms-managed UI. */
  isManagedNode: (node: Node | null) => boolean;
};

export interface ObserverAdapter {
  /** Begin observing resize/scroll/mutation events. */
  start(options: ObserverStartOptions): void;
  /** Stop all observers and event listeners. */
  stop(): void;
  /** Observe a host element for size changes to keep overlay boxes aligned. */
  observeHost(host: HTMLElement): void;
  /** Disconnect the host observer (used when clearing all worms). */
  disconnectHostObserver(): void;
}
