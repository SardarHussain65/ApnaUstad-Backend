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

export {
    loginAdminSchema,
    updateAdminProfileSchema,
    changeAdminPasswordSchema,
}
