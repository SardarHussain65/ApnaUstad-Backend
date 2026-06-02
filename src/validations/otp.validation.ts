import { z } from "zod";

export const verifyFirebaseTokenSchema = z.object({
    idToken: z.string({ error: "Firebase ID Token is required" }).min(10, "Invalid ID Token"),
    type: z.enum(['user', 'worker']).optional().default('user')
});

export const firebaseResetPasswordSchema = z.object({
    idToken: z.string({ error: "Firebase ID Token is required" }).min(10, "Invalid ID Token"),
    newPassword: z.string({ error: "New password is required" }).min(6, "Password must be at least 6 characters"),
    type: z.enum(['user', 'worker']).optional().default('user')
});

export const sendEmailOtpSchema = z.object({
    email: z.string({ error: "Email is required" }).email("Invalid email format")
});

export const verifyEmailOtpSchema = z.object({
    email: z.string({ error: "Email is required" }).email("Invalid email format"),
    code: z.string({ error: "Verification code is required" }).length(6, "Verification code must be exactly 6 digits")
});

export const sendForgotPasswordOtpSchema = z.object({
    email: z.string({ error: "Email is required" }).email("Invalid email format"),
    type: z.enum(['user', 'worker']).optional().default('user')
});

export const resetForgotPasswordSchema = z.object({
    email: z.string({ error: "Email is required" }).email("Invalid email format"),
    code: z.string({ error: "Verification code is required" }).length(6, "Verification code must be exactly 6 digits"),
    newPassword: z.string({ error: "New password is required" }).min(6, "Password must be at least 6 characters"),
    type: z.enum(['user', 'worker']).optional().default('user')
});

