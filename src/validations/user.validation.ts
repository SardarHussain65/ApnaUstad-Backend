import { z } from "zod";


const registerUserSchema = z.object({
    fullName: z.string({ message: "Full name is required" }).min(3, "Full name must be at least 3 characters long"),
    email: z.string({ message: "Email is required" }).email("Invalid email address"),
    password: z.string({ message: "Password is required" }).min(6, "Password must be at least 6 characters long"),
    phone: z.string({ message: "Phone number is required" }).min(10, "Phone number must be at least 10 digits long"),
    address: z.string({ message: "Address is required" }).min(3, "Address must be at least 3 characters long"),
    city: z.string({ message: "City is required" }).min(3, "City must be at least 3 characters long"),
    latitude: z.number({ message: "Latitude is required and must be a number" }).min(-90).max(90),
    longitude: z.number({ message: "Longitude is required and must be a number" }).min(-180).max(180),
    profileImage: z.string({ message: "Profile image must be a string" }).optional(),
    fcmToken: z.string({ message: "FCM token must be a string" }).optional()
});


const loginUserSchema = z.object({
    email: z.string({ message: "Email must be a string" }).email("Invalid email address").optional(),
    phone: z.string({ message: "Phone number must be a string" }).min(10, "Phone number must be at least 10 digits long").optional(),
    password: z.string({ message: "Password is required" }).min(6, "Password must be at least 6 characters long"),
    fcmToken: z.string({ message: "FCM token must be a string" }).optional()
});


const updateProfileSchema = z.object({
    fullName: z.string().min(3, "Full name must be at least 3 characters long").optional(),
    phone: z.string().min(10, "Phone number must be at least 10 digits long").optional(),
    address: z.string().min(3, "Address must be at least 3 characters long").optional(),
    city: z.string().min(3, "City must be at least 3 characters long").optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    profileImage: z.string().optional(),
    fcmToken: z.string().optional()
});



const logoutUserSchema = z.object({
    fcmToken: z.string().optional()
});



const getAllUsersSchema = z.object({
    page: z.number().optional(),
    limit: z.number().optional(),
    search: z.string().optional(),
    role: z.string().optional()
});


const updateUserSchema = z.object({
    userId: z.string(),
    fullName: z.string().min(3, "Full name must be at least 3 characters long").optional(),
    email: z.string().email("Invalid email address").optional(),
    phone: z.string().min(10, "Phone number must be at least 10 digits long").optional(),
    address: z.string().min(3, "Address must be at least 3 characters long").optional(),
    city: z.string().min(3, "City must be at least 3 characters long").optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    profileImage: z.string().optional(),
    fcmToken: z.string().optional()
});






export {
    registerUserSchema,
    loginUserSchema,
    updateProfileSchema,
    logoutUserSchema,
    getAllUsersSchema,
    updateUserSchema,
}

