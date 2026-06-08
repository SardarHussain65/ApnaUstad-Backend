import { z } from "zod";

export const registerWorkerSchema = z.object({
    fullName: z.string({ error: "Full name is required" }).min(3, "Full name must be at least 3 characters long"),
    phone: z.string({ error: "Phone number is required" }).min(9, "Phone number must be at least 9 digits long"),
    email: z.string({ error: "Email must be a string" }).email("Invalid email address").optional(),
    password: z.string({ error: "Password is required" }).min(6, "Password must be at least 6 characters long"),
    cnicNumber: z.string({ error: "CNIC number is required" }).min(13, "CNIC number must be at least 13 digits long"),
    // Image URLs — client uploads via dedicated endpoints first, then passes URLs here
    profileImage: z.string({ error: "Profile image must be a string" }).url("Invalid profile image URL").optional(),
    cnicFrontImage: z.string({ error: "CNIC front image must be a string" }).url("Invalid CNIC front image URL").optional(),
    cnicBackImage: z.string({ error: "CNIC back image must be a string" }).url("Invalid CNIC back image URL").optional(),
    category: z.string({ error: "Category is required" }).min(3, "Category must be at least 3 characters long"),
    skills: z.array(z.string({ error: "Skill must be a string" }), { error: "Skills array is required" }).min(1, "At least 1 skill is required"),
    hourlyRate: z.number({ error: "Hourly rate is required and must be a number" }).min(100, "Hourly rate must be at least 100"),
    bio: z.string({ error: "Bio is required" }).min(3, "Bio must be at least 3 characters long"),
    experience: z.number({ error: "Experience is required and must be a number" }).min(0, "Experience must be at least 0"),
    city: z.string({ error: "City is required" }).min(3, "City must be at least 3 characters long"),
    address: z.string({ error: "Address is required" }).min(3, "Address must be at least 3 characters long"),
    latitude: z.number({ error: "Latitude is required and must be a number" }).min(-90).max(90),
    longitude: z.number({ error: "Longitude is required and must be a number" }).min(-180).max(180),
    fcmToken: z.string({ error: "FCM token must be a string" }).optional(),
});


export const loginWorkerSchema = z.object({
    password: z.string({ error: "Password is required" }).min(6, "Password must be at least 6 characters long"),
    phone: z.string({ error: "Phone number is required" }).min(11, "Phone number must be at least 11 digits long").optional(),
    email: z.string({ error: "Email must be a string" }).email("Invalid email address").optional(),
    fcmToken: z.string({ error: "FCM token must be a string" }).optional()
}).refine((data) => (data.email && !data.phone) || (data.phone && !data.email), {
    message: "Provide either email or phone, not both",
    path: ["email"]
});

export const requestVerificationSchema = z.object({
    cnicNumber: z.string({ error: "CNIC number is required" }).min(13, "CNIC number must be at least 13 digits long").max(15, "CNIC number must be at most 15 characters long"),
    cnicFrontImage: z.string({ error: "CNIC front image is required" }).url("Invalid CNIC front image URL"),
    cnicBackImage: z.string({ error: "CNIC back image is required" }).url("Invalid CNIC back image URL"),
});
