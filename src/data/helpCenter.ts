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
    title: 'How to book an Ustad',
    body: 'Choose the work you need on the Home screen, explain the issue (or add a voice message), and send your request.',
    tags: ['booking', 'jobs', 'customer'],
  },
  {
    id: 'getting-started-2',
    topicId: 'getting-started',
    title: 'Check your job status',
    body: 'Open My Jobs to see whether your Ustad is confirmed, on the way, or has finished the work.',
    tags: ['booking', 'status', 'tracking'],
  },
  {
    id: 'bookings-1',
    topicId: 'bookings',
    title: 'Cancel a job request',
    body: 'Open the job from My Jobs and tap Cancel if your plans have changed before work starts.',
    tags: ['bookings', 'cancel', 'reschedule'],
  },
  {
    id: 'payments-1',
    topicId: 'payments',
    title: 'How cash payment works',
    body: 'Pay the Ustad in cash once the work is done, then tap Confirm Cash Paid in the app.',
    tags: ['payments', 'cash'],
  },
  {
    id: 'safety-1',
    topicId: 'safety',
    title: 'Staying safe during a visit',
    body: 'Check the Ustad or customer profile and agreed rate in the app before starting the work.',
    tags: ['safety', 'verification'],
  },
  {
    id: 'account-1',
    topicId: 'account',
    title: 'Change your phone, photo, or address',
    body: 'Go to Profile > Personal Details to update your name, photo, phone number, or area.',
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
