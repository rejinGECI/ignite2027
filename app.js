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

// Sound utility functions
const SoundManager = {
    playSound: function(frequency, duration, type = 'sine') {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = frequency;
            oscillator.type = type;
            
            gainNode.gain.setValueAtTime(0.8, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration);
        } catch (e) {
            console.warn('Could not play sound:', e);
        }
    },
    
    playStartSound: function() {
        // Distinct upbeat sound for start - higher pitch, quick
        this.playSound(523.25, 0.2, 'sine'); // C
        setTimeout(() => this.playSound(659.25, 0.2, 'sine'), 100); // E
        setTimeout(() => this.playSound(783.99, 0.2, 'sine'), 200); // G
    },
    
    playPauseSound: function() {
        // Distinct pause sound - medium pitch, single tone
        this.playSound(392, 0.3, 'square'); // G
    },
    
    playStopSound: function() {
        // Distinct stop sound - lower descending tone
        this.playSound(440, 0.2, 'sine'); // A
        setTimeout(() => this.playSound(349.23, 0.3, 'sine'), 150); // F
    },
    
    playCompleteSound: function() {
        // Distinct completion sound - triumphant ascending melody
        this.playSound(523.25, 0.25, 'sine'); // C
        setTimeout(() => this.playSound(659.25, 0.25, 'sine'), 150); // E
        setTimeout(() => this.playSound(783.99, 0.3, 'sine'), 300); // G
        setTimeout(() => this.playSound(987.77, 0.3, 'sine'), 450); // B
        setTimeout(() => this.playSound(1046.50, 0.4, 'sine'), 600); // C (high)
    }
};

// Application State
// Define app object first, then make it global
const app = {
    currentUser: null,
    userRole: null,
    isAdmin: false,
    isGuide: false,
    filteredByAttention: false,
    allProgressStudents: null,
    currentEditingMembers: [],
    isCreatingGuide: false,
    timer: {
        duration: 20 * 60, // 20 minutes (1200 seconds)
        remaining: 20 * 60,
        interval: null,
        isRunning: false,
        isPaused: false
    },
    
    init: function() {
        console.log('🚀 App initializing...');
        
        // Don't show login immediately - wait for auth check
        // This prevents showing login screen on refresh if user is already authenticated
        this.setupNavigation();
        this.setupAllButtonListeners(); // Simple direct event listeners
        this.checkAuthState();
        
        // Initially hide both login and app container until auth state is determined
        const loginPage = document.getElementById('login-page');
        const appContainer = document.getElementById('app-container');
        if (loginPage) loginPage.style.display = 'none';
        if (appContainer) appContainer.style.display = 'none';
        
        console.log('✅ App initialization complete');
    },
    
    // Setup all buttons using event delegation on document.body - works even if buttons are hidden
    setupAllButtonListeners: function() {
        // Prevent duplicate setup
        if (this._buttonListenersSetup) {
            return;
        }
        this._buttonListenersSetup = true;
        
        const self = this;
        
        // Button handlers by ID - add all button IDs here
        const buttonHandlers = {
            'start-timer': () => this.startTimer(),
            'pause-timer': () => this.pauseTimer(),
            'stop-timer': () => this.stopTimer(),
            'start-today-session': () => this.showPage('progress'),
            'save-activity-btn': () => this.saveActivity(),
            'login-btn': () => this.login()
        };
        
        // Also handle buttons by their onclick content (for buttons without IDs)
        const onclickHandlers = {
            'app.saveDreams()': () => this.saveDreams(),
            'app.saveReading()': () => this.saveReading(),
            'app.addCustomHabit()': () => this.addCustomHabit(),
            'app.saveReflection()': () => this.saveReflection(),
            'app.addFeedbackNote()': () => this.addFeedbackNote(),
            'app.logout()': () => this.logout(),
            'app.addEvaluationStage()': () => this.addEvaluationStage(),
            'app.createGuideAccount()': () => this.createGuideAccount(),
            'app.showCreateGroupModal()': () => this.showCreateGroupModal(),
            'app.saveGoLiveDate()': () => this.saveGoLiveDate(),
            'app.closeEditGroupModal()': () => this.closeEditGroupModal(),
            'app.addMemberToGroup()': () => this.addMemberToGroup()
        };
        
        // Event handler for all button clicks/touches - works like navbar
        const handleButtonClick = (e) => {
            // Find the button element (might be target or parent if icon was clicked)
            let target = e.target;
            
            // If clicked on icon or span inside button, find the button
            if (target.tagName === 'I' || (target.tagName === 'SPAN' && target.parentElement)) {
                const button = target.closest('button') || target.closest('a.btn') || target.closest('a[onclick]');
                if (button) {
                    target = button;
                }
            }
            
            // Check if it's a button or link with btn class or onclick
            const isButton = target.tagName === 'BUTTON';
            const isButtonLink = target.tagName === 'A' && (target.classList.contains('btn') || target.hasAttribute('onclick'));
            const hasOnclick = target.hasAttribute('onclick');
            
            if (!isButton && !isButtonLink && !hasOnclick) {
                return; // Not a button
            }
            
            // Skip if disabled
            if (target.disabled || target.classList.contains('disabled')) {
                return;
            }
            
            e.preventDefault();
            e.stopPropagation();
            
            // Handle by ID first
            const buttonId = target.id;
            if (buttonId && buttonHandlers[buttonId]) {
                buttonHandlers[buttonId]();
                return;
            }
            
            // Handle by onclick attribute (check both onclick and data-onclick)
            const onclick = target.getAttribute('onclick') || target.getAttribute('data-onclick');
            if (onclick && onclick.includes('app.')) {
                // First try exact match in onclickHandlers
                const trimmedOnclick = onclick.trim();
                if (onclickHandlers[trimmedOnclick]) {
                    onclickHandlers[trimmedOnclick]();
                    return;
                }
                
                // Then try parsing the function call
                const match = onclick.match(/app\.(\w+)(?:\(([^)]*)\))?/);
                if (match && this[match[1]]) {
                    const funcName = match[1];
                    const params = match[2] ? match[2].split(',').map(p => {
                        p = p.trim().replace(/['"]/g, '');
                        if (p === 'true') return true;
                        if (p === 'false') return false;
                        if (!isNaN(p)) return Number(p);
                        return p;
                    }) : [];
                    
                    try {
                        if (params.length > 0) {
                            this[funcName](...params);
                        } else {
                            this[funcName]();
                        }
                    } catch (error) {
                        console.error('Error calling button handler:', error);
                    }
                }
            }
        };
        
        // Store onclick info in data attribute before removing (so event delegation can use it)
        document.querySelectorAll('button[onclick], a[onclick]').forEach(element => {
            const onclick = element.getAttribute('onclick');
            if (onclick) {
                // Store the onclick in a data attribute before removing
                element.setAttribute('data-onclick', onclick);
                element.removeAttribute('onclick');
            }
        });
        
        // Add event listeners to document.body - always exists, catches all button clicks
        // Don't use capture phase - use bubble phase like navbar does
        document.body.addEventListener('click', handleButtonClick, { passive: false });
        document.body.addEventListener('touchend', handleButtonClick, { passive: false });
    },
    
    // Authentication
    checkAuthState: function() {
        // Check Firebase auth for all users (admin and students)
        // Only check if Firebase is initialized
        if (window.firebaseAuth) {
            onAuthStateChanged(window.firebaseAuth, async (user) => {
                // Prevent navigation when creating a guide account
                if (this.isCreatingGuide) {
                    return;
                }
                
                if (user) {
                    this.currentUser = user;
                    await this.loadUserData();
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
            const userData = userDoc.data();
            this.userRole = userData.role || 'student';
            this.isAdmin = this.userRole === 'admin';
            this.isGuide = this.userRole === 'guide';
            
            // Display user name and KTU ID in navbar (for students only)
            if (!this.isAdmin && this.userRole === 'student') {
                const userName = userData.name || userData.username || 'Student';
                const userKtuid = userData.username || '';
                
                const userInfoDiv = document.getElementById('user-info');
                const userNameDisplay = document.getElementById('user-name-display');
                const userKtuidDisplay = document.getElementById('user-ktuid-display');
                
                if (userInfoDiv && userNameDisplay && userKtuidDisplay) {
                    userNameDisplay.textContent = userName;
                    userKtuidDisplay.textContent = userKtuid ? `KTU ID: ${userKtuid}` : '';
                    userInfoDiv.style.display = 'flex';
                }
            } else if (this.isAdmin) {
                // Hide user info for admin
                const userInfoDiv = document.getElementById('user-info');
                if (userInfoDiv) {
                    userInfoDiv.style.display = 'none';
                }
                
                // Load students list for admin
                await this.loadStudentsList();
            }
        }
        
        // Only load student-specific data if not admin
        if (!this.isAdmin) {
        await this.updateDashboard();
        await this.updateStatistics();
        this.renderCalendar();
        this.renderRecentActivities();
        this.renderTodayActivities();
        this.renderFeedbackNotes();
        this.renderCustomHabits();
        await this.loadDreams();
        }
    },
    
    showLogin: function() {
        document.getElementById('login-page').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
        
        // Setup login button when login page is shown (important for mobile)
        setTimeout(() => {
            this.setupAllButtonListeners();
        }, 50);
    },
    
    showApp: async function() {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        // Setup all buttons again after app is shown (in case they weren't available during init)
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
            this.setupAllButtonListeners();
        }, 100);
        
        // Update mini project visibility
        await this.updateMiniProjectVisibility();
        
        // Show/hide navigation based on user role
        if (this.isAdmin || this.userRole === 'admin') {
            // Admin: Show admin menus, hide all student menus
            document.getElementById('admin-dash-nav').style.display = 'block';
            const progressNav = document.getElementById('admin-progress-nav');
            if (progressNav) {
                progressNav.style.display = 'block';
            }
            // Hide all student navigation items
            document.querySelectorAll('.student-nav').forEach(nav => {
                nav.style.display = 'none';
            });
            
            // Show mini project navigation for admin (always visible for admin)
            const adminMiniProjectNav = document.getElementById('admin-miniproject-nav');
            if (adminMiniProjectNav) {
                adminMiniProjectNav.style.display = 'block';
            }
            const adminMiniProjectSettingsNav = document.getElementById('admin-miniproject-settings-nav');
            if (adminMiniProjectSettingsNav) {
                adminMiniProjectSettingsNav.style.display = 'block';
            }
            const adminSettingsNav = document.getElementById('admin-settings-nav');
            if (adminSettingsNav) {
                adminSettingsNav.style.display = 'block';
            }
            
            // Hide guide navigation
            const guideNav = document.getElementById('guide-dashboard-nav');
            if (guideNav) {
                guideNav.style.display = 'none';
            }
            
            // Restore saved page or default to admin progress (home page)
            const savedPage = localStorage.getItem('currentPage');
            // Only use saved page if it's a valid admin page, otherwise default to progress
            const validAdminPages = ['admin-progress', 'admin-dashboard', 'admin-miniproject', 'admin-miniproject-settings'];
            const defaultPage = (savedPage && validAdminPages.includes(savedPage)) ? savedPage : 'admin-progress';
            
            // Make Progress nav active by default or saved page
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('data-page') === defaultPage) {
                    link.classList.add('active');
                }
            });
            
            // Ensure the correct page is shown - always call showPage to load data
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            // Always call showPage to ensure data is loaded - it will handle page visibility
            await this.showPage(defaultPage || 'admin-progress');
        } else if (this.userRole === 'guide') {
            // Guide: Show guide menu, hide admin and student menus
            document.getElementById('admin-dash-nav').style.display = 'none';
            const progressNav = document.getElementById('admin-progress-nav');
            if (progressNav) {
                progressNav.style.display = 'none';
            }
            // Hide all admin navigation items
            const adminMiniProjectNav = document.getElementById('admin-miniproject-nav');
            if (adminMiniProjectNav) {
                adminMiniProjectNav.style.display = 'none';
            }
            const adminMiniProjectSettingsNav = document.getElementById('admin-miniproject-settings-nav');
            if (adminMiniProjectSettingsNav) {
                adminMiniProjectSettingsNav.style.display = 'none';
            }
            const adminSettingsNav = document.getElementById('admin-settings-nav');
            if (adminSettingsNav) {
                adminSettingsNav.style.display = 'none';
            }
            document.querySelectorAll('.student-nav').forEach(nav => {
                nav.style.display = 'none';
            });
            
            const guideNav = document.getElementById('guide-dashboard-nav');
            if (guideNav) {
                guideNav.style.display = 'block';
            }
            
            // Hide user info for guide
            const userInfoDiv = document.getElementById('user-info');
            if (userInfoDiv) {
                userInfoDiv.style.display = 'none';
            }
            
            // Default to guide dashboard
            const savedPage = localStorage.getItem('currentPage');
            const defaultPage = savedPage || 'guide-dashboard';
            
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('data-page') === defaultPage) {
                    link.classList.add('active');
                }
            });
            
            // Always call showPage to ensure data is loaded - it will handle page visibility
            await this.showPage(defaultPage || 'guide-dashboard');
        } else {
            // Student: Hide admin menus, show all student menus
            document.getElementById('admin-dash-nav').style.display = 'none';
            const progressNav = document.getElementById('admin-progress-nav');
            if (progressNav) {
                progressNav.style.display = 'none';
            }
            // Hide all admin navigation items
            const adminMiniProjectNav = document.getElementById('admin-miniproject-nav');
            if (adminMiniProjectNav) {
                adminMiniProjectNav.style.display = 'none';
            }
            const adminMiniProjectSettingsNav = document.getElementById('admin-miniproject-settings-nav');
            if (adminMiniProjectSettingsNav) {
                adminMiniProjectSettingsNav.style.display = 'none';
            }
            const adminSettingsNav = document.getElementById('admin-settings-nav');
            if (adminSettingsNav) {
                adminSettingsNav.style.display = 'none';
            }
            // Show all student navigation items
            document.querySelectorAll('.student-nav').forEach(nav => {
                nav.style.display = 'block';
            });
            
            // Hide guide navigation
            const guideNav = document.getElementById('guide-dashboard-nav');
            if (guideNav) {
                guideNav.style.display = 'none';
            }
            
            // Restore saved page or default to dashboard
            const savedPage = localStorage.getItem('currentPage');
            const defaultPage = savedPage || 'dashboard';
            
            // Always call showPage to ensure data is loaded - it will handle page visibility
            await this.showPage(defaultPage || 'dashboard');
        }
    },
    
    async login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errorDiv = document.getElementById('login-error');
        
        errorDiv.textContent = '';
        
        if (!window.firebaseAuth) {
            errorDiv.textContent = 'Firebase is not initialized. Please check your configuration.';
            return;
        }
        
        try {
            let email, userCredential;
            
            // Try admin login first (admin@admin.local format)
            if (username.includes('@')) {
                // If username contains @, treat as email (for admin accounts)
                email = username;
            } else {
                // Otherwise, try as student (ktuid format)
                email = `${username}@student.local`;
            }
            
            // Attempt Firebase authentication
            userCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, password);
            
            // After successful login, check user role
            if (userCredential && userCredential.user) {
                this.currentUser = userCredential.user;
                const userDoc = await getDoc(doc(window.firebaseDb, 'users', userCredential.user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    this.userRole = userData.role || 'student';
                    this.isAdmin = this.userRole === 'admin';
                    
                    // Show app first
                    this.showApp();
                    
                    // Navigate to appropriate page and load data
                    if (this.isAdmin) {
                        // Show admin progress page (home page) and load data
                        this.showPage('admin-progress');
                    } else {
                        // Load student data
                        await this.loadUserData();
                    }
                }
            }
        } catch (error) {
            console.error('Login error:', error);
            
            // Provide user-friendly error messages
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                errorDiv.innerHTML = `
                    <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-top: 8px;">
                        <strong style="color: #991b1b;">⚠️ Invalid Credentials</strong><br>
                        <p style="margin: 8px 0; color: #7f1d1d; font-size: 0.9rem;">
                            The username or password you entered is incorrect. Please check your credentials and try again.
                        </p>
                    </div>
                `;
            } else if (error.code === 'auth/invalid-email') {
                errorDiv.innerHTML = `
                    <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-top: 8px;">
                        <strong style="color: #991b1b;">⚠️ Invalid Email Format</strong><br>
                        <p style="margin: 8px 0; color: #7f1d1d; font-size: 0.9rem;">
                            Please enter a valid email address or username.
                        </p>
                    </div>
                `;
            } else {
                errorDiv.textContent = `Login failed: ${error.message || 'Invalid username or password'}`;
            }
        }
    },
    
    async logout() {
        if (this.currentUser) {
            await signOut(window.firebaseAuth);
        }
        
        // Clear saved page state on logout
        localStorage.removeItem('currentPage');
        
        this.currentUser = null;
        this.isAdmin = false;
        this.userRole = null;
        this.showLogin();
    },
    
    // Setup CSV Upload Handler
    setupCSVUpload: function() {
        const csvInput = document.getElementById('csv-file-input');
        
        if (csvInput && !csvInput.hasAttribute('data-listener-attached')) {
            // Add change event listener to input
            csvInput.addEventListener('change', (event) => {
                if (event.target.files && event.target.files.length > 0) {
                    this.handleCSVUpload(event);
                }
            });
            csvInput.setAttribute('data-listener-attached', 'true');
        }
    },
    
    // CSV Upload for Admin
    async handleCSVUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            console.warn('No file selected');
            return;
        }
        
        console.log('CSV file selected:', file.name);
        
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
            
            for (const line of lines) {
                try {
                    // Parse CSV line: format can be "name,ktuid" or just "ktuid" (backward compatible)
                    let name, ktuid;
                    if (line.includes(',')) {
                        const parts = line.split(',').map(part => part.trim());
                        name = parts[0];
                        ktuid = parts[1] || parts[0]; // If only one part after comma, use it as ktuid
                    } else {
                        // Backward compatible: if no comma, treat entire line as ktuid
                        ktuid = line;
                        name = line; // Use ktuid as name if no name provided
                    }
                    
                    if (!ktuid || ktuid.length === 0) {
                        throw new Error('KTU ID is required');
                    }
                    
                    await this.createStudentAccount(ktuid, name);
                    successCount++;
                } catch (error) {
                    errorCount++;
                    errors.push(`${line}: ${error.message}`);
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
    
    // Create Admin Account
    async createAdminAccount(email, password, adminName) {
        // Check if Firebase Auth is initialized
        if (!window.firebaseAuth) {
            throw new Error('Firebase Authentication is not initialized. Please check your Firebase configuration.');
        }
        
        if (!window.firebaseDb) {
            throw new Error('Firebase Firestore is not initialized. Please check your Firebase configuration.');
        }
        
        try {
            // Create Firebase auth user
            const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, password);
            const user = userCredential.user;
            
            // Create user document with admin role
            await setDoc(doc(window.firebaseDb, 'users', user.uid), {
                name: adminName,
                email: email,
                username: email.split('@')[0], // Use email prefix as username
                role: 'admin',
                createdAt: new Date().toISOString()
            });
            
            console.log('✅ Admin account created successfully!');
            console.log('You can now log in with:', email);
            return user;
        } catch (error) {
            if (error.code === 'auth/email-already-in-use') {
                // Account exists, try to update it to admin
                console.log('Account already exists. Updating to admin role...');
                try {
                    // Sign in to get the user
                    const signInCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, password);
                    const user = signInCredential.user;
                    
                    // Update user document to admin role
                    await setDoc(doc(window.firebaseDb, 'users', user.uid), {
                        name: adminName,
                        email: email,
                        username: email.split('@')[0],
                        role: 'admin',
                        createdAt: new Date().toISOString()
                    }, { merge: true });
                    
                    // Sign out after updating
                    await signOut(window.firebaseAuth);
                    
                    console.log('✅ Existing account updated to admin role!');
                    console.log('You can now log in with:', email);
                    return user;
                } catch (updateError) {
                    throw new Error(`Account exists but couldn't update: ${updateError.message}. Try logging in - the account may already be an admin.`);
                }
            }
            throw error;
        }
    },
    
    // Helper function to make existing user an admin
    async makeUserAdmin(email, password) {
        if (!window.firebaseAuth || !window.firebaseDb) {
            throw new Error('Firebase is not initialized.');
        }
        
        try {
            // Sign in to get the user
            const userCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, password);
            const user = userCredential.user;
            
            // Update user document to admin role
            await setDoc(doc(window.firebaseDb, 'users', user.uid), {
                role: 'admin'
            }, { merge: true });
            
            // Sign out after updating
            await signOut(window.firebaseAuth);
            
            console.log('✅ User updated to admin role!');
            console.log('You can now log in with:', email);
            return user;
        } catch (error) {
            throw new Error(`Failed to update user: ${error.message}`);
        }
    },
    
    async createStudentAccount(ktuid, studentName = null) {
        // Check if Firebase Auth is initialized
        if (!window.firebaseAuth) {
            throw new Error('Firebase Authentication is not initialized. Please check your Firebase configuration.');
        }
        
        if (!window.firebaseDb) {
            throw new Error('Firebase Firestore is not initialized. Please check your Firebase configuration.');
        }
        
        const email = `${ktuid}@student.local`;
        const password = `ignite_${ktuid}`;
        // Use provided name or fallback to ktuid
        const name = studentName || ktuid;
        
        try {
            // Try to create user
            const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, password);
            const user = userCredential.user;
            
            // Create user document
            await setDoc(doc(window.firebaseDb, 'users', user.uid), {
                name: name,
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
                habits: { reading: [], custom: [], books: [] },
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
            // Remove onclick if present
            if (link.hasAttribute('onclick')) {
                link.removeAttribute('onclick');
            }
            
            const handleNavClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const page = link.getAttribute('data-page');
                if (page) {
                this.showPage(page);
                // Close mobile menu after navigation
                this.closeMobileMenu();
                }
            };
            
            // Add both click and touch events for mobile support
            link.addEventListener('click', handleNavClick, { passive: false });
            link.addEventListener('touchend', handleNavClick, { passive: false });
        });

        // Mobile menu toggle
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const navbar = document.getElementById('navbar');
        
        if (mobileMenuToggle && navbar) {
            const handleToggle = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleMobileMenu();
            };
            
            // Add both click and touch events
            mobileMenuToggle.addEventListener('click', handleToggle, { passive: false });
            mobileMenuToggle.addEventListener('touchend', handleToggle, { passive: false });

            // Close menu when clicking backdrop or outside
            const backdrop = document.getElementById('mobile-menu-backdrop');
            if (backdrop) {
                const handleBackdropClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeMobileMenu();
                };
                
                backdrop.addEventListener('click', handleBackdropClick, { passive: false });
                backdrop.addEventListener('touchend', handleBackdropClick, { passive: false });
            }
            
            // Handle outside clicks/touches
            const handleOutsideClick = (e) => {
                if (navbar.classList.contains('mobile-open') && 
                    !navbar.contains(e.target) && 
                    !mobileMenuToggle.contains(e.target) &&
                    !(backdrop && backdrop.contains(e.target))) {
                    this.closeMobileMenu();
                }
            };
            
            document.addEventListener('click', handleOutsideClick);
            document.addEventListener('touchend', handleOutsideClick);

            // Close menu on window resize (if resizing to desktop)
            window.addEventListener('resize', () => {
                if (window.innerWidth > 768) {
                    this.closeMobileMenu();
                }
            });
        }
    },

    toggleMobileMenu: function() {
        const navbar = document.getElementById('navbar');
        const toggle = document.getElementById('mobile-menu-toggle');
        const backdrop = document.getElementById('mobile-menu-backdrop');
        if (navbar && toggle) {
            navbar.classList.toggle('mobile-open');
            const icon = toggle.querySelector('i');
            if (icon) {
                if (navbar.classList.contains('mobile-open')) {
                    icon.classList.remove('fa-bars');
                    icon.classList.add('fa-times');
                    if (backdrop) backdrop.classList.add('active');
                    document.body.classList.add('mobile-menu-open');
                } else {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                    if (backdrop) backdrop.classList.remove('active');
                    document.body.classList.remove('mobile-menu-open');
                }
            }
        }
    },

    closeMobileMenu: function() {
        const navbar = document.getElementById('navbar');
        const toggle = document.getElementById('mobile-menu-toggle');
        const backdrop = document.getElementById('mobile-menu-backdrop');
        if (navbar && toggle) {
            navbar.classList.remove('mobile-open');
            const icon = toggle.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
            if (backdrop) backdrop.classList.remove('active');
            document.body.classList.remove('mobile-menu-open');
        }
    },
    
    showPageLoader: function(pageId, show = true) {
        const page = document.getElementById(pageId);
        if (!page) return;
        
        let loader = page.querySelector('.page-loader');
        
        if (show) {
            if (!loader) {
                // Create loader if it doesn't exist
                loader = document.createElement('div');
                loader.className = 'page-loader';
                loader.innerHTML = `
                    <div class="page-loader-content">
                        <div class="spinner-enhanced">
                            <div class="spinner-dot"></div>
                        </div>
                        <div class="page-loader-text">Loading...</div>
                    </div>
                `;
                page.appendChild(loader);
            } else {
                loader.classList.remove('hidden');
            }
        } else {
            if (loader) {
                // Fade out then hide
                loader.classList.add('hidden');
                setTimeout(() => {
                    if (loader && loader.parentNode) {
                        loader.remove();
                    }
                }, 300);
            }
        }
    },
    
    showPage: async function(pageId) {
        try {
            // Prevent non-admins from accessing admin pages
            const adminPages = ['admin-dashboard', 'admin-progress', 'admin-miniproject', 'admin-miniproject-settings', 'admin-settings'];
            if (adminPages.includes(pageId) && !this.isAdmin && this.userRole !== 'admin') {
                console.warn('Access denied: Admin pages require admin privileges');
                // Redirect to appropriate page
                if (this.userRole === 'guide') {
                    await this.showPage('guide-dashboard');
                } else {
                    await this.showPage('dashboard');
                }
                return;
            }
            
            // Save current page to localStorage for restoration on refresh
            localStorage.setItem('currentPage', pageId);
            
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
                // Hide any existing loaders
                this.showPageLoader(page.id, false);
        });
        
            // Show selected page FIRST - ensure it's visible even if data loading fails
        const page = document.getElementById(pageId);
        if (page) {
            page.classList.add('active');
                // Show loading animation
                this.showPageLoader(pageId, true);
                
                // Setup buttons for the newly shown page (important for mobile)
                setTimeout(() => {
                    this.setupAllButtonListeners();
                }, 100);
        }
        
        // Update active nav link
        document.querySelectorAll('.nav-link[data-page]').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-page') === pageId) {
                link.classList.add('active');
            }
        });
        
            // Update page-specific data with error handling
            try {
        if (pageId === 'stats') {
                    await this.updateStatistics();
                    await this.renderCalendar();
                    await this.renderDailySessions();
        } else if (pageId === 'progress') {
            this.renderTodayActivities();
        } else if (pageId === 'habits') {
                    await this.loadBookDropdown();
            this.updateReadingStats();
                    await this.renderCustomHabits();
                } else if (pageId === 'admin-miniproject-settings') {
                    await this.loadMiniProjectSettings();
                } else if (pageId === 'admin-settings') {
                    await this.loadAdminSettings();
                } else if (pageId === 'admin-miniproject') {
                    await this.loadGuidesList();
                    await this.loadProjectGroups();
                } else if (pageId === 'guide-dashboard') {
                    await this.loadGuideDashboard();
                } else if (pageId === 'miniproject') {
                    await this.loadStudentMiniProject();
        } else if (pageId === 'admin-dashboard') {
            // Load students list and setup CSV upload for admin dashboard
                    await this.loadStudentsList();
                    await this.loadAllStudentFeedback();
            this.setupCSVUpload();
        } else if (pageId === 'admin-progress') {
            // Load detailed student progress
            this.loadStudentProgress();
            this.setupProgressSearch();
                } else if (pageId === 'dashboard') {
                    // Dashboard - already loads in loadUserData, but ensure loader is hidden
                    // Setup timer buttons for mobile compatibility
                    this.setupAllButtonListeners();
                } else if (pageId === 'dreams') {
                    // Dreams page - data already loaded, just hide loader
                } else if (pageId === 'feedback') {
                    // Feedback page - data already loaded, just hide loader
                }
                
                // Hide loading animation after data is loaded (with small delay for smooth transition)
                setTimeout(() => {
                    this.showPageLoader(pageId, false);
                }, 100);
            } catch (error) {
                console.error(`Error loading data for page ${pageId}:`, error);
                // Hide loading animation on error
                this.showPageLoader(pageId, false);
                // Page is already visible, but show error message if container exists
                const container = document.querySelector(`#${pageId} .loading-state, #${pageId} .empty-state`);
                if (container) {
                    container.innerHTML = '<p class="error-message">Error loading data. Please refresh the page.</p>';
                }
            }
        } catch (error) {
            console.error(`Error showing page ${pageId}:`, error);
            // Hide loading animation on error
            this.showPageLoader(pageId, false);
            // Ensure app container is visible even on error
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.style.display = 'flex';
            }
        }
    },
    
    // Timer Functions
    startTimer: function() {
        if (!this.timer.isRunning) {
            this.timer.isRunning = true;
            this.timer.isPaused = false;
            
            // Play start sound
            SoundManager.playStartSound();
            
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
            
            // Disable save activity button when timer starts
            const saveActivityBtn = document.getElementById('save-activity-btn');
            if (saveActivityBtn) {
                saveActivityBtn.disabled = true;
            }
        }
    },
    
    pauseTimer: function() {
        if (this.timer.isRunning) {
            clearInterval(this.timer.interval);
            this.timer.isRunning = false;
            this.timer.isPaused = true;
            
            // Play pause sound
            SoundManager.playPauseSound();
            
            document.getElementById('start-timer').style.display = 'inline-flex';
            document.getElementById('pause-timer').style.display = 'none';
        }
    },
    
    stopTimer: async function() {
        clearInterval(this.timer.interval);
        this.timer.isRunning = false;
        this.timer.isPaused = false;
        
        // Play stop sound
        SoundManager.playStopSound();
        
        // Calculate minutes spent
        const secondsSpent = this.timer.duration - this.timer.remaining;
        if (secondsSpent > 0 && !this.isAdmin) {
            // Convert seconds to minutes and record (round to nearest minute)
            const minutesSpent = Math.round(secondsSpent / 60);
            if (minutesSpent > 0) {
                await this.recordTime(minutesSpent);
            }
        }
        
        this.timer.remaining = this.timer.duration;
        this.updateTimerDisplay();
        
        document.getElementById('start-timer').style.display = 'inline-flex';
        document.getElementById('pause-timer').style.display = 'none';
        document.getElementById('stop-timer').style.display = 'none';
        
        // Keep save activity button disabled when timer is stopped (not completed)
        const saveActivityBtn = document.getElementById('save-activity-btn');
        if (saveActivityBtn) {
            saveActivityBtn.disabled = true;
        }
    },
    
    completeTimer: async function() {
        clearInterval(this.timer.interval);
        this.timer.isRunning = false;
        this.timer.isPaused = false;
        if (!this.isAdmin) {
            // Record 20 minutes when timer completes
            await this.recordTime(20);
            
            // Automatically record timer completion as an activity
            await this.recordTimerCompletion();
        }
        this.timer.remaining = this.timer.duration;
        this.updateTimerDisplay();
        
        // Play completion sound
        SoundManager.playCompleteSound();
        
        document.getElementById('start-timer').style.display = 'inline-flex';
        document.getElementById('pause-timer').style.display = 'none';
        document.getElementById('stop-timer').style.display = 'none';
        
        // Enable save activity button after timer completion
        const saveActivityBtn = document.getElementById('save-activity-btn');
        if (saveActivityBtn) {
            saveActivityBtn.disabled = false;
        }
        
        if (!this.isAdmin) {
            alert('🎉 Great job! You completed your session!');
        }
    },
    
    async recordTimerCompletion() {
        const data = await this.getUserData();
        if (!data) return;
        
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Create activity entry for timer completion
        data.activities = data.activities || [];
        data.activities.push({
            date: today,
            text: `⏱️ Timer session completed at ${timeStr}`,
            timestamp: now.toISOString()
        });
        
        await this.saveUserData(data);
        await this.renderTodayActivities();
        await this.renderRecentActivities();
        await this.updateDashboard();
        await this.renderDailySessions(); // Update daily sessions in statistics
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
        if (!data) return;
        
        data.dreams = {
            career: document.getElementById('dream-career').value,
            places: document.getElementById('places-visit').value,
            things: document.getElementById('things-do').value,
            plan: document.getElementById('action-plan').value,
            lastUpdated: new Date().toISOString()
        };
        await this.saveUserData(data);
        
        // Update dream life inspiration on all pages
        this.displayDreamLifeInspiration(data.dreams.career || '');
        
        alert('Dreams and plans saved successfully! ✨');
    },
    
    async loadDreams() {
        const data = await this.getUserData();
        if (!data || !data.dreams) return;
        
        {
            document.getElementById('dream-career').value = data.dreams.career || '';
            document.getElementById('places-visit').value = data.dreams.places || '';
            document.getElementById('things-do').value = data.dreams.things || '';
            document.getElementById('action-plan').value = data.dreams.plan || '';
        }
        
        // Display dream life content on all pages for inspiration
        this.displayDreamLifeInspiration(data.dreams.career || '');
    },
    
    displayDreamLifeInspiration: function(dreamLifeText) {
        if (!dreamLifeText || dreamLifeText.trim() === '') {
            // Hide all inspiration cards if no dream life content
            document.querySelectorAll('.dream-life-inspiration-card').forEach(card => {
                card.style.display = 'none';
            });
            return;
        }
        
        // Truncate if too long (show first 200 characters)
        const displayText = dreamLifeText.length > 200 
            ? dreamLifeText.substring(0, 200) + '...' 
            : dreamLifeText;
        
        // Update all inspiration cards on all pages
        const inspirationIds = [
            'dream-life-content',
            'dream-life-content-progress',
            'dream-life-content-stats',
            'dream-life-content-habits',
            'dream-life-content-feedback'
        ];
        
        const cardIds = [
            'dream-life-inspiration',
            'dream-life-inspiration-progress',
            'dream-life-inspiration-stats',
            'dream-life-inspiration-habits',
            'dream-life-inspiration-feedback'
        ];
        
        inspirationIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = displayText;
            }
        });
        
        cardIds.forEach(id => {
            const card = document.getElementById(id);
            if (card) {
                card.style.display = 'block';
            }
        });
    },
    
    // Activities
    async saveActivity() {
        const saveActivityBtn = document.getElementById('save-activity-btn');
        if (saveActivityBtn && saveActivityBtn.disabled) {
            return; // Don't allow saving if button is disabled
        }
        
        const activityText = document.getElementById('activity-log').value.trim();
        if (!activityText) {
            alert('Please describe what you did today!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data) return;
        
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
        
        // Disable button again after saving - must complete timer again to enable
        if (saveActivityBtn) {
            saveActivityBtn.disabled = true;
        }
    },
    
    async recordTime(minutes) {
        const data = await this.getUserData();
        if (!data) return;
        
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
        if (!data) return;
        
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
        if (!data) return;
        
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
        if (!data) return;
        
        const timeLog = data.timeLog || [];
        
        // Filter timeLog by go-live date
        const goLiveDate = await this.getGoLiveDate();
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
        const streak = await this.calculateStreak(timeLog);
        document.getElementById('current-streak').textContent = streak.current;
        
        // Calculate total minutes (from filtered logs)
        const totalMinutes = filteredTimeLog.reduce((sum, log) => sum + log.minutes, 0);
        document.getElementById('total-minutes').textContent = totalMinutes;
        
        // Calculate total days (from filtered logs)
        const uniqueDays = new Set(filteredTimeLog.map(log => log.date)).size;
        document.getElementById('total-days').textContent = uniqueDays;
        
        // Calculate completion rate (based on 20 min goal)
        const today = new Date().toISOString().split('T')[0];
        const todayLog = filteredTimeLog.find(log => log.date === today);
        const todayMinutes = todayLog ? todayLog.minutes : 0;
        // For testing: completion rate based on 1 minute goal (change to 20 minutes for production)
        const completionRate = Math.min(100, Math.round((todayMinutes / 1) * 100));
        document.getElementById('completion-rate').textContent = `${completionRate}%`;
        
        // Today's progress
        // For testing: progress based on 1 minute goal (change to 20 minutes for production)
        const progressPercent = Math.min(100, (todayMinutes / 1) * 100);
        document.getElementById('today-progress').style.width = `${progressPercent}%`;
        document.getElementById('today-minutes').textContent = `${todayMinutes} / 20 minutes`;
    },
    
    async updateStatistics() {
        if (this.isAdmin) return;
        const data = await this.getUserData();
        if (!data) return;
        
        const timeLog = data.timeLog || [];
        
        // Filter timeLog by go-live date
        const goLiveDate = await this.getGoLiveDate();
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
        
        const streak = await this.calculateStreak(timeLog);
        
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
        await this.renderDailySessions();
    },
    
    async renderDailySessions() {
        if (this.isAdmin) return;
        const data = await this.getUserData();
        if (!data) return;
        
        const activities = (data.activities || []).filter(a => a.text && a.text.includes('Timer session completed'));
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
        
        // Sort dates descending (most recent first)
        const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a));
        
        container.innerHTML = sortedDates.map(date => {
            const dateActivities = groupedByDate[date];
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: dateObj.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
            });
            
            const isToday = date === new Date().toISOString().split('T')[0];
            const dateLabel = isToday ? 'Today' : formattedDate;
            
            return `
                <div class="daily-session-group">
                    <div class="daily-session-date">
                        <strong>${dateLabel}</strong>
                        <span class="session-count">${dateActivities.length} session${dateActivities.length > 1 ? 's' : ''}</span>
                    </div>
                    <div class="daily-session-times">
                        ${dateActivities.map(activity => {
                            const time = new Date(activity.timestamp).toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            return `<span class="session-time">${time}</span>`;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');
    },
    
    calculateStreak: async function(timeLog) {
        if (timeLog.length === 0) {
            return { current: 0, longest: 0 };
        }
        
        // Get go-live date and filter logs
        const goLiveDate = await this.getGoLiveDate();
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
    
    renderCalendar: async function() {
        if (this.isAdmin) return;
        const data = await this.getUserData();
        if (!data) return;
        
        const timeLog = data.timeLog || [];
        const reading = (data.habits?.reading || []);
        
        // Filter by go-live date
        const goLiveDate = await this.getGoLiveDate();
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
        
        const container = document.getElementById('activity-calendar');
        if (!container) return;
        
        // Get last 30 days
        const days = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            days.push(date.toISOString().split('T')[0]);
        }
        
        container.innerHTML = days.map(date => {
            const log = filteredTimeLog.find(l => l.date === date);
            const isActive = log && log.minutes >= 20;
            const isPartial = log && log.minutes > 0 && log.minutes < 20;
            
            // Check if there's reading activity on this date
            const readingEntry = reading.find(r => r.date === date);
            const hasReading = readingEntry && readingEntry.pages > 0;
            const readingPages = hasReading ? readingEntry.pages : 0;
            
            const dayNum = new Date(date).getDate();
            let className = 'calendar-day';
            if (isActive) className += ' active';
            else if (isPartial) className += ' partial';
            
            // Build title with both timer and reading info
            let title = date + ': ';
            if (log) {
                title += log.minutes + ' min';
            } else {
                title += 'No timer activity';
            }
            if (hasReading) {
                title += `, ${readingPages} pages read`;
            }
            
            // Add reading icon if there's reading activity
            const readingIcon = hasReading ? '<i class="fas fa-book calendar-reading-icon" title="' + readingPages + ' pages"></i>' : '';
            
            return `<div class="${className}" title="${title}">
                <span class="calendar-day-number">${dayNum}</span>
                ${readingIcon}
            </div>`;
        }).join('');
    },
    
    // Habits
    async saveReading() {
        const pages = parseInt(document.getElementById('pages-read').value);
        if (isNaN(pages) || pages < 0) {
            alert('Please enter a valid number of pages!');
            return;
        }
        
        const bookName = document.getElementById('book-name').value.trim();
        const authorName = document.getElementById('author-name').value.trim();
        const notes = document.getElementById('reading-notes').value.trim();
        
        if (!bookName) {
            alert('Please enter a book name!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data) return;
        
        const today = new Date().toISOString().split('T')[0];
        
        if (!data.habits) data.habits = { reading: [], custom: [], books: [] };
        if (!data.habits.reading) data.habits.reading = [];
        if (!data.habits.books) data.habits.books = [];
        
        // Store book info for dropdown
        const bookKey = `${bookName}|${authorName}`.toLowerCase();
        const existingBook = data.habits.books.find(b => b.key === bookKey);
        if (!existingBook) {
            data.habits.books.push({
                key: bookKey,
                bookName: bookName,
                authorName: authorName
            });
        }
        
        data.habits.reading.push({
            date: today,
            pages: pages,
            bookName: bookName,
            authorName: authorName,
            notes: notes || '',
            timestamp: new Date().toISOString()
        });
        
        await this.saveUserData(data);
        
        // Clear form
        document.getElementById('pages-read').value = '';
        document.getElementById('book-name').value = '';
        document.getElementById('author-name').value = '';
        document.getElementById('reading-notes').value = '';
        document.getElementById('book-select').value = '';
        
        // Update dropdown and stats
        await this.loadBookDropdown();
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
        
        // Reading streak
        const readingStreak = this.calculateReadingStreak(reading);
        document.getElementById('reading-streak').textContent = readingStreak;
    },
    
    calculateReadingStreak: function(reading) {
        if (!reading || reading.length === 0) return 0;
        
        // Get unique dates and sort descending
        const uniqueDates = [...new Set(reading.map(r => r.date))].sort((a, b) => new Date(b) - new Date(a));
        
        if (uniqueDates.length === 0) return 0;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let streak = 0;
        let expectedDate = new Date(today);
        
        for (let i = 0; i < uniqueDates.length; i++) {
            const readingDate = new Date(uniqueDates[i]);
            readingDate.setHours(0, 0, 0, 0);
            
            const daysDiff = Math.floor((expectedDate - readingDate) / (1000 * 60 * 60 * 24));
            
            if (i === 0) {
                // First date - check if it's today or yesterday
                if (daysDiff === 0 || daysDiff === 1) {
                    streak = 1;
                    expectedDate = new Date(readingDate);
                    expectedDate.setDate(expectedDate.getDate() - 1);
                } else {
                    // Gap found, streak broken
                    break;
                }
            } else {
                // Check if consecutive
                if (daysDiff === 0) {
                    streak++;
                    expectedDate.setDate(expectedDate.getDate() - 1);
                } else {
                    // Gap found, streak broken
                    break;
                }
            }
        }
        
        return streak;
    },
    
    async loadBookDropdown() {
        const data = await this.getUserData();
        if (!data) return;
        
        const books = (data.habits?.books || []);
        const select = document.getElementById('book-select');
        if (!select) return;
        
        // Clear existing options except the first one
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }
        
        // Add books to dropdown
        books.forEach(book => {
            const option = document.createElement('option');
            option.value = book.key;
            option.textContent = `${book.bookName}${book.authorName ? ' by ' + book.authorName : ''}`;
            option.setAttribute('data-book-name', book.bookName);
            option.setAttribute('data-author-name', book.authorName || '');
            select.appendChild(option);
        });
    },
    
    onBookSelect() {
        const select = document.getElementById('book-select');
        if (!select || !select.value) return;
        
        const selectedOption = select.options[select.selectedIndex];
        const bookName = selectedOption.getAttribute('data-book-name');
        const authorName = selectedOption.getAttribute('data-author-name') || '';
        
        if (bookName) {
            document.getElementById('book-name').value = bookName;
            document.getElementById('author-name').value = authorName;
        }
    },
    
    async addCustomHabit() {
        const habitName = document.getElementById('new-habit-name').value.trim();
        if (!habitName) {
            alert('Please enter a habit name!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data.habits) data.habits = { reading: [], custom: [], books: [] };
        if (!data.habits.custom) data.habits.custom = [];
        
        data.habits.custom.push({
            id: Date.now(),
            name: habitName,
            entries: []
        });
        
        await this.saveUserData(data);
        document.getElementById('new-habit-name').value = '';
        await this.renderCustomHabits();
    },
    
    async renderCustomHabits() {
        const data = await this.getUserData();
        if (!data) return;
        
        const container = document.getElementById('custom-habits-list');
        if (!container) return;
        
        const habits = data.habits?.custom || [];
        
        if (habits.length === 0) {
            container.innerHTML = '<p class="empty-state">No habits yet. Add your first habit above!</p>';
            return;
        }
        
            const today = new Date().toISOString().split('T')[0];
        
        container.innerHTML = habits.map(habit => {
            const todayEntry = habit.entries.find(e => e.date === today);
            const isChecked = todayEntry ? todayEntry.completed : false;
            const minutes = todayEntry ? (todayEntry.minutes || 0) : 0;
            
            // Calculate habit stats
            const totalEntries = habit.entries.length;
            const completedEntries = habit.entries.filter(e => e.completed).length;
            const totalMinutes = habit.entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
            const completionRate = totalEntries > 0 ? Math.round((completedEntries / totalEntries) * 100) : 0;
            
            return `
                <div class="custom-habit-item">
                    <div class="habit-item-header">
                        <div class="habit-name-section">
                    <h4>${this.escapeHtml(habit.name)}</h4>
                            <div class="habit-stats-inline">
                                <span class="stat-badge">${completionRate}% complete</span>
                                <span class="stat-badge">${totalMinutes} min total</span>
                            </div>
                        </div>
                        <button class="btn-icon" onclick="app.deleteHabit(${habit.id})" title="Delete habit">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <div class="habit-item-controls">
                        <label class="habit-checkbox-label">
                    <input type="checkbox" class="habit-checkbox" ${isChecked ? 'checked' : ''} 
                           onchange="app.toggleHabit(${habit.id}, this.checked)">
                            <span>Completed Today</span>
                        </label>
                        <div class="habit-time-section">
                            <label>Time Spent (minutes):</label>
                            <input type="number" id="habit-time-${habit.id}" min="0" value="${minutes}" 
                                   placeholder="0" class="habit-time-input"
                                   onchange="app.saveHabitTime(${habit.id}, this.value)">
                            <button class="btn btn-secondary btn-sm" onclick="app.saveHabitTime(${habit.id}, document.getElementById('habit-time-${habit.id}').value)">
                                <i class="fas fa-save"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Update habit statistics
        await this.renderHabitStatistics();
    },
    
    async toggleHabit(habitId, completed) {
        const data = await this.getUserData();
        if (!data || !data.habits) return;
        
        const habit = data.habits.custom.find(h => h.id === habitId);
        if (!habit) return;
        
        const today = new Date().toISOString().split('T')[0];
        let existingEntry = habit.entries.find(e => e.date === today);
        
        if (existingEntry) {
            existingEntry.completed = completed;
        } else {
            existingEntry = {
                date: today,
                completed: completed,
                minutes: 0,
                timestamp: new Date().toISOString()
            };
            habit.entries.push(existingEntry);
        }
        
        await this.saveUserData(data);
        await this.renderCustomHabits();
    },
    
    async saveHabitTime(habitId, minutes) {
        const minutesNum = parseInt(minutes) || 0;
        if (minutesNum < 0) {
            alert('Please enter a valid number of minutes!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data || !data.habits) return;
        
        const habit = data.habits.custom.find(h => h.id === habitId);
        if (!habit) return;
        
        const today = new Date().toISOString().split('T')[0];
        let existingEntry = habit.entries.find(e => e.date === today);
        
        if (existingEntry) {
            existingEntry.minutes = minutesNum;
        } else {
            existingEntry = {
                date: today,
                completed: false,
                minutes: minutesNum,
                timestamp: new Date().toISOString()
            };
            habit.entries.push(existingEntry);
        }
        
        await this.saveUserData(data);
        await this.renderCustomHabits();
    },
    
    async deleteHabit(habitId) {
        if (!confirm('Are you sure you want to delete this habit? This action cannot be undone.')) {
            return;
        }
        
        const data = await this.getUserData();
        if (!data || !data.habits) return;
        
        data.habits.custom = data.habits.custom.filter(h => h.id !== habitId);
        await this.saveUserData(data);
        await this.renderCustomHabits();
    },
    
    async renderHabitStatistics() {
        const data = await this.getUserData();
        if (!data) return;
        
        const container = document.getElementById('habit-stats-cards');
        if (!container) return;
        
        const habits = data.habits?.custom || [];
        
        if (habits.length === 0) {
            container.innerHTML = '';
            return;
        }
        
        // Calculate overall statistics
        let totalHabits = habits.length;
        let activeHabits = 0;
        let totalTimeAll = 0;
        let totalCompletedDays = 0;
        let totalDays = 0;
        
        habits.forEach(habit => {
            const today = new Date().toISOString().split('T')[0];
            const todayEntry = habit.entries.find(e => e.date === today);
            
            if (todayEntry && (todayEntry.completed || (todayEntry.minutes && todayEntry.minutes > 0))) {
                activeHabits++;
            }
            
            const habitMinutes = habit.entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
            totalTimeAll += habitMinutes;
            
            totalCompletedDays += habit.entries.filter(e => e.completed).length;
            totalDays += habit.entries.length;
        });
        
        const avgCompletionRate = totalDays > 0 ? Math.round((totalCompletedDays / totalDays) * 100) : 0;
        const totalHours = Math.floor(totalTimeAll / 60);
        const remainingMinutes = totalTimeAll % 60;
        
        container.innerHTML = `
            <div class="stat-card habit-stat-card">
                <div class="stat-icon"><i class="fas fa-tasks"></i></div>
                <div class="stat-content">
                    <h3>${totalHabits}</h3>
                    <p>Total Habits</p>
                </div>
            </div>
            
            <div class="stat-card habit-stat-card">
                <div class="stat-icon"><i class="fas fa-check-circle"></i></div>
                <div class="stat-content">
                    <h3>${activeHabits}</h3>
                    <p>Active Today</p>
                </div>
            </div>
            
            <div class="stat-card habit-stat-card">
                <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
                <div class="stat-content">
                    <h3>${avgCompletionRate}%</h3>
                    <p>Avg. Completion</p>
                </div>
            </div>
            
            <div class="stat-card habit-stat-card">
                <div class="stat-icon"><i class="fas fa-clock"></i></div>
                <div class="stat-content">
                    <h3>${totalHours}h ${remainingMinutes}m</h3>
                    <p>Total Time</p>
                </div>
            </div>
        `;
    },
    
    // Feedback
    async saveReflection() {
        const reflection = document.getElementById('weekly-reflection').value.trim();
        if (!reflection) {
            alert('Please write your reflection!');
            return;
        }
        
        const data = await this.getUserData();
        if (!data) return;
        
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
        if (!data) return;
        
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
        if (!data) return;
        
        const container = document.getElementById('feedback-notes');
        if (!container) return;
        
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
        if (!container) {
            console.error('Students list container not found');
            return;
        }
        
        container.innerHTML = '<div class="loading-state">Loading students...</div>';
        
        try {
            // Check if user is admin
            if (!this.isAdmin && this.userRole !== 'admin') {
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
                
                // Filter by go-live date
                const goLiveDate = await this.getGoLiveDate();
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
                
                const streak = await this.calculateStreak(timeLog);
                const totalMinutes = filteredTimeLog.reduce((sum, log) => sum + log.minutes, 0);
                const uniqueDays = new Set(filteredTimeLog.map(log => log.date)).size;
                
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
            
            // Sort students by name
            students.sort((a, b) => a.name.localeCompare(b.name));
            
            // Store students for search
            this.allStudents = students;
            
            if (students.length === 0) {
                container.innerHTML = '<div class="empty-state">No students found. Upload a CSV file to create student accounts.</div>';
                return;
            }
            
            container.innerHTML = students.map(student => `
                <div class="student-card" data-student-name="${this.escapeHtml(student.name.toLowerCase())}" data-student-ktuid="${this.escapeHtml(student.username.toLowerCase())}">
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
            
            // Setup search functionality
            this.setupStudentSearch();
            
            // Load all feedback
            await this.loadAllStudentFeedback();
        } catch (error) {
            console.error('Error loading students:', error);
            let errorMessage = error.message;
            
            // Provide helpful error messages
            if (error.code === 'permission-denied' || error.message.includes('permission')) {
                errorMessage = `
                    <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 1rem; margin: 1rem 0;">
                        <strong style="color: #dc2626;">⚠️ Permission Denied</strong><br>
                        <p style="margin: 0.5rem 0; color: #991b1b;">
                            Firestore security rules need to be updated to allow admin access.<br>
                            See <code>FIRESTORE_SECURITY_RULES.md</code> for instructions.
                        </p>
                        <p style="margin: 0.5rem 0; color: #991b1b; font-size: 0.9rem;">
                            Go to Firebase Console → Firestore Database → Rules and update the rules.
                        </p>
                    </div>
                `;
            }
            
            container.innerHTML = `<div class="error-message">${errorMessage}</div>`;
        }
    },
    
    // Load All Student Feedback for Admin
    async loadAllStudentFeedback() {
        const container = document.getElementById('all-feedback-container');
        if (!container) return;
        
        if (!this.isAdmin && this.userRole !== 'admin') {
            container.innerHTML = '<div class="error-message">Access denied. Admin access required.</div>';
            return;
        }
        
        container.innerHTML = '<div class="loading-state">Loading feedback...</div>';
        
        try {
            const usersQuery = query(
                collection(window.firebaseDb, 'users'),
                where('role', '==', 'student')
            );
            const usersSnapshot = await getDocs(usersQuery);
            
            const allFeedback = [];
            
            for (const userDoc of usersSnapshot.docs) {
                const userData = userDoc.data();
                const studentDataDoc = await getDoc(doc(window.firebaseDb, 'userData', userDoc.id));
                const studentData = studentDataDoc.exists() ? studentDataDoc.data() : {};
                
                const feedback = studentData.feedback || [];
                
                feedback.forEach(fb => {
                    allFeedback.push({
                        studentName: userData.name || userData.username || 'Unknown',
                        studentKtuid: userData.username || 'Unknown',
                        text: fb.text,
                        timestamp: fb.timestamp
                    });
                });
            }
            
            // Sort by timestamp (most recent first)
            allFeedback.sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime();
                const timeB = new Date(b.timestamp).getTime();
                return timeB - timeA;
            });
            
            if (allFeedback.length === 0) {
                container.innerHTML = '<p class="empty-state">No feedback from students yet.</p>';
                return;
            }
            
            container.innerHTML = allFeedback.map(fb => {
                const date = new Date(fb.timestamp);
                const formattedDate = date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                return `
                    <div class="admin-feedback-item">
                        <div class="admin-feedback-header">
                            <div class="admin-feedback-student">
                                <strong>${this.escapeHtml(fb.studentName)}</strong>
                                <span class="admin-feedback-ktuid">KTU ID: ${this.escapeHtml(fb.studentKtuid)}</span>
                            </div>
                            <div class="admin-feedback-date">${formattedDate}</div>
                        </div>
                        <div class="admin-feedback-text">${this.escapeHtml(fb.text)}</div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading feedback:', error);
            container.innerHTML = `<div class="error-message">Error loading feedback: ${error.message}</div>`;
        }
    },
    
    // Load Detailed Student Progress
    async loadStudentProgress() {
        // Reset filter when loading progress page
        this.filteredByAttention = false;
        
        const container = document.getElementById('progress-students-list');
        if (!container) {
            console.error('Progress students list container not found');
            return;
        }
        
        container.innerHTML = '<div class="loading-state">Loading student progress...</div>';
        
        try {
            // Check if user is admin
            if (!this.isAdmin && this.userRole !== 'admin') {
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
                const goLiveDate = await this.getGoLiveDate();
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
                
                const streak = await this.calculateStreak(timeLog);
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
                    streak: streak.current,
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
            this.allProgressStudents = students;
            
            // Render summary
            this.renderProgressSummary({
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
            this.renderProgressCharts(students);
            
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
                <div class="progress-student-card ${warningClass}" data-student-name="${this.escapeHtml(student.name.toLowerCase())}" data-student-ktuid="${this.escapeHtml(student.username.toLowerCase())}">
                    <div class="progress-student-header">
                        <div>
                            <h3 class="progress-student-name">${this.escapeHtml(student.name)} ${warningBadge}</h3>
                            <p class="progress-student-ktuid">KTU ID: ${this.escapeHtml(student.username)}</p>
                        </div>
                        <div class="progress-badge ${student.streak > 0 ? 'active' : 'inactive'}">
                            <i class="fas fa-fire"></i> ${student.streak} Day Streak
                        </div>
                    </div>
                    
                    <div class="progress-stats-grid">
                        <div class="progress-stat-item">
                            <div class="progress-stat-icon"><i class="fas fa-fire"></i></div>
                            <div class="progress-stat-content">
                                <div class="progress-stat-value">${student.streak}</div>
                                <div class="progress-stat-label">Current Streak</div>
                                <div class="progress-stat-sub">Longest: ${student.longestStreak} days</div>
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
                                    <div class="activity-text">${this.escapeHtml(activity.text || 'Activity logged')}</div>
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
    
    // Render Progress Summary
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
                        <div class="summary-sub">Avg: ${summary.avgHours} hrs per student</div>
                    </div>
                </div>
                
                <div class="summary-card summary-card-clickable" id="need-attention-card" onclick="app.filterStudentsByAttention()" style="cursor: pointer;" title="Click to view students who need attention">
                    <div class="summary-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="summary-content">
                        <div class="summary-value">${summary.behindStudents}</div>
                        <div class="summary-label">Need Attention <i class="fas fa-mouse-pointer" style="font-size: 0.7rem; margin-left: 0.25rem;"></i></div>
                        <div class="summary-sub">Low activity or no streak</div>
                    </div>
                </div>
            </div>
            ${this.filteredByAttention ? `
                <div class="filter-indicator" style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 0.75rem 1rem; margin-top: 1rem; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; color: #991b1b;">
                        <i class="fas fa-filter"></i>
                        <span>Showing only students who need attention (${summary.behindStudents})</span>
                    </div>
                    <button onclick="app.clearAttentionFilter()" class="btn btn-secondary btn-small" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
                        <i class="fas fa-times"></i> Clear Filter
                    </button>
                </div>
            ` : ''}
        `;
    },
    
    // Filter students by attention status
    filterStudentsByAttention: function() {
        if (!this.allProgressStudents) return;
        
        this.filteredByAttention = true;
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
        const behindCount = this.allProgressStudents.filter(s => s.isBehind).length;
        const summary = {
            totalStudents: this.allProgressStudents.length,
            avgStreak: Math.round(this.allProgressStudents.reduce((sum, s) => sum + s.streak, 0) / this.allProgressStudents.length),
            avgHours: Math.round(this.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0) / this.allProgressStudents.length),
            totalHours: this.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0),
            totalActivities: this.allProgressStudents.reduce((sum, s) => sum + s.totalActivities, 0),
            activeStudents: this.allProgressStudents.filter(s => s.streak > 0).length,
            inactiveStudents: this.allProgressStudents.filter(s => s.streak === 0).length,
            behindStudents: behindCount
        };
        this.renderProgressSummary(summary);
        
        // Scroll to students list
        const studentsList = document.getElementById('progress-students-list');
        if (studentsList) {
            studentsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },
    
    // Clear attention filter
    clearAttentionFilter: function() {
        this.filteredByAttention = false;
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
        if (this.allProgressStudents) {
            const behindCount = this.allProgressStudents.filter(s => s.isBehind).length;
            const summary = {
                totalStudents: this.allProgressStudents.length,
                avgStreak: Math.round(this.allProgressStudents.reduce((sum, s) => sum + s.streak, 0) / this.allProgressStudents.length),
                avgHours: Math.round(this.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0) / this.allProgressStudents.length),
                totalHours: this.allProgressStudents.reduce((sum, s) => sum + s.totalHours, 0),
                totalActivities: this.allProgressStudents.reduce((sum, s) => sum + s.totalActivities, 0),
                activeStudents: this.allProgressStudents.filter(s => s.streak > 0).length,
                inactiveStudents: this.allProgressStudents.filter(s => s.streak === 0).length,
                behindStudents: behindCount
            };
            this.renderProgressSummary(summary);
        }
    },
    
    // Render Progress Charts
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
    
    // Progress Search
    setupProgressSearch: function() {
        const searchInput = document.getElementById('search-progress-students');
        if (!searchInput) return;
        
        // Remove existing listener
        searchInput.removeEventListener('input', this._progressSearchHandler);
        
        // Create and store handler
        this._progressSearchHandler = (e) => {
            const query = e.target.value.toLowerCase().trim();
            const studentCards = document.querySelectorAll('.progress-student-card');
            
            if (query === '') {
                studentCards.forEach(card => {
                    card.style.display = 'block';
                });
            } else {
                studentCards.forEach(card => {
                    const name = card.getAttribute('data-student-name') || '';
                    const ktuid = card.getAttribute('data-student-ktuid') || '';
                    
                    if (name.includes(query) || ktuid.includes(query)) {
                        card.style.display = 'block';
                    } else {
                        card.style.display = 'none';
                    }
                });
            }
        };
        
        searchInput.addEventListener('input', this._progressSearchHandler);
    },
    
    // Student Search
    setupStudentSearch: function() {
        const searchInput = document.getElementById('search-students');
        if (!searchInput) return;
        
        // Remove existing listener
        searchInput.removeEventListener('input', this._studentSearchHandler);
        
        // Create and store handler
        this._studentSearchHandler = (e) => {
            const query = e.target.value.toLowerCase().trim();
            const studentCards = document.querySelectorAll('.student-card');
            
            if (query === '') {
                // Show all students
                studentCards.forEach(card => {
                    card.style.display = 'block';
                });
            } else {
                // Filter students
                studentCards.forEach(card => {
                    const name = card.getAttribute('data-student-name') || '';
                    const ktuid = card.getAttribute('data-student-ktuid') || '';
                    
                    if (name.includes(query) || ktuid.includes(query)) {
                        card.style.display = 'block';
                    } else {
                        card.style.display = 'none';
                    }
                });
            }
        };
        
        // Add event listener
        searchInput.addEventListener('input', this._studentSearchHandler);
    },
    
    // Utility
    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    // Mini Project Module - Feature Flag System
    async isMiniProjectEnabled() {
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            if (settingsDoc.exists()) {
                return settingsDoc.data().enabled === true;
            }
            return false; // Default to disabled
        } catch (error) {
            // Handle permission errors gracefully
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                console.warn('Mini project settings not accessible. Defaulting to disabled. Please update Firestore security rules.');
                return false;
            }
            console.error('Error checking mini project status:', error);
            return false;
        }
    },
    
    async updateMiniProjectVisibility() {
        const enabled = await this.isMiniProjectEnabled();
        
        // Show/hide navigation items
        const studentNav = document.getElementById('nav-miniproject');
        const adminNav = document.getElementById('admin-miniproject-nav');
        const adminSettingsNav = document.getElementById('admin-miniproject-settings-nav');
        
        // Always show mini project nav items for admin (regardless of enabled status)
        // Admin can enable/disable the module from settings
        if (studentNav) studentNav.style.display = enabled ? 'block' : 'none';
        if (adminNav) adminNav.style.display = this.isAdmin ? 'block' : 'none';
        if (adminSettingsNav) adminSettingsNav.style.display = this.isAdmin ? 'block' : 'none';
    },
    
    async toggleMiniProjectModule() {
        const checkbox = document.getElementById('miniproject-enabled');
        const enabled = checkbox.checked;
        
        try {
            await setDoc(doc(window.firebaseDb, 'settings', 'miniproject'), {
                enabled: enabled,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            await this.updateMiniProjectVisibility();
            alert(enabled ? 'Mini Project module enabled!' : 'Mini Project module disabled!');
        } catch (error) {
            console.error('Error toggling mini project:', error);
            alert('Error updating settings. Please try again.');
            checkbox.checked = !enabled; // Revert checkbox
        }
    },
    
    async loadMiniProjectSettings() {
        if (!this.isAdmin) return;
        
        const enabled = await this.isMiniProjectEnabled();
        const checkbox = document.getElementById('miniproject-enabled');
        if (checkbox) {
            checkbox.checked = enabled;
        }
        
        // Load evaluation stages
        await this.loadEvaluationStages();
    },
    
    async loadEvaluationStages() {
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            const container = document.getElementById('evaluation-stages-list');
            if (!container) return;
            
            if (stages.length === 0) {
                container.innerHTML = '<p class="empty-state">No evaluation stages configured yet.</p>';
                return;
            }
            
            container.innerHTML = stages.map((stage, index) => `
                <div class="evaluation-stage-item">
                    <span class="stage-number">${index + 1}</span>
                    <span class="stage-name">${this.escapeHtml(stage.name)}</span>
                    <button class="btn-icon" onclick="app.deleteEvaluationStage(${index})" title="Delete stage">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading evaluation stages:', error);
        }
    },
    
    // Admin Settings Functions
    async loadAdminSettings() {
        if (!this.isAdmin) return;
        
        try {
            const goLiveDate = await this.getGoLiveDate();
            const dateInput = document.getElementById('go-live-date');
            const displayDiv = document.getElementById('current-go-live-date');
            const displaySpan = document.getElementById('go-live-date-display');
            
            if (goLiveDate) {
                if (dateInput) {
                    dateInput.value = goLiveDate;
                }
                if (displayDiv) {
                    displayDiv.style.display = 'block';
                }
                if (displaySpan) {
                    const date = new Date(goLiveDate);
                    displaySpan.textContent = date.toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    });
                }
            } else {
                if (displayDiv) {
                    displayDiv.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error loading admin settings:', error);
        }
    },
    
    async getGoLiveDate() {
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'general'));
            if (settingsDoc.exists()) {
                const data = settingsDoc.data();
                return data.goLiveDate || null;
            }
            return null;
        } catch (error) {
            console.error('Error getting go-live date:', error);
            return null;
        }
    },
    
    async saveGoLiveDate() {
        if (!this.isAdmin) {
            alert('Only administrators can change this setting.');
            return;
        }
        
        const dateInput = document.getElementById('go-live-date');
        const statusDiv = document.getElementById('go-live-date-status');
        
        if (!dateInput || !dateInput.value) {
            alert('Please select a go-live date!');
            return;
        }
        
        const selectedDate = dateInput.value;
        
        try {
            // Show loading
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="csv-processing">Saving go-live date...</div>';
            }
            
            // Save to Firestore
            await setDoc(doc(window.firebaseDb, 'settings', 'general'), {
                goLiveDate: selectedDate,
                updatedAt: new Date().toISOString(),
                updatedBy: this.currentUser.uid
            }, { merge: true });
            
            // Show success
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="csv-success">Go-live date saved successfully! All streaks and statistics will be recalculated.</div>';
            }
            
            // Reload the settings page to show updated date
            await this.loadAdminSettings();
            
            // Refresh dashboard and statistics for all users
            if (!this.isAdmin) {
                await this.updateDashboard();
                await this.updateStatistics();
            }
            
            // Clear status after 3 seconds
            setTimeout(() => {
                if (statusDiv) {
                    statusDiv.innerHTML = '';
                }
            }, 3000);
        } catch (error) {
            console.error('Error saving go-live date:', error);
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="csv-error">Error saving go-live date: ${error.message}</div>`;
            }
        }
    },
    
    async addEvaluationStage() {
        const input = document.getElementById('new-stage-name');
        const stageName = input.value.trim();
        
        if (!stageName) {
            alert('Please enter a stage name!');
            return;
        }
        
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const currentStages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            currentStages.push({ name: stageName });
            
            await setDoc(doc(window.firebaseDb, 'settings', 'miniproject'), {
                evaluationStages: currentStages,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            input.value = '';
            await this.loadEvaluationStages();
        } catch (error) {
            console.error('Error adding evaluation stage:', error);
            alert('Error adding stage. Please try again.');
        }
    },
    
    async deleteEvaluationStage(index) {
        if (!confirm('Are you sure you want to delete this evaluation stage?')) {
            return;
        }
        
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const currentStages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            currentStages.splice(index, 1);
            
            await setDoc(doc(window.firebaseDb, 'settings', 'miniproject'), {
                evaluationStages: currentStages,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            await this.loadEvaluationStages();
        } catch (error) {
            console.error('Error deleting evaluation stage:', error);
            alert('Error deleting stage. Please try again.');
        }
    },
    
    // Guide Management
    async createGuideAccount() {
        const name = document.getElementById('guide-name').value.trim();
        const email = document.getElementById('guide-email').value.trim();
        const password = document.getElementById('guide-password').value;
        
        if (!name || !email || !password) {
            alert('Please fill in all fields!');
            return;
        }
        
        if (password.length < 6) {
            alert('Password must be at least 6 characters!');
            return;
        }
        
        try {
            // Store admin info before creating guide
            const adminUser = this.currentUser;
            const adminEmail = adminUser?.email;
            
            // Set flag to prevent navigation during guide creation
            this.isCreatingGuide = true;
            
            // Create Firebase auth account (this will auto-sign in the guide)
            const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, password);
            
            // Create user document with guide role
            await setDoc(doc(window.firebaseDb, 'users', userCredential.user.uid), {
                name: name,
                email: email,
                username: email.split('@')[0],
                role: 'guide',
                createdAt: new Date().toISOString()
            });
            
            // Clear form
            document.getElementById('guide-name').value = '';
            document.getElementById('guide-email').value = '';
            document.getElementById('guide-password').value = '';
            
            // Add guide to the list immediately (before signing out)
            const container = document.getElementById('guides-list');
            if (container) {
                const existingGuides = container.querySelectorAll('.guide-item');
                let hasExisting = existingGuides.length > 0;
                
                if (!hasExisting && container.innerHTML.includes('No guides')) {
                    container.innerHTML = '';
                }
                
                // Create guide item HTML and add it immediately
                const guideItem = document.createElement('div');
                guideItem.className = 'guide-item';
                guideItem.innerHTML = `
                    <div class="guide-info">
                        <strong>${this.escapeHtml(name)}</strong>
                        <span class="guide-email">${this.escapeHtml(email)}</span>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.deleteGuide('${userCredential.user.uid}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                `;
                container.insertBefore(guideItem, container.firstChild);
            }
            
            // Show success message
            alert(`Guide account created!\n\nUsername: ${email}\nPassword: ${password}\n\nPlease share these credentials with the guide.`);
            
            // Sign out the guide immediately (don't navigate to guide dashboard)
            await signOut(window.firebaseAuth);
            
            // Clear the flag
            this.isCreatingGuide = false;
        } catch (error) {
            console.error('Error creating guide:', error);
            if (error.code === 'auth/email-already-in-use') {
                alert('A guide with this email already exists!');
            } else {
                alert('Error creating guide account. Please try again.');
            }
        }
    },
    
    async loadGuidesList() {
        if (!this.isAdmin) return;
        
        const container = document.getElementById('guides-list');
        if (!container) return;
        
        try {
            const guidesQuery = query(
                collection(window.firebaseDb, 'users'),
                where('role', '==', 'guide')
            );
            const guidesSnapshot = await getDocs(guidesQuery);
            
            const guides = [];
            guidesSnapshot.forEach(doc => {
                const data = doc.data();
                guides.push({
                    id: doc.id,
                    name: data.name || 'Unknown',
                    email: data.email || '',
                    username: data.username || ''
                });
            });
            
            if (guides.length === 0) {
                container.innerHTML = '<p class="empty-state">No guides created yet.</p>';
                return;
            }
            
            container.innerHTML = guides.map(guide => `
                <div class="guide-item">
                    <div class="guide-info">
                        <strong>${this.escapeHtml(guide.name)}</strong>
                        <span class="guide-email">${this.escapeHtml(guide.email)}</span>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="app.deleteGuide('${guide.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            `).join('');
        } catch (error) {
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                container.innerHTML = '<p class="error-message">Permission denied. Please update Firestore security rules to allow admin access to users collection.</p>';
            } else {
                console.error('Error loading guides:', error);
                container.innerHTML = '<p class="error-message">Error loading guides.</p>';
            }
        }
    },
    
    async deleteGuide(guideId) {
        if (!confirm('Are you sure you want to delete this guide? This action cannot be undone.')) {
            return;
        }
        
        try {
            // Note: In production, you might want to also delete the auth account
            // For now, we'll just remove the user document
            await updateDoc(doc(window.firebaseDb, 'users', guideId), {
                role: 'deleted',
                deletedAt: new Date().toISOString()
            });
            
            await this.loadGuidesList();
        } catch (error) {
            console.error('Error deleting guide:', error);
            alert('Error deleting guide. Please try again.');
        }
    },
    
    // Project Groups Management
    async loadProjectGroups() {
        if (!this.isAdmin) return;
        
        const container = document.getElementById('project-groups-list');
        if (!container) return;
        
        try {
            const groupsQuery = query(collection(window.firebaseDb, 'projectGroups'));
            const groupsSnapshot = await getDocs(groupsQuery);
            
            const groups = [];
            groupsSnapshot.forEach(doc => {
                groups.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            if (groups.length === 0) {
                container.innerHTML = '<p class="empty-state">No project groups created yet.</p>';
                return;
            }
            
            container.innerHTML = groups.map(group => `
                <div class="project-group-item">
                    <div class="group-header">
                        <h4>${this.escapeHtml(group.groupName || 'Unnamed Group')}</h4>
                        <span class="group-id">Group ID: ${group.id.substring(0, 8)}...</span>
                    </div>
                    <div class="group-details">
                        <div class="detail-item">
                            <strong>Topic:</strong> ${this.escapeHtml(group.topic || 'Not assigned')}
                        </div>
                        <div class="detail-item">
                            <strong>Area:</strong> ${this.escapeHtml(group.area || 'Not assigned')}
                        </div>
                        <div class="detail-item">
                            <strong>Sub Area:</strong> ${this.escapeHtml(group.subArea || 'Not assigned')}
                        </div>
                        <div class="detail-item">
                            <strong>Guide:</strong> ${this.escapeHtml(group.guideName || 'Not assigned')}
                        </div>
                        <div class="detail-item">
                            <strong>Members:</strong> ${(group.members || []).length} student(s)
                        </div>
                    </div>
                    <div class="group-actions">
                        <button class="btn btn-primary btn-sm" onclick="app.editProjectGroup('${group.id}')">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="app.deleteProjectGroup('${group.id}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                container.innerHTML = '<p class="error-message">Permission denied. Please update Firestore security rules to allow access to projectGroups collection.</p>';
            } else {
                console.error('Error loading project groups:', error);
                container.innerHTML = '<p class="error-message">Error loading project groups.</p>';
            }
        }
    },
    
    showCreateGroupModal() {
        // For now, we'll use a simple prompt-based approach
        // In production, you'd want a proper modal
        const groupName = prompt('Enter group name:');
        if (!groupName) return;
        
        this.createProjectGroup(groupName);
    },
    
    async createProjectGroup(groupName) {
        try {
            const groupRef = await addDoc(collection(window.firebaseDb, 'projectGroups'), {
                groupName: groupName,
                members: [],
                topic: '',
                area: '',
                subArea: '',
                guideId: '',
                guideName: '',
                createdAt: new Date().toISOString()
            });
            
            alert('Project group created! Now you can edit it to assign members, topic, and guide.');
            await this.loadProjectGroups();
        } catch (error) {
            console.error('Error creating project group:', error);
            alert('Error creating project group. Please try again.');
        }
    },
    
    async editProjectGroup(groupId) {
        try {
            // Load group data
            const groupDoc = await getDoc(doc(window.firebaseDb, 'projectGroups', groupId));
            if (!groupDoc.exists()) {
                alert('Project group not found!');
                return;
            }
            
            const groupData = groupDoc.data();
            
            // Populate form fields
            document.getElementById('edit-group-id').value = groupId;
            document.getElementById('edit-group-name').value = groupData.groupName || '';
            document.getElementById('edit-group-topic').value = groupData.topic || '';
            document.getElementById('edit-group-area').value = groupData.area || '';
            document.getElementById('edit-group-subarea').value = groupData.subArea || '';
            
            // Load guides dropdown
            await this.loadGuidesDropdown(groupData.guideId || '');
            
            // Load members list
            await this.loadMembersList(groupData.members || []);
            
            // Show modal
            document.getElementById('edit-group-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading group for editing:', error);
            alert('Error loading group data. Please try again.');
        }
    },
    
    async loadGuidesDropdown(selectedGuideId = '') {
        const guideSelect = document.getElementById('edit-group-guide');
        if (!guideSelect) return;
        
        try {
            const guidesQuery = query(
                collection(window.firebaseDb, 'users'),
                where('role', '==', 'guide')
            );
            const guidesSnapshot = await getDocs(guidesQuery);
            
            guideSelect.innerHTML = '<option value="">Select a guide...</option>';
            
            guidesSnapshot.forEach(doc => {
                const data = doc.data();
                const guideId = doc.id;
                const guideName = data.name || data.email || 'Unknown Guide';
                const selected = guideId === selectedGuideId ? 'selected' : '';
                guideSelect.innerHTML += `<option value="${guideId}" data-name="${this.escapeHtml(guideName)}" ${selected}>${this.escapeHtml(guideName)}</option>`;
            });
        } catch (error) {
            console.error('Error loading guides:', error);
            guideSelect.innerHTML = '<option value="">Error loading guides</option>';
        }
    },
    
    async loadMembersList(members) {
        const container = document.getElementById('edit-group-members-list');
        if (!container) return;
        
        // Store members data for editing
        this.currentEditingMembers = members || [];
        
        if (this.currentEditingMembers.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding: 1rem; color: var(--text-secondary); text-align: center;">No members added yet.</p>';
            return;
        }
        
        container.innerHTML = this.currentEditingMembers.map((member, index) => {
            const memberName = member.name || member.ktuid || 'Unknown';
            const memberKtuid = member.ktuid || '';
            return `
                <div class="member-list-item" data-index="${index}">
                    <div>
                        <strong>${this.escapeHtml(memberName)}</strong>
                        ${memberKtuid ? `<span style="color: var(--text-secondary); font-size: 0.9rem; margin-left: 0.5rem;">(${this.escapeHtml(memberKtuid)})</span>` : ''}
                    </div>
                    <button type="button" class="remove-member" onclick="app.removeMemberFromGroup(${index})">
                        <i class="fas fa-times"></i> Remove
                    </button>
                </div>
            `;
        }).join('');
    },
    
    async addMemberToGroup() {
        const ktuidInput = document.getElementById('add-member-ktuid');
        const ktuid = ktuidInput.value.trim().toUpperCase();
        
        if (!ktuid) {
            alert('Please enter a KTU ID!');
            return;
        }
        
        try {
            // Find student by KTU ID
            const usersQuery = query(
                collection(window.firebaseDb, 'users'),
                where('username', '==', ktuid),
                where('role', '==', 'student')
            );
            const usersSnapshot = await getDocs(usersQuery);
            
            if (usersSnapshot.empty) {
                alert(`Student with KTU ID "${ktuid}" not found. Please check the KTU ID.`);
                return;
            }
            
            const studentDoc = usersSnapshot.docs[0];
            const studentData = studentDoc.data();
            
            // Initialize currentEditingMembers if not exists
            if (!this.currentEditingMembers) {
                this.currentEditingMembers = [];
            }
            
            // Check if member already exists
            if (this.currentEditingMembers.some(m => m.ktuid === ktuid || m.userId === studentDoc.id)) {
                alert('This student is already a member of the group!');
                return;
            }
            
            // Add new member
            const newMember = {
                userId: studentDoc.id,
                ktuid: ktuid,
                name: studentData.name || ktuid
            };
            
            this.currentEditingMembers.push(newMember);
            
            // Reload members list
            await this.loadMembersList(this.currentEditingMembers);
            
            // Clear input
            ktuidInput.value = '';
        } catch (error) {
            console.error('Error adding member:', error);
            alert('Error adding member. Please try again.');
        }
    },
    
    removeMemberFromGroup(index) {
        if (!this.currentEditingMembers || index < 0 || index >= this.currentEditingMembers.length) {
            return;
        }
        
        // Remove from array
        this.currentEditingMembers.splice(index, 1);
        
        // Reload the list
        this.loadMembersList(this.currentEditingMembers);
    },
    
    async saveProjectGroupChanges(event) {
        event.preventDefault();
        
        const groupId = document.getElementById('edit-group-id').value;
        const groupName = document.getElementById('edit-group-name').value.trim();
        const topic = document.getElementById('edit-group-topic').value.trim();
        const area = document.getElementById('edit-group-area').value.trim();
        const subArea = document.getElementById('edit-group-subarea').value.trim();
        const guideSelect = document.getElementById('edit-group-guide');
        const guideId = guideSelect.value;
        const guideName = guideSelect.options[guideSelect.selectedIndex]?.getAttribute('data-name') || '';
        
        if (!groupName) {
            alert('Group name is required!');
            return;
        }
        
        // Get members from currentEditingMembers
        const members = this.currentEditingMembers || [];
        
        try {
            await updateDoc(doc(window.firebaseDb, 'projectGroups', groupId), {
                groupName: groupName,
                topic: topic,
                area: area,
                subArea: subArea,
                guideId: guideId,
                guideName: guideName,
                members: members,
                updatedAt: new Date().toISOString()
            });
            
            alert('Project group updated successfully!');
            this.closeEditGroupModal();
            await this.loadProjectGroups();
        } catch (error) {
            console.error('Error saving group changes:', error);
            alert('Error saving changes. Please try again.');
        }
    },
    
    closeEditGroupModal() {
        document.getElementById('edit-group-modal').style.display = 'none';
        document.getElementById('edit-group-form').reset();
        document.getElementById('edit-group-members-list').innerHTML = '';
        this.currentEditingMembers = [];
    },
    
    async deleteProjectGroup(groupId) {
        if (!confirm('Are you sure you want to delete this project group? This action cannot be undone.')) {
            return;
        }
        
        try {
            await updateDoc(doc(window.firebaseDb, 'projectGroups', groupId), {
                deleted: true,
                deletedAt: new Date().toISOString()
            });
            
            await this.loadProjectGroups();
        } catch (error) {
            console.error('Error deleting project group:', error);
            alert('Error deleting project group. Please try again.');
        }
    },
    
    // Guide Dashboard Functions
    async loadGuideDashboard() {
        if (this.userRole !== 'guide') return;
        
        // Load groups assigned to this guide
        await this.loadGuideGroups();
    },
    
    async loadGuideGroups() {
        const container = document.getElementById('guide-groups-list');
        if (!container) return;
        
        try {
            const groupsQuery = query(
                collection(window.firebaseDb, 'projectGroups'),
                where('guideId', '==', this.currentUser.uid)
            );
            const groupsSnapshot = await getDocs(groupsQuery);
            
            const groups = [];
            groupsSnapshot.forEach(doc => {
                groups.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // Update stats
            document.getElementById('guide-groups-count').textContent = groups.length;
            
            if (groups.length === 0) {
                container.innerHTML = '<p class="empty-state">No groups assigned to you yet.</p>';
                return;
            }
            
            container.innerHTML = groups.map(group => `
                <div class="guide-group-card">
                    <h4>${this.escapeHtml(group.groupName || 'Unnamed Group')}</h4>
                    <div class="group-members-list">
                        <strong>Members:</strong>
                        ${(group.members || []).map(member => `
                            <span class="member-tag">${this.escapeHtml(member.name || member.ktuid)}</span>
                        `).join('')}
                    </div>
                    <div class="group-topic">
                        <strong>Topic:</strong> ${this.escapeHtml(group.topic || 'Not assigned')}
                    </div>
                    <button class="btn btn-primary" onclick="app.viewGroupDetails('${group.id}')">
                        <i class="fas fa-eye"></i> View Details
                    </button>
                </div>
            `).join('');
        } catch (error) {
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                container.innerHTML = '<p class="error-message">Permission denied. Please update Firestore security rules.</p>';
            } else {
                console.error('Error loading guide groups:', error);
                container.innerHTML = '<p class="error-message">Error loading groups.</p>';
            }
        }
    },
    
    viewGroupDetails(groupId) {
        alert('Group details view - Implementation in progress...');
    },
    
    // Student Mini Project View
    async loadStudentMiniProject() {
        if (this.isAdmin || this.userRole === 'guide') return;
        
        const container = document.getElementById('miniproject-content');
        if (!container) return;
        
        try {
            // Find group where this student is a member
            const groupsQuery = query(collection(window.firebaseDb, 'projectGroups'));
            const groupsSnapshot = await getDocs(groupsQuery);
            
            let studentGroup = null;
            // Get student's KTU ID from user data
            const userDoc = await getDoc(doc(window.firebaseDb, 'users', this.currentUser.uid));
            const userData = userDoc.exists() ? userDoc.data() : {};
            const studentKtuid = userData.username || '';
            
            groupsSnapshot.forEach(doc => {
                const group = doc.data();
                const members = group.members || [];
                // Check if student is a member by KTU ID or user ID
                const isMember = members.some(m => 
                    (m.ktuid && m.ktuid === studentKtuid) || 
                    (m.userId && m.userId === this.currentUser.uid) ||
                    (typeof m === 'string' && m === studentKtuid)
                );
                if (isMember) {
                    studentGroup = {
                        id: doc.id,
                        ...group
                    };
                }
            });
            
            if (!studentGroup) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-project-diagram" style="font-size: 3rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
                        <p>You haven't been assigned to a project group yet.</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = `
                <div class="miniproject-card">
                    <div class="project-header">
                        <h2>${this.escapeHtml(studentGroup.groupName || 'My Project Group')}</h2>
                    </div>
                    <div class="project-details">
                        <div class="detail-section">
                            <h3><i class="fas fa-users"></i> Group Members</h3>
                            <div class="members-list">
                                ${(studentGroup.members || []).map(member => `
                                    <div class="member-item">${this.escapeHtml(member.name || member.ktuid)}</div>
                                `).join('')}
                            </div>
                        </div>
                        <div class="detail-section">
                            <h3><i class="fas fa-book"></i> Project Details</h3>
                            <div class="detail-item">
                                <strong>Topic:</strong> ${this.escapeHtml(studentGroup.topic || 'Not assigned')}
                            </div>
                            <div class="detail-item">
                                <strong>Area:</strong> ${this.escapeHtml(studentGroup.area || 'Not assigned')}
                            </div>
                            <div class="detail-item">
                                <strong>Sub Area:</strong> ${this.escapeHtml(studentGroup.subArea || 'Not assigned')}
                            </div>
                        </div>
                        <div class="detail-section">
                            <h3><i class="fas fa-user-tie"></i> Guide</h3>
                            <p>${this.escapeHtml(studentGroup.guideName || 'Not assigned')}</p>
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            // Handle permission errors gracefully
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                console.warn('Project groups not accessible. Please update Firestore security rules.');
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-project-diagram" style="font-size: 3rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
                        <p>Mini project feature is not available. Please contact your administrator.</p>
                    </div>
                `;
            } else {
                console.error('Error loading student mini project:', error);
                container.innerHTML = '<p class="error-message">Error loading project details.</p>';
            }
        }
    }
};

// Make app available globally for onclick handlers
window.app = app;

// Initialize app - handle both DOMContentLoaded and immediate execution
function initializeApp() {
    if (document.readyState === 'loading') {
        // DOM is still loading, wait for DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    app.init();
    app.setupCSVUpload();
        });
    } else {
        // DOM is already loaded, initialize immediately
        app.init();
        app.setupCSVUpload();
    }
}

// Also try immediate initialization (for cases where DOMContentLoaded already fired)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // Use setTimeout to ensure all scripts are loaded
    setTimeout(() => {
        initializeApp();
    }, 0);
} else {
    initializeApp();
}

// Fallback: Also initialize on window load (most reliable on mobile)
window.addEventListener('load', () => {
    // Re-setup button listeners in case they weren't available the first time
    if (app && app.setupAllButtonListeners) {
        setTimeout(() => {
            app.setupAllButtonListeners();
        }, 200);
    }
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
