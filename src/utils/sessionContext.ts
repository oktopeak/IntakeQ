import { AsyncLocalStorage } from "async_hooks";

export interface SessionContext {
  sessionId: string;
  getApiKey(): string | null;
  storeApiKey(key: string): void;
  clearApiKey(): void;
}

export const sessionStorage = new AsyncLocalStorage<SessionContext>();

export function getSessionContext(): SessionContext | undefined {
  return sessionStorage.getStore();
}
