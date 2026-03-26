export interface RecruiterProfile {
  name: string;
  title: string;
  company: string;
}

export interface MessageData {
  message_id: string;
  thread_id: string;
  sender: RecruiterProfile;
  content: string;
  timestamp: string;
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

export interface TelegramCallbackData {
  message_id: string;
  action: 'not_interested' | 'tell_me_more' | 'lets_talk';
}
