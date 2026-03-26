import { describe, it, expect } from 'vitest';
import {
  analyzeRole,
  draftReply,
  RECRUITER_KEYWORDS,
} from '../src/services/analyzer.js';
import type { MessageData, AnalysisResult } from '../../../shared/types.js';

describe('analyzer.ts', () => {
  describe('RECRUITER_KEYWORDS', () => {
    it('should contain expected keywords', () => {
      expect(RECRUITER_KEYWORDS).toContain('opportunity');
      expect(RECRUITER_KEYWORDS).toContain('senior');
      expect(RECRUITER_KEYWORDS).toContain('staff');
      expect(RECRUITER_KEYWORDS).toContain('rust');
    });

    it('should not contain bare "go" (use word-boundary matching instead)', () => {
      expect(RECRUITER_KEYWORDS).not.toContain('go');
      expect(RECRUITER_KEYWORDS).toContain('golang');
    });
  });

  describe('analyzeRole', () => {
    const baseMessage: MessageData = {
      message_id: 'msg_123',
      thread_id: 'thread_456',
      sender: {
        name: 'Jane Smith',
        title: 'Senior Technical Recruiter at TechCorp',
        company: 'TechCorp',
      },
      content: '',
      timestamp: '2026-03-26T17:00:00Z',
    };

    it('should return high confidence for Go/Rust roles', () => {
      const message = {
        ...baseMessage,
        content: 'We are hiring Senior Backend Engineers with Go experience. Remote position paying $250K.',
      };

      const result = analyzeRole(message);

      expect(result.is_match).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.suggested_reply_type).toBe('lets_talk');
    });

    it('should return medium confidence for general backend roles', () => {
      const message = {
        ...baseMessage,
        content: 'We have a Backend Engineer position available. Looking for distributed systems experience.',
      };

      const result = analyzeRole(message);

      expect(result.confidence).toBeGreaterThan(0.3);
      expect(result.confidence).toBeLessThan(0.7);
    });

    it('should return low confidence for frontend roles', () => {
      const message = {
        ...baseMessage,
        content: 'We are looking for a Senior Frontend Developer with React experience.',
      };

      const result = analyzeRole(message);

      expect(result.is_match).toBe(false);
      expect(result.suggested_reply_type).toBe('not_interested');
    });

    it('should detect PHP/WordPress and reject', () => {
      const message = {
        ...baseMessage,
        content: 'Looking for a PHP developer with WordPress experience for a consulting project.',
      };

      const result = analyzeRole(message);

      expect(result.is_match).toBe(false);
      expect(result.confidence).toBeLessThan(0.6);
    });

    it('should detect consulting agencies', () => {
      const message = {
        ...baseMessage,
        sender: {
          ...baseMessage.sender,
          title: 'Recruiter at Staffing Solutions Inc',
        },
        content: 'We have a contract position available for a backend developer.',
      };

      const result = analyzeRole(message);

      expect(result.is_match).toBe(false);
    });

    it('should check compensation threshold', () => {
      const message = {
        ...baseMessage,
        content: 'Senior Backend Engineer position. Budget is $180K.',
      };

      const result = analyzeRole(message);

      expect(result.is_match).toBe(false);
      expect(result.confidence).toBeLessThan(0.6);
    });

    it('should detect Rust keyword and boost score', () => {
      const message = {
        ...baseMessage,
        content: 'We need a Rust engineer for our distributed systems team.',
      };

      const result = analyzeRole(message);

      expect(result.reasons).toContain('Rust experience mentioned');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return tell_me_more for medium confidence', () => {
      const message = {
        ...baseMessage,
        content: 'We have a senior backend role available with distributed systems work. Remote position.',
      };

      const result = analyzeRole(message);

      expect(result.confidence).toBeGreaterThan(0.4);
      expect(result.confidence).toBeLessThanOrEqual(0.7);
      expect(result.suggested_reply_type).toBe('tell_me_more');
    });

    it('should detect staff/principal level in title', () => {
      const message = {
        ...baseMessage,
        sender: { ...baseMessage.sender, title: 'Staff Engineer Recruiter' },
        content: 'We have a staff level position',
      };

      const result = analyzeRole(message);

      expect(result.reasons).toContain('Staff/Principal level role');
    });

    it('should detect consulting in title as agency', () => {
      const message = {
        ...baseMessage,
        sender: { ...baseMessage.sender, title: 'Consulting Manager' },
        content: 'We have a golang backend role',
      };

      const result = analyzeRole(message);

      expect(result.reasons).toContain('Agency/consulting role - lower priority');
    });

    it('should detect location preference for charlotte', () => {
      const message = {
        ...baseMessage,
        content: 'Backend role in Charlotte, NC',
      };

      const result = analyzeRole(message);

      expect(result.reasons).toContain('Location matches preference (Remote/Charlotte)');
    });

    it('should use word-boundary matching for "go" to avoid false positives', () => {
      const message = {
        ...baseMessage,
        content: 'We are looking for someone with good communication skills. Goals include team collaboration.',
      };

      const result = analyzeRole(message);

      // "go" appears as substring in "good" and "goals" but should NOT match
      expect(result.reasons).not.toContain('Go experience mentioned');
    });

    it('should match "go" as a standalone word', () => {
      const message = {
        ...baseMessage,
        content: 'We need a Go developer for our backend services.',
      };

      const result = analyzeRole(message);

      expect(result.reasons).toContain('Go experience mentioned');
    });

    it('should handle missing sender title gracefully', () => {
      const message = {
        ...baseMessage,
        sender: { ...baseMessage.sender, title: '' },
        content: 'Senior backend role',
      };

      expect(() => analyzeRole(message)).not.toThrow();
    });
  });

  describe('draftReply', () => {
    const mockMessage: MessageData = {
      message_id: 'msg_123',
      thread_id: 'thread_456',
      sender: {
        name: 'Jane Smith',
        title: 'Senior Recruiter at TechCorp',
        company: 'TechCorp',
      },
      content: 'We have a Senior Go Engineer role',
      timestamp: '2026-03-26T17:00:00Z',
    };

    it('should draft polite decline', () => {
      const reply = draftReply('not_interested', mockMessage);

      expect(reply).toContain('Thanks');
      expect(reply).toContain('doesn\'t align');
      expect(reply).toBeDefined();
    });

    it('should draft questions for more info', () => {
      const reply = draftReply('tell_me_more', mockMessage);

      expect(reply).toContain('learn more');
      expect(reply).toBeDefined();
    });

    it('should draft meeting request with dynamic times', () => {
      const suggestedTimes = [
        '2026-03-30T14:00:00.000Z',
        '2026-03-30T18:00:00.000Z',
        '2026-03-31T14:00:00.000Z',
      ];

      const reply = draftReply('lets_talk', mockMessage, suggestedTimes);

      expect(reply).toContain('schedule a call');
      expect(reply).toContain('ET');
    });

    it('should handle lets_talk with no suggested times', () => {
      const reply = draftReply('lets_talk', mockMessage);

      expect(reply).toContain('schedule a call');
      expect(reply).toContain('check my calendar');
    });

    it('should return generic reply for unknown choice', () => {
      const reply = draftReply('unknown_choice' as any, mockMessage);
      expect(reply).toBe('Thanks for reaching out!');
    });
  });
});
