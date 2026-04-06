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
