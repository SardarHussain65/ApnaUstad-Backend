# ApnaUstad Backend API 🔧

> **Har Kaam Ka Ustad** — Your Expert, At Your Door

A complete Node.js REST API backend for **ApnaUstad** — a local home services marketplace that connects customers with verified skilled workers (electricians, plumbers, carpenters, painters, and more) in their area.

---

## 📱 About The App

ApnaUstad is a two-sided marketplace:

- **Customers** can browse verified local workers, check hourly rates, and book them instantly
- **Workers** can register, set their rates, manage bookings, and earn money
- **Admin** can verify workers, manage categories, and monitor all activity

---

## 🏗️ Project Structure

```
apnaustad-backend/
├── src/
│   ├── config/
│   │   ├── db.js                  → MongoDB connection
│   │   ├── cloudinary.js          → Image upload config
│   │   └── socket.js              → Socket.io config
│   ├── models/
│   │   ├── User.js                → Customer model
│   │   ├── Worker.js              → Worker model
│   │   ├── Booking.js             → Booking model
│   │   ├── Review.js              → Review model
│   │   ├── Category.js            → Service category model
│   │   ├── Notification.js        → Notification model
│   │   └── OTP.js                 → OTP model (auto-expires)
│   ├── controllers/
│   │   ├── authController.js      → Login, OTP, register
│   │   ├── userController.js      → User profile management
│   │   ├── workerController.js    → Worker search & management
│   │   ├── bookingController.js   → Booking logic
│   │   ├── reviewController.js    → Reviews & ratings
│   │   ├── categoryController.js  → Service categories
│   │   └── notificationController.js → Push notifications
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── workerRoutes.js
│   │   ├── bookingRoutes.js
│   │   ├── reviewRoutes.js
│   │   ├── categoryRoutes.js
│   │   └── notificationRoutes.js
│   ├── middlewares/
│   │   ├── authMiddleware.js      → JWT verification & role check
│   │   ├── uploadMiddleware.js    → Cloudinary image upload
│   │   └── errorMiddleware.js     → Global error handler
│   ├── utils/
│   │   ├── sendOTP.js             → SMS (Twilio) & Email OTP sender
│   │   ├── generateToken.js       → JWT token generator
│   │   ├── sendNotification.js    → FCM push notifications
│   │   ├── calculateCommission.js → 15% commission logic
│   │   └── asyncHandler.js        → Async error wrapper
│   └── app.js                     → Express app setup
├── server.js                      → Entry point
├── .env                           → Secret keys (never commit)
├── .env.example                   → Template for other developers
├── .gitignore
└── package.json
```

---

## ⚙️ Tech Stack

| Technology | Purpose |
|---|---|
| **Node.js** | Runtime environment |
| **Express.js** | Web framework |
| **MongoDB** | Database |
| **Mongoose** | MongoDB object modeling |
| **JWT** | Authentication tokens |
| **Twilio** | SMS OTP sending |
| **Nodemailer** | Email OTP sending |
| **Cloudinary** | Image storage |
| **Socket.io** | Real-time communication |
| **Firebase Admin** | Push notifications (FCM) |
| **Stripe** | Payment processing |
| **Helmet** | API security headers |
| **Morgan** | Request logging |
| **express-rate-limit** | Rate limiting / spam protection |

---

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org) v18 or higher
- [npm](https://npmjs.com) v9 or higher
- [MongoDB Atlas](https://mongodb.com/atlas) account (free tier works)
- [Postman](https://postman.com) for API testing

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/yourusername/apnaustad-backend.git
cd apnaustad-backend
```

**2. Install dependencies**
```bash
npm install
```

**3. Setup environment variables**
```bash
# Copy the example env file
cp .env.example .env

# Open .env and fill in your values
```

**4. Start the development server**
```bash
npm run dev
```

**5. Verify server is running**
```
Open browser → http://localhost:5000
You should see: ✅ ApnaUstad API is running
```

---

## 🐳 Docker Support

You can run the entire application using Docker. This ensures that the app runs in the exact same environment on every machine.

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running.
- **MongoDB Dependency:** The server requires a MongoDB connection. `startServer()` calls `connectDB()`, which will trigger `process.exit(1)` on failure. Without a database, the container will crash immediately.

### Using Docker Compose (Recommended)

**1. Configure Database Connection**
You must satisfy the database requirement using one of these two options:
- **Option A (Local Database):** Enable/uncomment the `mongo` service and volume in your `docker-compose.yml` file. Update your `.env` to connect to it (e.g., `MONGODB_URL=mongodb://db_user:db_password@mongo:27017/ApnaUstad?authSource=admin`).
- **Option B (External Database):** Provide a valid `MONGODB_URL` environment variable within your `.env` pointing to an external MongoDB Atlas cluster or another server.

**2. Build and start the containers**
```bash
docker compose up --build
```
This command will:
- Build the Docker image using the multi-stage `Dockerfile`.
- Install all necessary dependencies inside the container.
- Compile TypeScript to JavaScript.
- Start the server on port `3000`.

**3. Stop the containers**
```bash
docker compose down
```

### Understanding the Docker Setup
- **Dockerfile**: Uses a multi-stage build to ensure the final production image is small and secure. It compiles TypeScript and only includes production dependencies in the final stage.
- **.dockerignore**: Ensures that local `node_modules` and other unnecessary files are not copied into the image.
- **docker-compose.yml**: Manages the container's configuration, maps ports, and links your `.env` file automatically.
- **Critical Dependency**: If the database is unreachable, the Node.js application will stop at startup, exiting the container immediately.

---

---

## 🔐 Environment Variables

Create a `.env` file in the root directory with the following:

```env
# ── SERVER ──────────────────────────────────
PORT=5000
NODE_ENV=development

# ── MONGODB ─────────────────────────────────
MONGO_URI=mongodb+srv://USERNAME:PASSWORD@cluster.mongodb.net/apnaustad

# ── JWT ─────────────────────────────────────
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRE=30d

# ── TWILIO (SMS OTP) ────────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890

# ── EMAIL (EMAIL OTP) ───────────────────────
EMAIL_USER=yourgmail@gmail.com
EMAIL_PASS=your_gmail_app_password

# ── CLOUDINARY (IMAGE UPLOAD) ───────────────
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your_key_here

# ── STRIPE (PAYMENTS) ───────────────────────
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_key_here

# ── FIREBASE (PUSH NOTIFICATIONS) ───────────
FIREBASE_PROJECT_ID=apnaustad-xxxxx
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nXXXXX\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@apnaustad.iam.gserviceaccount.com

# ── APP CONFIG ───────────────────────────────
CLIENT_URL=http://localhost:3000
COMMISSION_PERCENTAGE=15
```

> ⚠️ **Never commit your `.env` file to Git. It contains secret keys.**

---

## 📡 API Endpoints

### 🔑 Auth Routes `/api/auth`

| Method | Endpoint | Description | Access |
|---|---|---|---|
| POST | `/send-otp` | Send OTP to phone or email | Public |
| POST | `/verify-otp` | Verify OTP and login/register | Public |
| GET | `/me` | Get logged in user info | Private |

### 👤 User Routes `/api/users`

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/me` | Get my profile | Private |
| PUT | `/me` | Update my profile | Private |
| PUT | `/me/photo` | Update profile photo | Private |
| PUT | `/update-location` | Update GPS location | Private |
| PUT | `/me/fcm-token` | Update notification token | Private |
| DELETE | `/me` | Delete my account | Private |

### 👷 Worker Routes `/api/workers`

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/` | Get all workers (with filters) | Public |
| GET | `/:id` | Get single worker profile | Public |
| GET | `/nearby` | Get workers near customer | Public |
| GET | `/category/:name` | Get workers by category | Public |
| GET | `/top-rated` | Get top rated workers | Public |

### 📅 Booking Routes `/api/bookings`

| Method | Endpoint | Description | Access |
|---|---|---|---|
| POST | `/` | Create new booking | Private (Customer) |
| GET | `/my` | Get my bookings | Private |
| GET | `/:id` | Get single booking detail | Private |
| PUT | `/:id/cancel` | Cancel a booking | Private |

### ⭐ Review Routes `/api/reviews`

| Method | Endpoint | Description | Access |
|---|---|---|---|
| POST | `/` | Submit a review | Private (Customer) |
| GET | `/worker/:id` | Get all reviews for a worker | Public |

### 🗂️ Category Routes `/api/categories`

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/` | Get all active categories | Public |

### 🔔 Notification Routes `/api/notifications`

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/my` | Get my notifications | Private |
| PUT | `/read-all` | Mark all as read | Private |

---

## 🗄️ Database Models

### User (Customer)
```
fullName, phone, email, profileImage,
address, city, location (GPS), fcmToken, isActive
```

### Worker
```
fullName, phone, email, profileImage, cnicNumber,
cnicImage, category, skills[], hourlyRate, bio,
experience, city, address, location (GPS),
isAvailable, isVerified, isActive,
rating, totalReviews, totalJobs, totalEarnings, fcmToken
```

### Booking
```
customer (ref), worker (ref), category, description,
scheduledDate, scheduledTime, estimatedHours,
hourlyRate, subtotal, platformFee, totalAmount,
workerEarning, address, location (GPS),
status, paymentStatus, paymentMethod,
stripePaymentId, cancelledBy, cancelReason, isReviewed
```

### Review
```
booking (ref), customer (ref), worker (ref),
rating (1-5), comment, tags[]
```

### Category
```
name, icon, color, description, sortOrder, isActive
```

### Notification
```
recipient, recipientType, title, message,
type, icon, color, booking (ref), isRead
```

### OTP
```
phone, email, otp, createdAt (auto-expires in 5 min)
```

---

## 💰 Business Logic

### Commission Calculation
```
Hourly Rate:    Rs. 500
Estimated Hours: × 2
─────────────────────
Subtotal:       Rs. 1,000  ← Worker earns this
Platform Fee:   Rs.   150  ← ApnaUstad earns this (15%)
─────────────────────────
Total:          Rs. 1,150  ← Customer pays this
```

### Booking Status Flow
```
pending → accepted → ongoing → completed
                 ↘
               cancelled
```

### Login Options
```
Option 1: Phone Number → OTP sent via SMS (Twilio)
Option 2: Email Address → OTP sent via Email (Nodemailer)
```

### Worker Visibility Rules
```
✅ isVerified = true   (admin approved)
✅ isAvailable = true  (worker is online)
✅ isActive = true     (account not banned)
```

---

## 🔒 Authentication

This API uses **JWT (JSON Web Tokens)** for authentication.

**How it works:**
1. User sends phone/email → receives OTP
2. User verifies OTP → receives JWT token
3. User sends token with every protected request
4. Server verifies token → allows or rejects request

**How to send token in requests:**
```
Header: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 🧪 Testing with Postman

### Step 1 — Send OTP
```json
POST /api/auth/send-otp
{
  "phone": "+923001234567",
  "role": "user"
}
```

### Step 2 — Verify OTP
```json
POST /api/auth/verify-otp
{
  "phone": "+923001234567",
  "otp": "123456",
  "role": "user"
}
```

### Step 3 — Use Token
```
GET /api/auth/me
Header → Authorization: Bearer <your_token_here>
```

---

## 📦 Scripts

```bash
npm run dev     # Start development server (with nodemon)
npm start       # Start production server
```

---

## 🗺️ Development Roadmap

- [x] Project setup & folder structure
- [x] MongoDB connection
- [x] All database models
- [x] Auth system (OTP + JWT)
- [x] Core middlewares
- [ ] User routes & controller
- [ ] Worker routes & controller
- [ ] Booking system
- [ ] Reviews & rating system
- [ ] Push notifications
- [ ] Image upload (Cloudinary)
- [ ] Payment integration (Stripe)
- [ ] Admin panel API
- [ ] Deploy to Railway/Render

---

## 👥 User Roles

| Role | Description |
|---|---|
| `user` | Customer who books services |
| `worker` | Service provider (electrician, plumber etc.) |
| `admin` | Platform administrator |

---

## 📍 Location System

Both customers and workers share their GPS location from mobile:

- **Customer location** → used as search center point ("find workers near me")
- **Worker location** → used as search target ("I am here, find me")
- Coordinates stored as `[longitude, latitude]` (GeoJSON standard)
- MongoDB `2dsphere` index enables fast location-based queries

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is private and proprietary.
© 2026 ApnaUstad. All rights reserved.

---

## 📞 Contact

**ApnaUstad Team**
- App: ApnaUstad
- Tagline: *Har Kaam Ka Ustad*
- Email: support@apnaustad.pk

---

<div align="center">
  <strong>Built with ❤️ for Pakistan</strong><br/>
  <em>Connecting skilled workers with customers since 2026</em>
</div>