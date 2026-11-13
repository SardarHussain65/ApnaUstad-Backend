import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as emailService from '../services/emailService';

// Mock Resend
const mockSend = vi.fn().mockResolvedValue({ data: { id: 'test-email-id' }, error: null });

vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: mockSend,
      };
    },
  };
});

describe('emailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes inline cid:apnaustad-logo and auto-attaches logo with contentId', async () => {
    const res = await emailService.sendOTPEmail('test@example.com', '123456');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentParams = mockSend.mock.calls[0]![0];

    expect(sentParams.to).toBe('test@example.com');
    expect(sentParams.subject).toBe('Apna Ustad - Your Verification Code');
    expect(sentParams.html).toContain('cid:apnaustad-logo');
    expect(sentParams.html).toContain('Verify Your Account');
    expect(sentParams.html).toContain('>1</div>');
    expect(sentParams.html).toContain('>6</div>');

    // Check attachments
    expect(sentParams.attachments).toBeDefined();
    expect(Array.isArray(sentParams.attachments)).toBe(true);

    const logoAttachment = sentParams.attachments.find(
      (att: any) => att.contentId === 'apnaustad-logo'
    );
    expect(logoAttachment).toBeDefined();
    expect(logoAttachment.filename).toBe('apnaustad-logo.png');
    expect(logoAttachment.contentType).toBe('image/png');
    // Content should either be base64 string or path
    expect(Boolean(logoAttachment.content || logoAttachment.path)).toBe(true);
  });

  it('does not duplicate logo attachment if already supplied', async () => {
    await emailService.sendEmail({
      to: 'custom@example.com',
      subject: 'Custom Subject',
      html: '<p><img src="cid:apnaustad-logo" /></p>',
      attachments: [
        {
          filename: 'custom-logo.png',
          contentId: 'apnaustad-logo',
          path: 'https://example.com/custom.png',
        },
      ],
    });

    const sentParams = mockSend.mock.calls[0]![0];
    const logoAttachments = sentParams.attachments.filter(
      (att: any) => att.contentId === 'apnaustad-logo'
    );
    expect(logoAttachments.length).toBe(1);
    expect(logoAttachments[0].filename).toBe('custom-logo.png');
  });
});
