const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const checkAdmin = async () => {
    try {
        await mongoose.connect('mongodb+srv://replatechonologies_db_user:S7CSHXhVcvu1TDfu@apnacluster.fg69wjw.mongodb.net/ApnaUstad');
        
        const adminSchema = new mongoose.Schema({
            email: { type: String, required: true },
            password: { type: String, required: true, select: false }
        });
        
        const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
        
        const admin = await Admin.findOne({ email: 'admin@apnaustad.com' }).select('+password');
        
        if (!admin) {
            console.log('No admin found at admin@apnaustad.com');
            process.exit(1);
        }
        
        console.log('Admin found:', admin.email);
        
        const match1 = await bcrypt.compare('admin123', admin.password);
        console.log('Does admin123 match?', match1);
        
        const match2 = await bcrypt.compare('Admin@123', admin.password);
        console.log('Does Admin@123 match?', match2);

        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
};
checkAdmin();
