// Firebase imports (loaded via script tag in HTML)
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    addDoc,
    query,
    where,
    getDocs,
    orderBy,
    limit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Application State
const app = {
    currentUser: null,
    userRole: null,
    isAdmin: false,
    timer: {
        duration: 20 * 60, // 20 minutes in seconds
        remaining: 20 * 60,
        interval: null,
        isRunning: false,
        isPaused: false
    },
    
    // Admin credentials
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'IgniteAdmin27',
    
    init: function() {
        // Show login by default
        this.showLogin();
        this.setupNavigation();
        this.checkAuthState();
    },
    
    // Authentication
    checkAuthState: function() {
        // Check if admin is logged in (stored in sessionStorage)
        const adminLoggedIn = sessionStorage.getItem('adminLoggedIn') === 'true';
        if (adminLoggedIn) {
            this.isAdmin = true;
            this.userRole = 'admin';
            this.showApp();
            return;
        }
        
        // Check Firebase auth for students
        // Only check if Firebase is initialized
        if (window.firebaseAuth) {
            onAuthStateChanged(window.firebaseAuth, async (user) => {
                if (user) {
                    this.currentUser = user;
                    await this.loadUserData();
                    this.isAdmin = false;
                    this.userRole = 'student';
                    this.showApp();
                } else {
                    this.showLogin();
                }
            });
        } else {
            // Firebase not initialized, show login
            this.showLogin();
        }
    },
    
    async loadUserData() {
        if (!this.currentUser) return;
        
        const userDoc = await getDoc(doc(window.firebaseDb, 'users', this.currentUser.uid));
        if (userDoc.exists()) {
            this.userRole = userDoc.data().role || 'student';
        }
        
        await this.updateDashboard();
        await this.updateStatistics();
        this.renderCalendar();
        this.renderRecentActivities();
        this.renderTodayActivities();
        this.renderFeedbackNotes();
        this.renderCustomHabits();
        await this.loadDreams();
    },
    
    showLogin: function() {
        document.getElementById('login-page').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
    },
    
    showApp: function() {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        // Show/hide admin nav
        if (this.isAdmin || this.userRole === 'admin') {
            document.getElementById('admin-dash-nav').style.display = 'block';
        } else {
            document.getElementById('admin-dash-nav').style.display = 'none';
        }
    },
    
    async login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errorDiv = document.getElementById('login-error');
        
        errorDiv.textContent = '';
        
        // Check admin credentials
        if (username === this.ADMIN_USERNAME && password === this.ADMIN_PASSWORD) {
            this.isAdmin = true;
            this.userRole = 'admin';
            sessionStorage.setItem('adminLoggedIn', 'true');
            this.showApp();
            this.showPage('admin-dashboard');
            return;
        }
        
        // Try Firebase login for students (ktuid format)
        try {
            // For students, username is ktuid, password is ignite_{ktuid}
            const email = `${username}@student.local`; // Use ktuid as email
            await signInWithEmailAndPassword(window.firebaseAuth, email, password);
        } catch (error) {
            errorDiv.textContent = 'Invalid username or password';
        }
    },
    
    async logout() {
        if (this.isAdmin) {
            sessionStorage.removeItem('adminLoggedIn');
            this.isAdmin = false;
            this.userRole = null;
        } else {
            await signOut(window.firebaseAuth);
        }
        this.showLogin();
    },
    
    // CSV Upload for Admin
    async handleCSVUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const statusDiv = document.getElementById('csv-status');
        statusDiv.innerHTML = '<div class="csv-processing">Processing CSV file...</div>';
        
        try {
            const text = await file.text();
            const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            
            if (lines.length === 0) {
                statusDiv.innerHTML = '<div class="csv-error">CSV file is empty</div>';
                return;
            }
            
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            
            statusDiv.innerHTML = `<div class="csv-processing">Creating ${lines.length} student accounts...</div>`;
            
            for (const ktuid of lines) {
                try {
                    await this.createStudentAccount(ktuid);
                    successCount++;
                } catch (error) {
                    errorCount++;
                    errors.push(`${ktuid}: ${error.message}`);
                }
            }
            
            let statusHtml = `<div class="csv-success">
                <strong>Upload Complete!</strong><br>
                Successfully created: ${successCount} accounts<br>
                Errors: ${errorCount} accounts
            </div>`;
            
            if (errors.length > 0) {
                statusHtml += `<div class="csv-errors">
                    <strong>Errors:</strong><br>
                    ${errors.slice(0, 10).join('<br>')}
                    ${errors.length > 10 ? `<br>... and ${errors.length - 10} more` : ''}
                </div>`;
            }
            
            statusDiv.innerHTML = statusHtml;
            
            // Refresh students list
            await this.loadStudentsList();
            
            // Clear file input
            event.target.value = '';
        } catch (error) {
            statusDiv.innerHTML = `<div class="csv-error">Error reading CSV file: ${error.message}</div>`;
        }
    },
    
    async createStudentAccount(ktuid) {
        const email = `${ktuid}@student.local`;
        const password = `ignite_${ktuid}`;
        
        try {
            // Try to create user
            const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, password);
            const user = userCredential.user;
            
            // Create user document
            await setDoc(doc(window.firebaseDb, 'users', user.uid), {
                name: ktuid,
                email: email,
                username: ktuid,
                role: 'student',
                createdAt: new Date().toISOString()
            });
            
            // Initialize user data
            await setDoc(doc(window.firebaseDb, 'userData', user.uid), {
                dreams: {},
                activities: [],
                timeLog: [],
                habits: { reading: [], custom: [] },
                feedback: [],
                reflections: []
            });
        } catch (error) {
            // If user already exists, that's okay
            if (error.code === 'auth/email-already-in-use') {
                // User already exists, skip
                return;
            }
            throw error;
        }
    },
    
    // Navigation
    setupNavigation: function() {
        const navLinks = document.querySelectorAll('.nav-link[data-page]');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                this.showPage(page);
            });
        });
    },
    
    showPage: function(pageId) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        
        // Show selected page
        const page = document.getElementById(pageId);
        if (page) {
            page.classList.add('active');
        }
        
        // Update active nav link
        document.querySelectorAll('.nav-link[data-page]').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-page') === pageId) {
                link.classList.add('active');
            }
        });
        
        // Update page-specific data
        if (pageId === 'stats') {
            this.updateStatistics();
            this.renderCalendar();
        } else if (pageId === 'progress') {
            this.renderTodayActivities();
        } else if (pageId === 'habits') {
            this.updateReadingStats();
        } else if (pageId === 'admin-dashboard') {
            this.loadStudentsList();
        }
    },
    
    // Timer Functions
    startTimer: function() {
        if (!this.timer.isRunning) {
            this.timer.isRunning = true;
            this.timer.isPaused = false;
            
            this.timer.interval = setInterval(() => {
                if (this.timer.remaining > 0) {
                    this.timer.remaining--;
                    this.updateTimerDisplay();
                } else {
                    this.completeTimer();
                }
            }, 1000);
            
            document.getElementById('start-timer').style.display = 'none';
            document.getElementById('pause-timer').style.display = 'inline-flex';
            document.getElementById('stop-timer').style.display = 'inline-flex';
        }
    },
    
    pauseTimer: function() {
        if (this.timer.isRunning) {
            clearInterval(this.timer.interval);
            this.timer.isRunning = false;
            this.timer.isPaused = true;
            
            document.getElementById('start-timer').style.display = 'inline-flex';
            document.getElementById('pause-timer').style.display = 'none';
        }
    },
    
    stopTimer: async function() {
        clearInterval(this.timer.interval);
        this.timer.isRunning = false;
        this.timer.isPaused = false;
        
        const minutesSpent = Math.floor((this.timer.duration - this.timer.remaining) / 60);
        if (minutesSpent > 0 && !this.isAdmin) {
            await this.recordTime(minutesSpent);
        }
        
        this.timer.remaining = this.timer.duration;
        this.updateTimerDisplay();
        
        document.getElementById('start-timer').style.display = 'inline-flex';
        document.getElementById('pause-timer').style.display = 'none';
        document.getElementById('stop-timer').style.display = 'none';
    },
    
    completeTimer: async function() {
        clearInterval(this.timer.interval);
        this.timer.isRunning = false;
        this.timer.isPaused = false;
        if (!this.isAdmin) {
            await this.recordTime(20);
        }
        this.timer.remaining = this.timer.duration;
        this.updateTimerDisplay();
        
        document.getElementById('start-timer').style.display = 'inline-flex';
        document.getElementById('pause-timer').style.display = 'none';
        document.getElementById('stop-timer').style.display = 'none';
        
        if (!this.isAdmin) {
            alert('🎉 Great job! You completed your 20-minute session!');
        }
    },
    
    updateTimerDisplay: function() {
        const minutes = Math.floor(this.timer.remaining / 60);
        const seconds = this.timer.remaining % 60;
        document.getElementById('timer-display').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Update progress circle
        const progress = ((this.timer.duration - this.timer.remaining) / this.timer.duration) * 565.48;
        document.getElementById('timer-circle').style.strokeDashoffset = 565.48 - progress;
    },
    
    // Firebase Data Operations
    async getUserDataRef() {
        if (!this.currentUser || this.isAdmin) return null;
        return doc(window.firebaseDb, 'userData', this.currentUser.uid);
    },
    
    async getUserData() {
        if (this.isAdmin) return null;
        const userDataRef = await this.getUserDataRef();
        if (!userDataRef) return null;
        
        const userDataDoc = await getDoc(userDataRef);
        if (userDataDoc.exists()) {
            return userDataDoc.data();
        }
        return {
            dreams: {},
            activities: [],
            timeLog: [],
            habits: { reading: [], custom: [] },
            feedback: [],
            reflections: []
        };
    },
    
    async saveUserData(data) {
        if (this.isAdmin) return;
        const userDataRef = await this.getUserDataRef();
        if (!userDataRef) return;
        await setDoc(userDataRef, data, { merge: true });
    },
    
    // Dreams
    async saveDreams() {
        const data = await this.getUserData();
        data.dreams = {
            career: document.getElementById('dream-career').value,
            places: document.getElementById('places-visit').value,
            things: document.getElementById('things-do').value,
            plan: document.getElementById('action-plan').value,
            lastUpdated: new Date().toISOString()
        };
        await this.saveUserData(data);
        alert('Dreams and plans saved successfully! ✨');
    },
    
    async loadDreams() {
        const data = await this.getUserData();
        if (data && data.dreams) {
            document.getElementById('dream-career').value = data.dreams.career || '';
            document.getElementById('places-visit').value = data.dreams.places || '';
            document.getElementById('things-do').value = data.dreams.things || '';
            document.getElementById('action-plan').value = data.dreams.plan || '';
        }
    },
    
    // Activities
    async saveActivity() {
        const activityText = document.getElementById('activity-log').value.trim();
        if (!activityText) {
            alert('Please describe what you did today!');
            return;
        }
        
        const data = await this.getUserData();
        const today = new Date().toISOString().split('T')[0];
        
        data.activities.push({
            date: today,
            text: activityText,
            timestamp: new Date().toISOString()
        });
        
        await this.saveUserData(data);
        document.getElementById('activity-log').value = '';
        this.renderTodayActivities();
        this.renderRecentActivities();
        await this.updateDashboard();
        alert('Activity saved! Keep up the great work! 💪');
    },
    
    async recordTime(minutes) {
        const data = await this.getUserData();
        const today = new Date().toISOString().split('T')[0];
        
        const existingLog = data.timeLog.find(log => log.date === today);
        if (existingLog) {
            existingLog.minutes += minutes;
        } else {
            data.timeLog.push({
                date: today,
                minutes: minutes
            });
        }
        
        await this.saveUserData(data);
        await this.updateDashboard();
        await this.updateStatistics();
    },
    
    async renderTodayActivities() {
        const data = await this.getUserData();
        const today = new Date().toISOString().split('T')[0];
        const todayActivities = (data.activities || []).filter(a => a.date === today);
        
        const container = document.getElementById('today-activities-list');
        if (todayActivities.length === 0) {
            container.innerHTML = '<p class="empty-state">No activities logged yet for today.</p>';
            return;
        }
        
        container.innerHTML = todayActivities.map(activity => {
            const time = new Date(activity.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });
            return `
                <div class="activity-entry">
                    <div>
                        <div class="activity-text">${this.escapeHtml(activity.text)}</div>
                        <div class="activity-time">Logged at ${time}</div>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    async renderRecentActivities() {
        const data = await this.getUserData();
        const recent = (data.activities || []).slice(-5).reverse();
        
        const container = document.getElementById('recent-activities');
        if (recent.length === 0) {
            container.innerHTML = '<p class="empty-state">No activities yet. Start your journey today!</p>';
            return;
        }
        
        container.innerHTML = recent.map(activity => {
            const date = new Date(activity.date);
            const formattedDate = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            return `
                <div class="activity-item">
                    <div class="activity-date">${formattedDate}</div>
                    <div class="activity-text">${this.escapeHtml(activity.text)}</div>
                </div>
            `;
        }).join('');
    },
    
    // Statistics
    async updateDashboard() {
        if (this.isAdmin) return;
        const data = await this.getUserData();
        const timeLog = data.timeLog || [];
        
        // Calculate streak
        const streak = this.calculateStreak(timeLog);
        document.getElementById('current-streak').textContent = streak.current;
        
        // Calculate total minutes
        const totalMinutes = timeLog.reduce((sum, log) => sum + log.minutes, 0);
        document.getElementById('total-minutes').textContent = totalMinutes;
        
        // Calculate total days
        const uniqueDays = new Set(timeLog.map(log => log.date)).size;
        document.getElementById('total-days').textContent = uniqueDays;
        
        // Calculate completion rate (based on 20 min goal)
        const today = new Date().toISOString().split('T')[0];
        const todayLog = timeLog.find(log => log.date === today);
        const todayMinutes = todayLog ? todayLog.minutes : 0;
        const completionRate = Math.min(100, Math.round((todayMinutes / 20) * 100));
        document.getElementById('completion-rate').textContent = `${completionRate}%`;
        
        // Today's progress
        const progressPercent = Math.min(100, (todayMinutes / 20) * 100);
        document.getElementById('today-progress').style.width = `${progressPercent}%`;
        document.getElementById('today-minutes').textContent = `${todayMinutes} / 20 minutes`;
    },
    
    async updateStatistics() {
        if (this.isAdmin) return;
        const data = await this.getUserData();
        const timeLog = data.timeLog || [];
        const streak = this.calculateStreak(timeLog);
        
        document.getElementById('stat-streak').textContent = `${streak.current} days`;
        document.getElementById('stat-longest').textContent = `${streak.longest} days`;
        
        const totalMinutes = timeLog.reduce((sum, log) => sum + log.minutes, 0);
        const totalHours = Math.floor(totalMinutes / 60);
        document.getElementById('stat-total-time').textContent = `${totalHours} hours`;
        document.getElementById('total-time-detail').textContent = `${totalMinutes} minutes total`;
        
        const uniqueDays = new Set(timeLog.map(log => log.date)).size;
        document.getElementById('stat-days-active').textContent = uniqueDays;
        
        const allDates = timeLog.map(log => log.date);
        const firstDate = allDates.length > 0 ? Math.min(...allDates.map(d => new Date(d).getTime())) : new Date();
        const daysTracked = Math.ceil((new Date() - new Date(firstDate)) / (1000 * 60 * 60 * 24)) + 1;
        document.getElementById('total-days-tracked').textContent = daysTracked || 1;
        
        // Streak detail
        if (streak.current > 0) {
            document.getElementById('streak-detail').textContent = `Keep going! 🔥`;
        } else {
            document.getElementById('streak-detail').textContent = `Start your streak today!`;
        }
    },
    
    calculateStreak: function(timeLog) {
        if (timeLog.length === 0) {
            return { current: 0, longest: 0 };
        }
        
        const sortedLogs = [...timeLog].sort((a, b) => new Date(b.date) - new Date(a.date));
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
    
    renderCalendar: async function() {
        if (this.isAdmin) return;
        const data = await this.getUserData();
        const timeLog = data.timeLog || [];
        const container = document.getElementById('activity-calendar');
        
        // Get last 30 days
        const days = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            days.push(date.toISOString().split('T')[0]);
        }
        
        container.innerHTML = days.map(date => {
            const log = timeLog.find(l => l.date === date);
            const isActive = log && log.minutes >= 20;
            const isPartial = log && log.minutes > 0 && log.minutes < 20;
            
            const dayNum = new Date(date).getDate();
            let className = 'calendar-day';
            if (isActive) className += ' active';
            else if (isPartial) className += ' partial';
            
            return `<div class="${className}" title="${date}: ${log ? log.minutes + ' min' : 'No activity'}">${dayNum}</div>`;
        }).join('');
    },
    
    // Habits
    async saveReading() {
        const pages = parseInt(document.getElementById('pages-read').value);
        if (isNaN(pages) || pages < 0) {
            alert('Please enter a valid number of pages!');
            return;
        }
        
        const data = await this.getUserData();
        const today = new Date().toISOString().split('T')[0];
        
        if (!data.habits) data.habits = { reading: [], custom: [] };
        if (!data.habits.reading) data.habits.reading = [];
        
        data.habits.reading.push({
            date: today,
            pages: pages,
            timestamp: new Date().toISOString()
        });
        
        await this.saveUserData(data);
        document.getElementById('pages-read').value = '';
        this.updateReadingStats();
        alert('Reading logged! 📚');
    },
    
    async updateReadingStats() {
        const data = await this.getUserData();
        const today = new Date().toISOString().split('T')[0];
        
        const reading = (data.habits?.reading || []);
        const todayReading = reading.filter(r => r.date === today);
        const todayPages = todayReading.reduce((sum, r) => sum + r.pages, 0);
        document.getElementById('today-pages').textContent = todayPages;
        
        // This week
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekReading = reading.filter(r => new Date(r.date) >= weekAgo);
        const weekPages = weekReading.reduce((sum, r) => sum + r.pages, 0);
        document.getElementById('week-pages').textContent = weekPages;
        
        // Total
        const totalPages = reading.reduce((sum, r) => sum + r.pages, 0);
        document.getElementById('total-pages').textContent = totalPages;
    },
    
    async addCustomHabit() {
        const habitName = document.getElementById('new-habit-name').value.trim();
        if (!habitName) {
            alert('Please enter a habit name!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data.habits) data.habits = { reading: [], custom: [] };
        if (!data.habits.custom) data.habits.custom = [];
        
        data.habits.custom.push({
            id: Date.now(),
            name: habitName,
            entries: []
        });
        
        await this.saveUserData(data);
        document.getElementById('new-habit-name').value = '';
        this.renderCustomHabits();
    },
    
    async renderCustomHabits() {
        const data = await this.getUserData();
        const container = document.getElementById('custom-habits-list');
        const habits = data.habits?.custom || [];
        
        if (habits.length === 0) {
            container.innerHTML = '';
            return;
        }
        
        container.innerHTML = habits.map(habit => {
            const today = new Date().toISOString().split('T')[0];
            const todayEntry = habit.entries.find(e => e.date === today);
            const isChecked = todayEntry ? todayEntry.completed : false;
            
            return `
                <div class="custom-habit-item">
                    <h4>${this.escapeHtml(habit.name)}</h4>
                    <input type="checkbox" class="habit-checkbox" ${isChecked ? 'checked' : ''} 
                           onchange="app.toggleHabit(${habit.id}, this.checked)">
                </div>
            `;
        }).join('');
    },
    
    async toggleHabit(habitId, completed) {
        const data = await this.getUserData();
        const habit = data.habits.custom.find(h => h.id === habitId);
        if (!habit) return;
        
        const today = new Date().toISOString().split('T')[0];
        const existingEntry = habit.entries.find(e => e.date === today);
        
        if (existingEntry) {
            existingEntry.completed = completed;
        } else {
            habit.entries.push({
                date: today,
                completed: completed,
                timestamp: new Date().toISOString()
            });
        }
        
        await this.saveUserData(data);
        this.renderCustomHabits();
    },
    
    // Feedback
    async saveReflection() {
        const reflection = document.getElementById('weekly-reflection').value.trim();
        if (!reflection) {
            alert('Please write your reflection!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data.reflections) data.reflections = [];
        
        data.reflections.push({
            text: reflection,
            date: new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString()
        });
        
        await this.saveUserData(data);
        document.getElementById('weekly-reflection').value = '';
        alert('Reflection saved! 💭');
    },
    
    async addFeedbackNote() {
        const note = document.getElementById('new-feedback').value.trim();
        if (!note) {
            alert('Please enter a feedback note!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data.feedback) data.feedback = [];
        
        data.feedback.push({
            text: note,
            timestamp: new Date().toISOString()
        });
        
        await this.saveUserData(data);
        document.getElementById('new-feedback').value = '';
        this.renderFeedbackNotes();
    },
    
    async renderFeedbackNotes() {
        const data = await this.getUserData();
        const container = document.getElementById('feedback-notes');
        const feedback = (data.feedback || []).slice().reverse();
        
        if (feedback.length === 0) {
            container.innerHTML = '<p class="empty-state">No feedback notes yet.</p>';
            return;
        }
        
        container.innerHTML = feedback.map(note => {
            const date = new Date(note.timestamp);
            const formattedDate = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `
                <div class="feedback-note">
                    <div class="note-date">${formattedDate}</div>
                    <div class="note-text">${this.escapeHtml(note.text)}</div>
                </div>
            `;
        }).join('');
    },
    
    // Admin Dashboard
    async loadStudentsList() {
        const container = document.getElementById('students-list');
        container.innerHTML = '<div class="loading-state">Loading students...</div>';
        
        try {
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
                const streak = this.calculateStreak(timeLog);
                const totalMinutes = timeLog.reduce((sum, log) => sum + log.minutes, 0);
                const uniqueDays = new Set(timeLog.map(log => log.date)).size;
                
                students.push({
                    id: userDoc.id,
                    name: userData.name || userData.username || 'Unknown',
                    username: userData.username || userData.name || 'Unknown',
                    email: userData.email || '',
                    streak: streak.current,
                    totalMinutes: totalMinutes,
                    daysActive: uniqueDays
                });
            }
            
            if (students.length === 0) {
                container.innerHTML = '<div class="empty-state">No students found. Upload a CSV file to create student accounts.</div>';
                return;
            }
            
            container.innerHTML = students.map(student => `
                <div class="student-card">
                    <div class="student-header">
                        <div>
                            <div class="student-name">${this.escapeHtml(student.name)}</div>
                            <div class="student-email">KTU ID: ${this.escapeHtml(student.username)}</div>
                        </div>
                    </div>
                    <div class="student-stats">
                        <div class="student-stat">
                            <div class="student-stat-value">${student.streak}</div>
                            <div class="student-stat-label">Day Streak</div>
                        </div>
                        <div class="student-stat">
                            <div class="student-stat-value">${student.totalMinutes}</div>
                            <div class="student-stat-label">Total Minutes</div>
                        </div>
                        <div class="student-stat">
                            <div class="student-stat-value">${student.daysActive}</div>
                            <div class="student-stat-label">Days Active</div>
                        </div>
                        <div class="student-stat">
                            <div class="student-stat-value">${Math.floor(student.totalMinutes / 60)}</div>
                            <div class="student-stat-label">Total Hours</div>
                        </div>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            container.innerHTML = `<div class="error-message">Error loading students: ${error.message}</div>`;
        }
    },
    
    // Utility
    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

// Search functionality for admin dashboard
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-students');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('.student-card').forEach(card => {
                const name = card.querySelector('.student-name').textContent.toLowerCase();
                const email = card.querySelector('.student-email').textContent.toLowerCase();
                if (name.includes(searchTerm) || email.includes(searchTerm)) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }
});
