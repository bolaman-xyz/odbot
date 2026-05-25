const staffStatsModel = require('./models/staffStatsModel');
const ticketModel = require("./models/ticketModel");
const utils = require("./utils.js");
const client = require("./index.js")

function getISOWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getWeekStartEnd(date) {
    const currentDate = new Date(date);
    const day = currentDate.getDay();
    const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1);
    
    const weekStart = new Date(currentDate.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    return { start: weekStart, end: weekEnd };
}

function getMonthStartEnd(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    const monthStart = new Date(year, month, 1);
    monthStart.setHours(0, 0, 0, 0);
    
    const monthEnd = new Date(year, month + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);
    
    return { start: monthStart, end: monthEnd };
}

function getYearStartEnd(date) {
    const year = date.getFullYear();
    
    const yearStart = new Date(year, 0, 1);
    yearStart.setHours(0, 0, 0, 0);
    
    const yearEnd = new Date(year, 11, 31);
    yearEnd.setHours(23, 59, 59, 999);
    
    return { start: yearStart, end: yearEnd };
}

async function getCurrentTimePeriods(staffMember) {
    const now = new Date();
    const weekNumber = getISOWeek(now);
    const year = now.getFullYear();
    const month = now.getMonth();
    
    let currentWeek = staffMember.weekly.find(w => w.weekNumber === weekNumber && w.year === year);
    if (!currentWeek) {
        const { start: weekStart, end: weekEnd } = getWeekStartEnd(now);
        currentWeek = {
            weekNumber,
            year,
            startDate: weekStart,
            endDate: weekEnd,
            messages: 0,
            claims: 0,
            closedTickets: 0,
            responseTime: 0
        };
        staffMember.weekly.push(currentWeek);
    }

    let currentMonth = staffMember.monthly.find(m => m.month === month && m.year === year);
    if (!currentMonth) {
        const { start: monthStart, end: monthEnd } = getMonthStartEnd(now);
        currentMonth = {
            month,
            year,
            startDate: monthStart,
            endDate: monthEnd,
            messages: 0,
            claims: 0,
            closedTickets: 0,
            responseTime: 0
        };
        staffMember.monthly.push(currentMonth);
    }
    
    let currentYear = staffMember.yearly.find(y => y.year === year);
    if (!currentYear) {
        const { start: yearStart, end: yearEnd } = getYearStartEnd(now);
        currentYear = {
            year,
            startDate: yearStart,
            endDate: yearEnd,
            messages: 0,
            claims: 0,
            closedTickets: 0,
            responseTime: 0
        };
        staffMember.yearly.push(currentYear);
    }
    
    return { currentWeek, currentMonth, currentYear };
}

async function incrementStat(user, statType, value = 1, ticketData = null, interaction = null, message = null) {
    try {

        const supportRole = await utils.checkIfUserHasSupportRoles(interaction, message);

        if (!supportRole) return null;

        let staffMember = await staffStatsModel.findOne({ userID: user.id });
        
        if (!staffMember) {
            staffMember = new staffStatsModel({
                userID: user.id,
                username: user.username,
                avatarURL: user.displayAvatarURL({ dynamic: true }),
                totalMessages: 0,
                totalClaims: 0,
                totalClosedTickets: 0,
                averageResponseTime: 0,
                lastActive: Date.now(),
                weekly: [],
                monthly: [],
                yearly: [],
                ticketsHistory: []
            });
        }
        
        const { currentWeek, currentMonth, currentYear } = await getCurrentTimePeriods(staffMember);
        
        switch (statType) {
            case 'message':
                staffMember.totalMessages += value;
                currentWeek.messages += value;
                currentMonth.messages += value;
                currentYear.messages += value;
                
                if (ticketData && ticketData.ticketID) {
                    const ticketIndex = staffMember.ticketsHistory.findIndex(
                        t => t.ticketID === ticketData.ticketID
                    );
                    
                    if (ticketIndex !== -1) {
                        staffMember.ticketsHistory[ticketIndex].messageCount += value;
                    } else {
                        staffMember.ticketsHistory.push({
                            ticketID: ticketData.ticketID,
                            claimedAt: new Date(),
                            messageCount: value,
                            responseTime: 0
                        });
                    }
                }
                break;
                
            case 'claim':
                staffMember.totalClaims += value;
                currentWeek.claims += value;
                currentMonth.claims += value;
                currentYear.claims += value;
                
                if (ticketData && ticketData.ticketID) {
                    const ticketIndex = staffMember.ticketsHistory.findIndex(
                        t => t.ticketID === ticketData.ticketID
                    );
                    
                    if (ticketIndex !== -1) {
                        staffMember.ticketsHistory[ticketIndex].claimedAt = new Date();
                    } else {
                        staffMember.ticketsHistory.push({
                            ticketID: ticketData.ticketID,
                            claimedAt: new Date(),
                            messageCount: 0,
                            responseTime: 0
                        });
                    }
                }
                break;
                
            case 'close':
                staffMember.totalClosedTickets += value;
                currentWeek.closedTickets += value;
                currentMonth.closedTickets += value;
                currentYear.closedTickets += value;
                
                if (ticketData && ticketData.ticketID) {
                    const ticketIndex = staffMember.ticketsHistory.findIndex(
                        t => t.ticketID === ticketData.ticketID
                    );
                    
                    if (ticketIndex !== -1) {
                        staffMember.ticketsHistory[ticketIndex].closedAt = new Date();
                    }
                }
                break;
                
            case 'responseTime':
                const responseTimeVal = parseInt(value);
                if (isNaN(responseTimeVal) || responseTimeVal <= 0) {
                    console.error(`Invalid response time value: ${value}`);
                    break;
                }
                
                if (ticketData && ticketData.ticketID) {
                    const ticketIndex = staffMember.ticketsHistory.findIndex(
                        t => t.ticketID === ticketData.ticketID
                    );
                    
                    if (ticketIndex !== -1) {
                        staffMember.ticketsHistory[ticketIndex].responseTime = responseTimeVal;
                    } else {
                        staffMember.ticketsHistory.push({
                            ticketID: ticketData.ticketID,
                            claimedAt: new Date(),
                            messageCount: 0,
                            responseTime: responseTimeVal
                        });
                    }
                    
                    const ticketsWithResponseTime = staffMember.ticketsHistory.filter(t => 
                        t.responseTime && t.responseTime > 0
                    );
                    
                    if (ticketsWithResponseTime.length > 0) {
                        const totalResponseTime = ticketsWithResponseTime.reduce(
                            (sum, ticket) => sum + ticket.responseTime, 0
                        );
                        
                        staffMember.averageResponseTime = Math.floor(
                            totalResponseTime / ticketsWithResponseTime.length
                        );
                        
                    }
                    
                    const weekStart = new Date(currentWeek.startDate);
                    const weekEnd = new Date(currentWeek.endDate);
                    
                    const weekTickets = ticketsWithResponseTime.filter(t => {
                        const ticketDate = t.claimedAt;
                        return ticketDate >= weekStart && ticketDate <= weekEnd;
                    });
                    
                    if (weekTickets.length > 0) {
                        const weekTotalResponseTime = weekTickets.reduce(
                            (sum, ticket) => sum + ticket.responseTime, 0
                        );
                        
                        currentWeek.responseTime = Math.floor(
                            weekTotalResponseTime / weekTickets.length
                        );
                        
                    }
                    
                    const monthStart = new Date(currentMonth.startDate);
                    const monthEnd = new Date(currentMonth.endDate);
                    
                    const monthTickets = ticketsWithResponseTime.filter(t => {
                        const ticketDate = t.claimedAt;
                        return ticketDate >= monthStart && ticketDate <= monthEnd;
                    });
                    
                    if (monthTickets.length > 0) {
                        const monthTotalResponseTime = monthTickets.reduce(
                            (sum, ticket) => sum + ticket.responseTime, 0
                        );
                        
                        currentMonth.responseTime = Math.floor(
                            monthTotalResponseTime / monthTickets.length
                        );
                        
                    }
                    
                    const yearStart = new Date(currentYear.startDate);
                    const yearEnd = new Date(currentYear.endDate);
                    
                    const yearTickets = ticketsWithResponseTime.filter(t => {
                        const ticketDate = t.claimedAt;
                        return ticketDate >= yearStart && ticketDate <= yearEnd;
                    });
                    
                    if (yearTickets.length > 0) {
                        const yearTotalResponseTime = yearTickets.reduce(
                            (sum, ticket) => sum + ticket.responseTime, 0
                        );
                        
                        currentYear.responseTime = Math.floor(
                            yearTotalResponseTime / yearTickets.length
                        );
                        
                    }
                }
                break;
        }
        
        staffMember.lastActive = new Date();
        await staffMember.save();
        
        return staffMember;
    } catch (error) {
        console.error(`Error in incrementStat (${statType}):`, error);
        throw error;
    }
}

async function getStaffMemberStats(userID) {
    try {
        const staffMember = await staffStatsModel.findOne({ userID });
        
        if (!staffMember) return null;
        
        const now = new Date();
        const weekNumber = getISOWeek(now);
        const year = now.getFullYear();
        const month = now.getMonth();
        
        const currentWeek = staffMember.weekly.find(w => w.weekNumber === weekNumber && w.year === year) || null;
        const currentMonth = staffMember.monthly.find(m => m.month === month && m.year === year) || null;
        const currentYear = staffMember.yearly.find(y => y.year === year) || null;
        
        return {
            userID: staffMember.userID,
            username: staffMember.username,
            avatarURL: staffMember.avatarURL,
            totalMessages: staffMember.totalMessages,
            totalClaims: staffMember.totalClaims,
            totalClosedTickets: staffMember.totalClosedTickets,
            averageResponseTime: staffMember.averageResponseTime,
            lastActive: staffMember.lastActive,
            currentWeek,
            currentMonth,
            currentYear
        };
    } catch (error) {
        console.error("Error in getStaffMemberStats:", error);
        throw error;
    }
}

async function getStaffStats(timeframe = 'lifetime', sortBy = 'claims') {
    try {
        const allStaff = await staffStatsModel.find({});
        
        if (!allStaff || allStaff.length === 0) return [];
        const validStaff = [];
        
        for (const staff of allStaff) {
            try {
                const user = await client.users.fetch(staff.userID).catch(() => null);
                if (!user) continue;
                
                const guilds = client.guilds.cache.values();
                let hasValidRole = false;
                
                for (const guild of guilds) {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    if (!member) continue;
                    
                    const fakeMessage = {
                        member: member,
                        guild: guild,
                        channel: { id: 'dummy' }
                    };
                    
                    const supportRole = await utils.checkIfUserHasSupportRoles(null, fakeMessage);
                    if (supportRole) {
                        hasValidRole = true;
                        break;
                    }
                }
                
                if (hasValidRole) {
                    validStaff.push(staff);
                }
            } catch (error) {
                console.error(`Error validating staff member ${staff.userID}:`, error);
            }
        }
        
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const currentWeek = getISOWeek(now);
        
        const processedStaff = validStaff.map(staff => {
            const currentWeekData = staff.weekly.find(w => w.weekNumber === currentWeek && w.year === currentYear) || null;
            const currentMonthData = staff.monthly.find(m => m.month === currentMonth && m.year === currentYear) || null;
            const currentYearData = staff.yearly.find(y => y.year === currentYear) || null;
            
            return {
                userID: staff.userID,
                username: staff.username,
                avatarURL: staff.avatarURL,
                totalMessages: staff.totalMessages,
                totalClaims: staff.totalClaims,
                totalClosedTickets: staff.totalClosedTickets,
                averageResponseTime: staff.averageResponseTime,
                lastActive: staff.lastActive,
                currentWeek: currentWeekData,
                currentMonth: currentMonthData,
                currentYear: currentYearData
            };
        });
        
        return processedStaff.sort((a, b) => {
            let aValue, bValue;
            
            if (timeframe === 'weekly') {
                aValue = a.currentWeek ? (sortBy === 'messages' ? a.currentWeek.messages : 
                        sortBy === 'claims' ? a.currentWeek.claims : 
                        sortBy === 'responseTime' ? a.currentWeek.responseTime : 
                        a.currentWeek.closedTickets) : 0;
                
                bValue = b.currentWeek ? (sortBy === 'messages' ? b.currentWeek.messages : 
                        sortBy === 'claims' ? b.currentWeek.claims : 
                        sortBy === 'responseTime' ? b.currentWeek.responseTime : 
                        b.currentWeek.closedTickets) : 0;
                
            } else if (timeframe === 'monthly') {
                aValue = a.currentMonth ? (sortBy === 'messages' ? a.currentMonth.messages : 
                        sortBy === 'claims' ? a.currentMonth.claims : 
                        sortBy === 'responseTime' ? a.currentMonth.responseTime : 
                        a.currentMonth.closedTickets) : 0;
                
                bValue = b.currentMonth ? (sortBy === 'messages' ? b.currentMonth.messages : 
                        sortBy === 'claims' ? b.currentMonth.claims : 
                        sortBy === 'responseTime' ? b.currentMonth.responseTime : 
                        b.currentMonth.closedTickets) : 0;
                
            } else if (timeframe === 'yearly') {
                aValue = a.currentYear ? (sortBy === 'messages' ? a.currentYear.messages : 
                        sortBy === 'claims' ? a.currentYear.claims : 
                        sortBy === 'responseTime' ? a.currentYear.responseTime : 
                        a.currentYear.closedTickets) : 0;
                
                bValue = b.currentYear ? (sortBy === 'messages' ? b.currentYear.messages : 
                        sortBy === 'claims' ? b.currentYear.claims : 
                        sortBy === 'responseTime' ? b.currentYear.responseTime : 
                        b.currentYear.closedTickets) : 0;
                
            } else {
                aValue = sortBy === 'messages' ? a.totalMessages : 
                        sortBy === 'claims' ? a.totalClaims : 
                        sortBy === 'responseTime' ? a.averageResponseTime : 
                        a.totalClosedTickets;
                
                bValue = sortBy === 'messages' ? b.totalMessages : 
                        sortBy === 'claims' ? b.totalClaims : 
                        sortBy === 'responseTime' ? b.averageResponseTime : 
                        b.totalClosedTickets;
            }
            
            if (sortBy === 'responseTime') {
                if (aValue === 0) return 1;
                if (bValue === 0) return -1;
                return aValue - bValue;
            }
            
            return bValue - aValue;
        });
    } catch (error) {
        console.error("Error in getStaffStats:", error);
        throw error;
    }
}

async function trackRating(ticketId, rating) {
    try {
        
        const ticketData = await ticketModel.findOne({ channelID: ticketId });
        
        if (!ticketData) {
            return null;
        }
        
        if (!ticketData.claimed || !ticketData.claimUser) {
            return null;
        }
        
        const staffId = ticketData.claimUser;
        
        const fakeMessage = {
            member: await client.guilds.cache.get(ticketData.guildID)?.members.fetch(staffId).catch(() => null),
            guild: client.guilds.cache.get(ticketData.guildID),
            channel: { id: ticketId }
        };

        const supportRole = await utils.checkIfUserHasSupportRoles(null, fakeMessage);
        if (!supportRole) {
            return null;
        }

        let staffMember = await staffStatsModel.findOne({ userID: staffId });
        
        if (!staffMember) {
            
            const staffUser = await client.users.fetch(staffId).catch(() => null);
            if (!staffUser) {
                return null;
            }
            
            staffMember = new staffStatsModel({
                userID: staffId,
                username: staffUser.username,
                avatarURL: staffUser.displayAvatarURL({ dynamic: true }),
                totalMessages: 0,
                totalClaims: 1,
                totalClosedTickets: 0,
                averageResponseTime: 0,
                totalRatings: 0,
                totalRatingScore: 0,
                averageRating: 0,
                lastActive: Date.now(),
                weekly: [],
                monthly: [],
                yearly: [],
                ticketsHistory: []
            });
        }
        
        const { currentWeek, currentMonth, currentYear } = await getCurrentTimePeriods(staffMember);
        
        staffMember.totalRatings = (staffMember.totalRatings || 0) + 1;
        staffMember.totalRatingScore = (staffMember.totalRatingScore || 0) + rating;
        staffMember.averageRating = staffMember.totalRatingScore / staffMember.totalRatings;
        
        currentWeek.ratings = (currentWeek.ratings || 0) + 1;
        currentWeek.ratingScore = (currentWeek.ratingScore || 0) + rating;
        currentWeek.averageRating = currentWeek.ratingScore / currentWeek.ratings;
        
        currentMonth.ratings = (currentMonth.ratings || 0) + 1;
        currentMonth.ratingScore = (currentMonth.ratingScore || 0) + rating;
        currentMonth.averageRating = currentMonth.ratingScore / currentMonth.ratings;
        
        currentYear.ratings = (currentYear.ratings || 0) + 1;
        currentYear.ratingScore = (currentYear.ratingScore || 0) + rating;
        currentYear.averageRating = currentYear.ratingScore / currentYear.ratings;
        
        const ticketIndex = staffMember.ticketsHistory.findIndex(t => t.ticketID === ticketId);
        
        if (ticketIndex !== -1) {
            staffMember.ticketsHistory[ticketIndex].rating = rating;
        } else {
            staffMember.ticketsHistory.push({
                ticketID: ticketId,
                claimedAt: ticketData.claimed ? new Date(ticketData.claimed) : new Date(),
                closedAt: ticketData.closedAt ? new Date(ticketData.closedAt) : null,
                messageCount: 0,
                responseTime: 0,
                rating: rating
            });
        }
        
        const result = await staffMember.save();
        
        const verifyStaff = await staffStatsModel.findOne({ userID: staffId });
        const verifyTicket = verifyStaff.ticketsHistory.find(t => t.ticketID === ticketId);
        if (verifyTicket) {
        } else {
        }
        
        return result;
    } catch (error) {
        console.error("[RATING] Error tracking rating:", error);
        return null;
    }
}

module.exports = {
    incrementStat,
    getStaffStats,
    getStaffMemberStats,
    getCurrentTimePeriods,
    getISOWeek,
    getWeekStartEnd,
    getMonthStartEnd,
    getYearStartEnd,
    trackRating
};