const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Chat message header timestamp: "dd/mm Ddd HH:MM" in local time,
 * e.g. "27/09 Sun 14:05". Shared by Claude and Codex chat bubbles.
 */
export function formatMessageTimestamp(date: Date): string {
  const dayOfMonth = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${dayOfMonth}/${month} ${SHORT_WEEKDAYS[date.getDay()]} ${time}`;
}
