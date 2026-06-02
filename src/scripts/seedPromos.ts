import mongoose from 'mongoose';
import PromoCode from '../models/PromoCode';
import { getConfig } from '../config/env';

const config = getConfig();

const samplePromos = [
    {
        code: 'WELCOME100',
        discountType: 'fixed',
        discountValue: 100,
        minBookingAmount: 500,
        maxDiscountAmount: 0,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Active yesterday
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Valid 1 year
        usageLimit: 0, // Unlimited global
        userUsageLimit: 1, // Max 1 per user
        isActive: true
    },
    {
        code: 'SPECIAL20',
        discountType: 'percentage',
        discountValue: 20,
        minBookingAmount: 1000,
        maxDiscountAmount: 500, // Max Rs. 500 off
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // Valid 6 months
        usageLimit: 500, // 500 global limit
        userUsageLimit: 1,
        isActive: true
    },
    {
        code: 'USTAD50',
        discountType: 'percentage',
        discountValue: 50,
        minBookingAmount: 300,
        maxDiscountAmount: 250,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // Valid 3 months
        usageLimit: 100,
        userUsageLimit: 1,
        isActive: true
    },
    {
        code: 'EID500',
        discountType: 'fixed',
        discountValue: 500,
        minBookingAmount: 2000,
        maxDiscountAmount: 0,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        usageLimit: 200,
        userUsageLimit: 1,
        isActive: true
    },
    {
        code: 'EXPIRED10',
        discountType: 'percentage',
        discountValue: 10,
        minBookingAmount: 100,
        maxDiscountAmount: 0,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Expired 2 days ago
        usageLimit: 0,
        userUsageLimit: 1,
        isActive: true
    },
    {
        code: 'FUTURE50',
        discountType: 'percentage',
        discountValue: 50,
        minBookingAmount: 500,
        maxDiscountAmount: 500,
        startDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // Starts in 10 days
        endDate: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
        usageLimit: 0,
        userUsageLimit: 1,
        isActive: true
    },
    {
        code: 'GLOBALCAP',
        discountType: 'percentage',
        discountValue: 15,
        minBookingAmount: 500,
        maxDiscountAmount: 500,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        usageLimit: 5,
        usageCount: 5, // Fully claimed
        userUsageLimit: 1,
        isActive: true
    },
    {
        code: 'DISABLED25',
        discountType: 'percentage',
        discountValue: 25,
        minBookingAmount: 500,
        maxDiscountAmount: 1000,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        usageLimit: 100,
        userUsageLimit: 1,
        isActive: false // Deactivated
    }
];

const seedPromos = async () => {
    try {
        console.log('Connecting to database...');
        if (!config.mongodbUrl) {
            throw new Error('MONGODB_URL is not defined in environment variables');
        }

        await mongoose.connect(config.mongodbUrl as string);
        console.log('Connected to database successfully.');

        console.log('Cleaning up existing matching coupons to ensure idempotency...');
        const promoCodesToClear = samplePromos.map(p => p.code);
        await PromoCode.deleteMany({ code: { $in: promoCodesToClear } });
        console.log('Old test coupons removed.');

        console.log('Inserting fresh test coupons into database...');
        const inserted = await PromoCode.insertMany(samplePromos);
        console.log(`✅ Success! Seeded ${inserted.length} diverse promo codes!`);
        
        console.log('\nList of seeded codes:');
        inserted.forEach(p => {
            const rules = p.discountType === 'percentage' 
                ? `${p.discountValue}% Off (Max: Rs. ${p.maxDiscountAmount || 'none'})`
                : `Rs. ${p.discountValue} Off`;
            console.log(`- ${p.code}: ${rules} [Min booking: Rs. ${p.minBookingAmount}] [Status: ${p.isActive ? 'Active' : 'Disabled'}]`);
        });

        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding promo codes:', error);
        process.exit(1);
    }
};

seedPromos();
