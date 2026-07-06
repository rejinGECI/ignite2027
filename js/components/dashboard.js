// Dashboard module
export function createDashboardModule(app) {
    return {
        async updateDashboard() {
            if (app.isAdmin) return;
            const data = await app.getUserData();
            if (!data) return;
            
            const timeLog = data.timeLog || [];
            
            // Filter timeLog by go-live date
            const goLiveDate = await app.getGoLiveDate();
            let filteredTimeLog = timeLog;
            if (goLiveDate) {
                const goLive = new Date(goLiveDate);
                goLive.setHours(0, 0, 0, 0);
                filteredTimeLog = timeLog.filter(log => {
                    const logDate = new Date(log.date);
                    logDate.setHours(0, 0, 0, 0);
                    return logDate >= goLive;
                });
            }
            
            // Calculate streak
            const streak = await app.calculateStreak(timeLog);
            const longestStreakEl = document.getElementById('longest-streak');
            if (longestStreakEl) longestStreakEl.textContent = streak.longest;
            
            // Calculate total minutes (from filtered logs)
            const totalMinutes = filteredTimeLog.reduce((sum, log) => sum + log.minutes, 0);
            const totalMinutesEl = document.getElementById('total-minutes');
            if (totalMinutesEl) totalMinutesEl.textContent = totalMinutes;
            
            // Calculate total days (from filtered logs)
            const uniqueDays = new Set(filteredTimeLog.map(log => log.date)).size;
            const totalDaysEl = document.getElementById('total-days');
            if (totalDaysEl) totalDaysEl.textContent = uniqueDays;
            
            // Calculate total hours and remaining minutes
            const totalHours = Math.floor(totalMinutes / 60);
            const remainingMinutes = totalMinutes % 60;
            const totalHoursEl = document.getElementById('total-hours');
            if (totalHoursEl) {
                if (totalHours > 0) {
                    totalHoursEl.textContent = remainingMinutes > 0 ? `${totalHours}h ${remainingMinutes}m` : `${totalHours}h`;
                } else {
                    totalHoursEl.textContent = remainingMinutes > 0 ? `${remainingMinutes}m` : '0';
                }
            }
            
            // Calculate today's completion status
            const today = new Date().toISOString().split('T')[0];
            const todayLog = filteredTimeLog.find(log => log.date === today);
            const todayMinutes = todayLog ? todayLog.minutes : 0;
            
            // Check if there's any activity submitted today (activity description = completed)
            const todayActivities = (data.activities || []).filter(a => a.date === today);
            const hasActivity = todayActivities.length > 0;
            
            // If activity is submitted OR any minutes logged (> 0), it's completed (partial = full completion)
            const isCompleted = hasActivity || todayMinutes > 0;
            
            // Today's progress display
            const todayProgressEl = document.getElementById('today-progress');
            if (todayProgressEl) {
                if (isCompleted) {
                    // Completed - green (100%)
                    todayProgressEl.style.width = '100%';
                    todayProgressEl.style.background = 'linear-gradient(90deg, #10b981, #059669)';
                    todayProgressEl.className = 'progress-fill progress-completed';
                } else {
                    // No progress - gray
                    todayProgressEl.style.width = '0%';
                    todayProgressEl.style.background = 'var(--border-color)';
                    todayProgressEl.className = 'progress-fill progress-none';
                }
            }
            
            const todayMinutesEl = document.getElementById('today-minutes');
            if (todayMinutesEl) {
                if (isCompleted) {
                    if (hasActivity) {
                        todayMinutesEl.textContent = `✅ Completed! (Activity submitted)`;
                    } else {
                        todayMinutesEl.textContent = `✅ Completed! (${todayMinutes} / 20 minutes)`;
                    }
                } else {
                    todayMinutesEl.textContent = `Not completed yet`;
                }
            }
        },
        
        async updateStatistics() {
            if (app.isAdmin) return;
            const data = await app.getUserData();
            if (!data) return;
            
            const timeLog = data.timeLog || [];
            
            // Filter timeLog by go-live date
            const goLiveDate = await app.getGoLiveDate();
            let filteredTimeLog = timeLog;
            if (goLiveDate) {
                const goLive = new Date(goLiveDate);
                goLive.setHours(0, 0, 0, 0);
                filteredTimeLog = timeLog.filter(log => {
                    const logDate = new Date(log.date);
                    logDate.setHours(0, 0, 0, 0);
                    return logDate >= goLive;
                });
            }
            
            const streak = await app.calculateStreak(timeLog);
            
            document.getElementById('stat-streak').textContent = `${streak.current} days`;
            document.getElementById('stat-longest').textContent = `${streak.longest} days`;
            
            const totalMinutes = filteredTimeLog.reduce((sum, log) => sum + log.minutes, 0);
            const totalHours = Math.floor(totalMinutes / 60);
            document.getElementById('stat-total-time').textContent = `${totalHours} hours`;
            document.getElementById('total-time-detail').textContent = `${totalMinutes} minutes total`;
            
            const uniqueDays = new Set(filteredTimeLog.map(log => log.date)).size;
            document.getElementById('stat-days-active').textContent = uniqueDays;
            
            // Calculate days tracked: from go-live date or first activity date to today (inclusive)
            let daysTracked = 1; // Default to 1 if no activity
            if (filteredTimeLog.length > 0) {
                const allDates = filteredTimeLog.map(log => log.date).sort();
                const firstDateStr = allDates[0];
                const firstDate = new Date(firstDateStr + 'T00:00:00');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                // If go-live date exists, use it as the start date
                let startDate = firstDate;
                if (goLiveDate) {
                    const goLive = new Date(goLiveDate);
                    goLive.setHours(0, 0, 0, 0);
                    startDate = goLive < firstDate ? goLive : firstDate;
                }
                
                // Calculate difference in days (inclusive of both start and end date)
                const diffTime = today - startDate;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                daysTracked = Math.max(1, diffDays + 1); // +1 to include both start and end date, minimum 1
            } else if (goLiveDate) {
                // If no activity but go-live date exists, calculate from go-live date
                const goLive = new Date(goLiveDate);
                goLive.setHours(0, 0, 0, 0);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const diffTime = today - goLive;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                daysTracked = Math.max(1, diffDays + 1);
            }
            document.getElementById('total-days-tracked').textContent = daysTracked;
            
            // Streak detail
            if (streak.current > 0) {
                document.getElementById('streak-detail').textContent = `Keep going! 🔥`;
            } else {
                document.getElementById('streak-detail').textContent = `Start your streak today!`;
            }
            
            // Render daily sessions list
            await app.renderDailySessions();
        },
        
        async calculateStreak(timeLog) {
            if (timeLog.length === 0) {
                return { current: 0, longest: 0 };
            }
            
            // Get go-live date and filter logs
            const goLiveDate = await app.getGoLiveDate();
            let filteredLogs = timeLog;
            
            if (goLiveDate) {
                const goLive = new Date(goLiveDate);
                goLive.setHours(0, 0, 0, 0);
                filteredLogs = timeLog.filter(log => {
                    const logDate = new Date(log.date);
                    logDate.setHours(0, 0, 0, 0);
                    return logDate >= goLive;
                });
            }
            
            if (filteredLogs.length === 0) {
                return { current: 0, longest: 0 };
            }
            
            const sortedLogs = [...filteredLogs].sort((a, b) => new Date(b.date) - new Date(a.date));
            const dates = [...new Set(sortedLogs.map(log => log.date))].sort((a, b) => new Date(b) - new Date(a));
            
            let currentStreak = 0;
            let longestStreak = 0;
            let tempStreak = 0;
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            for (let i = 0; i < dates.length; i++) {
                const logDate = new Date(dates[i]);
                logDate.setHours(0, 0, 0, 0);
                
                const daysDiff = Math.floor((today - logDate) / (1000 * 60 * 60 * 24));
                
                if (i === 0 && daysDiff <= 1) {
                    currentStreak = 1;
                    tempStreak = 1;
                } else if (i > 0) {
                    const prevDate = new Date(dates[i - 1]);
                    prevDate.setHours(0, 0, 0, 0);
                    const dayDiff = Math.floor((prevDate - logDate) / (1000 * 60 * 60 * 24));
                    
                    if (dayDiff === 1) {
                        if (i === 1 && daysDiff <= 1) {
                            currentStreak++;
                        }
                        tempStreak++;
                    } else {
                        tempStreak = 1;
                    }
                }
                
                longestStreak = Math.max(longestStreak, tempStreak);
            }
            
            return { current: currentStreak, longest: longestStreak };
        },
        
        async renderDailySessions() {
            if (app.isAdmin) return;
            const data = await app.getUserData();
            if (!data) return;
            
            const activities = data.activities || [];
            const container = document.getElementById('daily-sessions-list');
            if (!container) return;
            
            if (activities.length === 0) {
                container.innerHTML = '<p class="empty-state">No timer sessions recorded yet.</p>';
                return;
            }
            
            // Group activities by date
            const groupedByDate = {};
            activities.forEach(activity => {
                if (!groupedByDate[activity.date]) {
                    groupedByDate[activity.date] = [];
                }
                groupedByDate[activity.date].push(activity);
            });
            
            // Get last 7 days
            const dates = [];
            for (let i = 6; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                dates.push(date.toISOString().split('T')[0]);
            }
            
            container.innerHTML = dates.map(date => {
                const dayActivities = groupedByDate[date] || [];
                const dateObj = new Date(date);
                const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                const dayNum = dateObj.getDate();
                const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' });
                
                if (dayActivities.length === 0) {
                    return `
                        <div class="daily-session-item">
                            <div class="session-date">${dayName}, ${monthName} ${dayNum}</div>
                            <div class="session-count">No sessions</div>
                        </div>
                    `;
                }
                
                return `
                    <div class="daily-session-item">
                        <div class="session-date">${dayName}, ${monthName} ${dayNum}</div>
                        <div class="session-count">${dayActivities.length} session${dayActivities.length > 1 ? 's' : ''}</div>
                    </div>
                `;
            }).join('');
        }
    };
}

