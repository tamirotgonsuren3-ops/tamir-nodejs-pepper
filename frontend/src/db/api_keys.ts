// API keys, stored in the Go backend. Values are opaque to the frontend; it
// only stores and reads back what the settings forms entered.
import { ApiKeyGet, ApiKeySet } from '../../wailsjs/go/main/App';

export async function getApiKey(keyName: string): Promise<string | null> {
  const v = await ApiKeyGet(keyName);
  return v ? v : null;
}

export async function setApiKey(keyName: string, value: string): Promise<void> {
  await ApiKeySet(keyName, value);
}
