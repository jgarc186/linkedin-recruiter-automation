import type { MessageData, AnalysisResult, UserCriteria } from '../../../shared/types.js';
import { DEFAULT_CRITERIA } from '../../../shared/types.js';
import { RECRUITER_KEYWORDS as BASE_KEYWORDS } from '../../../shared/constants.js';

export const RECRUITER_KEYWORDS = [
  ...BASE_KEYWORDS,
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

const SENIORITY_RANKS: Record<string, number> = {
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
  principal: 5,
};

function matchesTech(lowerContent: string, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  // Short keywords (≤2 chars) need word-boundary matching to avoid false positives (e.g., "C" in "company", "go" in "good")
  if (lower.length <= 2) {
    // Special case: "go" can also match "golang"
    if (lower === 'go') {
      return /\bgo\b/.test(lowerContent) || lowerContent.includes('golang');
    }
    return new RegExp(`\\b${lower}\\b`).test(lowerContent);
  }
  return lowerContent.includes(lower);
}

export function analyzeRole(messageData: MessageData): AnalysisResult {
  const criteria = messageData.criteria ?? DEFAULT_CRITERIA;
  const { content, sender } = messageData;
  const lowerContent = content.toLowerCase();
  const lowerTitle = sender.title?.toLowerCase() ?? '';

  let score = 0;
  const reasons: string[] = [];

  // Check preferred tech stack (cap contribution at 0.6)
  let techScore = 0;
  for (const tech of criteria.preferredTechStack) {
    if (matchesTech(lowerContent, tech)) {
      techScore += 0.3;
      reasons.push(`${tech} mentioned`);
    }
  }
  techScore = Math.min(techScore, 0.6);
  score += techScore;

  // Check seniority
  const minRank = SENIORITY_RANKS[criteria.minSeniority.toLowerCase()] ?? 3;
  const hasPrincipal = lowerContent.includes('principal') || lowerTitle.includes('principal');
  const hasStaff = lowerContent.includes('staff') || lowerTitle.includes('staff');
  const hasSenior = lowerContent.includes('senior') || lowerTitle.includes('senior');
  const hasMid = lowerContent.includes('mid-level') || lowerContent.includes('mid level') || lowerTitle.includes('mid-level') || lowerTitle.includes('mid level');
  const hasJunior = lowerContent.includes('junior') || lowerTitle.includes('junior');

  const detectedRank = hasPrincipal ? 5 : hasStaff ? 4 : hasSenior ? 3 : hasMid ? 2 : hasJunior ? 1 : 0;

  if (detectedRank > 0 && detectedRank >= minRank) {
    if (detectedRank >= 4) {
      score += 0.3;
      reasons.push('Staff/Principal level role');
    } else if (detectedRank === 3) {
      score += 0.2;
      reasons.push('Senior level role');
    } else {
      score += 0.1;
      reasons.push('Mid/Junior level role');
    }
  }

  // Check for avoid keywords (negative signals)
  const avoidLower = criteria.avoidKeywords.map(k => k.toLowerCase());
  const hasAvoidKeywords = avoidLower.some(kw => lowerContent.includes(kw));
  const isAgency = lowerTitle.includes('consulting') ||
                   lowerTitle.includes('staffing') ||
                   lowerContent.includes('staff augmentation');

  // Check compensation
  const compThresholdK = criteria.minCompensation / 1000;
  const compMatch = content.match(/\$([\d,]+)k/i);
  if (compMatch) {
    const comp = parseInt(compMatch[1].replace(/,/g, ''), 10);
    if (comp >= compThresholdK) {
      score += 0.2;
      reasons.push(`Compensation $${comp}K meets threshold`);
    } else {
      score -= 0.3;
      reasons.push(`Compensation $${comp}K below $${compThresholdK}K threshold`);
    }
  }

  // Check locations
  const matchedLocation = criteria.locations.find(loc =>
    lowerContent.includes(loc.toLowerCase())
  );
  if (matchedLocation) {
    score += 0.1;
    reasons.push(`Location matches preference (${criteria.locations.join('/')})`);
  }

  // Negative adjustments
  if (hasAvoidKeywords || isAgency) {
    score -= 0.5;
    if (isAgency) reasons.push('Agency/consulting role - lower priority');
    else reasons.push('Contains non-preferred keywords');
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
  const resolved = messageData.criteria ?? DEFAULT_CRITERIA;

  switch (choice) {
    case 'not_interested': {
      const seniority = resolved.minSeniority.charAt(0).toUpperCase() + resolved.minSeniority.slice(1);
      const techFocus = resolved.preferredTechStack.join('/');
      return `Hi ${sender.name.split(' ')[0]},

Thanks for reaching out about the opportunity at ${sender.company}.

After reviewing the details, this doesn't align with my current career focus. I'm specifically targeting ${seniority}+ Engineer roles in ${techFocus}.

I appreciate you thinking of me and wish you luck in your search!

Best regards`;
    }

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
