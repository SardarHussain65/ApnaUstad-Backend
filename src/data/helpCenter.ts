export interface HelpTopic {
  id: string;
  title: string;
  icon: string;
  color: string;
}

export interface HelpArticle {
  id: string;
  topicId: string;
  title: string;
  body: string;
  tags: string[];
}

export interface SupportChannel {
  id: string;
  title: string;
  subtitle: string;
  type: 'chat' | 'email' | 'community';
  action: string;
}

export const helpTopics: HelpTopic[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'book',
    color: '#00F5FF',
  },
  {
    id: 'bookings',
    title: 'Bookings',
    icon: 'briefcase',
    color: '#FF8C00',
  },
  {
    id: 'payments',
    title: 'Cash Payments',
    icon: 'wallet',
    color: '#64D2FF',
  },
  {
    id: 'safety',
    title: 'Safety',
    icon: 'shield',
    color: '#BF5AF2',
  },
  {
    id: 'account',
    title: 'Account',
    icon: 'user',
    color: '#FF1493',
  },
];

export const helpArticles: HelpArticle[] = [
  {
    id: 'getting-started-1',
    topicId: 'getting-started',
    title: 'Create your first booking',
    body: 'Open Jobs, choose a category, add details, and submit your booking request.',
    tags: ['booking', 'jobs', 'client'],
  },
  {
    id: 'getting-started-2',
    topicId: 'getting-started',
    title: 'Track booking progress',
    body: 'Use the Bookings tab to follow status updates from accepted to completed.',
    tags: ['booking', 'status', 'tracking'],
  },
  {
    id: 'bookings-1',
    topicId: 'bookings',
    title: 'Cancel or reschedule a booking',
    body: 'Open the booking details and choose cancel or reschedule if available.',
    tags: ['bookings', 'cancel', 'reschedule'],
  },
  {
    id: 'payments-1',
    topicId: 'payments',
    title: 'Cash payment steps',
    body: 'Pay the worker in cash after the job is completed. Confirm payment in the app if prompted.',
    tags: ['payments', 'cash'],
  },
  {
    id: 'safety-1',
    topicId: 'safety',
    title: 'Stay safe during a job',
    body: 'Verify the worker or client details in the booking before starting the job.',
    tags: ['safety', 'verification'],
  },
  {
    id: 'account-1',
    topicId: 'account',
    title: 'Update your profile',
    body: 'Go to Profile > Personal Information to update your details.',
    tags: ['account', 'profile'],
  },
];

export const supportChannels: SupportChannel[] = [
  {
    id: 'chat',
    title: 'Live Chat',
    subtitle: 'Typical response: under 5 minutes',
    type: 'chat',
    action: 'in-app',
  },
  {
    id: 'email',
    title: 'Email Support',
    subtitle: 'Typical response: within 4 hours',
    type: 'email',
    action: 'mailto:support@apnaustad.com',
  },
  {
    id: 'community',
    title: 'Community',
    subtitle: 'Share tips with other users',
    type: 'community',
    action: 'https://community.apnaustad.com',
  },
];
