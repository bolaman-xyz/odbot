const mongoose = require('mongoose');

const ticketPanelSchema = new mongoose.Schema({
    guildID: { type: String, required: true },
    panelId: { type: String, required: true },
    msgID: { type: String, required: true },
    selectMenuOptions: { type: Array, default: [] }
}, {
    timestamps: true
});

module.exports = mongoose.model('ticketPanel', ticketPanelSchema);