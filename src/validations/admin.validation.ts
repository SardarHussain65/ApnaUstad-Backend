import { z } from "zod";

const loginAdminSchema = z.object({
    email: z.string({ error: "Email is required" }).email("Invalid email address"),
    password: z.string({ error: "Password is required" }).min(6, "Password must be at least 6 characters long"),
});

const updateAdminProfileSchema = z.object({
    fullName: z.string().min(3, "Full name must be at least 3 characters long").optional(),
    email: z.string().email("Invalid email address").optional(),
});

const changeAdminPasswordSchema = z.object({
    oldPassword: z.string().min(6, "Old password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters long"),
});

const reviewVerificationSchema = z.object({
    status: z.enum(['approved', 'rejected'], { error: "Status must be 'approved' or 'rejected'" }),
    rejectionReason: z.string().max(500, "Rejection reason is too long").optional(),
    adminNotes: z.string().max(1000, "Admin notes are too long").optional(),
});

export {
    loginAdminSchema,
    updateAdminProfileSchema,
    changeAdminPasswordSchema,
    reviewVerificationSchema,
}
