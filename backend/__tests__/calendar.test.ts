import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RecruiterProfile } from '../../../shared/types.js';

// Mock config before importing calendar module
vi.mock('../src/config.js', () => ({
  config: {
    googleClientId: 'test-client-id',
    googleClientSecret: 'test-client-secret',
    googleRefreshToken: 'test-refresh-token',
  },
}));

const mockInsert = vi.fn().mockResolvedValue({ data: { id: 'event_123' } });

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn().mockReturnValue({
      events: {
        insert: (...args: any[]) => mockInsert(...args),
      },
    }),
  },
}));

// Mock google-auth-library
const mockSetCredentials = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    setCredentials: mockSetCredentials,
    getAccessToken: vi.fn().mockResolvedValue({ token: 'test_token' }),
  })),
}));

import { scheduleMeeting, createEvent, generateTimeSlots } from '../src/services/calendar.js';
import { config } from '../src/config.js';

describe('calendar.ts', () => {
  const mockRecruiter: RecruiterProfile = {
    name: 'Jane Smith',
    title: 'Senior Technical Recruiter',
    company: 'TechCorp',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Thursday March 26 2026 at noon UTC
    vi.setSystemTime(new Date('2026-03-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateTimeSlots', () => {
    it('should generate exactly 3 time slots', () => {
      const slots = generateTimeSlots();
      expect(slots).toHaveLength(3);
    });

    it('should start from the next day', () => {
      const slots = generateTimeSlots();
      const firstSlot = new Date(slots[0]);
      const now = new Date('2026-03-26T12:00:00Z');
      expect(firstSlot.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should generate slots at 10am, 2pm, 4pm Eastern Time', () => {
      const slots = generateTimeSlots();
      const etHours = slots.map(slot => {
        return parseInt(new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          hour12: false,
        }).format(new Date(slot)));
      });
      expect(etHours).toEqual([10, 14, 16]);
    });

    it('should skip weekends', () => {
      // Set to Friday March 27 2026
      vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));

      const slots = generateTimeSlots();
      slots.forEach(slot => {
        const day = new Date(slot).getUTCDay();
        expect(day).not.toBe(0); // Sunday
        expect(day).not.toBe(6); // Saturday
      });
    });

    it('should skip Saturday and Sunday when starting on Friday', () => {
      // Friday March 27 -> next day is Saturday, should skip to Monday March 30
      vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));

      const slots = generateTimeSlots();
      const firstSlot = new Date(slots[0]);
      // March 30 2026 is Monday
      expect(firstSlot.getUTCDay()).toBe(1); // Monday
    });

    it('should return ISO string format', () => {
      const slots = generateTimeSlots();
      slots.forEach(slot => {
        expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      });
    });

    it('should generate correct UTC hours during EDT (summer)', () => {
      // July 15 2026 is during EDT (UTC-4)
      vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

      const slots = generateTimeSlots();
      const utcHours = slots.map(s => new Date(s).getUTCHours());
      // 10am EDT = 14 UTC, 2pm EDT = 18 UTC, 4pm EDT = 20 UTC
      expect(utcHours).toEqual([14, 18, 20]);
    });

    it('should generate correct UTC hours during EST (winter)', () => {
      // January 15 2026 is during EST (UTC-5)
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

      const slots = generateTimeSlots();
      const utcHours = slots.map(s => new Date(s).getUTCHours());
      // 10am EST = 15 UTC, 2pm EST = 19 UTC, 4pm EST = 21 UTC
      expect(utcHours).toEqual([15, 19, 21]);
    });
  });

  describe('createEvent', () => {
    it('should create a calendar event and return it', async () => {
      const event = await createEvent(
        'Interview with Jane Smith',
        '2026-03-28T14:00:00Z',
        ['jane@techcorp.com'],
        'Discussion about Senior Engineer role'
      );

      expect(event).toBeDefined();
      expect(event.id).toBe('event_123');
      expect(event.summary).toBe('Interview with Jane Smith');
      expect(event.description).toBe('Discussion about Senior Engineer role');
    });

    it('should set 1 hour duration', async () => {
      const event = await createEvent(
        'Interview',
        '2026-03-28T14:00:00Z',
        [],
        'Test'
      );

      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime);
      expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
    });

    it('should use America/New_York timezone', async () => {
      const event = await createEvent(
        'Interview',
        '2026-03-28T14:00:00Z',
        [],
        'Test'
      );

      expect(event.start.timeZone).toBe('America/New_York');
      expect(event.end.timeZone).toBe('America/New_York');
    });

    it('should include attendees', async () => {
      const event = await createEvent(
        'Interview',
        '2026-03-28T14:00:00Z',
        ['jane@techcorp.com', 'bob@techcorp.com'],
        'Test'
      );

      expect(event.attendees).toEqual([
        { email: 'jane@techcorp.com' },
        { email: 'bob@techcorp.com' },
      ]);
    });

    it('should call Google Calendar API with correct params', async () => {
      await createEvent(
        'Interview with Jane',
        '2026-03-28T14:00:00Z',
        ['jane@techcorp.com'],
        'Discussion'
      );

      expect(mockInsert).toHaveBeenCalledWith({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          summary: 'Interview with Jane',
          description: 'Discussion',
          attendees: [{ email: 'jane@techcorp.com' }],
        }),
        sendUpdates: 'all',
      });
    });

    it('should set OAuth2 credentials with refresh token', async () => {
      await createEvent('Test', '2026-03-28T14:00:00Z', [], 'Test');

      expect(mockSetCredentials).toHaveBeenCalledWith({
        refresh_token: 'test-refresh-token',
      });
    });

    it('should throw when Google Calendar credentials not configured', async () => {
      // Temporarily override config
      const originalToken = (config as any).googleRefreshToken;
      (config as any).googleRefreshToken = '';

      await expect(
        createEvent('Test', '2026-03-28T14:00:00Z', [], '')
      ).rejects.toThrow('Google Calendar credentials not configured');

      (config as any).googleRefreshToken = originalToken;
    });

    it('should throw when API returns no event id', async () => {
      mockInsert.mockResolvedValueOnce({ data: {} });

      await expect(
        createEvent('Test', '2026-03-28T14:00:00Z', [], '')
      ).rejects.toThrow('Failed to create calendar event');
    });

    it('should include reminders in the request', async () => {
      await createEvent('Test', '2026-03-28T14:00:00Z', [], 'Test');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            reminders: {
              useDefault: false,
              overrides: [
                { method: 'email', minutes: 60 },
                { method: 'popup', minutes: 10 },
              ],
            },
          }),
        })
      );
    });
  });

  describe('scheduleMeeting', () => {
    it('should schedule a meeting with recruiter details', async () => {
      const suggestedTimes = [
        '2026-03-28T14:00:00Z',
        '2026-03-28T18:00:00Z',
        '2026-03-28T20:00:00Z',
      ];

      const event = await scheduleMeeting(mockRecruiter, suggestedTimes);

      expect(event).toBeDefined();
      expect(event.id).toBe('event_123');
    });

    it('should use the first suggested time', async () => {
      const suggestedTimes = [
        '2026-03-30T14:00:00Z',
        '2026-03-30T18:00:00Z',
      ];

      const event = await scheduleMeeting(mockRecruiter, suggestedTimes);

      expect(event.start.dateTime).toBe(new Date('2026-03-30T14:00:00Z').toISOString());
    });

    it('should include company name in event title', async () => {
      const suggestedTimes = ['2026-03-28T14:00:00Z'];

      await scheduleMeeting(mockRecruiter, suggestedTimes);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Interview with Jane Smith from TechCorp',
          }),
        })
      );
    });

    it('should include recruiter name, title, and company in description', async () => {
      const suggestedTimes = ['2026-03-28T14:00:00Z'];

      await scheduleMeeting(mockRecruiter, suggestedTimes);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            description: expect.stringContaining('Jane Smith'),
          }),
        })
      );

      const callArgs = mockInsert.mock.calls[0][0];
      expect(callArgs.requestBody.description).toContain('Senior Technical Recruiter');
      expect(callArgs.requestBody.description).toContain('TechCorp');
    });

    it('should not pass attendee emails (no recruiter email available)', async () => {
      const suggestedTimes = ['2026-03-28T14:00:00Z'];

      await scheduleMeeting(mockRecruiter, suggestedTimes);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            attendees: [],
          }),
        })
      );
    });

    it('should include recruiter email as attendee when available', async () => {
      const recruiterWithEmail = {
        ...mockRecruiter,
        email: 'jane@techcorp.com',
      };
      const suggestedTimes = ['2026-03-28T14:00:00Z'];

      await scheduleMeeting(recruiterWithEmail, suggestedTimes);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            attendees: [{ email: 'jane@techcorp.com' }],
          }),
        })
      );
    });
  });
});
