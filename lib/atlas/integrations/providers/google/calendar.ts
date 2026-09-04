export const GOOGLE_CALENDAR_LIST_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";

/** Minimum read set for discovering a user's calendar list and observing events. */
export const GOOGLE_CALENDAR_READ_SCOPES = [
  GOOGLE_CALENDAR_LIST_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
] as const;
