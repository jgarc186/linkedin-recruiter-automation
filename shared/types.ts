export interface RecruiterProfile {
  name: string;
  title: string;
  company: string;
  email?: string;
}

export interface UserCriteria {
  minSeniority: string;
  preferredTechStack: string[];
  avoidKeywords: string[];
  locations: string[];
  minCompensation: number;
}

export const DEFAULT_CRITERIA: UserCriteria = {
  minSeniority: 'senior',
  preferredTechStack: ['Go', 'Rust', 'Distributed Systems', 'Backend'],
  avoidKeywords: ['PHP', 'WordPress', 'Staff Augmentation', 'Frontend-only', 'Frontend only', 'Consulting', 'Contract'],
  locations: ['Remote', 'Charlotte, NC'],
  minCompensation: 200000,
};

export interface MessageData {
  message_id: string;
  thread_id: string;
  sender: RecruiterProfile;
  content: string;
  timestamp: string;
  criteria?: UserCriteria;
  extracted_data?: {
    role_title?: string;
    company?: string;
    location?: string;
    tech_stack?: string[];
  };
}

export type WebhookMessagePayload = MessageData;

export interface AnalysisResult {
  is_match: boolean;
  confidence: number;
  reasons: string[];
  suggested_reply_type: 'not_interested' | 'tell_me_more' | 'lets_talk';
}

export interface WebhookReplyPayload {
  message_id: string;
  thread_id: string;
  user_choice: 'not_interested' | 'tell_me_more' | 'lets_talk';
  drafted_reply: string;
  suggested_times?: string[];
}

export type MessageStatus = 'pending' | 'not_interested' | 'tell_me_more' | 'lets_talk' | 'replied';

export interface TelegramCallbackData {
  message_id: string;
  action: 'not_interested' | 'tell_me_more' | 'lets_talk';
}
