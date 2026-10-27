import { describe, it, expect } from 'vitest';
import {
  isValidCnic,
  normalizeCnic,
  maskCnic,
  maskCnicDeep,
} from '../utils/cnic';

describe('CNIC helpers', () => {
  it('validates and normalizes 13-digit Pakistani CNICs', () => {
    expect(isValidCnic('35202-1234567-1')).toBe(true);
    expect(isValidCnic('3520212345671')).toBe(true);
    expect(isValidCnic('35202-1234567')).toBe(false);
    expect(isValidCnic('abcd-efghijk-l')).toBe(false);

    expect(normalizeCnic('3520212345671')).toBe('35202-1234567-1');
    expect(normalizeCnic('35202-1234567-1')).toBe('35202-1234567-1');
    expect(normalizeCnic('invalid')).toBeNull();
  });

  it('masks CNIC retaining district, last 2 digits, and checksum', () => {
    expect(maskCnic('35202-1234567-1')).toBe('35202-*****67-1');
    expect(maskCnic('3520212345671')).toBe('35202-*****67-1');
  });

  it('deep masks CNIC in arbitrary object trees and sets cnicMasked flag', () => {
    const payload = {
      worker: {
        id: '123',
        fullName: 'Ali Khan',
        cnicNumber: '35202-1234567-1',
        certificates: [
          { title: 'Plumbing Cert', verified: true }
        ]
      },
      meta: {
        cnic: '42201-9876543-2'
      }
    };

    const masked = maskCnicDeep(payload);
    expect(masked.worker.cnicNumber).toBe('35202-*****67-1');
    expect((masked.worker as any).cnicMasked).toBe(true);
    expect(masked.meta.cnic).toBe('42201-*****43-2');
    expect((masked.meta as any).cnicMasked).toBe(true);
    expect(masked.worker.fullName).toBe('Ali Khan');
  });
});
