const mongoose = require("mongoose");

const aiAutoResponseSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  channelId: { type: String, required: true },
  guildId: { type: String, required: true },
  
  userMessage: { type: String, required: true },
  
  responseKey: { type: String, required: true },
  aiConfidence: { type: Number, required: true },
  aiReasoning: { type: String },
  
  responseType: { type: String, enum: ['EMBED', 'TEXT'], required: true },
  responseMessage: { type: String, required: true },
  
  userFeedback: { 
    type: String, 
    enum: ['helpful', 'not_helpful', null], 
    default: null 
  },
  feedbackTimestamp: { type: Date, default: null },
  
  responseTimestamp: { type: Date, default: Date.now },
  buttonInteractionCount: { type: Number, default: 0 },
  
  month: { type: Number, required: true },
  year: { type: Number, required: true },
});

aiAutoResponseSchema.index({ userId: 1, responseTimestamp: -1 });
aiAutoResponseSchema.index({ responseKey: 1, responseTimestamp: -1 });
aiAutoResponseSchema.index({ month: 1, year: 1 });
aiAutoResponseSchema.index({ userFeedback: 1 });

module.exports = mongoose.model("AIAutoResponse", aiAutoResponseSchema);