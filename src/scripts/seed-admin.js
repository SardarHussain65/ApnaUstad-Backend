const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const seedAdmin = async () => {
    try {
        const mongoUrl = process.env.MONGODB_URL;
        if (!mongoUrl) {
            throw new Error('Missing required environment variable: MONGODB_URL');
        }

        await mongoose.connect(mongoUrl);
        
        const adminSchema = new mongoose.Schema({
            name: { type: String },
            email: { type: String, required: true },
            password: { type: String, required: true, select: false },
            role: { type: String, default: 'superadmin' }
        });
        
        const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
        
        const existing = await Admin.findOne({ email: 'admin@apnaustad.com' });
        if (!existing) {
            const password = await bcrypt.hash('admin123', 10);
            await Admin.create({ 
                name: 'Super Admin',
                email: 'admin@apnaustad.com', 
                password: password, 
                role: 'superadmin' 
            });
            console.log('✅ Test admin created: admin@apnaustad.com / admin123');
        } else {
            console.log('✅ Admin already exists. Use: admin@apnaustad.com / admin123');
        }
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
};
seedAdmin();