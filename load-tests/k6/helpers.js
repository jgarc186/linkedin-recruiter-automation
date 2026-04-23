export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8000';
export const API_KEY = __ENV.API_KEY || 'test-api-key';

export const authHeaders = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

export function makeMessagePayload(suffix) {
  return JSON.stringify({
    message_id: `msg_load_${suffix}`,
    thread_id: `thread_load_${suffix}`,
    sender: {
      name: 'Jane Smith',
      title: 'Senior Software Engineer Recruiter',
      company: 'TechCorp Inc',
    },
    content:
      'We have an exciting Senior TypeScript/Go position. Competitive comp $180k–$220k. Remote-friendly. 5+ years of backend experience required.',
    timestamp: new Date().toISOString(),
    criteria: {
      minSeniority: 'senior',
      preferredTechStack: ['Go', 'TypeScript', 'Kubernetes'],
      minCompensation: 150000,
    },
  });
}
