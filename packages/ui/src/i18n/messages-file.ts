import { en } from './en';
import { fa } from './fa';

/** `dist/messages.json`: every built-in bundle, read by core at boot to let the host's `translate` reword UI texts. */
export function messagesFile(): string {
  return JSON.stringify({ en, fa });
}
