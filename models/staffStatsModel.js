const mongoose = require('mongoose');

const staffStatsSchema = new mongoose.Schema({
    userID: String,
    username: String,
    avatarURL: String,
    
    totalMessages: { type: Number, default: 0 },
    totalClaims: { type: Number, default: 0 },
    totalClosedTickets: { type: Number, default: 0 },
    averageResponseTime: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
    
    totalRatings: { type: Number, default: 0 },
    totalRatingScore: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    
    weekly: [{
        weekNumber: Number,
        year: Number,
        startDate: Date,
        endDate: Date,
        messages: { type: Number, default: 0 },
        claims: { type: Number, default: 0 },
        closedTickets: { type: Number, default: 0 },
        responseTime: { type: Number, default: 0 },
        ratings: { type: Number, default: 0 },
        ratingScore: { type: Number, default: 0 },
        averageRating: { type: Number, default: 0 }
    }],
    
    monthly: [{
        month: Number,
        year: Number,
        startDate: Date,
        endDate: Date,
        messages: { type: Number, default: 0 },
        claims: { type: Number, default: 0 },
        closedTickets: { type: Number, default: 0 },
        responseTime: { type: Number, default: 0 },
        ratings: { type: Number, default: 0 },
        ratingScore: { type: Number, default: 0 },
        averageRating: { type: Number, default: 0 }
    }],
    
    yearly: [{
        year: Number,
        startDate: Date,
        endDate: Date,
        messages: { type: Number, default: 0 },
        claims: { type: Number, default: 0 },
        closedTickets: { type: Number, default: 0 },
        responseTime: { type: Number, default: 0 },
        ratings: { type: Number, default: 0 },
        ratingScore: { type: Number, default: 0 },
        averageRating: { type: Number, default: 0 }
    }],
    
    ticketsHistory: [{
        ticketID: String,
        claimedAt: Date,
        closedAt: Date,
        messageCount: { type: Number, default: 0 },
        responseTime: { type: Number, default: 0 },
        rating: { type: Number, default: 0 }
    }]
});

module.exports = mongoose.model('staffStats', staffStatsSchema);