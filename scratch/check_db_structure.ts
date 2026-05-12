import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function checkDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URL!);
        console.log('Connected to MongoDB');

        const review = await mongoose.connection.db!.collection('reviews').findOne({});
        if (review) {
            console.log('Sample Review:', JSON.stringify(review, null, 2));
        } else {
            console.log('No review found in "reviews" collection');
        }

        const collections = await mongoose.connection.db!.listCollections().toArray();
        console.log('Collections:', collections.map(c => c.name));

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkDB();
