const mongoose = require('mongoose');

const schema = new mongoose.Schema ({
    invoiceID: String,
    userID: String,
    sellerID: String,
    channelID: String,
    messageID: String,
    customerID: String,
    price: Number,
    service: String,
    status: String,
}, {
    timestamps: true,
});

module.exports = mongoose.model('stripe', schema);

// Debugging:
// 22209
// 1767080449
// 0