import type { MessageData, AnalysisResult } from '../../../shared/types.js';

export const RECRUITER_KEYWORDS = [
  'opportunity',
  'role',
  'hiring',
  'position',
  'interview',
  'recruiter',
  'job',
  'career',
  'vacancy',
  'opening',
  'senior',
  'staff',
  'principal',
  'lead',
  'golang',
  'rust',
  'backend',
  'distributed',
  'systems',
  'infrastructure',
  'platform',
];

// Negative signals
const NEGATIVE_KEYWORDS = [
  'php',
  'wordpress',
  'frontend-only',
  'frontend only',
  'consulting',
  'staff augmentation',
  'contract',
];

// High-priority signals
const HIGH_VALUE_KEYWORDS = ['golang', 'rust', 'distributed', 'senior', 'staff'];

export function analyzeRole(messageData: MessageData): AnalysisResult {
  const { content, sender } = messageData;
  const lowerContent = content.toLowerCase();
  const lowerTitle = sender.title?.toLowerCase() ?? '';

  let score = 0;
  const reasons: string[] = [];

  // Check for high-value keywords - use word boundary for "go"
  const hasGo = /\bgo\b/.test(lowerContent) || lowerContent.includes('golang');
  const hasRust = lowerContent.includes('rust');

  if (hasGo) {
    score += 0.3;
    reasons.push('Go experience mentioned');
  }

  if (hasRust) {
    score += 0.3;
    reasons.push('Rust experience mentioned');
  }

  // Check seniority
  const hasSenior = lowerContent.includes('senior') || lowerTitle.includes('senior');
  const hasStaff = lowerContent.includes('staff') || lowerTitle.includes('staff');
  const hasPrincipal = lowerContent.includes('principal') || lowerTitle.includes('principal');

  if (hasStaff || hasPrincipal) {
    score += 0.3;
    reasons.push('Staff/Principal level role');
  } else if (hasSenior) {
    score += 0.2;
    reasons.push('Senior level role');
  }

  // Check backend/distributed systems
  if (lowerContent.includes('distributed') || lowerContent.includes('backend')) {
    score += 0.2;
    reasons.push('Backend/distributed systems work');
  }

  // Check for negative signals
  const hasNegativeKeywords = NEGATIVE_KEYWORDS.some(kw => lowerContent.includes(kw));
  const isAgency = lowerTitle.includes('consulting') ||
                   lowerTitle.includes('staffing') ||
                   lowerContent.includes('staff augmentation');

  // Check compensation
  const compMatch = content.match(/\$([\d,]+)k/i);
  if (compMatch) {
    const comp = parseInt(compMatch[1].replace(/,/g, ''), 10);
    if (comp >= 200) {
      score += 0.2;
      reasons.push(`Compensation $${comp}K meets threshold`);
    } else {
      score -= 0.3;
      reasons.push(`Compensation $${comp}K below $200K threshold`);
    }
  }

  // Check location
  if (lowerContent.includes('remote') || lowerContent.includes('charlotte')) {
    score += 0.1;
    reasons.push('Location matches preference (Remote/Charlotte)');
  }

  // Negative adjustments
  if (hasNegativeKeywords || isAgency) {
    score -= 0.5;
    if (isAgency) reasons.push('Agency/consulting role - lower priority');
    else reasons.push('Contains non-preferred tech (PHP/WordPress/etc)');
  }

  // Final decision
  const confidence = Math.min(Math.max(score, 0), 1);
  const isMatch = confidence > 0.6;

  let suggestedReplyType: AnalysisResult['suggested_reply_type'];
  if (confidence > 0.7) {
    suggestedReplyType = 'lets_talk';
  } else if (confidence > 0.4) {
    suggestedReplyType = 'tell_me_more';
  } else {
    suggestedReplyType = 'not_interested';
  }

  return {
    is_match: isMatch,
    confidence,
    reasons,
    suggested_reply_type: suggestedReplyType,
  };
}

function formatTimeSlots(suggestedTimes?: string[]): string {
  if (!suggestedTimes || suggestedTimes.length === 0) {
    return '(Please check my calendar for available times)';
  }

  return suggestedTimes.map(iso => {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
    return `- ${day} ${time} ET`;
  }).join('\n');
}

export function draftReply(
  choice: 'not_interested' | 'tell_me_more' | 'lets_talk',
  messageData: MessageData,
  suggestedTimes?: string[]
): string {
  const { sender } = messageData;

  switch (choice) {
    case 'not_interested':
      return `Hi ${sender.name.split(' ')[0]},

Thanks for reaching out about the opportunity at ${sender.company}.

After reviewing the details, this doesn't align with my current career focus. I'm specifically targeting Senior/Staff Engineer roles in Go/Rust backend systems.

I appreciate you thinking of me and wish you luck in your search!

Best regards`;

    case 'tell_me_more':
      return `Hi ${sender.name.split(' ')[0]},

Thanks for reaching out about the opportunity at ${sender.company}. This sounds interesting, and I'd like to learn more.

Could you share additional details about:
- The specific tech stack and architecture
- Team structure and size
- Compensation range
- Interview process

Looking forward to hearing more!

Best regards`;

    case 'lets_talk':
      return `Hi ${sender.name.split(' ')[0]},

Thanks for reaching out! This opportunity at ${sender.company} sounds like a great fit for my background and interests.

I'd love to schedule a call to discuss the role in more detail. Here are some times I'm available this week:

${formatTimeSlots(suggestedTimes)}

Please let me know what works for you, or feel free to send over a calendar invite.

Looking forward to chatting!

Best regards`;

    default:
      return 'Thanks for reaching out!';
  }
}
