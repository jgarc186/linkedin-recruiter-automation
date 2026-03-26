import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { RecruiterProfile } from '../../../shared/types.js';
import { config } from '../config.js';

const TIMEZONE = 'America/New_York';

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: { email: string }[];
  description?: string;
}

function etHourToUtc(date: Date, etHour: number): Date {
  // Start with a guess assuming EST (UTC-5)
  const candidate = new Date(date);
  candidate.setUTCHours(etHour + 5, 0, 0, 0);

  // Check actual ET hour using Intl
  const actualEtHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).format(candidate)
  );

  // Adjust if DST shifted it
  candidate.setUTCHours(candidate.getUTCHours() + (etHour - actualEtHour));
  return candidate;
}

export function generateTimeSlots(): string[] {
  const slots: string[] = [];
  const now = new Date();
  let currentDate = new Date(now);

  // Start from tomorrow
  currentDate.setDate(currentDate.getDate() + 1);

  const etHours = [10, 14, 16]; // 10am, 2pm, 4pm ET

  while (slots.length < 3) {
    const dayOfWeek = currentDate.getDay();

    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      etHours.forEach(etHour => {
        if (slots.length < 3) {
          const slot = etHourToUtc(currentDate, etHour);
          slots.push(slot.toISOString());
        }
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return slots.slice(0, 3);
}

export async function createEvent(
  title: string,
  startTime: string,
  attendees: string[],
  description: string
): Promise<CalendarEvent> {
  if (!config.googleRefreshToken) {
    throw new Error('Google Calendar credentials not configured');
  }

  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: config.googleRefreshToken,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const start = new Date(startTime);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour meeting

  const event = {
    summary: title,
    description,
    start: {
      dateTime: start.toISOString(),
      timeZone: TIMEZONE,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: TIMEZONE,
    },
    attendees: attendees.map(email => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
    sendUpdates: 'all',
  });

  if (!response.data.id) {
    throw new Error('Failed to create calendar event');
  }

  return {
    id: response.data.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
    attendees: event.attendees,
    description: event.description,
  };
}

export async function scheduleMeeting(
  recruiter: RecruiterProfile,
  suggestedTimes: string[]
): Promise<CalendarEvent> {
  const title = `Interview with ${recruiter.name} from ${recruiter.company}`;
  const description = `
Recruiter: ${recruiter.name}
Title: ${recruiter.title}
Company: ${recruiter.company}

Initial call to discuss the opportunity.
  `.trim();

  // Use the first suggested time
  const startTime = suggestedTimes[0];

  const attendees = recruiter.email ? [recruiter.email] : [];
  return createEvent(title, startTime, attendees, description);
}