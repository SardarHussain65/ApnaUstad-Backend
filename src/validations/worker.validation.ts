import { z } from "zod";

export const registerWorkerSchema = z.object({
    fullName: z.string({ message: "Full name is required" }).min(3, "Full name must be at least 3 characters long"),
    phone: z.string({ message: "Phone number is required" }).min(11, "Phone number must be at least 11 digits long"),
    email: z.string({ message: "Email must be a string" }).email("Invalid email address").optional(),
    password: z.string({ message: "Password is required" }).min(6, "Password must be at least 6 characters long"),
    cnicNumber: z.string({ message: "CNIC number is required" }).min(13, "CNIC number must be at least 13 digits long"),
    // Image URLs — client uploads via dedicated endpoints first, then passes URLs here
    profileImage: z.string({ message: "Profile image must be a string" }).url("Invalid profile image URL").optional(),
    cnicFrontImage: z.string({ message: "CNIC front image must be a string" }).url("Invalid CNIC front image URL").optional(),
    cnicBackImage: z.string({ message: "CNIC back image must be a string" }).url("Invalid CNIC back image URL").optional(),
    category: z.string({ message: "Category is required" }).min(3, "Category must be at least 3 characters long"),
    skills: z.array(z.string({ message: "Skill must be a string" }), { message: "Skills array is required" }).min(1, "At least 1 skill is required"),
    hourlyRate: z.number({ message: "Hourly rate is required and must be a number" }).min(1, "Hourly rate must be at least 1"),
    bio: z.string({ message: "Bio is required" }).min(3, "Bio must be at least 3 characters long"),
    experience: z.number({ message: "Experience is required and must be a number" }).min(0, "Experience must be at least 0"),
    city: z.string({ message: "City is required" }).min(3, "City must be at least 3 characters long"),
    address: z.string({ message: "Address is required" }).min(3, "Address must be at least 3 characters long"),
    latitude: z.number({ message: "Latitude is required and must be a number" }),
    longitude: z.number({ message: "Longitude is required and must be a number" }),
    fcmToken: z.string({ message: "FCM token must be a string" }).optional(),
});


export const loginWorkerSchema = z.object({
    password: z.string({ message: "Password is required" }).min(6, "Password must be at least 6 characters long"),
    phone: z.string({ message: "Phone number is required" }).min(11, "Phone number must be at least 11 digits long").optional(),
    email: z.string({ message: "Email must be a string" }).email("Invalid email address").optional(),
    fcmToken: z.string({ message: "FCM token must be a string" }).optional()
});
