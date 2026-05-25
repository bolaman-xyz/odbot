const mongoose = require('mongoose');

const schema = new mongoose.Schema ({
    guildID: String,
    channelID: String,
    userID: String,
    ticketType: String,
    button: String,
    msgID: String,
    claimed: Boolean,
    claimUser: String,
    messages: Number,
    lastMessageSent: Date,
    status: String,
    closeUserID: String,
    questions: [
        {
            customId: String,
            required: Boolean,
            question: String,
            style: String,
            response: String,
        },
    ],
    participants: [{
        userID: String,
        messageCount: { type: Number, default: 1 },
        firstMessage: Date,
        lastMessage: Date
    }],
    defaultidx: { type: String, default: '{{IDENTIFIER}}', required: false },
    ticketCreationDate: Date,
    closedAt: Date,
    identifier: String,
    closeReason: { type: String, default: "No reason provided." },
    closeNotificationTime: Number,
    closeNotificationMsgID: String,
    closeNotificationUserID: String,
    transcriptID: String,
    priority: String,
    priorityName: String,
    waitingReplyFrom: String,
    firstStaffResponse: Date,
    inactivityWarningSent: { type: Boolean, default: false },
    priorityCooldown: Date,
    originalCategoryID: { type: String, default: null },
    archived: { type: Boolean, default: false },
    archivedBy: String,
    archivedAt: Number,
    originalCategoryID: String,
    archiveMsgID: String,
    aiSummary: String,
}, {
    timestamps: true,
});

module.exports = mongoose.model('ticket', schema);