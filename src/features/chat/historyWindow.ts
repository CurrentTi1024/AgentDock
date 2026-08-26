/** A newly created conversation still needs one complete run after terminal persistence. */
export const getHistoryWindowLimit = (loadedTextCount: number): number =>
  Math.max(loadedTextCount, 1);

export const shouldReloadPersistedRun = (status?: string): boolean =>
  Boolean(status && !['running', 'paused'].includes(status));
