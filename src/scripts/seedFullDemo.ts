import mongoose from 'mongoose';
import User from '../models/User';
import Worker from '../models/Workers';
import Category from '../models/Category';
import JobPost from '../models/JobPost';
import JobBid from '../models/JobBid';
import Booking from '../models/Booking';
import Review from '../models/Reviews';
import WorkerWallet from '../models/WorkerWallet';
import WalletTransaction from '../models/WalletTransaction';
import WalletTopUpRequest from '../models/WalletTopUpRequest';
import SupportRequest from '../models/SupportRequest';
import AdminAuditLog from '../models/AdminAuditLog';
import Admin from '../models/Admin';
import { getConfig } from '../config/env';

const config = getConfig();

const sampleCategories = [
    { name: 'AC & Appliances', icon: 'Tv', color: '#00F5FF', description: 'Expert repair and servicing for AC, refrigerators, washing machines and ovens.', sortOrder: 1, additionalCategoryMonthlyFee: 300, additionalCategoryGraceDays: 3 },
    { name: 'Plumbing', icon: 'Droplet', color: '#BF5AF2', description: 'Leaking pipe repairs, geyser installs, toilet fittings and full plumbing solutions.', sortOrder: 2, additionalCategoryMonthlyFee: 250, additionalCategoryGraceDays: 3 },
    { name: 'Electrical Work', icon: 'Zap', color: '#FF9500', description: 'Short circuit repairs, switch replacements, ceiling fans and smart home wiring.', sortOrder: 3, additionalCategoryMonthlyFee: 300, additionalCategoryGraceDays: 3 },
    { name: 'Home Cleaning', icon: 'Sparkles', color: '#34C759', description: 'Deep sofa cleaning, carpet sanitization, kitchen and full house scrubbing.', sortOrder: 4, additionalCategoryMonthlyFee: 200, additionalCategoryGraceDays: 3 },
    { name: 'Painting & Renovation', icon: 'Brush', color: '#FF3B30', description: 'Interior/exterior wall painting, waterproofing and modern home renovations.', sortOrder: 5, additionalCategoryMonthlyFee: 350, additionalCategoryGraceDays: 3 },
    { name: 'Geyser Service', icon: 'Flame', color: '#FFCC00', description: 'Instant and storage geyser installation, thermostat replacements and gas leak checks.', sortOrder: 6, additionalCategoryMonthlyFee: 250, additionalCategoryGraceDays: 3 }
];

const sampleCustomers = [
    { fullName: 'Muhammad Bilal', phone: '03001234567', email: 'bilal@gmail.com', password: 'User@123', address: 'Block H3, Johar Town', city: 'Lahore', location: { type: 'Point', coordinates: [74.2662, 31.4697] } },
    { fullName: 'Zainab Fatima', phone: '03217654321', email: 'zainab@gmail.com', password: 'User@123', address: 'Street 4, Phase 5, DHA', city: 'Karachi', location: { type: 'Point', coordinates: [67.0674, 24.8238] } },
    { fullName: 'Hamza Kamran', phone: '03339876543', email: 'hamza@gmail.com', password: 'User@123', address: 'Sector F-10/2', city: 'Islamabad', location: { type: 'Point', coordinates: [73.0116, 33.6938] } },
    { fullName: 'Ayesha Siddiqui', phone: '03454567890', email: 'ayesha@gmail.com', password: 'User@123', address: 'Gulistan-e-Jauhar, Block 13', city: 'Karachi', location: { type: 'Point', coordinates: [67.1246, 24.9123] } },
    { fullName: 'Usman Ghani', phone: '03123456789', email: 'usman@gmail.com', password: 'User@123', address: 'Canal View Society', city: 'Lahore', location: { type: 'Point', coordinates: [74.2234, 31.4889] } }
];

const sampleWorkers = [
    { fullName: 'Sardar Hussain', phone: '03369164460', email: 'sardar@apnaustad.com', password: 'Worker@123', cnicNumber: '17301-1234567-1', category: 'AC & Appliances', hourlyRate: 800, experience: 8, city: 'Lahore', address: 'Model Town Ext', isVerified: true, isActive: true, rating: 4.8, totalReviews: 0, totalJobs: 0, totalEarnings: 0, location: { type: 'Point', coordinates: [74.3212, 31.4801] } },
    { fullName: 'Kamran Akmal', phone: '03159988776', email: 'kamran@apnaustad.com', password: 'Worker@123', cnicNumber: '35202-9876543-1', category: 'Plumbing', hourlyRate: 600, experience: 5, city: 'Lahore', address: 'Gulberg 3', isVerified: true, isActive: true, rating: 4.5, totalReviews: 0, totalJobs: 0, totalEarnings: 0, location: { type: 'Point', coordinates: [74.3512, 31.5204] } },
    { fullName: 'Muhammad Ali', phone: '03441122334', email: 'ali@apnaustad.com', password: 'Worker@123', cnicNumber: '42201-4455667-1', category: 'Electrical Work', hourlyRate: 500, experience: 10, city: 'Karachi', address: 'Clifton Block 5', isVerified: true, isActive: true, rating: 4.9, totalReviews: 0, totalJobs: 0, totalEarnings: 0, location: { type: 'Point', coordinates: [67.0312, 24.8182] } },
    { fullName: 'Zahid Khan', phone: '03028887766', email: 'zahid@apnaustad.com', password: 'Worker@123', cnicNumber: '14301-7788990-1', category: 'Home Cleaning', hourlyRate: 400, experience: 3, city: 'Islamabad', address: 'Sector G-9/4', isVerified: false, isActive: true, rating: 0, totalReviews: 0, totalJobs: 0, totalEarnings: 0, location: { type: 'Point', coordinates: [73.0332, 33.6892] } },
    { fullName: 'Shakeel Painter', phone: '03221234321', email: 'shakeel@apnaustad.com', password: 'Worker@123', cnicNumber: '33102-1122334-1', category: 'Painting & Renovation', hourlyRate: 700, experience: 12, city: 'Faisalabad', address: 'Samanabad Road', isVerified: true, isActive: true, rating: 4.2, totalReviews: 0, totalJobs: 0, totalEarnings: 0, location: { type: 'Point', coordinates: [73.0812, 31.4112] } },
    { fullName: 'Umar Farooq', phone: '03104545123', email: 'umar@apnaustad.com', password: 'Worker@123', cnicNumber: '37405-5544332-1', category: 'Geyser Service', hourlyRate: 650, experience: 4, city: 'Rawalpindi', address: 'Saddar Bazar', isVerified: false, isActive: false, rating: 0, totalReviews: 0, totalJobs: 0, totalEarnings: 0, location: { type: 'Point', coordinates: [73.0612, 33.5912] } }
];

const seedFullDemo = async () => {
    try {
        console.log('Connecting to database...');
        if (!config.mongodbUrl) {
            throw new Error('MONGODB_URL is not defined in environment variables');
        }

        await mongoose.connect(config.mongodbUrl as string);
        console.log('Connected to database successfully.');

        // Fetch or create an Admin for referencing in transactions and audits
        let admin = await Admin.findOne();
        if (!admin) {
            console.log('No admin found, creating a default seed admin...');
            admin = new Admin({
                fullName: 'Super Admin',
                email: 'admin@apnaustad.com',
                password: 'Admin@123',
                role: 'superadmin'
            });
            await admin.save();
        }
        const adminId = admin._id;

        // Cleanup existing collections
        console.log('Cleaning up existing demo collections to ensure clean seed...');
        await Category.deleteMany({});
        await User.deleteMany({ phone: { $in: sampleCustomers.map(c => c.phone) } });

        // Remove workers and all related wallets, transactions, requests
        const existingWorkers = await Worker.find({ phone: { $in: sampleWorkers.map(w => w.phone) } });
        const workerIds = existingWorkers.map(w => w._id);
        await WorkerWallet.deleteMany({ worker: { $in: workerIds } });
        await WalletTransaction.deleteMany({ worker: { $in: workerIds } });
        await WalletTopUpRequest.deleteMany({ worker: { $in: workerIds } });
        await Worker.deleteMany({ phone: { $in: sampleWorkers.map(w => w.phone) } });

        // Remove jobs, bids, bookings, reviews, tickets and logs
        await JobPost.deleteMany({});
        await JobBid.deleteMany({});
        await Booking.deleteMany({});
        await Review.deleteMany({});
        await SupportRequest.deleteMany({});
        await AdminAuditLog.deleteMany({});

        console.log('Existing demo records purged.');

        // 1. Seed Categories
        console.log('Seeding categories...');
        const insertedCategories = await Category.insertMany(sampleCategories);
        console.log(`Seeded ${insertedCategories.length} categories.`);

        // 2. Seed Customers
        console.log('Seeding customers...');
        const customers: any[] = [];
        for (const customerData of sampleCustomers) {
            const customer = new User(customerData);
            await customer.save();
            customers.push(customer);
        }
        console.log(`Seeded ${customers.length} customers.`);

        // 3. Seed Workers
        console.log('Seeding workers...');
        const workers = [];
        const categoryByName = new Map(insertedCategories.map(category => [category.name, category]));
        for (const workerData of sampleWorkers) {
            const primaryCategory = categoryByName.get(workerData.category);
            const seedSkills = 'skills' in workerData && Array.isArray(workerData.skills)
                ? workerData.skills
                : [workerData.category, 'Repair', 'Maintenance'];
            const seedBio = 'bio' in workerData && typeof workerData.bio === 'string'
                ? workerData.bio
                : `Experienced ${workerData.category} professional available for reliable home service.`;
            const worker = new Worker({
                ...workerData,
                skills: seedSkills,
                bio: seedBio,
                specialties: primaryCategory ? [{
                    categoryId: primaryCategory._id,
                    priority: 1,
                    skills: seedSkills,
                    hourlyRate: workerData.hourlyRate || 0,
                    experience: workerData.experience || 0,
                    bio: seedBio,
                    isActive: workerData.isVerified,
                    approvalStatus: workerData.isVerified ? 'approved' : 'pending',
                    subscriptionStatus: 'free',
                    monthlyFeeSnapshot: 0,
                    autoRenew: true
                }] : []
            });
            await worker.save();
            workers.push(worker);

            // Create a wallet for the worker
            const wallet = new WorkerWallet({
                worker: worker._id,
                balance: worker.fullName === 'Sardar Hussain' ? 2500 : worker.fullName === 'Kamran Akmal' ? 850 : 1500,
                totalRecharged: worker.fullName === 'Sardar Hussain' ? 3000 : 1500,
                totalCommissionDeducted: worker.fullName === 'Sardar Hussain' ? 500 : 0,
                isActive: true
            });
            await wallet.save();

            // Create initial wallet transaction for recharge
            if (wallet.balance > 0) {
                const transaction = new WalletTransaction({
                    wallet: wallet._id,
                    worker: worker._id,
                    type: 'recharge',
                    amount: wallet.totalRecharged,
                    balanceBefore: 0,
                    balanceAfter: wallet.totalRecharged,
                    description: 'Initial secure wallet activation recharge via Admin Panel',
                    performedBy: {
                        actor: adminId,
                        actorType: 'admin'
                    }
                });
                await transaction.save();

                if (wallet.totalCommissionDeducted > 0) {
                    const deduction = new WalletTransaction({
                        wallet: wallet._id,
                        worker: worker._id,
                        type: 'commission_deduction',
                        amount: wallet.totalCommissionDeducted,
                        balanceBefore: wallet.totalRecharged,
                        balanceAfter: wallet.balance,
                        description: 'System commission deduction for previous jobs',
                        performedBy: {
                            actor: adminId,
                            actorType: 'admin'
                        }
                    });
                    await deduction.save();
                }
            }

            // Create wallet top-up requests
            if (worker.fullName === 'Sardar Hussain') {
                // Seed 1 Approved request
                const approvedReq = new WalletTopUpRequest({
                    requestId: `TR-${Date.now()}-1`,
                    worker: worker._id,
                    wallet: wallet._id,
                    amount: 2000,
                    method: 'easypaisa',
                    proofImageUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?w=500',
                    status: 'approved',
                    paymentDetailsSnapshot: {
                        method: 'easypaisa',
                        label: 'EasyPaisa Mobile Account',
                        accountTitle: 'Sardar Hussain',
                        accountNumber: '03369164460'
                    },
                    admin: adminId,
                    adminNotes: 'Transaction verified and approved',
                    approvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
                });
                await approvedReq.save();

                // Seed 1 Pending request
                const pendingReq = new WalletTopUpRequest({
                    requestId: `TR-${Date.now()}-2`,
                    worker: worker._id,
                    wallet: wallet._id,
                    amount: 1500,
                    method: 'jazzcash',
                    proofImageUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?w=500',
                    status: 'pending',
                    paymentDetailsSnapshot: {
                        method: 'jazzcash',
                        label: 'JazzCash Wallet',
                        accountTitle: 'Sardar Hussain',
                        accountNumber: '03369164460'
                    }
                });
                await pendingReq.save();
            } else if (worker.fullName === 'Kamran Akmal') {
                // Seed 1 Rejected request
                const rejectedReq = new WalletTopUpRequest({
                    requestId: `TR-${Date.now()}-3`,
                    worker: worker._id,
                    wallet: wallet._id,
                    amount: 1000,
                    method: 'bank_transfer',
                    proofImageUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?w=500',
                    status: 'rejected',
                    paymentDetailsSnapshot: {
                        method: 'bank_transfer',
                        label: 'Meezan Bank Account',
                        accountTitle: 'Kamran Akmal',
                        accountNumber: '00300111342456'
                    },
                    admin: adminId,
                    adminNotes: 'Invalid transaction receipt attached.',
                    rejectionReason: 'Receipt screenshot is unreadable. Please upload a clear receipt.',
                    rejectedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
                });
                await rejectedReq.save();
            }
        }
        console.log(`Seeded ${workers.length} workers with wallets, transactions and top-up requests.`);

        // Find active workers we seeded for job bidding and bookings
        const sardar = workers.find(w => w.fullName === 'Sardar Hussain')!;
        const kamran = workers.find(w => w.fullName === 'Kamran Akmal')!;
        const ali = workers.find(w => w.fullName === 'Muhammad Ali')!;

        // 4. Seed JobPosts & Bids
        console.log('Seeding jobs & bids...');
        const jobPostsData = [
            {
                customer: customers[0]!._id,
                category: 'AC & Appliances',
                description: 'We need urgent repair for our split AC unit. It is not cooling properly and blowing warm air. Please bring necessary refrigerant and manifold gauges for testing.',
                urgency: 'scheduled',
                scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
                scheduledTime: '11:00 AM - 01:00 PM',
                address: 'Block H3, Johar Town, Lahore',
                location: { type: 'Point', coordinates: [74.2662, 31.4697] },
                status: 'open',
                amount: 1000,
                pricing: { clientOffer: 1000, currency: 'PKR', pricingVersion: 2 },
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            },
            {
                customer: customers[1]!._id,
                category: 'Plumbing',
                description: 'The bathroom washbasin drain pipe is severely leaking water. Water is clogging and leaking onto the cabinets. Looking for a professional plumbing specialist to replace the waste pipe.',
                urgency: 'instant',
                scheduledDate: new Date(),
                scheduledTime: 'Immediate',
                address: 'Street 4, Phase 5, DHA, Karachi',
                location: { type: 'Point', coordinates: [67.0674, 24.8238] },
                status: 'assigned',
                amount: 1200,
                pricing: { clientOffer: 1200, currency: 'PKR', pricingVersion: 2 },
                expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
            },
            {
                customer: customers[2]!._id,
                category: 'Electrical Work',
                description: 'A major short circuit occurred in our kitchen wiring, causing multiple sockets to fail completely. Urgent electrical diagnostic and replacement of the circuit breakers / burnt wires is needed.',
                urgency: 'scheduled',
                scheduledDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
                scheduledTime: '03:00 PM - 05:00 PM',
                address: 'Sector F-10/2, Islamabad',
                location: { type: 'Point', coordinates: [73.0116, 33.6938] },
                status: 'open',
                amount: 1500,
                pricing: { clientOffer: 1500, currency: 'PKR', pricingVersion: 2 },
                expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
            }
        ];

        const seededJobs: any[] = [];
        for (const jobData of jobPostsData) {
            const job = new JobPost(jobData);
            await job.save();
            seededJobs.push(job);
        }

        // Bids for first Job (Johar Town split AC)
        const bid1 = new JobBid({
            jobPost: seededJobs[0]!._id,
            worker: sardar._id,
            message: 'Hi Bilal, I have 8+ years of specialized experience in inverter split AC diagnostic and repairs. I can bring pure R410a refrigerant to charge the system if there is a gas leak. I will charge Rs. 1000 flat.',
            proposedPrice: 1000,
            priceMode: 'accepted_offer',
            clientOfferSnapshot: 1000,
            commissionRateSnapshot: 10,
            estimatedDays: 1,
            status: 'pending'
        });
        await bid1.save();

        const bid2 = new JobBid({
            jobPost: seededJobs[0]!._id,
            worker: kamran._id,
            message: 'A/A. I can resolve your AC cooling issue quickly. Available on short notice. Standard rate of Rs. 1200.',
            proposedPrice: 1200,
            priceMode: 'counter_offer',
            clientOfferSnapshot: 1000,
            commissionRateSnapshot: 10,
            estimatedDays: 1,
            status: 'pending'
        });
        await bid2.save();

        // Bid for second Job (DHA Karachi Plumbing - Accepted)
        const acceptedBid = new JobBid({
            jobPost: seededJobs[1]!._id,
            worker: ali._id,
            message: 'Hello Zainab! I am an expert plumbing specialist and can arrive at your DHA address in 25 minutes. I will fix the washbasin drain pipe immediately for Rs. 1200.',
            proposedPrice: 1200,
            priceMode: 'accepted_offer',
            clientOfferSnapshot: 1200,
            commissionRateSnapshot: 10,
            estimatedDays: 1,
            status: 'accepted'
        });
        await acceptedBid.save();

        console.log('Seeded job posts and bids.');

        // 5. Seed Bookings in diverse states
        console.log('Seeding bookings...');

        // 1. Pending Direct Hire booking (Scheduled)
        const bookingPending = new Booking({
            customer: customers[0]!._id,
            worker: sardar._id,
            category: 'AC & Appliances',
            description: 'Direct hire for AC deep cleaning and gas top-up.',
            scheduledDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            scheduledTime: '10:00 AM - 12:00 PM',
            estimatedHours: 2,
            hourlyRate: sardar.hourlyRate,
            subtotal: 1600,
            platformFee: 160,
            totalAmount: 1760,
            workerEarning: 1440,
            address: 'Block H3, Johar Town, Lahore',
            location: { type: 'Point', coordinates: [74.2662, 31.4697] },
            bookingType: 'scheduled',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            status: 'pending',
            paymentStatus: 'unpaid',
            paymentMethod: 'cash',
            agreement: {
                clientOffer: 0,
                agreedPrice: 1600,
                cashDue: 1760,
                priceSource: 'direct_rate',
                commissionRateSnapshot: 10,
                commissionAmount: 160,
                workerNetIncome: 1440,
                lockedAt: new Date(),
                pricingVersion: 2
            }
        });
        await bookingPending.save();

        // 2. Ongoing Direct Hire booking (Instant)
        const bookingOngoing = new Booking({
            customer: customers[3]!._id,
            worker: kamran._id,
            category: 'Plumbing',
            description: 'Kitchen drain pipe leakage resolution and fitting check.',
            scheduledDate: new Date(),
            scheduledTime: 'Immediate',
            estimatedHours: 1,
            hourlyRate: kamran.hourlyRate,
            subtotal: 600,
            platformFee: 60,
            totalAmount: 660,
            workerEarning: 540,
            address: 'Gulistan-e-Jauhar, Block 13, Karachi',
            location: { type: 'Point', coordinates: [67.1246, 24.9123] },
            bookingType: 'instant',
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
            status: 'ongoing',
            paymentStatus: 'unpaid',
            paymentMethod: 'cash',
            agreement: {
                clientOffer: 0,
                agreedPrice: 600,
                cashDue: 660,
                priceSource: 'direct_rate',
                commissionRateSnapshot: 10,
                commissionAmount: 60,
                workerNetIncome: 540,
                lockedAt: new Date(),
                pricingVersion: 2
            }
        });
        await bookingOngoing.save();

        // 3. Completed Booking with promo discount applied! (SPECIAL20 - 20% off)
        const bookingCompleted1 = new Booking({
            customer: customers[4]!._id,
            worker: ali._id,
            category: 'Electrical Work',
            description: 'Wiring replacement and distribution box terminal diagnostics.',
            scheduledDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            scheduledTime: '02:00 PM - 03:00 PM',
            estimatedHours: 2,
            hourlyRate: ali.hourlyRate,
            subtotal: 1000,
            platformFee: 100,
            totalAmount: 1100,
            workerEarning: 900,
            address: 'Canal View Society, Lahore',
            location: { type: 'Point', coordinates: [74.2234, 31.4889] },
            bookingType: 'scheduled',
            expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
            status: 'completed',
            paymentStatus: 'paid',
            paymentMethod: 'card',
            stripePaymentId: 'ch_3M4oN1E2h3i4O5P6q7R8s9t',
            isReviewed: true,
            agreement: {
                clientOffer: 0,
                agreedPrice: 1000,
                cashDue: 0, // Card payment is online
                priceSource: 'direct_rate',
                commissionRateSnapshot: 10,
                commissionAmount: 100,
                workerNetIncome: 900,
                promoCode: 'SPECIAL20',
                discountAmount: 200, // 20% of Rs. 1000 = Rs. 200
                lockedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
                pricingVersion: 2
            }
        });
        await bookingCompleted1.save();

        // 4. Completed Booking with promo WELCOME100 (Rs. 100 off)
        const bookingCompleted2 = new Booking({
            customer: customers[1]!._id,
            worker: sardar._id,
            category: 'AC & Appliances',
            description: 'AC deep general pressure cleaning.',
            scheduledDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            scheduledTime: '04:00 PM - 05:00 PM',
            estimatedHours: 1.5,
            hourlyRate: sardar.hourlyRate,
            subtotal: 1200,
            platformFee: 120,
            totalAmount: 1320,
            workerEarning: 1080,
            address: 'Street 4, Phase 5, DHA, Karachi',
            location: { type: 'Point', coordinates: [67.0674, 24.8238] },
            bookingType: 'scheduled',
            expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
            status: 'completed',
            paymentStatus: 'paid',
            paymentMethod: 'cash',
            isReviewed: true,
            agreement: {
                clientOffer: 0,
                agreedPrice: 1200,
                cashDue: 1220, // (1200 subtotal + 120 fee - 100 discount)
                priceSource: 'direct_rate',
                commissionRateSnapshot: 10,
                commissionAmount: 120,
                workerNetIncome: 1080,
                promoCode: 'WELCOME100',
                discountAmount: 100,
                lockedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
                pricingVersion: 2
            }
        });
        await bookingCompleted2.save();

        // 5. Cancelled Booking
        const bookingCancelled = new Booking({
            customer: customers[2]!._id,
            worker: ali._id,
            category: 'Electrical Work',
            description: 'Ceiling fan capacitor diagnostic and switch replacement.',
            scheduledDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            scheduledTime: '01:00 PM - 02:00 PM',
            estimatedHours: 1,
            hourlyRate: ali.hourlyRate,
            subtotal: 500,
            platformFee: 50,
            totalAmount: 550,
            workerEarning: 450,
            address: 'Sector F-10/2, Islamabad',
            location: { type: 'Point', coordinates: [73.0116, 33.6938] },
            bookingType: 'scheduled',
            expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
            status: 'cancelled',
            paymentStatus: 'unpaid',
            paymentMethod: 'cash',
            cancelledBy: 'customer',
            cancelReason: 'Customer rescheduled and booked another local technician.',
            agreement: {
                clientOffer: 0,
                agreedPrice: 500,
                cashDue: 550,
                priceSource: 'direct_rate',
                commissionRateSnapshot: 10,
                commissionAmount: 50,
                workerNetIncome: 450,
                lockedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
                pricingVersion: 2
            }
        });
        await bookingCancelled.save();

        // Update workers stats dynamically based on seeded bookings
        await Worker.findByIdAndUpdate(ali._id, { totalJobs: 1, totalEarnings: 900 });
        await Worker.findByIdAndUpdate(sardar._id, { totalJobs: 1, totalEarnings: 1080 });

        console.log('Seeded bookings in different status segments.');

        // 6. Seed Customer Reviews for completed bookings
        console.log('Seeding reviews...');
        const review1 = new Review({
            booking: bookingCompleted1._id,
            customer: customers[4]!._id,
            worker: ali._id,
            rating: 5,
            comment: 'Ali did an exceptional job! He diagnosed the breaker box issue in canal view in minutes, replaced the damaged wiring very safely, and explained the safety precautions. Very professional and polite! Highly recommended ustad.'
        });
        await review1.save();

        const review2 = new Review({
            booking: bookingCompleted2._id,
            customer: customers[1]!._id,
            worker: sardar._id,
            rating: 4.8,
            comment: 'Very professional split AC servicing. Sardar cleaned the filters and coils thoroughly, restoring extreme cold cooling. Reduced 0.2 points only because he arrived 15 minutes later than the scheduled time, but the quality of service is top notch!'
        });
        await review2.save();

        console.log('Seeded reviews and triggered auto rating aggregators.');

        // 7. Seed Support Tickets
        console.log('Seeding support tickets...');
        const supportTickets = [
            {
                user: customers[0]!._id,
                name: customers[0]!.fullName,
                email: customers[0]!.email || 'bilal@gmail.com',
                topic: 'Wallet Transaction Issues',
                message: 'Hello support desk, I attempted to recharge my worker wallet via JazzCash but the balance is not reflecting in the application. I have attached the receipt. Please resolve this immediately.',
                status: 'open',
                priority: 'urgent',
                replies: []
            },
            {
                user: customers[2]!._id,
                name: customers[2]!.fullName,
                email: customers[2]!.email || 'hamza@gmail.com',
                topic: 'App Bug / Technical Issue',
                message: 'I am unable to see worker proposals for my plumbing booking request in Islamabad. The spinner loads indefinitely and nothing displays. Please guide me.',
                status: 'pending',
                priority: 'high',
                replies: [
                    {
                        from: 'admin',
                        message: 'Hello Hamza! We have received your query. Our engineers are deploying a quick fix for the location parameters in Islamabad. We will notify you when solved.',
                        authorName: 'Support Agent Ayesha',
                        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
                    }
                ]
            },
            {
                name: 'Muhammad Imran',
                email: 'imran@gmail.com',
                topic: 'General Query',
                message: 'How can I register my service workshop profile as an AC technician on the ApnaUstad platform? Are there any registration or annual subscription fees?',
                status: 'closed',
                priority: 'low',
                replies: [
                    {
                        from: 'admin',
                        message: 'Hello Imran! The registration is completely free. Download the Ustad App, upload your CNIC cards and wait for Admin verification. We only deduct a nominal 10% commission per job.',
                        authorName: 'Super Admin',
                        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
                    },
                    {
                        from: 'user',
                        message: 'Thank you! I have uploaded my profile details. Looking forward to verification.',
                        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
                    }
                ]
            }
        ];

        for (const ticketData of supportTickets) {
            const ticket = new SupportRequest(ticketData);
            await ticket.save();
        }
        console.log('Seeded support tickets.');

        // 8. Seed Admin Audit Logs
        console.log('Seeding admin audit logs...');
        const auditLogs = [
            { actor: adminId, actorRole: 'superadmin', action: 'VERIFY', entityType: 'Worker', entityId: sardar._id.toString(), reason: 'CNIC and credentials checked and verified.' },
            { actor: adminId, actorRole: 'superadmin', action: 'VERIFY', entityType: 'Worker', entityId: kamran._id.toString(), reason: 'Plumbing certification and CNIC verified.' },
            { actor: adminId, actorRole: 'superadmin', action: 'CREATE', entityType: 'PromoCode', entityId: 'WELCOME100', reason: 'Created marketing launch promo coupon.' },
            { actor: adminId, actorRole: 'superadmin', action: 'CREATE', entityType: 'PromoCode', entityId: 'SPECIAL20', reason: 'Created eid discount campaign.' },
            { actor: adminId, actorRole: 'superadmin', action: 'RECHARGE', entityType: 'Wallet', entityId: sardar._id.toString(), reason: 'Approved EasyPaisa top-up ticket of Rs. 2000.' },
            { actor: adminId, actorRole: 'superadmin', action: 'REJECT', entityType: 'Wallet', entityId: kamran._id.toString(), reason: 'Rejected invalid Bank Transfer top-up ticket of Rs. 1000.' },
            { actor: adminId, actorRole: 'superadmin', action: 'REPLY', entityType: 'SupportRequest', reason: 'Responded to technical query from user Hamza.' }
        ];

        for (const logData of auditLogs) {
            const log = new AdminAuditLog(logData);
            await log.save();
        }
        console.log('Seeded admin audit logs.');

        console.log('\n=========================================');
        console.log('🎉 SUCCESS! Idempotent database seeding complete!');
        console.log(`Seeded:`);
        console.log(`- Categories: ${insertedCategories.length}`);
        console.log(`- Customers: ${customers.length}`);
        console.log(`- Workers & Wallets: ${workers.length}`);
        console.log(`- Job Posts & Bids: ${seededJobs.length}`);
        console.log(`- Diverse Bookings: 5`);
        console.log(`- Reviews & Ratings: 2`);
        console.log(`- Support tickets: 3`);
        console.log(`- Admin Audit Logs: ${auditLogs.length}`);
        console.log('=========================================');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error during demo database seeding:', error);
        process.exit(1);
    }
};

seedFullDemo();
