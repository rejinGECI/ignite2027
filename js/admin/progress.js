// Admin Progress module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createAdminProgressModule(app) {
    return {
        async loadStudentProgress() {
            // Reset filter when loading progress page
            app.filteredByAttention = false;
            
            const container = document.getElementById('progress-students-list');
            if (!container) {
                console.error('Progress students list container not found');
                return;
            }
            
            container.innerHTML = '<div class="loading-state">Loading student progress...</div>';
            
            try {
                // Check if user is admin
                if (!app.isAdmin && app.userRole !== 'admin') {
                    container.innerHTML = '<div class="error-message">Access denied. Admin access required.</div>';
                    return;
                }
                
                const usersQuery = query(
                    collection(window.firebaseDb, 'users'),
                    where('role', '==', 'student')
                );
                const usersSnapshot = await getDocs(usersQuery);
                
                const students = [];
                for (const userDoc of usersSnapshot.docs) {
                    const userData = userDoc.data();
                    const studentDataDoc = await getDoc(doc(window.firebaseDb, 'userData', userDoc.id));
                    const studentData = studentDataDoc.exists() ? studentDataDoc.data() : {};
                    
                    const timeLog = studentData.timeLog || [];
                    const activities = studentData.activities || [];
                    const habits = studentData.habits || { reading: [], custom: [], books: [] };
                    const reflections = studentData.reflections || [];
                    const feedback = studentData.feedback || [];
                    
                    // Filter by go-live date
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
                    const totalMinutes = filteredTimeLog.reduce((sum, log) => sum + log.minutes, 0);
                    const uniqueDays = new Set(filteredTimeLog.map(log => log.date)).size;
                    const totalHours = Math.floor(totalMinutes / 60);
                    
                    // Calculate recent activity (last 7 days)
                    const sevenDaysAgo = new Date();
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                    const recentActivities = activities.filter(a => {
                        const activityDate = new Date(a.timestamp || a.date);
                        return activityDate >= sevenDaysAgo;
                    }).length;
                    
                    // Calculate reading stats
                    const totalPages = (habits.reading || []).reduce((sum, r) => sum + (r.pages || 0), 0);
                    
                    // Get last activity date
                    const sortedTimeLog = [...timeLog].sort((a, b) => new Date(b.date) - new Date(a.date));
                    const lastActivityDate = sortedTimeLog.length > 0 ? sortedTimeLog[0].date : null;
                    
                    students.push({
                        id: userDoc.id,
                        name: userData.name || userData.username || 'Unknown',
                        username: userData.username || userData.name || 'Unknown',
                        email: userData.email || '',
                        streak: streak.longest, // Use longest streak (total streak) instead of current
                        longestStreak: streak.longest,
                        totalMinutes: totalMinutes,
                        totalHours: totalHours,
                        daysActive: uniqueDays,
                        totalActivities: activities.length,
                        recentActivities: recentActivities,
                        totalPages: totalPages,
                        reflections: reflections.length,
                        feedback: feedback.length,
                        lastActivityDate: lastActivityDate,
                        activities: activities.slice(-5) // Last 5 activities
                    });
                }
                
                // Calculate summary statistics
                const totalStudents = students.length;
                const avgStreak = totalStudents > 0 ? Math.round(students.reduce((sum, s) => sum + s.streak, 0) / totalStudents) : 0;
                const avgHours = totalStudents > 0 ? Math.round(students.reduce((sum, s) => sum + s.totalHours, 0) / totalStudents) : 0;
                const totalHours = students.reduce((sum, s) => sum + s.totalHours, 0);
                const totalActivities = students.reduce((sum, s) => sum + s.totalActivities, 0);
                const activeStudents = students.filter(s => s.streak > 0).length;
                const inactiveStudents = students.filter(s => s.streak === 0).length;
                
                // Identify students falling behind (no streak, no recent activity)
                const today = new Date();
                const threeDaysAgo = new Date(today);
                threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
                
                students.forEach(student => {
                    const lastActivity = student.lastActivityDate ? new Date(student.lastActivityDate) : null;
                    const daysSinceActivity = lastActivity ? Math.floor((today - lastActivity) / (1000 * 60 * 60 * 24)) : 999;
                    
                    student.isBehind = student.streak === 0 || daysSinceActivity > 3 || student.recentActivities === 0;
                    student.daysSinceActivity = daysSinceActivity;
                });
                
                const behindStudents = students.filter(s => s.isBehind).length;
                
                // Store students for filtering
                app.allProgressStudents = students;
                
                // Render summary
                app.renderProgressSummary({
                    totalStudents,
                    avgStreak,
                    avgHours,
                    totalHours,
                    totalActivities,
                    activeStudents,
                    inactiveStudents,
                    behindStudents
                });
                
                // Render charts
                app.renderProgressCharts(students);
                
                // Sort students: behind students first, then by name
                students.sort((a, b) => {
                    if (a.isBehind !== b.isBehind) {
                        return a.isBehind ? -1 : 1; // Behind students first
                    }
                    return a.name.localeCompare(b.name);
                });
                
                if (students.length === 0) {
                    container.innerHTML = '<div class="empty-state">No students found. Upload a CSV file to create student accounts.</div>';
                    return;
                }
                
                // Format date helper
                const formatDate = (dateStr) => {
                    if (!dateStr) return 'Never';
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                    });
                };
                
                container.innerHTML = students.map(student => {
                    const warningClass = student.isBehind ? 'student-behind' : '';
                    const warningBadge = student.isBehind ? `
                        <div class="warning-badge">
                            <i class="fas fa-exclamation-triangle"></i> Needs Attention
                        </div>
                    ` : '';
                    
                    return `
                    <div class="progress-student-card ${warningClass}" data-student-name="${escapeHtml(student.name.toLowerCase())}" data-student-ktuid="${escapeHtml(student.username.toLowerCase())}">
                        <div class="progress-student-header">
                            <div>
                                <h3 class="progress-student-name">${escapeHtml(student.name)} ${warningBadge}</h3>
                                <p class="progress-student-ktuid">KTU ID: ${escapeHtml(student.username)}</p>
                            </div>
                            <div class="progress-badge ${student.streak > 0 ? 'active' : 'inactive'}">
                                <i class="fas fa-fire"></i> ${student.streak} Day Total Streak
                            </div>
                        </div>
                        
                        <div class="progress-stats-grid">
                            <div class="progress-stat-item">
                                <div class="progress-stat-icon"><i class="fas fa-fire"></i></div>
                                <div class="progress-stat-content">
                                    <div class="progress-stat-value">${student.streak}</div>
                                    <div class="progress-stat-label">Total Streak</div>
                                    <div class="progress-stat-sub">Longest streak achieved</div>
                                </div>
                            </div>
                            
                            <div class="progress-stat-item">
                                <div class="progress-stat-icon"><i class="fas fa-clock"></i></div>
                                <div class="progress-stat-content">
                                    <div class="progress-stat-value">${student.totalHours}</div>
                                    <div class="progress-stat-label">Total Hours</div>
                                    <div class="progress-stat-sub">${student.totalMinutes} minutes</div>
                                </div>
                            </div>
                            
                            <div class="progress-stat-item">
                                <div class="progress-stat-icon"><i class="fas fa-calendar-check"></i></div>
                                <div class="progress-stat-content">
                                    <div class="progress-stat-value">${student.daysActive}</div>
                                    <div class="progress-stat-label">Days Active</div>
                                    <div class="progress-stat-sub">Last: ${formatDate(student.lastActivityDate)}</div>
                                </div>
                            </div>
                            
                            <div class="progress-stat-item">
                                <div class="progress-stat-icon"><i class="fas fa-tasks"></i></div>
                                <div class="progress-stat-content">
                                    <div class="progress-stat-value">${student.totalActivities}</div>
                                    <div class="progress-stat-label">Total Activities</div>
                                    <div class="progress-stat-sub">${student.recentActivities} this week</div>
                                </div>
                            </div>
                            
                            <div class="progress-stat-item">
                                <div class="progress-stat-icon"><i class="fas fa-book"></i></div>
                                <div class="progress-stat-content">
                                    <div class="progress-stat-value">${student.totalPages}</div>
                                    <div class="progress-stat-label">Pages Read</div>
                                    <div class="progress-stat-sub">Reading habit</div>
                                </div>
                            </div>
                            
                            <div class="progress-stat-item">
                                <div class="progress-stat-icon"><i class="fas fa-comments"></i></div>
                                <div class="progress-stat-content">
                                    <div class="progress-stat-value">${student.reflections + student.feedback}</div>
                                    <div class="progress-stat-label">Reflections</div>
                                    <div class="progress-stat-sub">Feedback & notes</div>
                                </div>
                            </div>
                        </div>
                        
                        ${student.activities.length > 0 ? `
                        <div class="progress-recent-activities">
                            <h4><i class="fas fa-history"></i> Recent Activities</h4>
                            <div class="recent-activities-list">
                                ${student.activities.slice().reverse().map(activity => `
                                    <div class="recent-activity-item">
                                        <div class="activity-date">${formatDate(activity.date || activity.timestamp)}</div>
                                        <div class="activity-text">${escapeHtml(activity.text || 'Activity logged')}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `;
                }).join('');
                
            } catch (error) {
                console.error('Error loading student progress:', error);
                let errorMessage = error.message;
                
                if (error.code === 'permission-denied' || error.message.includes('permission')) {
                    errorMessage = `
                        <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 1rem; margin: 1rem 0;">
                            <strong style="color: #dc2626;">⚠️ Permission Denied</strong><br>
                            <p style="margin: 0.5rem 0; color: #991b1b;">
                                Firestore security rules need to be updated to allow admin access.<br>
                                See <code>FIRESTORE_SECURITY_RULES.md</code> for instructions.
                            </p>
                        </div>
                    `;
                }
                
                container.innerHTML = `<div class="error-message">${errorMessage}</div>`;
            }
        },
        
        renderProgressSummary: function(summary) {
            const container = document.getElementById('progress-summary');
            if (!container) return;
            
            container.innerHTML = `
                <div class="summary-grid">
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #6366f1, #8b5cf6);">
                            <i class="fas fa-users"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${summary.totalStudents}</div>
                            <div class="summary-label">Total Students</div>
                        </div>
                    </div>
                    
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #f59e0b, #ef4444);">
                            <i class="fas fa-fire"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${summary.avgStreak}</div>
                            <div class="summary-label">Average Streak</div>
                            <div class="summary-sub">${summary.activeStudents} active, ${summary.inactiveStudents} inactive</div>
                        </div>
                    </div>
                    
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${summary.totalHours}</div>
                            <div class="summary-label">Total Hours</div>
                            <div class="summary-sub">${summary.avgHours} hours average</div>
                        </div>
                    </div>
                    
                    <div class="summary-card">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #3b82f6, #2563eb);">
                            <i class="fas fa-tasks"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${summary.totalActivities}</div>
                            <div class="summary-label">Total Activities</div>
                        </div>
                    </div>
                    
                    ${summary.behindStudents > 0 ? `
                    <div class="summary-card" style="border-left: 4px solid #ef4444;">
                        <div class="summary-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div class="summary-content">
                            <div class="summary-value">${summary.behindStudents}</div>
                            <div class="summary-label">Need Attention</div>
                            <div class="summary-sub">Students falling behind</div>
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
        },
        
        filterStudentsByAttention: function() {
            if (!app.allProgressStudents) return;
            
            app.filteredByAttention = true;
            const studentCards = document.querySelectorAll('.progress-student-card');
            
            studentCards.forEach(card => {
                // Check if card has the student-behind class
                if (card.classList.contains('student-behind')) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
            
            // Update summary to show filter indicator
            const behindCount = app.allProgressStudents.filter(s => s.isBehind).length;
            const summary = {
                totalStudents: app.allProgressStudents.length,
                avgStreak: Math.round(app.allProgressStudents.reduce((sum, s) => sum + s.streak, 0) / app.allProgressStudents.length),
                avgHours: Math.round(app.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0) / app.allProgressStudents.length),
                totalHours: app.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0),
                totalActivities: app.allProgressStudents.reduce((sum, s) => sum + s.totalActivities, 0),
                activeStudents: app.allProgressStudents.filter(s => s.streak > 0).length,
                inactiveStudents: app.allProgressStudents.filter(s => s.streak === 0).length,
                behindStudents: behindCount
            };
            app.renderProgressSummary(summary);
            
            // Scroll to students list
            const studentsList = document.getElementById('progress-students-list');
            if (studentsList) {
                studentsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        },
        
        clearAttentionFilter: function() {
            app.filteredByAttention = false;
            const studentCards = document.querySelectorAll('.progress-student-card');
            
            // Show all students
            studentCards.forEach(card => {
                card.style.display = 'block';
            });
            
            // Clear search input if it exists
            const searchInput = document.getElementById('search-progress-students');
            if (searchInput) {
                searchInput.value = '';
            }
            
            // Update summary to remove filter indicator
            if (app.allProgressStudents) {
                const behindCount = app.allProgressStudents.filter(s => s.isBehind).length;
                const summary = {
                    totalStudents: app.allProgressStudents.length,
                    avgStreak: Math.round(app.allProgressStudents.reduce((sum, s) => sum + s.streak, 0) / app.allProgressStudents.length),
                    avgHours: Math.round(app.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0) / app.allProgressStudents.length),
                    totalHours: app.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0),
                    totalActivities: app.allProgressStudents.reduce((sum, s) => sum + s.totalActivities, 0),
                    activeStudents: app.allProgressStudents.filter(s => s.streak > 0).length,
                    inactiveStudents: app.allProgressStudents.filter(s => s.streak === 0).length,
                    behindStudents: behindCount
                };
                app.renderProgressSummary(summary);
            }
        },
        
        renderProgressCharts: function(students) {
            const container = document.getElementById('progress-charts');
            if (!container) return;
            
            // Calculate data for charts
            const streakRanges = {
                '0': students.filter(s => s.streak === 0).length,
                '1-7': students.filter(s => s.streak >= 1 && s.streak <= 7).length,
                '8-14': students.filter(s => s.streak >= 8 && s.streak <= 14).length,
                '15-30': students.filter(s => s.streak >= 15 && s.streak <= 30).length,
                '30+': students.filter(s => s.streak > 30).length
            };
            
            const activityRanges = {
                '0': students.filter(s => s.totalActivities === 0).length,
                '1-10': students.filter(s => s.totalActivities >= 1 && s.totalActivities <= 10).length,
                '11-25': students.filter(s => s.totalActivities >= 11 && s.totalActivities <= 25).length,
                '26-50': students.filter(s => s.totalActivities >= 26 && s.totalActivities <= 50).length,
                '50+': students.filter(s => s.totalActivities > 50).length
            };
            
            const maxStreak = Math.max(...Object.values(streakRanges), 1);
            const maxActivity = Math.max(...Object.values(activityRanges), 1);
            
            container.innerHTML = `
                <div class="charts-grid">
                    <div class="chart-card">
                        <h3><i class="fas fa-fire"></i> Streak Distribution</h3>
                        <div class="chart-container">
                            ${Object.entries(streakRanges).map(([range, count]) => {
                                const percentage = (count / students.length) * 100;
                                const barWidth = (count / maxStreak) * 100;
                                return `
                                    <div class="chart-bar-item">
                                        <div class="chart-bar-label">${range} days</div>
                                        <div class="chart-bar-wrapper">
                                            <div class="chart-bar" style="width: ${barWidth}%; background: ${range === '0' ? '#ef4444' : range === '30+' ? '#10b981' : '#6366f1'};">
                                                <span class="chart-bar-value">${count}</span>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    
                    <div class="chart-card">
                        <h3><i class="fas fa-tasks"></i> Activity Distribution</h3>
                        <div class="chart-container">
                            ${Object.entries(activityRanges).map(([range, count]) => {
                                const barWidth = (count / maxActivity) * 100;
                                return `
                                    <div class="chart-bar-item">
                                        <div class="chart-bar-label">${range}</div>
                                        <div class="chart-bar-wrapper">
                                            <div class="chart-bar" style="width: ${barWidth}%; background: ${range === '0' ? '#ef4444' : range === '50+' ? '#10b981' : '#6366f1'};">
                                                <span class="chart-bar-value">${count}</span>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            `;
        },
        
        setupProgressSearch: function() {
            const searchInput = document.getElementById('search-progress-students');
            if (!searchInput) return;
            
            // Remove existing listener
            searchInput.removeEventListener('input', app._progressSearchHandler);
            
            // Create and store handler
            app._progressSearchHandler = (e) => {
                const query = e.target.value.toLowerCase().trim();
                const studentCards = document.querySelectorAll('.progress-student-card');
                
                if (query === '') {
                    // Show all students (respect filter)
                    studentCards.forEach(card => {
                        if (app.filteredByAttention) {
                            card.style.display = card.classList.contains('student-behind') ? 'block' : 'none';
                        } else {
                            card.style.display = 'block';
                        }
                    });
                } else {
                    // Filter students
                    studentCards.forEach(card => {
                        const name = card.getAttribute('data-student-name') || '';
                        const ktuid = card.getAttribute('data-student-ktuid') || '';
                        
                        if (name.includes(query) || ktuid.includes(query)) {
                            // Respect attention filter
                            if (app.filteredByAttention && !card.classList.contains('student-behind')) {
                                card.style.display = 'none';
                            } else {
                                card.style.display = 'block';
                            }
                        } else {
                            card.style.display = 'none';
                        }
                    });
                }
            };
            
            searchInput.addEventListener('input', app._progressSearchHandler);
        }
    };
}

