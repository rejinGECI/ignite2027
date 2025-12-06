// Firebase imports (loaded via script tag in HTML)
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider,
    sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    addDoc,
    deleteDoc,
    query,
    where,
    getDocs,
    orderBy,
    limit,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

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
        
        // Ensure mobile backdrop doesn't block interactions - FORCE it off
        const backdrop = document.getElementById('mobile-menu-backdrop');
        if (backdrop) {
            backdrop.style.pointerEvents = 'none';
            backdrop.style.display = 'none';
            backdrop.style.opacity = '0';
            backdrop.classList.remove('active');
            backdrop.style.zIndex = '9999';
            console.log('Mobile backdrop FORCED OFF - pointer-events: none, display: none');
        }
        
        // Don't show login immediately - wait for auth check
        // This prevents showing login screen on refresh if user is already authenticated
        this.setupNavigation();
        this.checkAuthState();
        
        // Initially hide both login and app container until auth state is determined
        const loginPage = document.getElementById('login-page');
        const appContainer = document.getElementById('app-container');
        if (loginPage) loginPage.style.display = 'none';
        if (appContainer) appContainer.style.display = 'none';
        
        console.log('✅ App initialization complete');
    },
    
    
    // Authentication
    checkAuthState: function() {
        // Check Firebase auth for admin and students (guides use Firestore login)
        // Only check if Firebase is initialized
        if (window.firebaseAuth) {
            onAuthStateChanged(window.firebaseAuth, async (user) => {
                // Prevent navigation when creating a guide account
                if (this.isCreatingGuide) {
                    return;
                }
                
                // Check if guide is logged in (stored in sessionStorage)
                const guideSession = sessionStorage.getItem('guideSession');
                if (guideSession) {
                    try {
                        const guideData = JSON.parse(guideSession);
                        this.currentUser = {
                            uid: guideData.uid,
                            email: guideData.email,
                            displayName: guideData.name
                        };
                        this.userRole = 'guide';
                        this.isAdmin = false;
                        this.isGuide = true;
                        await this.loadUserData();
                        this.showApp();
                        return;
                    } catch (e) {
                        sessionStorage.removeItem('guideSession');
                    }
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
        
    },
    
    showApp: async function() {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        // FORCE backdrop off when app shows
        const backdrop = document.getElementById('mobile-menu-backdrop');
        if (backdrop) {
            backdrop.style.pointerEvents = 'none';
            backdrop.style.display = 'none';
            backdrop.style.opacity = '0';
            backdrop.classList.remove('active');
            console.log('Backdrop FORCED OFF in showApp');
        }
        
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
            
            // Determine email format based on username
            if (username.includes('@')) {
                // If username contains @, treat as email (for admin or guide accounts)
                email = username;
            } else {
                // Otherwise, try as student (ktuid format)
                email = `${username}@student.local`;
            }
            
            // First, check if it's a guide by querying Firestore
            const guidesQuery = query(
                collection(window.firebaseDb, 'users'),
                where('role', '==', 'guide'),
                where('email', '==', email)
            );
            const guidesSnapshot = await getDocs(guidesQuery);
            
            if (!guidesSnapshot.empty) {
                // It's a guide - check password from Firestore
                const guideDoc = guidesSnapshot.docs[0];
                const guideData = guideDoc.data();
                
                // Check password from Firestore
                if (guideData.password === password) {
                    // Password matches - create a simple user object for guides
                    this.currentUser = {
                        uid: guideDoc.id,
                        email: guideData.email,
                        displayName: guideData.name
                    };
                    this.userRole = 'guide';
                    this.isAdmin = false;
                    this.isGuide = true;
                    
                    // Store guide session
                    sessionStorage.setItem('guideSession', JSON.stringify({
                        uid: guideDoc.id,
                        email: guideData.email,
                        name: guideData.name
                    }));
                    
                    // Show app
                    this.showApp();
                    await this.loadUserData();
                    this.showPage('guide-dashboard');
                    return; // Exit early for guide login
                } else {
                    // Wrong password for guide
                    errorDiv.innerHTML = `
                        <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-top: 8px;">
                            <strong style="color: #991b1b;">⚠️ Invalid Credentials</strong><br>
                            <p style="margin: 8px 0; color: #7f1d1d; font-size: 0.9rem;">
                                The username or password you entered is incorrect. Please check your credentials and try again.
                            </p>
                        </div>
                    `;
                    return;
                }
            }
            
            // Not a guide, try Firebase Auth for admin/student
            userCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, password);
            
            // After successful login, check user role
            if (userCredential && userCredential.user) {
                this.currentUser = userCredential.user;
                const userDoc = await getDoc(doc(window.firebaseDb, 'users', userCredential.user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    this.userRole = userData.role || 'student';
                    this.isAdmin = this.userRole === 'admin';
                    this.isGuide = this.userRole === 'guide';
                    
                    // Show app first
                    this.showApp();
                    
                    // Navigate to appropriate page and load data based on role
                    if (this.isAdmin) {
                        // Show admin progress page (home page) and load data
                        this.showPage('admin-progress');
                    } else if (this.isGuide) {
                        // Load guide data and show guide dashboard
                        await this.loadUserData();
                        this.showPage('guide-dashboard');
                    } else {
                        // Load student data
                        await this.loadUserData();
                    }
                } else {
                    // User document doesn't exist - might be a new account
                    // Try to determine role from email format
                    if (email.includes('@student.local')) {
                        this.userRole = 'student';
                        this.isAdmin = false;
                        this.isGuide = false;
                        this.showApp();
                        await this.loadUserData();
                    } else {
                        // For email-based logins without user doc, show error
                        errorDiv.innerHTML = `
                            <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-top: 8px;">
                                <strong style="color: #991b1b;">⚠️ Account Not Found</strong><br>
                                <p style="margin: 8px 0; color: #7f1d1d; font-size: 0.9rem;">
                                    Your account is not registered in the system. Please contact an administrator.
                                </p>
                            </div>
                        `;
                        return;
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
                        <p style="margin: 4px 0; color: #7f1d1d; font-size: 0.85rem;">
                            <strong>Login formats:</strong><br>
                            • Students: Enter your KTU ID<br>
                            • Admins/Guides: Enter your email address
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
        // Clear guide session if exists
        sessionStorage.removeItem('guideSession');
        
        if (this.currentUser && window.firebaseAuth) {
            try {
                await signOut(window.firebaseAuth);
            } catch (e) {
                // Ignore errors if not using Firebase Auth
            }
        }
        
        // Clear saved page state on logout
        localStorage.removeItem('currentPage');
        
        this.currentUser = null;
        this.isAdmin = false;
        this.isGuide = false;
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
                    await this.loadBookSuggestions();
                    await this.renderCustomHabits();
                } else if (pageId === 'admin-miniproject-settings') {
                    await this.loadMiniProjectSettings();
                } else if (pageId === 'admin-settings') {
                    await this.loadAdminSettings();
                } else if (pageId === 'admin-miniproject') {
                    await this.loadGuidesList();
                    await this.loadProjectTeams();
                    await this.loadEvaluationStagesDropdown();
                } else if (pageId === 'guide-dashboard') {
                    await this.loadGuideDashboard();
                } else if (pageId === 'miniproject') {
                    await this.loadStudentMiniProject();
        } else if (pageId === 'admin-dashboard') {
            // Load students list and setup CSV upload for admin dashboard
                    await this.loadStudentsList();
                    await this.loadAllStudentFeedback();
                    await this.loadAllBookSuggestions();
            this.setupCSVUpload();
        } else if (pageId === 'admin-progress') {
            // Load detailed student progress
            this.loadStudentProgress();
            this.setupProgressSearch();
                } else if (pageId === 'dashboard') {
                    // Dashboard - already loads in loadUserData, but ensure loader is hidden
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
        
        // Check if today's progress is less than 20 minutes, if so, mark as completed (20 minutes)
        const existingLog = data.timeLog.find(log => log.date === today);
        if (existingLog) {
            if (existingLog.minutes < 20) {
                existingLog.minutes = 20; // Mark as completed
            }
        } else {
            // No time log for today, create one with 20 minutes
            data.timeLog.push({
                date: today,
                minutes: 20
            });
        }
        
        await this.saveUserData(data);
        document.getElementById('activity-log').value = '';
        this.renderTodayActivities();
        this.renderRecentActivities();
        await this.updateDashboard();
        await this.updateStatistics();
        alert('Activity saved! Keep up the great work! 💪');
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
    
    async showAllActivities() {
        const data = await this.getUserData();
        if (!data) return;
        
        const allActivities = (data.activities || []).slice().reverse();
        
        // Create modal HTML
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="flex-shrink: 0;">
                    <h2>All Activities</h2>
                    <button class="btn-icon" onclick="this.closest('.modal').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-primary);">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    ${allActivities.length === 0 
                        ? '<p class="empty-state">No activities yet. Start your journey today!</p>'
                        : allActivities.map(activity => {
                            const date = new Date(activity.date);
                            const time = new Date(activity.timestamp);
                            const formattedDate = date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            });
                            const formattedTime = time.toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            return `
                                <div class="activity-item" style="margin-bottom: 1rem; padding: 1rem; background: var(--card-bg); border-radius: 8px; border-left: 4px solid var(--primary-color);">
                                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                                        <div class="activity-date" style="font-weight: 600; color: var(--text-primary);">${formattedDate}</div>
                                        <div style="font-size: 0.85rem; color: var(--text-secondary);">${formattedTime}</div>
                                    </div>
                                    <div class="activity-text" style="color: var(--text-primary); line-height: 1.6;">${this.escapeHtml(activity.text)}</div>
                                </div>
                            `;
                        }).join('')
                    }
                </div>
            </div>
        `;
        
        // Add click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
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
        
        // Calculate today's minutes for progress display
        const today = new Date().toISOString().split('T')[0];
        const todayLog = filteredTimeLog.find(log => log.date === today);
        const todayMinutes = todayLog ? todayLog.minutes : 0;
        
        // Today's progress based on 20 minute goal
        const progressPercent = Math.min(100, (todayMinutes / 20) * 100);
        const todayProgressEl = document.getElementById('today-progress');
        if (todayProgressEl) {
            todayProgressEl.style.width = `${progressPercent}%`;
            
            // Set color based on completion status
            todayProgressEl.className = 'progress-fill'; // Reset classes
            if (todayMinutes >= 20) {
                // Completed - green
                todayProgressEl.style.background = 'linear-gradient(90deg, #10b981, #059669)';
                todayProgressEl.classList.add('progress-completed');
            } else if (todayMinutes > 0) {
                // Partial - yellow/orange
                todayProgressEl.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
                todayProgressEl.classList.add('progress-partial');
            } else {
                // No progress - gray
                todayProgressEl.style.background = 'var(--border-color)';
                todayProgressEl.classList.add('progress-none');
            }
        }
        
        const todayMinutesEl = document.getElementById('today-minutes');
        if (todayMinutesEl) {
            if (todayMinutes >= 20) {
                todayMinutesEl.textContent = `✅ Completed! (${todayMinutes} / 20 minutes)`;
            } else if (todayMinutes > 0) {
                const percent = Math.round(progressPercent);
                todayMinutesEl.textContent = `${todayMinutes} / 20 minutes (${percent}%)`;
            } else {
                todayMinutesEl.textContent = `0 / 20 minutes`;
            }
        }
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
    
    // Book Suggestions
    async suggestBook() {
        const bookName = document.getElementById('suggest-book-name').value.trim();
        const note = document.getElementById('suggest-book-note').value.trim();
        
        if (!bookName) {
            alert('Please enter a book name!');
            return;
        }
        
        if (!note) {
            alert('Please add a note explaining why you recommend this book!');
            return;
        }
        
        if (!this.currentUser) return;
        
        try {
            // Get user info
            const userDoc = await getDoc(doc(window.firebaseDb, 'users', this.currentUser.uid));
            const userData = userDoc.data();
            const studentName = userData?.name || 'Unknown';
            const ktuid = userData?.username || userData?.ktuid || 'Unknown';
            
            // Save suggestion to Firestore
            await addDoc(collection(window.firebaseDb, 'bookSuggestions'), {
                bookName: bookName,
                note: note,
                studentName: studentName,
                ktuid: ktuid,
                suggestedBy: this.currentUser.uid,
                createdAt: new Date().toISOString(),
                timestamp: serverTimestamp()
            });
            
            // Clear form
            document.getElementById('suggest-book-name').value = '';
            document.getElementById('suggest-book-note').value = '';
            
            // Reload suggestions
            await this.loadBookSuggestions();
            
            alert('Book suggestion added! 📚');
        } catch (error) {
            console.error('Error suggesting book:', error);
            alert('Error adding suggestion. Please try again.');
        }
    },
    
    async loadBookSuggestions() {
        const suggestionsList = document.getElementById('book-suggestions-list');
        if (!suggestionsList) return;
        
        try {
            // Get user's hidden books preference
            const userDataDoc = await getDoc(doc(window.firebaseDb, 'userData', window.firebaseAuth.currentUser.uid));
            const userData = userDataDoc.exists() ? userDataDoc.data() : {};
            const hiddenBookIds = userData.hiddenBookIds || [];
            
            // Get all book suggestions from Firestore
            const suggestionsRef = collection(window.firebaseDb, 'bookSuggestions');
            const q = query(suggestionsRef, orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                suggestionsList.innerHTML = '<p class="empty-state">No book suggestions yet. Be the first to suggest a book!</p>';
                return;
            }
            
            let html = '';
            let visibleCount = 0;
            
            querySnapshot.forEach((doc) => {
                const suggestion = doc.data();
                const suggestionId = doc.id;
                
                // Skip if this book is hidden by the user
                if (hiddenBookIds.includes(suggestionId)) {
                    return;
                }
                
                // Only show published suggestions
                if (suggestion.published === false) {
                    return;
                }
                
                visibleCount++;
                const date = new Date(suggestion.createdAt).toLocaleDateString();
                
                html += `
                    <div class="book-suggestion-item" style="background: var(--card-bg); border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: var(--shadow); border-left: 4px solid var(--primary-color); position: relative;">
                        <button onclick="app.hideBookSuggestion('${suggestionId}')" style="position: absolute; top: 1rem; right: 1rem; background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1.2rem; padding: 0.5rem;" title="Hide this suggestion">
                            <i class="fas fa-eye-slash"></i>
                        </button>
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                            <h5 style="margin: 0; color: var(--text-primary); font-size: 1.1rem;">
                                <i class="fas fa-book" style="color: var(--primary-color); margin-right: 0.5rem;"></i>
                                ${suggestion.bookName}
                            </h5>
                            <span style="font-size: 0.85rem; color: var(--text-secondary);">${date}</span>
                        </div>
                        <p style="color: var(--text-primary); margin: 1rem 0; line-height: 1.6;">${suggestion.note}</p>
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                            <i class="fas fa-user" style="color: var(--text-secondary);"></i>
                            <span style="color: var(--text-secondary); font-size: 0.9rem;">
                                Suggested by <strong style="color: var(--primary-color);">${suggestion.studentName}</strong> 
                                <span style="color: var(--text-secondary);">(${suggestion.ktuid})</span>
                            </span>
                        </div>
                    </div>
                `;
            });
            
            if (visibleCount === 0) {
                suggestionsList.innerHTML = '<p class="empty-state">No book suggestions to display. You may have hidden all suggestions.</p>';
            } else {
                suggestionsList.innerHTML = html;
            }
        } catch (error) {
            console.error('Error loading book suggestions:', error);
            suggestionsList.innerHTML = '<p class="empty-state">Error loading suggestions. Please try again.</p>';
        }
    },
    
    async hideBookSuggestion(bookId) {
        try {
            const userDataDoc = await getDoc(doc(window.firebaseDb, 'userData', window.firebaseAuth.currentUser.uid));
            const userData = userDataDoc.exists() ? userDataDoc.data() : {};
            const hiddenBookIds = userData.hiddenBookIds || [];
            
            if (!hiddenBookIds.includes(bookId)) {
                hiddenBookIds.push(bookId);
                await setDoc(doc(window.firebaseDb, 'userData', window.firebaseAuth.currentUser.uid), {
                    hiddenBookIds: hiddenBookIds
                }, { merge: true });
            }
            
            // Reload suggestions to update the display
            await this.loadBookSuggestions();
        } catch (error) {
            console.error('Error hiding book suggestion:', error);
            alert('Error hiding book suggestion. Please try again.');
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
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-secondary btn-sm" onclick="app.showHabitDetails(${habit.id})" title="View habit details">
                                <i class="fas fa-info-circle"></i> Details
                            </button>
                        <button class="btn-icon" onclick="app.deleteHabit(${habit.id})" title="Delete habit">
                            <i class="fas fa-trash"></i>
                        </button>
                        </div>
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
    
    async showHabitDetails(habitId) {
        const data = await this.getUserData();
        if (!data || !data.habits) return;
        
        const habit = data.habits.custom.find(h => h.id === habitId);
        if (!habit) return;
        
        const totalEntries = habit.entries.length;
        const completedEntries = habit.entries.filter(e => e.completed).length;
        const totalMinutes = habit.entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
        const completionRate = totalEntries > 0 ? Math.round((completedEntries / totalEntries) * 100) : 0;
        
        // Sort entries by date (most recent first)
        const sortedEntries = [...habit.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Create modal HTML
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="flex-shrink: 0;">
                    <h2>${this.escapeHtml(habit.name)} - Details</h2>
                    <button class="btn-icon" onclick="this.closest('.modal').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-primary);">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem;">
                        <div style="text-align: center; padding: 1rem; background: var(--card-bg); border-radius: 8px;">
                            <div style="font-size: 2rem; font-weight: bold; color: var(--primary-color);">${completionRate}%</div>
                            <div style="color: var(--text-secondary); margin-top: 0.5rem;">Completion Rate</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: var(--card-bg); border-radius: 8px;">
                            <div style="font-size: 2rem; font-weight: bold; color: var(--primary-color);">${totalEntries}</div>
                            <div style="color: var(--text-secondary); margin-top: 0.5rem;">Total Entries</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: var(--card-bg); border-radius: 8px;">
                            <div style="font-size: 2rem; font-weight: bold; color: var(--primary-color);">${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m</div>
                            <div style="color: var(--text-secondary); margin-top: 0.5rem;">Total Time</div>
                        </div>
                    </div>
                    <h3 style="margin-bottom: 1rem;">Habit History</h3>
                    ${sortedEntries.length === 0 
                        ? '<p class="empty-state">No entries yet. Start tracking this habit!</p>'
                        : sortedEntries.map(entry => {
                            const date = new Date(entry.date);
                            const formattedDate = date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            });
                            return `
                                <div style="margin-bottom: 1rem; padding: 1rem; background: var(--card-bg); border-radius: 8px; border-left: 4px solid ${entry.completed ? '#10b981' : '#ef4444'};">
                                    <div style="display: flex; justify-content: space-between; align-items: start;">
                                        <div>
                                            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">${formattedDate}</div>
                                            <div style="color: var(--text-secondary);">
                                                ${entry.completed ? '<span style="color: #10b981;"><i class="fas fa-check-circle"></i> Completed</span>' : '<span style="color: #ef4444;"><i class="fas fa-times-circle"></i> Not Completed</span>'}
                                                ${entry.minutes > 0 ? ` • ${entry.minutes} minutes` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')
                    }
                </div>
            </div>
        `;
        
        // Add click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    },
    
    async showReadingHistory() {
        const data = await this.getUserData();
        if (!data || !data.habits) return;
        
        const reading = (data.habits.reading || []).slice().reverse();
        
        // Create modal HTML
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="flex-shrink: 0;">
                    <h2>Reading History</h2>
                    <button class="btn-icon" onclick="this.closest('.modal').remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-primary);">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    ${reading.length === 0 
                        ? '<p class="empty-state">No reading entries yet. Start reading!</p>'
                        : reading.map(entry => {
                            const date = new Date(entry.date);
                            const time = new Date(entry.timestamp);
                            const formattedDate = date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            });
                            const formattedTime = time.toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            return `
                                <div style="margin-bottom: 1rem; padding: 1rem; background: var(--card-bg); border-radius: 8px; border-left: 4px solid var(--primary-color);">
                                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                                        <div>
                                            <div style="font-weight: 600; color: var(--text-primary); font-size: 1.1rem; margin-bottom: 0.25rem;">${this.escapeHtml(entry.bookName)}</div>
                                            ${entry.authorName ? `<div style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">by ${this.escapeHtml(entry.authorName)}</div>` : ''}
                                        </div>
                                        <span style="background: var(--primary-color); color: white; padding: 0.25rem 0.75rem; border-radius: 20px; font-weight: 600;">${entry.pages} pages</span>
                                    </div>
                                    <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">${formattedDate} • ${formattedTime}</div>
                                    ${entry.notes ? `<div style="color: var(--text-primary); line-height: 1.6; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color);">${this.escapeHtml(entry.notes)}</div>` : ''}
                                </div>
                            `;
                        }).join('')
                    }
                </div>
            </div>
        `;
        
        // Add click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
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
    
    async loadAllBookSuggestions() {
        const container = document.getElementById('admin-book-suggestions-container');
        if (!container) return;
        
        if (!this.isAdmin && this.userRole !== 'admin') {
            container.innerHTML = '<div class="error-message">Access denied. Admin access required.</div>';
            return;
        }
        
        container.innerHTML = '<div class="loading-state">Loading book suggestions...</div>';
        
        try {
            const suggestionsRef = collection(window.firebaseDb, 'bookSuggestions');
            const q = query(suggestionsRef, orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
                container.innerHTML = '<p class="empty-state">No book suggestions from students yet.</p>';
                return;
            }
            
            const suggestions = [];
            querySnapshot.forEach((doc) => {
                const suggestion = doc.data();
                suggestions.push({
                    id: doc.id,
                    bookName: suggestion.bookName || 'Unknown Book',
                    note: suggestion.note || '',
                    studentName: suggestion.studentName || 'Unknown',
                    ktuid: suggestion.ktuid || 'Unknown',
                    createdAt: suggestion.createdAt || new Date().toISOString(),
                    published: suggestion.published !== false // Default to true if not set
                });
            });
            
            container.innerHTML = suggestions.map(suggestion => {
                const date = new Date(suggestion.createdAt);
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
                                <strong><i class="fas fa-book" style="color: var(--primary-color); margin-right: 0.5rem;"></i>${this.escapeHtml(suggestion.bookName)}</strong>
                                <span class="admin-feedback-ktuid">Suggested by ${this.escapeHtml(suggestion.studentName)} (${this.escapeHtml(suggestion.ktuid)})</span>
                            </div>
                            <div class="admin-feedback-date">${formattedDate}</div>
                        </div>
                        <div class="admin-feedback-text">${this.escapeHtml(suggestion.note)}</div>
                        <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color);">
                            <span style="font-size: 0.85rem; color: ${suggestion.published ? 'var(--success-color)' : 'var(--text-secondary)'};">
                                <i class="fas fa-${suggestion.published ? 'check-circle' : 'eye-slash'}"></i> 
                                ${suggestion.published ? 'Published' : 'Hidden'}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading book suggestions:', error);
            container.innerHTML = `<div class="error-message">Error loading book suggestions: ${error.message}</div>`;
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
        
        // Load team order settings
        await this.loadTeamOrderSettings();
    },
    
    async loadTeamOrderSettings() {
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const teamOrderType = settingsDoc.exists() ? (settingsDoc.data().teamOrderType || 'alphabetical') : 'alphabetical';
            const customTeamOrder = settingsDoc.exists() ? (settingsDoc.data().customTeamOrder || []) : [];
            
            const orderTypeSelect = document.getElementById('team-order-type');
            const customSection = document.getElementById('team-order-custom-section');
            
            if (orderTypeSelect) {
                orderTypeSelect.value = teamOrderType;
            }
            
            if (customSection) {
                customSection.style.display = teamOrderType === 'custom' ? 'block' : 'none';
            }
            
            // Load teams for custom order if needed
            if (teamOrderType === 'custom') {
                await this.loadTeamsForCustomOrder(customTeamOrder);
            }
        } catch (error) {
            console.error('Error loading team order settings:', error);
        }
    },
    
    async loadTeamsForCustomOrder(savedOrder = []) {
        const teamOrderList = document.getElementById('team-order-list');
        if (!teamOrderList) return;
        
        try {
            // Load all teams
            const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
            const teamsSnapshot = await getDocs(teamsQuery);
            
            const teams = [];
            teamsSnapshot.forEach(doc => {
                const data = doc.data();
                if (!data.deleted) {
                    teams.push({
                        id: doc.id,
                        groupName: data.groupName || 'Unnamed Team',
                        ...data
                    });
                }
            });
            
            // Sort teams based on saved order
            const orderedTeams = [];
            const teamMap = new Map(teams.map(t => [t.id, t]));
            
            // First add teams in saved order
            savedOrder.forEach(teamId => {
                if (teamMap.has(teamId)) {
                    orderedTeams.push(teamMap.get(teamId));
                    teamMap.delete(teamId);
                }
            });
            
            // Then add remaining teams alphabetically
            const remainingTeams = Array.from(teamMap.values()).sort((a, b) => {
                const nameA = (a.groupName || 'Unnamed Team').trim().toLowerCase();
                const nameB = (b.groupName || 'Unnamed Team').trim().toLowerCase();
                return nameA.localeCompare(nameB);
            });
            orderedTeams.push(...remainingTeams);
            
            // Render sortable list
            teamOrderList.innerHTML = orderedTeams.map((team, index) => `
                <div class="team-order-item" data-team-id="${team.id}" style="display: flex; align-items: center; gap: 12px; padding: 12px; margin-bottom: 8px; background: white; border: 1px solid #ddd; border-radius: 6px; cursor: move;">
                    <i class="fas fa-grip-vertical" style="color: #999; cursor: grab;"></i>
                    <span style="flex: 1; font-weight: 500;">${this.escapeHtml(team.groupName || 'Unnamed Team')}</span>
                    <span style="color: #666; font-size: 0.9rem;">#${index + 1}</span>
                </div>
            `).join('');
            
            // Make list sortable using HTML5 drag and drop
            this.makeTeamOrderListSortable(teamOrderList);
            
        } catch (error) {
            console.error('Error loading teams for custom order:', error);
            teamOrderList.innerHTML = '<p class="empty-state" style="text-align: center; color: #d32f2f;">Error loading teams. Please try again.</p>';
        }
    },
    
    makeTeamOrderListSortable(container) {
        const items = container.querySelectorAll('.team-order-item');
        let draggedElement = null;
        let draggedIndex = null;
        
        items.forEach((item, index) => {
            item.draggable = true;
            item.dataset.index = index;
            
            item.addEventListener('dragstart', (e) => {
                draggedElement = item;
                draggedIndex = index;
                item.classList.add('dragging');
                item.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', item.innerHTML);
            });
            
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                item.style.opacity = '1';
                draggedElement = null;
                draggedIndex = null;
                this.updateTeamOrderNumbers(container);
            });
            
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                if (!draggedElement || item === draggedElement) return;
                
                const rect = item.getBoundingClientRect();
                const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                
                if (next && item.nextSibling) {
                    container.insertBefore(draggedElement, item.nextSibling);
                } else {
                    container.insertBefore(draggedElement, item);
                }
            });
            
            item.addEventListener('drop', (e) => {
                e.preventDefault();
            });
        });
    },
    
    updateTeamOrderNumbers(container) {
        const items = container.querySelectorAll('.team-order-item');
        items.forEach((item, index) => {
            const numberSpan = item.querySelector('span:last-child');
            if (numberSpan) {
                numberSpan.textContent = `#${index + 1}`;
            }
        });
    },
    
    onTeamOrderTypeChange() {
        const orderTypeSelect = document.getElementById('team-order-type');
        const customSection = document.getElementById('team-order-custom-section');
        
        if (!orderTypeSelect || !customSection) return;
        
        if (orderTypeSelect.value === 'custom') {
            customSection.style.display = 'block';
            this.loadTeamsForCustomOrder();
        } else {
            customSection.style.display = 'none';
            // Save alphabetical order immediately
            this.saveTeamOrder();
        }
    },
    
    async saveTeamOrder() {
        const orderTypeSelect = document.getElementById('team-order-type');
        const teamOrderList = document.getElementById('team-order-list');
        
        if (!orderTypeSelect) return;
        
        const orderType = orderTypeSelect.value;
        let customTeamOrder = [];
        
        if (orderType === 'custom' && teamOrderList) {
            const items = teamOrderList.querySelectorAll('.team-order-item');
            customTeamOrder = Array.from(items).map(item => item.getAttribute('data-team-id'));
        }
        
        try {
            await setDoc(doc(window.firebaseDb, 'settings', 'miniproject'), {
                teamOrderType: orderType,
                customTeamOrder: customTeamOrder,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            alert('Team order saved successfully!');
        } catch (error) {
            console.error('Error saving team order:', error);
            alert('Error saving team order. Please try again.');
        }
    },
    
    async getTeamOrderSettings() {
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            if (settingsDoc.exists()) {
                return {
                    orderType: settingsDoc.data().teamOrderType || 'alphabetical',
                    customOrder: settingsDoc.data().customTeamOrder || []
                };
            }
            return { orderType: 'alphabetical', customOrder: [] };
        } catch (error) {
            console.error('Error loading team order settings:', error);
            return { orderType: 'alphabetical', customOrder: [] };
        }
    },
    
    async applyTeamOrder(teams) {
        const orderSettings = await this.getTeamOrderSettings();
        
        if (orderSettings.orderType === 'alphabetical') {
            // Sort alphabetically by group name
            return teams.sort((a, b) => {
                const nameA = (a.groupName || 'Unnamed Team').trim().toLowerCase();
                const nameB = (b.groupName || 'Unnamed Team').trim().toLowerCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;
                return 0;
            });
        } else if (orderSettings.orderType === 'custom' && orderSettings.customOrder.length > 0) {
            // Apply custom order
            const orderedTeams = [];
            const teamMap = new Map(teams.map(t => [t.id, t]));
            const addedIds = new Set();
            
            // First add teams in saved custom order
            orderSettings.customOrder.forEach(teamId => {
                if (teamMap.has(teamId)) {
                    orderedTeams.push(teamMap.get(teamId));
                    addedIds.add(teamId);
                }
            });
            
            // Then add remaining teams alphabetically
            const remainingTeams = teams
                .filter(t => !addedIds.has(t.id))
                .sort((a, b) => {
                    const nameA = (a.groupName || 'Unnamed Team').trim().toLowerCase();
                    const nameB = (b.groupName || 'Unnamed Team').trim().toLowerCase();
                    return nameA.localeCompare(nameB);
                });
            orderedTeams.push(...remainingTeams);
            
            return orderedTeams;
        }
        
        // Default: alphabetical
        return teams.sort((a, b) => {
            const nameA = (a.groupName || 'Unnamed Team').trim().toLowerCase();
            const nameB = (b.groupName || 'Unnamed Team').trim().toLowerCase();
            return nameA.localeCompare(nameB);
        });
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
            
            container.innerHTML = stages.map((stage, index) => {
                const teamParams = stage.teamMarkParams || [];
                const individualParams = stage.individualMarkParams || [];
                const teamTotal = teamParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
                const individualTotal = individualParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
                const pptRequired = stage.pptRequired || false;
                
                return `
                <div class="evaluation-stage-item">
                    <span class="stage-number">${index + 1}</span>
                    <span class="stage-name">${this.escapeHtml(stage.name)}</span>
                    <span class="stage-marks" style="color: var(--text-secondary); font-size: 0.9rem; margin-left: 1rem;">
                        Team: ${teamTotal} | Individual: ${individualTotal}
                    </span>
                    <label style="display: flex; align-items: center; gap: 0.5rem; margin-left: 1rem; cursor: pointer;">
                        <input type="checkbox" id="ppt-required-${index}" ${pptRequired ? 'checked' : ''} onchange="app.togglePPTRequired(${index})" style="cursor: pointer;">
                        <span style="font-size: 0.9rem; color: var(--text-secondary);">PPT Required</span>
                    </label>
                    <div style="display: flex; gap: 0.5rem; margin-left: auto;">
                        <button class="btn btn-primary btn-sm" onclick="app.editStageMarkParameters(${index})" title="Configure marks">
                            <i class="fas fa-cog"></i> Configure
                        </button>
                    <button class="btn-icon" onclick="app.deleteEvaluationStage(${index})" title="Delete stage">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                </div>
            `;
            }).join('');
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
        const nameInput = document.getElementById('new-stage-name');
        const stageName = nameInput.value.trim();
        
        if (!stageName) {
            alert('Please enter a stage name!');
            return;
        }
        
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const currentStages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            currentStages.push({ 
                name: stageName,
                teamMarkParams: [],
                individualMarkParams: [],
                pptRequired: false
            });
            
            await setDoc(doc(window.firebaseDb, 'settings', 'miniproject'), {
                evaluationStages: currentStages,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            nameInput.value = '';
            await this.loadEvaluationStages();
        } catch (error) {
            console.error('Error adding evaluation stage:', error);
            alert('Error adding stage. Please try again.');
        }
    },
    
    async editStageMarkParameters(stageIndex) {
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            const stage = stages[stageIndex];
            
            if (!stage) {
                alert('Stage not found!');
                return;
            }
            
            document.getElementById('edit-stage-index').value = stageIndex;
            document.getElementById('edit-stage-name-text').textContent = stage.name;
            
            // Load team parameters
            const teamParams = stage.teamMarkParams || [];
            const teamList = document.getElementById('team-params-list');
            teamList.innerHTML = teamParams.map((param, idx) => `
                <div class="param-item" style="display: flex; gap: 0.75rem; align-items: end; margin-bottom: 0.75rem; padding: 0.75rem; background: var(--card-bg); border-radius: 6px;">
                    <div style="flex: 2;">
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--text-secondary);">Parameter Name</label>
                        <input type="text" class="form-input param-name" value="${this.escapeHtml(param.name || '')}" placeholder="e.g., Presentation" data-param-index="${idx}" data-param-type="team">
                    </div>
                    <div style="flex: 1;">
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--text-secondary);">Max Marks</label>
                        <input type="number" class="form-input param-marks" value="${param.maxMarks || 0}" min="0" placeholder="0" data-param-index="${idx}" data-param-type="team" onchange="app.updateTotalMarks('team')">
                    </div>
                    <button type="button" class="btn btn-danger btn-sm" onclick="app.removeMarkParameter('team', ${idx})" style="flex-shrink: 0;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');
            
            // Load individual parameters
            const individualParams = stage.individualMarkParams || [];
            const individualList = document.getElementById('individual-params-list');
            individualList.innerHTML = individualParams.map((param, idx) => `
                <div class="param-item" style="display: flex; gap: 0.75rem; align-items: end; margin-bottom: 0.75rem; padding: 0.75rem; background: var(--card-bg); border-radius: 6px;">
                    <div style="flex: 2;">
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--text-secondary);">Parameter Name</label>
                        <input type="text" class="form-input param-name" value="${this.escapeHtml(param.name || '')}" placeholder="e.g., Contribution" data-param-index="${idx}" data-param-type="individual">
                    </div>
                    <div style="flex: 1;">
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--text-secondary);">Max Marks</label>
                        <input type="number" class="form-input param-marks" value="${param.maxMarks || 0}" min="0" placeholder="0" data-param-index="${idx}" data-param-type="individual" onchange="app.updateTotalMarks('individual')">
                    </div>
                    <button type="button" class="btn btn-danger btn-sm" onclick="app.removeMarkParameter('individual', ${idx})" style="flex-shrink: 0;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');
            
            this.updateTotalMarks('team');
            this.updateTotalMarks('individual');
            
            document.getElementById('edit-stage-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading stage for editing:', error);
            alert('Error loading stage. Please try again.');
        }
    },
    
    addMarkParameter(type) {
        const listId = type === 'team' ? 'team-params-list' : 'individual-params-list';
        const list = document.getElementById(listId);
        const currentIndex = list.querySelectorAll('.param-item').length;
        
        const paramItem = document.createElement('div');
        paramItem.className = 'param-item';
        paramItem.style.cssText = 'display: flex; gap: 0.75rem; align-items: end; margin-bottom: 0.75rem; padding: 0.75rem; background: var(--card-bg); border-radius: 6px;';
        paramItem.innerHTML = `
            <div style="flex: 2;">
                <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--text-secondary);">Parameter Name</label>
                <input type="text" class="form-input param-name" placeholder="e.g., ${type === 'team' ? 'Presentation' : 'Contribution'}" data-param-index="${currentIndex}" data-param-type="${type}">
            </div>
            <div style="flex: 1;">
                <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; color: var(--text-secondary);">Max Marks</label>
                <input type="number" class="form-input param-marks" value="0" min="0" placeholder="0" data-param-index="${currentIndex}" data-param-type="${type}" onchange="app.updateTotalMarks('${type}')">
            </div>
            <button type="button" class="btn btn-danger btn-sm" onclick="app.removeMarkParameter('${type}', ${currentIndex})" style="flex-shrink: 0;">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        list.appendChild(paramItem);
        this.updateTotalMarks(type);
    },
    
    removeMarkParameter(type, index) {
        const listId = type === 'team' ? 'team-params-list' : 'individual-params-list';
        const list = document.getElementById(listId);
        const items = list.querySelectorAll('.param-item');
        
        if (items[index]) {
            items[index].remove();
            // Reindex remaining items
            const remainingItems = list.querySelectorAll('.param-item');
            remainingItems.forEach((item, idx) => {
                item.querySelectorAll('input, button').forEach(el => {
                    if (el.dataset.paramIndex !== undefined) {
                        el.dataset.paramIndex = idx;
                    }
                    if (el.onclick) {
                        el.setAttribute('onclick', el.getAttribute('onclick').replace(/\d+/, idx));
                    }
                });
            });
            this.updateTotalMarks(type);
        }
    },
    
    updateTotalMarks(type) {
        const listId = type === 'team' ? 'team-params-list' : 'individual-params-list';
        const totalId = type === 'team' ? 'team-total-marks' : 'individual-total-marks';
        const list = document.getElementById(listId);
        const marksInputs = list.querySelectorAll('.param-marks');
        
        let total = 0;
        marksInputs.forEach(input => {
            const value = parseFloat(input.value) || 0;
            total += value;
        });
        
        document.getElementById(totalId).textContent = total;
    },
    
    async saveStageMarkParameters() {
        try {
            const stageIndex = parseInt(document.getElementById('edit-stage-index').value);
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            if (!stages[stageIndex]) {
                alert('Stage not found!');
                return;
            }
            
            // Collect team parameters
            const teamParams = [];
            const teamList = document.getElementById('team-params-list');
            teamList.querySelectorAll('.param-item').forEach(item => {
                const nameInput = item.querySelector('.param-name');
                const marksInput = item.querySelector('.param-marks');
                const name = nameInput.value.trim();
                const maxMarks = parseFloat(marksInput.value) || 0;
                
                if (name && maxMarks > 0) {
                    teamParams.push({ name, maxMarks });
                }
            });
            
            // Collect individual parameters
            const individualParams = [];
            const individualList = document.getElementById('individual-params-list');
            individualList.querySelectorAll('.param-item').forEach(item => {
                const nameInput = item.querySelector('.param-name');
                const marksInput = item.querySelector('.param-marks');
                const name = nameInput.value.trim();
                const maxMarks = parseFloat(marksInput.value) || 0;
                
                if (name && maxMarks > 0) {
                    individualParams.push({ name, maxMarks });
                }
            });
            
            // Update stage
            stages[stageIndex].teamMarkParams = teamParams;
            stages[stageIndex].individualMarkParams = individualParams;
            
            // Calculate total marks for backward compatibility
            const teamTotal = teamParams.reduce((sum, p) => sum + p.maxMarks, 0);
            const individualTotal = individualParams.reduce((sum, p) => sum + p.maxMarks, 0);
            stages[stageIndex].marks = Math.max(teamTotal, individualTotal); // Use max for backward compatibility
            
            await setDoc(doc(window.firebaseDb, 'settings', 'miniproject'), {
                evaluationStages: stages,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            
            alert('Mark parameters saved successfully!');
            this.closeEditStageModal();
            await this.loadEvaluationStages();
        } catch (error) {
            console.error('Error saving mark parameters:', error);
            alert('Error saving parameters. Please try again.');
        }
    },
    
    closeEditStageModal() {
        document.getElementById('edit-stage-modal').style.display = 'none';
        document.getElementById('team-params-list').innerHTML = '';
        document.getElementById('individual-params-list').innerHTML = '';
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
    
    async togglePPTRequired(stageIndex) {
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            if (stageIndex >= 0 && stageIndex < stages.length) {
                const checkbox = document.getElementById(`ppt-required-${stageIndex}`);
                stages[stageIndex].pptRequired = checkbox ? checkbox.checked : false;
                
                await updateDoc(doc(window.firebaseDb, 'settings', 'miniproject'), {
                    evaluationStages: stages
                });
            }
        } catch (error) {
            console.error('Error toggling PPT requirement:', error);
            alert('Error updating PPT requirement. Please try again.');
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
            // Create guide document directly in Firestore (no Firebase Auth needed)
            const guideRef = doc(collection(window.firebaseDb, 'users'));
            
            // Create user document with guide role and password
            await setDoc(guideRef, {
                name: name,
                email: email,
                username: email.split('@')[0],
                password: password, // Store password directly in Firestore
                role: 'guide',
                createdAt: new Date().toISOString()
            });
            
            // Clear form
            document.getElementById('guide-name').value = '';
            document.getElementById('guide-email').value = '';
            document.getElementById('guide-password').value = '';
            
            // Add guide to the list immediately
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
                    <div class="guide-actions">
                        <button class="btn btn-primary btn-sm" onclick="app.editGuide('${guideRef.id}')">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="app.deleteGuide('${guideRef.id}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                `;
                container.insertBefore(guideItem, container.firstChild);
            }
            
            // Show success message
            alert(`Guide account created!\n\nUsername: ${email}\nPassword: ${password}\n\nPlease share these credentials with the guide.`);
            
            // Reload guides list to ensure consistency
            await this.loadGuidesList();
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
                    username: data.username || '',
                    password: data.password || '' // Include password for report generation
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
                    <div class="guide-actions">
                        <button type="button" class="btn btn-primary btn-sm" onclick="app.editGuide('${guide.id}')">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="app.deleteGuide('${guide.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    </div>
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
    
    async editGuide(guideId) {
        try {
            // Load guide data
            const guideDoc = await getDoc(doc(window.firebaseDb, 'users', guideId));
            if (!guideDoc.exists()) {
                alert('Guide not found!');
                return;
            }
            
            const guideData = guideDoc.data();
            
            // Populate form fields
            document.getElementById('edit-guide-id').value = guideId;
            document.getElementById('edit-guide-name').value = guideData.name || '';
            document.getElementById('edit-guide-email').value = guideData.email || '';
            
            // Show modal
            document.getElementById('edit-guide-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading guide for editing:', error);
            alert('Error loading guide data. Please try again.');
        }
    },
    
    async saveGuideChanges(event) {
        event.preventDefault();
        
        const guideId = document.getElementById('edit-guide-id').value;
        const name = document.getElementById('edit-guide-name').value.trim();
        const email = document.getElementById('edit-guide-email').value.trim();
        const newPassword = document.getElementById('edit-guide-password').value;
        
        if (!name || !email) {
            alert('Name and email are required!');
            return;
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            alert('Please enter a valid email address!');
            return;
        }
        
        // Validate password if provided
        if (newPassword && newPassword.length < 6) {
            alert('Password must be at least 6 characters long!');
            return;
        }
        
        try {
            // Update guide document
            await updateDoc(doc(window.firebaseDb, 'users', guideId), {
                name: name,
                email: email,
                username: email.split('@')[0],
                updatedAt: new Date().toISOString()
            });
            
            // If new password is provided, update it directly in Firestore
            if (newPassword) {
                try {
                    // Simply update password in Firestore - no verification needed
                    await updateDoc(doc(window.firebaseDb, 'users', guideId), {
                        password: newPassword
                    });
                } catch (passwordError) {
                    console.error('Error updating password:', passwordError);
                    alert('Error updating password: ' + (passwordError.message || 'Unknown error'));
                    return; // Don't continue if password update failed
                }
            }
            
            alert('Guide updated successfully!');
            this.closeEditGuideModal();
            await this.loadGuidesList();
        } catch (error) {
            console.error('Error saving guide changes:', error);
            if (error.code === 'permission-denied') {
                alert('Permission denied. Please check Firestore security rules.');
            } else {
                alert('Error saving changes. Please try again.');
            }
        }
    },
    
    closeEditGuideModal() {
        document.getElementById('edit-guide-modal').style.display = 'none';
        document.getElementById('edit-guide-form').reset();
        // Clear password field
        document.getElementById('edit-guide-password').value = '';
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
    
    // Project Teams Management
    async loadProjectTeams() {
        if (!this.isAdmin) return;
        
        const container = document.getElementById('project-teams-list');
        if (!container) return;
        
        try {
            const teamsQuery = query(collection(window.firebaseDb, 'projectGroups')); // Keep collection name for backward compatibility
            const teamsSnapshot = await getDocs(teamsQuery);
            
            const teams = [];
            teamsSnapshot.forEach(doc => {
                const data = doc.data();
                if (!data.deleted) { // Filter out deleted teams
                    teams.push({
                    id: doc.id,
                        ...data
                });
                }
            });
            
            if (teams.length === 0) {
                container.innerHTML = '<p class="empty-state">No project teams created yet.</p>';
                return;
            }
            
            container.innerHTML = teams.map(team => `
                <div class="project-team-item">
                    <div class="team-header">
                        <h4>${this.escapeHtml(team.groupName || 'Unnamed Team')}</h4>
                        <span class="team-id">Team ID: ${team.id.substring(0, 8)}...</span>
                    </div>
                    <div class="team-details">
                        <div class="detail-item">
                            <strong>Topic:</strong> ${this.escapeHtml(team.topic || 'Not assigned')}
                        </div>
                        ${team.area ? `<div class="detail-item"><strong>Area:</strong> ${this.escapeHtml(team.area)}</div>` : ''}
                        ${team.subArea ? `<div class="detail-item"><strong>Sub Area:</strong> ${this.escapeHtml(team.subArea)}</div>` : ''}
                        <div class="detail-item">
                            <strong>Guide:</strong> ${this.escapeHtml(team.guideName || 'Not assigned')}
                        </div>
                        <div class="detail-item">
                            <strong>Members:</strong> ${(team.members || []).length} student(s)
                        </div>
                        </div>
                    <div class="team-actions">
                        <button class="btn btn-primary btn-sm" onclick="app.editProjectTeam('${team.id}')">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="app.deleteProjectTeam('${team.id}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                container.innerHTML = '<p class="error-message">Permission denied. Please update Firestore security rules to allow access to projectGroups collection.</p>';
            } else {
                console.error('Error loading project teams:', error);
                container.innerHTML = '<p class="error-message">Error loading project teams.</p>';
            }
        }
    },
    
    showCreateTeamModal() {
        const teamName = prompt('Enter team name:');
        if (!teamName) return;
        
        this.createProjectTeam(teamName);
    },
    
    async createProjectTeam(teamName) {
        try {
            const teamRef = await addDoc(collection(window.firebaseDb, 'projectGroups'), { // Keep collection name for backward compatibility
                groupName: teamName,
                members: [],
                topic: '',
                area: '',
                subArea: '',
                guideId: '',
                guideName: '',
                createdAt: new Date().toISOString()
            });
            
            alert('Project team created! Now you can edit it to assign members, topic, and guide.');
            await this.loadProjectTeams();
        } catch (error) {
            console.error('Error creating project team:', error);
            alert('Error creating project team. Please try again.');
        }
    },
    
    async editProjectTeam(teamId) {
        try {
            // Load team data
            const teamDoc = await getDoc(doc(window.firebaseDb, 'projectGroups', teamId)); // Keep collection name for backward compatibility
            if (!teamDoc.exists()) {
                alert('Project team not found!');
                return;
            }
            
            const teamData = teamDoc.data();
            
            // Populate form fields
            document.getElementById('edit-team-id').value = teamId;
            document.getElementById('edit-team-name').value = teamData.groupName || '';
            document.getElementById('edit-team-topic').value = teamData.topic || '';
            document.getElementById('edit-team-area').value = teamData.area || '';
            document.getElementById('edit-team-subarea').value = teamData.subArea || '';
            
            // Set selected guide
            if (teamData.guideId) {
                document.getElementById('edit-team-guide-id').value = teamData.guideId;
                document.getElementById('selected-guide-name').textContent = teamData.guideName || 'Selected Guide';
                document.getElementById('selected-guide-display').style.display = 'flex';
            }
            
            // Load members list
            await this.loadMembersList(teamData.members || []);
            
            // Setup search handlers
            this.setupTeamSearchHandlers();
            
            // Show modal
            document.getElementById('edit-team-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error loading team for editing:', error);
            alert('Error loading team data. Please try again.');
        }
    },
    
    setupTeamSearchHandlers() {
        // Setup guide search
        const guideSearchInput = document.getElementById('search-guide-input');
        const guideResults = document.getElementById('search-guide-results');
        
        if (guideSearchInput) {
            guideSearchInput.addEventListener('input', async (e) => {
                const searchTerm = e.target.value.trim().toLowerCase();
                if (searchTerm.length < 2) {
                    guideResults.style.display = 'none';
                    return;
                }
        
        try {
            const guidesQuery = query(
                collection(window.firebaseDb, 'users'),
                where('role', '==', 'guide')
            );
            const guidesSnapshot = await getDocs(guidesQuery);
            
                    const matches = [];
            guidesSnapshot.forEach(doc => {
                const data = doc.data();
                        const name = (data.name || '').toLowerCase();
                        const email = (data.email || '').toLowerCase();
                        
                        if (name.includes(searchTerm) || email.includes(searchTerm)) {
                            matches.push({
                                id: doc.id,
                                name: data.name || data.email || 'Unknown Guide',
                                email: data.email || ''
                            });
                        }
                    });
                    
                    if (matches.length > 0) {
                        guideResults.innerHTML = matches.map(guide => `
                            <div class="search-result-item" onclick="app.selectGuide('${guide.id}', '${this.escapeHtml(guide.name)}')">
                                <strong>${this.escapeHtml(guide.name)}</strong>
                                ${guide.email ? `<span style="color: var(--text-secondary); font-size: 0.85rem;">${this.escapeHtml(guide.email)}</span>` : ''}
                            </div>
                        `).join('');
                        guideResults.style.display = 'block';
                    } else {
                        guideResults.innerHTML = '<div class="search-result-item" style="color: var(--text-secondary);">No guides found</div>';
                        guideResults.style.display = 'block';
                    }
        } catch (error) {
                    console.error('Error searching guides:', error);
                }
            });
        }
        
        // Setup student search
        const studentSearchInput = document.getElementById('search-student-input');
        const studentResults = document.getElementById('search-student-results');
        
        if (studentSearchInput) {
            studentSearchInput.addEventListener('input', async (e) => {
                const searchTerm = e.target.value.trim().toLowerCase();
                if (searchTerm.length < 2) {
                    if (studentResults) studentResults.style.display = 'none';
                    return;
                }
                
                try {
                    const studentsQuery = query(
                        collection(window.firebaseDb, 'users'),
                        where('role', '==', 'student')
                    );
                    const studentsSnapshot = await getDocs(studentsQuery);
                    
                    const matches = [];
                    studentsSnapshot.forEach(doc => {
                        const data = doc.data();
                        const name = (data.name || '').toLowerCase();
                        const ktuid = (data.username || '').toLowerCase();
                        const email = (data.email || '').toLowerCase();
                        
                        if (name.includes(searchTerm) || ktuid.includes(searchTerm) || email.includes(searchTerm)) {
                            matches.push({
                                id: doc.id,
                                name: data.name || data.username || 'Unknown',
                                ktuid: data.username || '',
                                email: data.email || ''
                            });
                        }
                    });
                    
                    if (matches.length > 0) {
                        if (studentResults) {
                            studentResults.innerHTML = matches.map(student => `
                                <div class="search-result-item" onclick="app.selectStudent('${student.id}', '${this.escapeHtml(student.name)}', '${this.escapeHtml(student.ktuid)}')">
                                    <strong>${this.escapeHtml(student.name)}</strong>
                                    ${student.ktuid ? `<span style="color: var(--text-secondary); font-size: 0.85rem;">(${this.escapeHtml(student.ktuid)})</span>` : ''}
                                </div>
                            `).join('');
                            studentResults.style.display = 'block';
                        }
                    } else {
                        if (studentResults) {
                            studentResults.innerHTML = '<div class="search-result-item" style="color: var(--text-secondary);">No students found</div>';
                            studentResults.style.display = 'block';
                        }
                    }
                } catch (error) {
                    console.error('Error searching students:', error);
                }
            });
        }
        
        // Close search results when clicking outside
        document.addEventListener('click', (e) => {
            if (guideResults && !guideSearchInput.contains(e.target) && !guideResults.contains(e.target)) {
                guideResults.style.display = 'none';
            }
            if (studentResults && studentSearchInput && !studentSearchInput.contains(e.target) && !studentResults.contains(e.target)) {
                studentResults.style.display = 'none';
            }
        });
    },
    
    selectGuide(guideId, guideName) {
        document.getElementById('edit-team-guide-id').value = guideId;
        document.getElementById('selected-guide-name').textContent = guideName;
        document.getElementById('selected-guide-display').style.display = 'flex';
        document.getElementById('search-guide-input').value = '';
        document.getElementById('search-guide-results').style.display = 'none';
    },
    
    clearSelectedGuide() {
        document.getElementById('edit-team-guide-id').value = '';
        document.getElementById('selected-guide-display').style.display = 'none';
    },
    
    selectStudent(studentId, studentName, studentKtuid) {
        if (!this.currentEditingMembers) {
            this.currentEditingMembers = [];
        }
        
        // Check if already added
        if (this.currentEditingMembers.some(m => m.userId === studentId || m.ktuid === studentKtuid)) {
            alert('This student is already a member of the team!');
            return;
        }
        
        // Add student
        this.currentEditingMembers.push({
            userId: studentId,
            ktuid: studentKtuid,
            name: studentName
        });
        
        // Reload members list
        this.loadMembersList(this.currentEditingMembers);
        
        // Clear search
        document.getElementById('search-student-input').value = '';
        const studentResults = document.getElementById('search-student-results');
        if (studentResults) studentResults.style.display = 'none';
    },
    
    async loadMembersList(members) {
        const container = document.getElementById('edit-team-members-list');
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
                    <button type="button" class="remove-member" onclick="app.removeMemberFromTeam(${index})">
                        <i class="fas fa-times"></i> Remove
                    </button>
                </div>
            `;
        }).join('');
    },
    
    removeMemberFromTeam(index) {
        if (!this.currentEditingMembers || index < 0 || index >= this.currentEditingMembers.length) {
            return;
        }
        
        // Remove from array
        this.currentEditingMembers.splice(index, 1);
        
        // Reload the list
        this.loadMembersList(this.currentEditingMembers);
    },
    
    async saveProjectTeamChanges(event) {
        event.preventDefault();
        
        const teamId = document.getElementById('edit-team-id').value;
        const teamName = document.getElementById('edit-team-name').value.trim();
        const topic = document.getElementById('edit-team-topic').value.trim();
        const area = document.getElementById('edit-team-area').value.trim();
        const subArea = document.getElementById('edit-team-subarea').value.trim();
        const guideId = document.getElementById('edit-team-guide-id').value;
        const guideName = document.getElementById('selected-guide-name').textContent || '';
        
        if (!teamName) {
            alert('Team name is required!');
            return;
        }
        
        // Get members from currentEditingMembers
        const members = this.currentEditingMembers || [];
        
        try {
            await updateDoc(doc(window.firebaseDb, 'projectGroups', teamId), { // Keep collection name for backward compatibility
                groupName: teamName,
                topic: topic,
                area: area || '',
                subArea: subArea || '',
                guideId: guideId,
                guideName: guideName,
                members: members,
                updatedAt: new Date().toISOString()
            });
            
            alert('Project team updated successfully!');
            this.closeEditTeamModal();
            await this.loadProjectTeams();
        } catch (error) {
            console.error('Error saving team changes:', error);
            alert('Error saving changes. Please try again.');
        }
    },
    
    closeEditTeamModal() {
        document.getElementById('edit-team-modal').style.display = 'none';
        document.getElementById('edit-team-form').reset();
        document.getElementById('edit-team-members-list').innerHTML = '';
        document.getElementById('search-guide-input').value = '';
        document.getElementById('search-student-input').value = '';
        document.getElementById('search-guide-results').style.display = 'none';
        const studentResults = document.getElementById('search-student-results');
        if (studentResults) studentResults.style.display = 'none';
        document.getElementById('selected-guide-display').style.display = 'none';
        this.currentEditingMembers = [];
    },
    
    async deleteProjectTeam(teamId) {
        if (!confirm('Are you sure you want to delete this project team? This action cannot be undone.')) {
            return;
        }
        
        try {
            await updateDoc(doc(window.firebaseDb, 'projectGroups', teamId), { // Keep collection name for backward compatibility
                deleted: true,
                deletedAt: new Date().toISOString()
            });
            
            await this.loadProjectTeams();
        } catch (error) {
            console.error('Error deleting project team:', error);
            alert('Error deleting project team. Please try again.');
        }
    },
    
    // Guide Dashboard Functions
    async loadGuideDashboard() {
        if (this.userRole !== 'guide') return;
        
        // Load teams assigned to this guide
        await this.loadGuideTeams();
    },
    
    async loadGuideTeams() {
        const container = document.getElementById('guide-teams-list');
        if (!container) return;
        
        try {
            // Load evaluation stages
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            // Get guide's email to match teams
            const guideEmail = this.currentUser.email;
            
            // Query teams by guideId (Firestore document ID) or guideName (email)
            const teamsQuery = query(
                collection(window.firebaseDb, 'projectGroups') // Keep collection name for backward compatibility
            );
            const teamsSnapshot = await getDocs(teamsQuery);
            
            const teams = [];
            teamsSnapshot.forEach(doc => {
                const data = doc.data();
                if (!data.deleted) {
                    // Match by guideId (Firestore document ID) or guideName (email)
                    const matchesGuide = data.guideId === this.currentUser.uid || 
                                       data.guideName === guideEmail ||
                                       (data.guideId && data.guideId === this.currentUser.uid);
                    
                    if (matchesGuide) {
                        teams.push({
                            id: doc.id,
                            ...data
                        });
                    }
                }
            });
            
            // Load evaluation data for all teams
            const teamsWithEvaluations = await Promise.all(teams.map(async (team) => {
                const evaluations = {};
                for (let i = 0; i < stages.length; i++) {
                    try {
                        const evalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${team.id}_${i}`));
                        if (evalDoc.exists()) {
                            evaluations[i] = evalDoc.data();
                        }
                    } catch (error) {
                        console.error(`Error loading evaluation for team ${team.id}, stage ${i}:`, error);
                    }
                }
                return { ...team, evaluations };
            }));
            
            // Update stats
            const teamsCountEl = document.getElementById('guide-teams-count');
            if (teamsCountEl) teamsCountEl.textContent = teams.length;
            
            if (teams.length === 0) {
                container.innerHTML = '<p class="empty-state">No teams assigned to you yet.</p>';
                return;
            }
            
            container.innerHTML = teamsWithEvaluations.map(team => {
                // Calculate evaluation summary
                const completedEvals = Object.keys(team.evaluations || {}).length;
                const totalEvals = stages.length;
                
                return `
                <div class="guide-team-card">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
                        <h4 style="margin: 0; font-size: 1.1rem;">${this.escapeHtml(team.groupName || 'Unnamed Team')}</h4>
                        <span style="font-size: 0.85rem; color: var(--text-secondary);">
                            ${completedEvals}/${totalEvals} Evaluations
                        </span>
                    </div>
                    <div class="team-members-list" style="margin-bottom: 0.5rem; font-size: 0.9rem;">
                        <strong>Members:</strong>
                        ${(team.members || []).map(member => `
                            <span class="member-tag">${this.escapeHtml(member.name || member.ktuid)}</span>
                        `).join('')}
                    </div>
                    <div class="team-topic" style="margin-bottom: 0.75rem; font-size: 0.9rem;">
                        <strong>Topic:</strong> ${this.escapeHtml(team.topic || 'Not assigned')}
                    </div>
                    
                    ${stages.length > 0 ? `
                        <div class="team-evaluations-summary" style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
                            <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">
                                <i class="fas fa-clipboard-check"></i> Evaluation Details
                            </div>
                            ${stages.map((stage, index) => {
                                const evalData = team.evaluations[index];
                                const teamParams = stage.teamMarkParams || [];
                                const individualParams = stage.individualMarkParams || [];
                                const teamTotal = teamParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
                                const individualTotal = individualParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
                                
                                // Get marks
                                const teamMarksData = evalData?.teamMarksData || {};
                                const teamMarks = evalData?.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
                                
                                // Check for team comments - be more lenient
                                const teamCommentsText = evalData?.teamComments || '';
                                const hasTeamComments = teamCommentsText && 
                                    teamCommentsText.trim() !== '' && 
                                    teamCommentsText.trim() !== '<p><br></p>' &&
                                    teamCommentsText.trim() !== '<p></p>' &&
                                    teamCommentsText.trim() !== '<br>';
                                
                                const hasIndividualEvals = evalData?.individualEvaluations && Object.keys(evalData.individualEvaluations).length > 0;
                                
                                const isComplete = teamMarks > 0 || hasTeamComments || hasIndividualEvals;
                                
                                // Always show evaluation section if evaluation data exists
                                const showEvaluationDetails = evalData !== undefined;
                                
                                return `
                                    <div style="margin-bottom: 0.5rem; padding: 0.5rem; background: var(--bg-color); border-radius: 6px; border-left: 3px solid ${isComplete ? 'var(--success-color)' : 'var(--warning-color)'};">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                                            <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">
                                                ${this.escapeHtml(stage.name)}
                                            </span>
                                            <span style="font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px; background: ${isComplete ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${isComplete ? 'var(--success-color)' : 'var(--warning-color)'};">
                                                ${isComplete ? 'Completed' : 'Pending'}
                                            </span>
                                        </div>
                                        ${showEvaluationDetails ? `
                                            ${teamTotal > 0 && (teamMarks > 0 || teamMarksData) ? `
                                                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">
                                                    <i class="fas fa-users"></i> Team: ${teamMarks || 0} / ${teamTotal} marks
                                                </div>
                                            ` : ''}
                                            ${hasTeamComments || (teamCommentsText && teamCommentsText.trim().length > 10) ? `
                                                <div style="font-size: 0.8rem; color: var(--text-primary); margin-top: 0.5rem; padding: 0.5rem; background: white; border-radius: 4px; border: 1px solid var(--border-color);">
                                                    <div style="font-weight: 600; margin-bottom: 0.25rem; color: var(--text-primary); font-size: 0.85rem;">
                                                        <i class="fas fa-comment"></i> Team Comments
                                                    </div>
                                                    <div class="formatted-content" style="font-size: 0.85rem; line-height: 1.5; color: var(--text-secondary); min-height: 20px;">
                                                        ${teamCommentsText}
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${hasIndividualEvals ? `
                                                <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color);">
                                                    <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">
                                                        <i class="fas fa-user"></i> Individual Evaluations
                                                    </div>
                                                    ${Object.entries(evalData.individualEvaluations).map(([userId, individualEval]) => {
                                                        const member = (team.members || []).find(m => (m.userId || m.ktuid) === userId) || {};
                                                        const studentName = individualEval.studentName || member.name || member.ktuid || userId;
                                                        const studentMarks = individualEval.marks !== null && individualEval.marks !== undefined ? individualEval.marks : 0;
                                                        const individualCommentsText = individualEval.comments || '';
                                                        // More lenient check - show if there's any meaningful content
                                                        const hasIndividualComments = individualCommentsText && 
                                                            individualCommentsText.trim() !== '' && 
                                                            individualCommentsText.trim() !== '<p><br></p>' &&
                                                            individualCommentsText.trim() !== '<p></p>' &&
                                                            individualCommentsText.trim() !== '<br>' &&
                                                            individualCommentsText.trim().length > 0;
                                                        
                                                        return `
                                                            <div style="margin-bottom: 0.5rem; padding: 0.5rem; background: white; border-radius: 4px; border-left: 2px solid var(--primary-color);">
                                                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                                                                    <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">
                                                                        ${this.escapeHtml(studentName)}
                                                                        ${individualEval.isAbsent ? '<span style="font-size: 0.75rem; color: var(--danger-color); margin-left: 0.5rem;">(Absent)</span>' : ''}
                                                                    </span>
                                                                    ${individualTotal > 0 ? `
                                                                        <span style="font-size: 0.75rem; color: var(--text-secondary);">
                                                                            ${studentMarks} / ${individualTotal} marks
                                                                        </span>
                                                                    ` : ''}
                                                                </div>
                                                                ${hasIndividualComments || (individualCommentsText && individualCommentsText.trim().length > 10) ? `
                                                                    <div style="margin-top: 0.25rem; padding: 0.4rem; background: var(--bg-color); border-radius: 4px;">
                                                                        <div style="font-weight: 600; margin-bottom: 0.25rem; font-size: 0.75rem; color: var(--text-primary);">
                                                                            <i class="fas fa-comment"></i> Comments
                                                                        </div>
                                                                        <div class="formatted-content" style="font-size: 0.8rem; line-height: 1.4; color: var(--text-secondary); min-height: 20px;">
                                                                            ${individualCommentsText}
                                                                        </div>
                                                                    </div>
                                                                ` : ''}
                                                            </div>
                                                        `;
                                                    }).join('')}
                                                </div>
                                            ` : ''}
                                        ` : `
                                            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
                                                Not yet evaluated
                                            </div>
                                        `}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
            }).join('');
        } catch (error) {
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                container.innerHTML = '<p class="error-message">Permission denied. Please update Firestore security rules.</p>';
            } else {
                console.error('Error loading guide teams:', error);
                container.innerHTML = '<p class="error-message">Error loading teams.</p>';
            }
        }
    },
    
    viewTeamDetails(teamId) {
        alert('Team details view - Implementation in progress...');
    },
    
    // Admin Mini Project Tab Switching
    switchAdminMiniProjectTab(tabName) {
        // Load problem statements when tab is switched
        if (tabName === 'problem-statements') {
            setTimeout(() => this.loadAllProblemStatements(), 100);
        }
        // Update tab buttons
        document.querySelectorAll('.admin-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-tab') === tabName) {
                btn.classList.add('active');
            }
        });
        
        // Update tab content
        document.querySelectorAll('.admin-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        const targetTab = document.getElementById(`admin-miniproject-${tabName}-tab`);
        if (targetTab) {
            targetTab.classList.add('active');
        }
        
        // Load data when switching to evaluations tab
        if (tabName === 'evaluations') {
            this.loadEvaluationStagesDropdown();
        }
    },
    
    // Evaluation Management Functions
    async loadTeamsForEvaluation() {
        const stageSelect = document.getElementById('eval-stage-select');
        const teamsContainer = document.getElementById('teams-list-container');
        const teamsList = document.getElementById('eval-teams-list');
        const formContainer = document.getElementById('evaluation-form-container');
        const consolidatedReportBtn = document.getElementById('generate-consolidated-report-btn');
        
        if (!stageSelect || !teamsContainer || !teamsList) return;
        
        const stageIndex = stageSelect.value;
        
        // Hide form and teams list when stage changes
        formContainer.style.display = 'none';
        teamsContainer.style.display = 'none';
        
        // Enable/disable consolidated report button
        if (consolidatedReportBtn) {
            if (stageIndex === '') {
                consolidatedReportBtn.disabled = true;
            } else {
                consolidatedReportBtn.disabled = false;
            }
        }
        
        if (stageIndex === '') {
            return;
        }
        
        try {
            // Load all teams
            const teamsQuery = query(collection(window.firebaseDb, 'projectGroups')); // Keep collection name for backward compatibility
            const teamsSnapshot = await getDocs(teamsQuery);
            
            const teams = [];
            teamsSnapshot.forEach(doc => {
                const data = doc.data();
                if (!data.deleted) {
                    teams.push({
                        id: doc.id,
                        groupName: data.groupName || 'Unnamed Team',
                        ...data
                    });
                }
            });
            
            // Apply team order settings
            const sortedTeams = await this.applyTeamOrder(teams);
            
            if (sortedTeams.length === 0) {
                teamsList.innerHTML = '<p class="empty-state">No teams available.</p>';
                teamsContainer.style.display = 'block';
                return;
            }
            
            // Check evaluation status for each team
            const teamsWithStatus = await Promise.all(sortedTeams.map(async (team) => {
                try {
                    const evalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${team.id}_${stageIndex}`));
                    const evalData = evalDoc.exists() ? evalDoc.data() : null;
                    
                    // Determine if evaluation is complete
                    // Complete if: has team marks OR has team comments OR has individual evaluations
                    let isComplete = false;
                    if (evalData) {
                        const hasTeamMarks = (evalData.teamMarks !== null && evalData.teamMarks !== undefined) || 
                                           (evalData.teamMarksData && Object.keys(evalData.teamMarksData).length > 0);
                        const hasTeamComments = evalData.teamComments && evalData.teamComments.trim() !== '' && 
                                             evalData.teamComments.trim() !== '<p><br></p>';
                        const hasIndividualEvals = evalData.individualEvaluations && 
                                                Object.keys(evalData.individualEvaluations).length > 0;
                        
                        isComplete = hasTeamMarks || hasTeamComments || hasIndividualEvals;
                    }
                    
                    return {
                        ...team,
                        evaluationStatus: isComplete ? 'completed' : 'pending'
                    };
                } catch (error) {
                    console.error(`Error checking evaluation for team ${team.id}:`, error);
                    return {
                        ...team,
                        evaluationStatus: 'pending'
                    };
                }
            }));
            
            // Display teams as clickable cards with status colors
            teamsList.innerHTML = teamsWithStatus.map(team => `
                <div class="eval-team-card eval-team-${team.evaluationStatus}">
                    <div onclick="app.selectTeamForEvaluation('${team.id}', '${this.escapeHtml(team.groupName)}', '${stageIndex}')" style="cursor: pointer;">
                        <div class="eval-team-name">${this.escapeHtml(team.groupName)}</div>
                        <div class="eval-team-info">
                            <span><i class="fas fa-users"></i> ${(team.members || []).length} member(s)</span>
                            ${team.guideName ? `<span><i class="fas fa-user-tie"></i> ${this.escapeHtml(team.guideName)}</span>` : ''}
                            <span class="eval-status-badge">
                                <i class="fas ${team.evaluationStatus === 'completed' ? 'fa-check-circle' : 'fa-clock'}"></i>
                                ${team.evaluationStatus === 'completed' ? 'Completed' : 'Pending'}
                            </span>
                        </div>
                    </div>
                    ${team.evaluationStatus === 'completed' ? `
                        <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
                            <button type="button" class="btn btn-primary" style="width: 100%; padding: 0.5rem; font-size: 0.85rem;" onclick="event.stopPropagation(); app.showReportGenerationOptions('${team.id}', '${stageIndex}')">
                                <i class="fas fa-file-download"></i> Generate Report
                            </button>
                        </div>
                    ` : ''}
                </div>
            `).join('');
            
            teamsContainer.style.display = 'block';
        } catch (error) {
            console.error('Error loading teams for evaluation:', error);
            teamsList.innerHTML = '<p class="error-message">Error loading teams.</p>';
            teamsContainer.style.display = 'block';
        }
    },
    
    async selectTeamForEvaluation(teamId, teamName, stageIndex) {
        await this.loadEvaluationForm(teamId, stageIndex);
    },
    
    async loadEvaluationStagesDropdown() {
        const select = document.getElementById('eval-stage-select');
        const consolidatedReportBtn = document.getElementById('generate-consolidated-report-btn');
        
        if (!select) return;
        
        try {
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            select.innerHTML = '<option value="">-- Select a stage --</option>';
            
            stages.forEach((stage, index) => {
                select.innerHTML += `<option value="${index}">${this.escapeHtml(stage.name)}</option>`;
            });
            
            // Ensure consolidated report button is disabled when no stage is selected
            if (consolidatedReportBtn) {
                consolidatedReportBtn.disabled = true;
            }
        } catch (error) {
            console.error('Error loading evaluation stages:', error);
            select.innerHTML = '<option value="">Error loading stages</option>';
            if (consolidatedReportBtn) {
                consolidatedReportBtn.disabled = true;
            }
        }
    },
    
    async loadEvaluationForm(teamId, stageIndex) {
        const formContainer = document.getElementById('evaluation-form-container');
        const teamsContainer = document.getElementById('teams-list-container');
        
        if (!formContainer) return;
        
        if (!teamId || stageIndex === '') {
            formContainer.style.display = 'none';
            return;
        }
        
        try {
            // Load team data
            const teamDoc = await getDoc(doc(window.firebaseDb, 'projectGroups', teamId));
            if (!teamDoc.exists()) {
                alert('Team not found!');
                return;
            }
            
            const teamData = teamDoc.data();
            const members = teamData.members || [];
            
            // Load evaluation stages
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            const stage = stages[parseInt(stageIndex)];
            
            if (!stage) {
                alert('Evaluation stage not found!');
                return;
            }
            
            // Load existing evaluation data
            const evalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${teamId}_${stageIndex}`));
            const evalData = evalDoc.exists() ? evalDoc.data() : {};
            
            // Get mark parameters
            const teamParams = stage.teamMarkParams || [];
            const individualParams = stage.individualMarkParams || [];
            const teamTotal = teamParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
            const individualTotal = individualParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
            
            // Get existing evaluation marks (parameter-based or legacy)
            const teamMarksData = evalData.teamMarksData || {};
            const teamMarksTotal = evalData.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
            
            // Build form HTML
            formContainer.innerHTML = `
                <div class="evaluation-form">
                    <h4 style="margin-bottom: 1rem; color: var(--text-primary); font-size: 1.1rem;">
                        <i class="fas fa-clipboard-check"></i> ${this.escapeHtml(stage.name)} - ${this.escapeHtml(teamData.groupName || 'Team')}
                    </h4>
                    ${teamData.guideName ? `
                        <div style="margin-bottom: 1rem; padding: 0.5rem 0.75rem; background: var(--bg-color); border-radius: 6px; font-size: 0.9rem; color: var(--text-secondary);">
                            <i class="fas fa-user-tie"></i> Guide: <strong style="color: var(--text-primary);">${this.escapeHtml(teamData.guideName)}</strong>
                        </div>
                    ` : ''}
                    
                    <!-- Team Marks & Comments -->
                    <div class="evaluation-section">
                        <h5 style="margin-bottom: 0.75rem; color: var(--text-primary); font-size: 1rem;">
                            <i class="fas fa-users"></i> Team Evaluation
                            ${teamTotal > 0 ? `<span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: normal; margin-left: 0.5rem;">(Total: ${teamTotal} marks)</span>` : ''}
                        </h5>
                        ${teamParams.length > 0 ? `
                            ${teamParams.map((param, idx) => `
                                <div class="form-group" style="margin-bottom: 0.75rem;">
                                    <label for="team-param-${idx}" style="font-size: 0.9rem; margin-bottom: 0.25rem;">${this.escapeHtml(param.name)} (out of ${param.maxMarks})</label>
                                    <input type="number" id="team-param-${idx}" class="form-input team-param-input" 
                                           min="0" max="${param.maxMarks}" 
                                           data-param-name="${this.escapeHtml(param.name)}"
                                           value="${teamMarksData[param.name] || ''}" 
                                           placeholder="Enter marks"
                                           style="padding: 0.5rem; font-size: 0.9rem;">
                                </div>
                            `).join('')}
                            <div style="margin-top: 0.75rem; padding: 0.5rem; background: var(--bg-color); border-radius: 6px; font-size: 0.9rem;">
                                <strong>Total Team Marks: <span id="team-marks-total">${teamMarksTotal || 0}</span> / ${teamTotal}</strong>
                            </div>
                        ` : `
                            <div class="form-row">
                                <div class="form-group" style="flex: 1;">
                                    <label for="team-marks" style="font-size: 0.9rem; margin-bottom: 0.25rem;">Team Marks</label>
                                    <input type="number" id="team-marks" class="form-input" min="0" 
                                           value="${teamMarksTotal || ''}" placeholder="Enter team marks"
                                           style="padding: 0.5rem; font-size: 0.9rem;">
                                </div>
                            </div>
                        `}
                        <div class="form-group" style="margin-top: 1rem;">
                            <label for="team-comments" style="font-size: 0.9rem; margin-bottom: 0.25rem;">Team Comments</label>
                            <div id="team-comments-editor" style="min-height: 120px; background: white; border: 1px solid var(--border-color); border-radius: 6px;"></div>
                        </div>
                    </div>
                    
                    <!-- Individual Marks & Comments -->
                    <div class="evaluation-section" style="margin-top: 1rem;">
                        <h5 style="margin-bottom: 0.75rem; color: var(--text-primary); font-size: 1rem;">
                            <i class="fas fa-user"></i> Individual Evaluations
                        </h5>
                        ${members.length === 0 
                            ? '<p class="empty-state">No team members found.</p>'
                            : members.map((member, index) => {
                                const memberEval = evalData.individualEvaluations?.[member.userId || member.ktuid] || {};
                                const isAbsent = memberEval.isAbsent || false;
                                return `
                                    <div class="individual-eval-item" style="background: var(--bg-color); border-radius: 6px; border-left: 3px solid var(--primary-color); ${isAbsent ? 'opacity: 0.7;' : ''}">
                                        <div style="margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                                            <div>
                                                <strong style="color: var(--text-primary); font-size: 0.95rem;">${this.escapeHtml(member.name || member.ktuid)}</strong>
                                                ${member.ktuid ? `<span style="color: var(--text-secondary); font-size: 0.8rem; margin-left: 0.5rem;">(${this.escapeHtml(member.ktuid)})</span>` : ''}
                                            </div>
                                            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
                                                <input type="checkbox" id="absent-${index}" class="absent-checkbox" 
                                                       ${isAbsent ? 'checked' : ''} 
                                                       onchange="app.toggleAbsentStatus(${index})"
                                                       style="width: 16px; height: 16px; cursor: pointer;">
                                                <span style="color: var(--text-secondary); font-size: 0.8rem; font-weight: 500;">
                                                    <i class="fas fa-user-times"></i> Absent
                                                </span>
                                            </label>
                                        </div>
                                        ${individualParams.length > 0 ? `
                                            ${individualParams.map((param, paramIdx) => {
                                                const paramMarks = memberEval.marksData?.[param.name] || '';
                                                return `
                                                    <div class="form-group" style="margin-bottom: 0.75rem;">
                                                        <label for="individual-param-${index}-${paramIdx}" style="font-size: 0.85rem; margin-bottom: 0.25rem;">${this.escapeHtml(param.name)} (out of ${param.maxMarks})</label>
                                                        <input type="number" id="individual-param-${index}-${paramIdx}" 
                                                               class="form-input individual-param-input" 
                                                               min="0" max="${param.maxMarks}" 
                                                               data-user-id="${member.userId || member.ktuid}"
                                                               data-param-name="${this.escapeHtml(param.name)}"
                                                               data-member-index="${index}"
                                                               value="${paramMarks}" 
                                                               placeholder="Enter marks"
                                                               style="padding: 0.5rem; font-size: 0.9rem;"
                                                               ${isAbsent ? 'disabled' : ''}>
                                                    </div>
                                                `;
                                            }).join('')}
                                            <div style="margin-top: 0.75rem; padding: 0.5rem; background: var(--bg-color); border-radius: 6px; font-size: 0.85rem;">
                                                <strong>Total Individual Marks: <span id="individual-marks-total-${index}">${memberEval.marks || 0}</span> / ${individualTotal}</strong>
                                            </div>
                                        ` : `
                                            <div class="form-row">
                                                <div class="form-group" style="flex: 1;">
                                                    <label for="individual-marks-${index}" style="font-size: 0.85rem; margin-bottom: 0.25rem;">Individual Marks</label>
                                                    <input type="number" id="individual-marks-${index}" 
                                                           class="form-input" min="0" 
                                                           data-user-id="${member.userId || member.ktuid}"
                                                           data-member-index="${index}"
                                                           value="${memberEval.marks || ''}" 
                                                           placeholder="Enter individual marks"
                                                           style="padding: 0.5rem; font-size: 0.9rem;"
                                                           ${isAbsent ? 'disabled' : ''}>
                                                </div>
                                            </div>
                                        `}
                                        <div class="form-group" style="margin-top: 0.75rem;">
                                            <label for="individual-comments-${index}" style="font-size: 0.85rem; margin-bottom: 0.25rem;">Individual Comments</label>
                                            <div id="individual-comments-editor-${index}" style="min-height: 100px; background: white; border: 1px solid var(--border-color); border-radius: 6px;"></div>
                                        </div>
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>
                    
                    <div class="modal-actions" style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color); display: flex; gap: 0.75rem; justify-content: space-between;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('evaluation-form-container').style.display = 'none'">
                            Cancel
                        </button>
                        <div style="display: flex; gap: 0.75rem;">
                            <button type="button" class="btn btn-secondary" onclick="app.showReportGenerationOptions('${teamId}', '${stageIndex}')">
                                <i class="fas fa-file-download"></i> Generate Report
                            </button>
                            <button type="button" class="btn btn-primary" onclick="app.saveEvaluationData('${teamId}', '${stageIndex}')">
                                <i class="fas fa-save"></i> Save Evaluation
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            formContainer.style.display = 'block';
            
            // Initialize Quill editors
            this.quillEditors = this.quillEditors || {};
            
            // Team comments editor
            const teamCommentsEditor = new Quill('#team-comments-editor', {
                theme: 'snow',
                modules: {
                    toolbar: [
                        ['bold', 'italic', 'underline'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['link'],
                        ['clean']
                    ]
                },
                placeholder: 'Enter team evaluation comments...'
            });
            if (evalData.teamComments) {
                teamCommentsEditor.root.innerHTML = evalData.teamComments;
            }
            this.quillEditors['team-comments'] = teamCommentsEditor;
            
            // Individual comments editors
            members.forEach((member, index) => {
                const memberEval = evalData.individualEvaluations?.[member.userId || member.ktuid] || {};
                const editorId = `individual-comments-editor-${index}`;
                const individualEditor = new Quill(`#${editorId}`, {
                    theme: 'snow',
                    modules: {
                        toolbar: [
                            ['bold', 'italic', 'underline'],
                            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                            ['link'],
                            ['clean']
                        ]
                    },
                    placeholder: 'Enter individual evaluation comments...'
                });
                if (memberEval.comments) {
                    individualEditor.root.innerHTML = memberEval.comments;
                }
                this.quillEditors[`individual-comments-${index}`] = individualEditor;
            });
            
            // Add event listeners for parameter-based marks calculation
            if (teamParams.length > 0) {
                document.querySelectorAll('.team-param-input').forEach(input => {
                    input.addEventListener('input', () => this.calculateTeamMarksTotal());
                });
            }
            
            if (individualParams.length > 0) {
                document.querySelectorAll('.individual-param-input').forEach(input => {
                    input.addEventListener('input', (e) => {
                        const userId = e.target.dataset.userId;
                        this.calculateIndividualMarksTotal(userId);
                    });
                });
            }
        } catch (error) {
            console.error('Error loading evaluation form:', error);
            alert('Error loading evaluation form. Please try again.');
        }
    },
    
    calculateTeamMarksTotal() {
        const inputs = document.querySelectorAll('.team-param-input');
        let total = 0;
        inputs.forEach(input => {
            const value = parseFloat(input.value) || 0;
            total += value;
        });
        const totalEl = document.getElementById('team-marks-total');
        if (totalEl) totalEl.textContent = total;
    },
    
    calculateIndividualMarksTotal(userId) {
        const inputs = document.querySelectorAll(`.individual-param-input[data-user-id="${userId}"]`);
        let total = 0;
        inputs.forEach(input => {
            const value = parseFloat(input.value) || 0;
            total += value;
        });
        // Find the member index
        const firstInput = inputs[0];
        if (firstInput) {
            const inputId = firstInput.id;
            const match = inputId.match(/individual-param-(\d+)-/);
            if (match) {
                const memberIndex = match[1];
                const totalEl = document.getElementById(`individual-marks-total-${memberIndex}`);
                if (totalEl) totalEl.textContent = total;
            }
        }
    },
    
    toggleAbsentStatus(memberIndex) {
        const absentCheckbox = document.getElementById(`absent-${memberIndex}`);
        const isAbsent = absentCheckbox.checked;
        
        // Disable/enable all input fields for this member
        const memberInputs = document.querySelectorAll(`[data-member-index="${memberIndex}"]`);
        memberInputs.forEach(input => {
            input.disabled = isAbsent;
            if (isAbsent) {
                input.value = '';
            }
        });
        
        // Disable/enable Quill editor for this member
        if (this.quillEditors && this.quillEditors[`individual-comments-${memberIndex}`]) {
            const editor = this.quillEditors[`individual-comments-${memberIndex}`];
            editor.enable(!isAbsent);
            if (isAbsent) {
                editor.root.innerHTML = '<p><br></p>';
            }
        }
        
        // Update the individual marks total to 0 if absent
        if (isAbsent) {
            const totalEl = document.getElementById(`individual-marks-total-${memberIndex}`);
            if (totalEl) totalEl.textContent = '0';
        } else {
            // Recalculate total if not absent
            const firstInput = memberInputs[0];
            if (firstInput && firstInput.dataset.userId) {
                this.calculateIndividualMarksTotal(firstInput.dataset.userId);
            }
        }
        
        // Update visual appearance
        const evalItem = absentCheckbox.closest('.individual-eval-item');
        if (evalItem) {
            if (isAbsent) {
                evalItem.style.opacity = '0.7';
            } else {
                evalItem.style.opacity = '1';
            }
        }
    },
    
    async saveEvaluationData(teamId, stageIndex) {
        try {
            // Get stage and parameters
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            const stage = stages[parseInt(stageIndex)];
            const teamParams = stage?.teamMarkParams || [];
            const individualParams = stage?.individualMarkParams || [];
            
            // Get team comments from Quill editor
            let teamComments = '';
            if (this.quillEditors && this.quillEditors['team-comments']) {
                const html = this.quillEditors['team-comments'].root.innerHTML;
                teamComments = html.trim() === '<p><br></p>' ? '' : html.trim();
            }
            
            // Collect team marks (parameter-based or single)
            let teamMarks = null;
            let teamMarksData = {};
            
            if (teamParams.length > 0) {
                // Parameter-based marks
                teamParams.forEach((param, idx) => {
                    const input = document.getElementById(`team-param-${idx}`);
                    if (input) {
                        const value = parseFloat(input.value) || 0;
                        if (value > 0) {
                            teamMarksData[param.name] = value;
                        }
                    }
                });
                teamMarks = Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0);
            } else {
                // Legacy single marks
                const teamMarksInput = document.getElementById('team-marks');
                if (teamMarksInput) {
                    const value = teamMarksInput.value.trim();
                    teamMarks = value ? parseFloat(value) : null;
                }
            }
            
            // Get individual evaluations
            const individualEvaluations = {};
            const teamDoc = await getDoc(doc(window.firebaseDb, 'projectGroups', teamId));
            const teamData = teamDoc.exists() ? teamDoc.data() : {};
            const members = teamData.members || [];
            
            members.forEach((member, index) => {
                const userId = member.userId || member.ktuid;
                // Get individual comments from Quill editor
                let comments = '';
                if (this.quillEditors && this.quillEditors[`individual-comments-${index}`]) {
                    const html = this.quillEditors[`individual-comments-${index}`].root.innerHTML;
                    comments = html.trim() === '<p><br></p>' ? '' : html.trim();
                }
                
                // Check if student is marked as absent
                const absentCheckbox = document.getElementById(`absent-${index}`);
                const isAbsent = absentCheckbox ? absentCheckbox.checked : false;
                
                let marks = null;
                let marksData = {};
                
                if (!isAbsent) {
                    // Only calculate marks if not absent
                    if (individualParams.length > 0) {
                        // Parameter-based marks
                        individualParams.forEach((param, paramIdx) => {
                            const input = document.getElementById(`individual-param-${index}-${paramIdx}`);
                            if (input) {
                                const value = parseFloat(input.value) || 0;
                                if (value > 0) {
                                    marksData[param.name] = value;
                                }
                            }
                        });
                        marks = Object.values(marksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0);
                    } else {
                        // Legacy single marks
                        const marksInput = document.getElementById(`individual-marks-${index}`);
                        if (marksInput) {
                            const value = marksInput.value.trim();
                            marks = value ? parseFloat(value) : null;
                        }
                    }
                }
                
                // Build individual evaluation object
                const individualEval = {
                    marks: isAbsent ? 0 : marks,
                    comments: comments || '',
                    studentName: member.name || member.ktuid,
                    ktuid: member.ktuid || '',
                    isAbsent: isAbsent
                };
                
                // Only include marksData if it has values and not absent
                if (!isAbsent && Object.keys(marksData).length > 0) {
                    individualEval.marksData = marksData;
                }
                
                individualEvaluations[userId] = individualEval;
            });
            
            // Build evaluation data object, only including fields with values
            const evalData = {
                teamId: teamId,
                stageIndex: parseInt(stageIndex),
                teamComments: teamComments || '',
                individualEvaluations: individualEvaluations,
                updatedAt: new Date().toISOString(),
                updatedBy: this.currentUser.uid
            };
            
            // Only include teamMarks if it has a value
            if (teamMarks !== null && teamMarks !== undefined) {
                evalData.teamMarks = teamMarks;
            }
            
            // Only include teamMarksData if it has values
            if (Object.keys(teamMarksData).length > 0) {
                evalData.teamMarksData = teamMarksData;
            }
            
            // Save to Firestore
            const evalRef = doc(window.firebaseDb, 'evaluations', `${teamId}_${stageIndex}`);
            await setDoc(evalRef, evalData, { merge: true });
            
            alert('Evaluation data saved successfully!');
        } catch (error) {
            console.error('Error saving evaluation data:', error);
            alert('Error saving evaluation data. Please try again.');
        }
    },
    
    // Report Generation Functions
    showReportGenerationOptions(teamId, stageIndex) {
        if (!teamId || stageIndex === undefined) {
            alert('Invalid team or evaluation stage selected.');
            return;
        }
        
        // Store the current team and stage for report generation
        this.currentReportTeamId = teamId;
        this.currentReportStageIndex = stageIndex;
        
        // Show the modal
        const modal = document.getElementById('report-generation-modal');
        if (modal) {
            modal.style.display = 'flex';
            // Reset format selection to PDF
            const formatSelect = document.getElementById('report-format');
            if (formatSelect) formatSelect.value = 'pdf';
        }
    },
    
    showConsolidatedReportOptions() {
        const stageSelect = document.getElementById('eval-stage-select');
        if (!stageSelect || !stageSelect.value || stageSelect.value === '') {
            alert('Please select an evaluation stage first.');
            return;
        }
        
        // Store the stage for consolidated report generation
        this.currentConsolidatedStageIndex = stageSelect.value;
        
        // Show the consolidated report modal
        const modal = document.getElementById('consolidated-report-modal');
        if (modal) {
            modal.style.display = 'flex';
            // Set CSV as default
            const formatSelect = document.getElementById('consolidated-report-format');
            if (formatSelect) formatSelect.value = 'csv';
        }
    },
    
    closeReportGenerationModal() {
        const modal = document.getElementById('report-generation-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentReportTeamId = null;
        this.currentReportStageIndex = null;
    },
    
    closeConsolidatedReportModal() {
        const modal = document.getElementById('consolidated-report-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentConsolidatedStageIndex = null;
    },
    
    showGuideCredentialsReportOptions() {
        const modal = document.getElementById('guide-credentials-report-modal');
        if (modal) {
            modal.style.display = 'flex';
            // Set default format to PDF
            const formatSelect = document.getElementById('guide-credentials-report-format');
            if (formatSelect) {
                formatSelect.value = 'pdf';
            }
        }
    },
    
    closeGuideCredentialsReportModal() {
        const modal = document.getElementById('guide-credentials-report-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },
    
    async generateGuideCredentialsReportFromModal() {
        const formatSelect = document.getElementById('guide-credentials-report-format');
        if (!formatSelect) return;
        
        const format = formatSelect.value;
        this.closeGuideCredentialsReportModal();
        
        try {
            await this.generateGuideCredentialsReport(format);
        } catch (error) {
            console.error('Error generating guide credentials report:', error);
            alert('Error generating report. Please try again.');
        }
    },
    
    async generateGuideCredentialsReport(format) {
        try {
            // Load all guides
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
                    username: data.username || data.email?.split('@')[0] || '',
                    password: data.password || 'N/A'
                });
            });
            
            // Sort guides alphabetically by name
            guides.sort((a, b) => {
                const nameA = (a.name || '').trim().toLowerCase();
                const nameB = (b.name || '').trim().toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
            // Generate based on format
            if (format === 'csv') {
                this.generateGuideCredentialsCSVReport(guides);
            } else if (format === 'json') {
                this.generateGuideCredentialsJSONReport(guides);
            } else {
                // For PDF/HTML/DOCX, generate HTML report
                const reportContent = this.generateGuideCredentialsReportContent(guides);
                
                if (format === 'pdf') {
                    await this.generatePDFReport(reportContent, { groupName: 'Guide Credentials' }, { name: 'Guide Credentials Report' });
                } else if (format === 'html') {
                    this.generateHTMLReport(reportContent, { groupName: 'Guide Credentials' }, { name: 'Guide Credentials Report' });
                } else if (format === 'docx') {
                    await this.generateDOCXReport(reportContent, { groupName: 'Guide Credentials' }, { name: 'Guide Credentials Report' });
                }
            }
        } catch (error) {
            console.error('Error generating guide credentials report:', error);
            throw error;
        }
    },
    
    generateGuideCredentialsReportContent(guides) {
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Guide Credentials Report</title>
                <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap" rel="stylesheet">
                <style>
                    body {
                        font-family: 'Lato', sans-serif;
                        color: #2d3748;
                        line-height: 1.5;
                        margin: 0;
                        padding: 0;
                        background-color: #ffffff;
                    }
                    .report-container {
                        max-width: 900px;
                        margin: 20px auto;
                        padding: 20px;
                        background: #ffffff;
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 25px;
                        padding: 30px;
                        background: #ffffff;
                        border-radius: 12px;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                        border: 1px solid rgba(0, 0, 0, 0.06);
                    }
                    .header-text {
                        font-family: 'Montserrat', sans-serif;
                        font-size: 15px;
                        font-weight: 600;
                        margin-bottom: 10px;
                        letter-spacing: 1.5px;
                        color: #1f2937;
                        text-transform: uppercase;
                    }
                    .report-title {
                        font-family: 'Lato', sans-serif;
                        font-size: 24px;
                        font-weight: 700;
                        margin-top: 20px;
                        padding: 15px 35px;
                        background: #f8fafc;
                        border-radius: 12px;
                        display: inline-block;
                        color: #1f2937;
                        border: 2px solid rgba(0, 0, 0, 0.08);
                    }
                    .guides-table {
                        width: 100%;
                        border-collapse: separate;
                        border-spacing: 0;
                        margin-bottom: 20px;
                        border-radius: 8px;
                        overflow: hidden;
                        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
                        border: 1px solid rgba(0, 0, 0, 0.06);
                    }
                    .guides-table th {
                        background-color: #f8fafc;
                        color: #1f2937;
                        font-weight: 700;
                        font-family: 'Montserrat', sans-serif;
                        font-size: 12px;
                        padding: 8px 10px;
                        text-align: left;
                        border-bottom: 2px solid #e5e7eb;
                        letter-spacing: 0.5px;
                    }
                    .guides-table td {
                        padding: 6px 10px;
                        border-bottom: 1px solid #e5e7eb;
                        font-size: 12px;
                        font-family: 'Lato', sans-serif;
                    }
                    .guides-table tr:nth-child(even) {
                        background-color: #f8fafc;
                    }
                    .guides-table tr:nth-child(odd) {
                        background-color: #ffffff;
                    }
                    .password-cell {
                        font-family: 'Courier New', monospace;
                        font-weight: 600;
                        color: #7e22ce;
                        font-size: 11px;
                    }
                    .footer {
                        margin-top: 20px;
                        text-align: right;
                        font-size: 11px;
                        color: #6b7280;
                        padding-top: 12px;
                        border-top: 1px solid #e5e7eb;
                        font-family: 'Lato', sans-serif;
                        font-weight: 500;
                    }
                </style>
            </head>
            <body>
                <div class="report-container">
                    <div class="header">
                        <div class="header-text">DEPARTMENT OF INFORMATION TECHNOLOGY</div>
                        <div class="header-text">GOVERNMENT ENGINEERING COLLEGE IDUKKI</div>
                        <div class="header-text" style="margin-bottom: 20px;">ITD 334 MINI PROJECT</div>
                        <div class="report-title">
                            Guide Credentials Report
                        </div>
                    </div>
                    
                    <table class="guides-table">
                        <thead>
                            <tr>
                                <th style="width: 5%;">Sl. No.</th>
                                <th style="width: 25%;">Guide Name</th>
                                <th style="width: 30%;">Email / Username</th>
                                <th style="width: 40%;">Password</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${guides.map((guide, index) => `
                                <tr>
                                    <td style="text-align: center; color: #4b5563; font-weight: 600;">${index + 1}</td>
                                    <td style="color: #1f2937; font-weight: 500;">${this.escapeHtml(guide.name)}</td>
                                    <td style="color: #1f2937;">${this.escapeHtml(guide.email || guide.username)}</td>
                                    <td class="password-cell">${this.escapeHtml(guide.password)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="footer">
                        Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </div>
                </div>
            </body>
            </html>
        `;
        
        return html;
    },
    
    generateGuideCredentialsCSVReport(guides) {
        const csvRows = [];
        
        // Header information
        csvRows.push('DEPARTMENT OF INFORMATION TECHNOLOGY');
        csvRows.push('GOVERNMENT ENGINEERING COLLEGE IDUKKI');
        csvRows.push('ITD 334 MINI PROJECT');
        csvRows.push('');
        csvRows.push('Guide Credentials Report');
        csvRows.push('');
        csvRows.push('Sl. No.,Guide Name,Email/Username,Password');
        
        // Guide data
        guides.forEach((guide, index) => {
            csvRows.push(`${index + 1},"${guide.name}","${guide.email || guide.username}","${guide.password}"`);
        });
        
        csvRows.push('');
        csvRows.push(`Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`);
        
        // Create CSV content
        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Guide_Credentials_Report_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    generateGuideCredentialsJSONReport(guides) {
        const reportData = {
            header: {
                department: 'DEPARTMENT OF INFORMATION TECHNOLOGY',
                college: 'GOVERNMENT ENGINEERING COLLEGE IDUKKI',
                course: 'ITD 334 MINI PROJECT',
                reportTitle: 'Guide Credentials Report',
                generatedOn: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
            },
            guides: guides.map((guide, index) => ({
                serialNumber: index + 1,
                name: guide.name,
                email: guide.email || guide.username,
                username: guide.username || guide.email?.split('@')[0] || '',
                password: guide.password
            }))
        };
        
        const jsonContent = JSON.stringify(reportData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Guide_Credentials_Report_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    async generateEvaluationReport() {
        const teamId = this.currentReportTeamId;
        const stageIndex = this.currentReportStageIndex;
        const formatSelect = document.getElementById('report-format');
        
        if (!teamId || stageIndex === undefined || stageIndex === null || !formatSelect) {
            alert('Invalid report parameters.');
            return;
        }
        
        const format = formatSelect.value;
        
        try {
            // Load team data
            const teamDoc = await getDoc(doc(window.firebaseDb, 'projectGroups', teamId));
            if (!teamDoc.exists()) {
                alert('Team not found!');
                return;
            }
            
            const teamData = teamDoc.data();
            
            // Load evaluation stages
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            const stage = stages[parseInt(stageIndex)];
            
            if (!stage) {
                alert('Evaluation stage not found!');
                return;
            }
            
            // Load evaluation data
            const evalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${teamId}_${stageIndex}`));
            const evalData = evalDoc.exists() ? evalDoc.data() : {};
            
            // Get mark parameters
            const teamParams = stage.teamMarkParams || [];
            const individualParams = stage.individualMarkParams || [];
            const teamTotal = teamParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
            const individualTotal = individualParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
            
            // Generate report content
            const reportContent = this.generateReportContent(teamData, stage, evalData, teamParams, individualParams, teamTotal, individualTotal);
            
            // Generate and download based on format
            if (format === 'pdf') {
                await this.generatePDFReport(reportContent, teamData, stage);
            } else if (format === 'html') {
                this.generateHTMLReport(reportContent, teamData, stage);
            } else if (format === 'docx') {
                await this.generateDOCXReport(reportContent, teamData, stage);
            } else if (format === 'csv') {
                this.generateCSVReport(teamData, stage, evalData, teamParams, individualParams, teamTotal, individualTotal);
            } else if (format === 'json') {
                this.generateJSONReport(teamData, stage, evalData, teamParams, individualParams, teamTotal, individualTotal);
            }
            
            // Close modal after generation
            this.closeReportGenerationModal();
        } catch (error) {
            console.error('Error generating report:', error);
            alert('Error generating report. Please try again.');
        }
    },
    
    async generateConsolidatedReportFromModal() {
        const stageIndex = this.currentConsolidatedStageIndex;
        const formatSelect = document.getElementById('consolidated-report-format');
        
        if (stageIndex === undefined || stageIndex === null || !formatSelect) {
            alert('Invalid report parameters.');
            return;
        }
        
        const format = formatSelect.value;
        
        try {
            // Load evaluation stages
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            const stage = stages[parseInt(stageIndex)];
            
            if (!stage) {
                alert('Evaluation stage not found!');
                return;
            }
            
            // Generate consolidated report for all teams
            await this.generateConsolidatedReport(stage, stageIndex, format);
            
            // Close modal after generation
            this.closeConsolidatedReportModal();
        } catch (error) {
            console.error('Error generating consolidated report:', error);
            alert('Error generating consolidated report. Please try again.');
        }
    },
    
    generateReportContent(teamData, stage, evalData, teamParams, individualParams, teamTotal, individualTotal, skipHeader = false) {
        // Get team marks
        const teamMarksData = evalData.teamMarksData || {};
        const teamMarks = evalData.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
        const teamComments = evalData.teamComments || '';
        
        // Get members
        const members = teamData.members || [];
        const individualEvaluations = evalData.individualEvaluations || {};
        
        // Build report HTML content
        const containerPadding = skipHeader ? '20px' : '40px';
        const containerMargin = skipHeader ? '0' : '0 auto';
        let html = `
            <div style="font-family: 'Montserrat', 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: ${containerMargin}; padding: ${containerPadding}; line-height: ${skipHeader ? '1.6' : '1.8'}; color: #2d3748; background: #ffffff;">
                ${!skipHeader ? `
                <!-- Header -->
                <div style="text-align: center; margin-bottom: 45px; padding: 40px 30px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">DEPARTMENT OF INFORMATION TECHNOLOGY</div>
                    <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">GOVERNMENT ENGINEERING COLLEGE IDUKKI</div>
                    <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 25px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">ITD 334 MINI PROJECT</div>
                    <div style="font-family: 'Lato', sans-serif; font-size: 26px; font-weight: 700; margin-top: 25px; padding: 18px 40px; background: #f8fafc; border-radius: 12px; display: inline-block; color: #1f2937; border: 2px solid rgba(0, 0, 0, 0.08);">
                        ${this.escapeHtml(stage.name)}
                    </div>
                </div>
                ` : ''}
                
                <!-- Team Information -->
                <div style="margin-bottom: ${skipHeader ? '10px' : '35px'}; padding: ${skipHeader ? '10px' : '30px'}; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: ${skipHeader ? '14px' : '20px'}; font-weight: 700; margin-bottom: ${skipHeader ? '6px' : '25px'}; color: #1f2937; border-left: 4px solid #9333ea; padding-left: ${skipHeader ? '10px' : '12px'}; letter-spacing: 0.5px;">Team Information</h3>
                    <div style="display: grid; gap: ${skipHeader ? '4px' : '15px'};">
                        <div style="display: flex; align-items: center; padding: ${skipHeader ? '4px 8px' : '16px 20px'}; background: #f8fafc; border-radius: 8px; border-left: 3px solid #9333ea;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: ${skipHeader ? '100px' : '150px'}; font-size: ${skipHeader ? '12px' : '15px'};">Team Name:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: ${skipHeader ? '12px' : '16px'};">${this.escapeHtml(teamData.groupName || 'N/A')}</span>
                        </div>
                        ${teamData.topic ? `
                        <div style="display: flex; align-items: center; padding: ${skipHeader ? '4px 8px' : '16px 20px'}; background: #f8fafc; border-radius: 8px; border-left: 3px solid #9333ea;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: ${skipHeader ? '100px' : '150px'}; font-size: ${skipHeader ? '12px' : '15px'};">Topic:</span>
                            <span style="font-family: 'Lato', sans-serif; color: #1f2937; font-size: ${skipHeader ? '12px' : '16px'};">${this.escapeHtml(teamData.topic)}</span>
                        </div>
                        ` : ''}
                        ${teamData.guideName ? `
                        <div style="display: flex; align-items: center; padding: ${skipHeader ? '4px 8px' : '16px 20px'}; background: #f8fafc; border-radius: 8px; border-left: 3px solid #9333ea;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: ${skipHeader ? '100px' : '150px'}; font-size: ${skipHeader ? '12px' : '15px'};">Guide:</span>
                            <span style="font-family: 'Lato', sans-serif; color: #1f2937; font-size: ${skipHeader ? '12px' : '16px'};">${this.escapeHtml(teamData.guideName)}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                <!-- Team Members -->
                <div style="margin-bottom: ${skipHeader ? '10px' : '35px'}; padding: ${skipHeader ? '10px' : '30px'}; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: ${skipHeader ? '14px' : '20px'}; font-weight: 700; margin-bottom: ${skipHeader ? '6px' : '25px'}; color: #1f2937; border-left: 4px solid #0284c7; padding-left: ${skipHeader ? '10px' : '12px'}; letter-spacing: 0.5px;">Team Members</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
                        <thead>
                            <tr>
                                <th style="padding: ${skipHeader ? '6px 8px' : '16px 18px'}; background: #f8fafc; color: #1f2937; text-align: left; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: ${skipHeader ? '12px' : '15px'}; border-radius: 8px 0 0 0; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Sl. No.</th>
                                <th style="padding: ${skipHeader ? '6px 8px' : '16px 18px'}; background: #f8fafc; color: #1f2937; text-align: left; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: ${skipHeader ? '12px' : '15px'}; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Name</th>
                                <th style="padding: ${skipHeader ? '6px 8px' : '16px 18px'}; background: #f8fafc; color: #1f2937; text-align: left; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: ${skipHeader ? '12px' : '15px'}; border-radius: 0 8px 0 0; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">KTU ID</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${members.map((member, index) => `
                                <tr style="${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8fafc;'}">
                                    <td style="padding: ${skipHeader ? '4px 8px' : '14px 18px'}; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: ${skipHeader ? '12px' : '15px'}; border-bottom: 1px solid #e5e7eb;">${index + 1}</td>
                                    <td style="padding: ${skipHeader ? '4px 8px' : '14px 18px'}; color: #1f2937; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '12px' : '15px'}; border-bottom: 1px solid #e5e7eb;">${this.escapeHtml(member.name || 'N/A')}</td>
                                    <td style="padding: ${skipHeader ? '4px 8px' : '14px 18px'}; color: #1f2937; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '12px' : '15px'}; font-weight: 500; border-bottom: 1px solid #e5e7eb;">${this.escapeHtml(member.ktuid || 'N/A')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                
                <!-- Team Evaluation -->
                ${teamTotal > 0 || teamMarks !== null && teamMarks !== undefined ? `
                <div style="margin-bottom: ${skipHeader ? '20px' : '35px'}; padding: ${skipHeader ? '20px' : '30px'}; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: ${skipHeader ? '18px' : '20px'}; font-weight: 700; margin-bottom: ${skipHeader ? '15px' : '25px'}; color: #1f2937; border-left: 4px solid #059669; padding-left: 15px; letter-spacing: 0.5px;">Team Evaluation</h3>
                    ${teamParams.length > 0 ? `
                        <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: ${skipHeader ? '15px' : '25px'};">
                            <thead>
                                <tr>
                                    <th style="padding: ${skipHeader ? '12px 14px' : '16px 18px'}; background: #f8fafc; color: #1f2937; text-align: left; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: ${skipHeader ? '14px' : '15px'}; border-radius: 8px 0 0 0; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Parameter</th>
                                    <th style="padding: ${skipHeader ? '12px 14px' : '16px 18px'}; background: #f8fafc; color: #1f2937; text-align: center; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: ${skipHeader ? '14px' : '15px'}; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Marks Obtained</th>
                                    <th style="padding: ${skipHeader ? '12px 14px' : '16px 18px'}; background: #f8fafc; color: #1f2937; text-align: center; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: ${skipHeader ? '14px' : '15px'}; border-radius: 0 8px 0 0; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Maximum Marks</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${teamParams.map((param, idx) => {
                                    const paramMarks = teamMarksData[param.name] || 0;
                                    return `
                                        <tr style="${idx % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8fafc;'}">
                                            <td style="padding: ${skipHeader ? '10px 14px' : '14px 18px'}; color: #1f2937; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '14px' : '15px'}; border-bottom: 1px solid #e5e7eb;">${this.escapeHtml(param.name)}</td>
                                            <td style="padding: ${skipHeader ? '10px 14px' : '14px 18px'}; text-align: center; color: #059669; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '14px' : '15px'}; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${paramMarks}</td>
                                            <td style="padding: ${skipHeader ? '10px 14px' : '14px 18px'}; text-align: center; color: #4b5563; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '14px' : '15px'}; border-bottom: 1px solid #e5e7eb;">${param.maxMarks}</td>
                                        </tr>
                                    `;
                                }).join('')}
                                <tr style="background: #f0fdf4; border-top: 2px solid #059669;">
                                    <td style="padding: ${skipHeader ? '12px 14px' : '16px 18px'}; font-family: 'Montserrat', sans-serif; font-weight: 700; color: #1f2937; font-size: ${skipHeader ? '15px' : '16px'}; border-radius: 0 0 0 8px;">Total</td>
                                    <td style="padding: ${skipHeader ? '12px 14px' : '16px 18px'}; text-align: center; font-family: 'Montserrat', sans-serif; font-weight: 700; color: #059669; font-size: ${skipHeader ? '16px' : '18px'};">${teamMarks !== null && teamMarks !== undefined ? teamMarks : 0}</td>
                                    <td style="padding: ${skipHeader ? '12px 14px' : '16px 18px'}; text-align: center; font-family: 'Montserrat', sans-serif; font-weight: 700; color: #1f2937; font-size: ${skipHeader ? '15px' : '16px'}; border-radius: 0 0 8px 0;">${teamTotal}</td>
                                </tr>
                            </tbody>
                        </table>
                    ` : `
                        <div style="margin-bottom: ${skipHeader ? '15px' : '25px'}; padding: ${skipHeader ? '15px' : '20px'}; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #059669;">
                            <strong style="font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '15px' : '17px'}; color: #1f2937;">Total Team Marks: <span style="color: #059669; font-size: ${skipHeader ? '18px' : '20px'}; font-weight: 700;">${teamMarks !== null && teamMarks !== undefined ? teamMarks : 0}</span> / ${teamTotal}</strong>
                        </div>
                    `}
                    ${teamComments && teamComments.trim() !== '' && teamComments.trim() !== '<p><br></p>' ? `
                        <div style="margin-top: ${skipHeader ? '15px' : '25px'}; padding: ${skipHeader ? '15px' : '20px'}; background: #f8fafc; border-radius: 8px; border-left: 4px solid #9333ea;">
                            <h4 style="font-family: 'Montserrat', sans-serif; font-size: ${skipHeader ? '14px' : '16px'}; font-weight: 700; margin-bottom: ${skipHeader ? '10px' : '12px'}; color: #1f2937;">Team Comments</h4>
                            <div style="padding: ${skipHeader ? '12px' : '14px'}; background: #ffffff; border-radius: 6px; color: #374151; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '14px' : '15px'}; line-height: 1.7;">
                                ${teamComments}
                            </div>
                        </div>
                    ` : ''}
                </div>
                ` : ''}
                
                <!-- Individual Evaluations -->
                ${individualTotal > 0 || Object.keys(individualEvaluations).length > 0 ? `
                <div style="margin-bottom: ${skipHeader ? '10px' : '35px'}; padding: ${skipHeader ? '10px' : '30px'}; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: ${skipHeader ? '14px' : '20px'}; font-weight: 700; margin-bottom: ${skipHeader ? '8px' : '20px'}; color: #1f2937; border-left: 4px solid #7e22ce; padding-left: ${skipHeader ? '10px' : '12px'}; letter-spacing: 0.5px;">Individual Evaluations</h3>
                    ${members.map((member, index) => {
                        const userId = member.userId || member.ktuid;
                        const individualEval = individualEvaluations[userId] || {};
                        const studentMarks = individualEval.marks !== null && individualEval.marks !== undefined ? individualEval.marks : 0;
                        const individualComments = individualEval.comments || '';
                        const isAbsent = individualEval.isAbsent || false;
                        
                        return `
                            <div style="margin-bottom: ${index < members.length - 1 ? (skipHeader ? '8px' : '20px') : '0'}; padding-bottom: ${index < members.length - 1 ? (skipHeader ? '8px' : '20px') : '0'}; ${index < members.length - 1 ? 'border-bottom: 1px solid #e5e7eb;' : ''}">
                                <div style="display: flex; align-items: center; gap: ${skipHeader ? '6px' : '12px'}; margin-bottom: ${skipHeader ? '6px' : '12px'};">
                                    <span style="font-family: 'Montserrat', sans-serif; font-size: ${skipHeader ? '11px' : '14px'}; font-weight: 600; color: #6b7280; min-width: ${skipHeader ? '18px' : '24px'};">${index + 1}.</span>
                                    <span style="font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '12px' : '16px'}; font-weight: 600; color: #1f2937;">${this.escapeHtml(member.name || member.ktuid || 'N/A')}</span>
                                    ${member.ktuid ? ` <span style="color: #6b7280; font-weight: 400; font-size: ${skipHeader ? '11px' : '14px'};">(${this.escapeHtml(member.ktuid)})</span>` : ''}
                                    ${isAbsent ? ' <span style="padding: 2px 5px; background: #fee2e2; color: #991b1b; border-radius: 4px; font-size: 9px; font-weight: 600; font-family: \'Montserrat\', sans-serif;">Absent</span>' : ''}
                                    <span style="margin-left: auto; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '12px' : '15px'}; font-weight: 600; color: #7e22ce;">${studentMarks} / ${individualTotal}</span>
                                </div>
                                ${individualParams.length > 0 && !isAbsent ? `
                                    <table style="width: 100%; border-collapse: collapse; margin: ${skipHeader ? '4px' : '10px'} 0 ${skipHeader ? '6px' : '12px'} ${skipHeader ? '24px' : '36px'}; font-size: ${skipHeader ? '11px' : '13px'};">
                                        <tbody>
                                            ${individualParams.map((param) => {
                                                const paramMarks = individualEval.marksData?.[param.name] || 0;
                                                return `
                                                    <tr>
                                                        <td style="padding: ${skipHeader ? '2px 8px 2px 0' : '4px 12px 4px 0'}; color: #4b5563; font-family: 'Lato', sans-serif; width: 60%;">${this.escapeHtml(param.name)}</td>
                                                        <td style="padding: ${skipHeader ? '2px 0' : '4px 0'}; text-align: right; color: #1f2937; font-family: 'Lato', sans-serif; font-weight: 500;">${paramMarks} / ${param.maxMarks}</td>
                                                    </tr>
                                                `;
                                            }).join('')}
                                        </tbody>
                                    </table>
                                ` : ''}
                                ${individualComments && individualComments.trim() !== '' && individualComments.trim() !== '<p><br></p>' && individualComments.trim() !== '<p></p>' ? `
                                    <div style="margin-top: ${skipHeader ? '4px' : '8px'}; margin-left: ${skipHeader ? '24px' : '36px'}; padding: ${skipHeader ? '6px 8px' : '10px 12px'}; background: #f8fafc; border-radius: 6px; border-left: 2px solid #9333ea;">
                                        <div style="color: #374151; font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '11px' : '13px'}; line-height: ${skipHeader ? '1.5' : '1.6'};">
                                            ${individualComments}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
                ` : ''}
                
                ${!skipHeader ? `
                <!-- Footer -->
                <div style="margin-top: ${skipHeader ? '20px' : '50px'}; padding: ${skipHeader ? '16px' : '24px'}; background: #f8fafc; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); text-align: right; border: 1px solid rgba(0, 0, 0, 0.06);">
                    <div style="font-family: 'Lato', sans-serif; font-size: ${skipHeader ? '12px' : '14px'}; color: #6b7280; font-weight: 500;">Generated on: <span style="color: #1f2937; font-weight: 600;">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
                </div>
                ` : ''}
            </div>
        `;
        
        return html;
    },
    
    async generatePDFReport(reportContent, teamData, stage) {
        // Create a new window with the report content
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Evaluation Report - ${this.escapeHtml(stage.name)}</title>
                <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap" rel="stylesheet">
                <style>
                    @media print {
                        @page {
                            size: A4;
                            margin: 1cm;
                        }
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        font-family: 'Montserrat', 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    }
                    * {
                        box-sizing: border-box;
                    }
                </style>
            </head>
            <body>
                ${reportContent}
            </body>
            </html>
        `);
        printWindow.document.close();
        
        // Wait for content to load, then print/save as PDF
        printWindow.onload = function() {
            setTimeout(() => {
                printWindow.print();
            }, 250);
        };
    },
    
    generateHTMLReport(reportContent, teamData, stage) {
        // Create a blob with the HTML content
        const blob = new Blob([`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Evaluation Report - ${this.escapeHtml(stage.name)}</title>
                <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap" rel="stylesheet">
                <style>
                    body {
                        margin: 0;
                        padding: 20px;
                        font-family: 'Montserrat', 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    }
                    * {
                        box-sizing: border-box;
                    }
                </style>
            </head>
            <body>
                ${reportContent}
            </body>
            </html>
        `], { type: 'text/html' });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Evaluation_Report_${this.escapeHtml(teamData.groupName || 'Team')}_${this.escapeHtml(stage.name).replace(/[^a-z0-9]/gi, '_')}.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    async generateDOCXReport(reportContent, teamData, stage) {
        // For DOCX, we'll create an HTML file that can be opened in Word
        // Word can open HTML files and save them as DOCX
        const blob = new Blob([`
            <!DOCTYPE html>
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
                <meta charset='utf-8'>
                <title>Evaluation Report - ${this.escapeHtml(stage.name)}</title>
                <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap" rel="stylesheet">
                <!--[if gte mso 9]>
                <xml>
                    <w:WordDocument>
                        <w:View>Print</w:View>
                        <w:Zoom>90</w:Zoom>
                        <w:DoNotOptimizeForBrowser/>
                    </w:WordDocument>
                </xml>
                <![endif]-->
                <style>
                    @page {
                        size: 8.5in 11in;
                        margin: 1in;
                    }
                    body {
                        font-family: 'Montserrat', 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    }
                    * {
                        box-sizing: border-box;
                    }
                </style>
            </head>
            <body>
                ${reportContent}
            </body>
            </html>
        `], { type: 'application/msword' });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Evaluation_Report_${this.escapeHtml(teamData.groupName || 'Team')}_${this.escapeHtml(stage.name).replace(/[^a-z0-9]/gi, '_')}.doc`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    generateCSVReport(teamData, stage, evalData, teamParams, individualParams, teamTotal, individualTotal) {
        const csvRows = [];
        
        // Header information
        csvRows.push('DEPARTMENT OF INFORMATION TECHNOLOGY');
        csvRows.push('GOVERNMENT ENGINEERING COLLEGE IDUKKI');
        csvRows.push('ITD 334 MINI PROJECT');
        csvRows.push('');
        csvRows.push(`Evaluation: ${stage.name}`);
        csvRows.push('');
        
        // Team Information
        csvRows.push('Team Information');
        csvRows.push(`Team Name,${teamData.groupName || 'N/A'}`);
        if (teamData.topic) csvRows.push(`Topic,${teamData.topic}`);
        if (teamData.guideName) csvRows.push(`Guide,${teamData.guideName}`);
        csvRows.push('');
        
        // Team Members
        csvRows.push('Team Members');
        csvRows.push('Sl. No.,Name,KTU ID');
        (teamData.members || []).forEach((member, index) => {
            csvRows.push(`${index + 1},${member.name || 'N/A'},${member.ktuid || 'N/A'}`);
        });
        csvRows.push('');
        
        // Team Evaluation
        if (teamTotal > 0) {
            csvRows.push('Team Evaluation');
            const teamMarksData = evalData.teamMarksData || {};
            const teamMarks = evalData.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
            
            if (teamParams.length > 0) {
                csvRows.push('Parameter,Marks Obtained,Maximum Marks');
                teamParams.forEach(param => {
                    const paramMarks = teamMarksData[param.name] || 0;
                    csvRows.push(`${param.name},${paramMarks},${param.maxMarks}`);
                });
                csvRows.push(`Total,${teamMarks},${teamTotal}`);
            } else {
                csvRows.push(`Total Team Marks,${teamMarks},${teamTotal}`);
            }
            
            if (evalData.teamComments && evalData.teamComments.trim() !== '' && evalData.teamComments.trim() !== '<p><br></p>') {
                csvRows.push('');
                csvRows.push('Team Comments');
                csvRows.push(this.stripHtml(evalData.teamComments).replace(/\n/g, ' '));
            }
            csvRows.push('');
        }
        
        // Individual Evaluations
        if (individualTotal > 0 || Object.keys(evalData.individualEvaluations || {}).length > 0) {
            csvRows.push('Individual Evaluations');
            const members = teamData.members || [];
            const individualEvaluations = evalData.individualEvaluations || {};
            
            members.forEach((member, index) => {
                const userId = member.userId || member.ktuid;
                const individualEval = individualEvaluations[userId] || {};
                const studentMarks = individualEval.marks !== null && individualEval.marks !== undefined ? individualEval.marks : 0;
                const isAbsent = individualEval.isAbsent || false;
                
                csvRows.push('');
                csvRows.push(`Student ${index + 1}: ${member.name || member.ktuid || 'N/A'}${member.ktuid ? ` (${member.ktuid})` : ''}${isAbsent ? ' [Absent]' : ''}`);
                
                if (individualParams.length > 0 && !isAbsent) {
                    csvRows.push('Parameter,Marks Obtained,Maximum Marks');
                    individualParams.forEach(param => {
                        const paramMarks = individualEval.marksData?.[param.name] || 0;
                        csvRows.push(`${param.name},${paramMarks},${param.maxMarks}`);
                    });
                    csvRows.push(`Total,${studentMarks},${individualTotal}`);
                } else {
                    csvRows.push(`Individual Marks,${studentMarks},${individualTotal}`);
                }
                
                if (individualEval.comments && individualEval.comments.trim() !== '' && individualEval.comments.trim() !== '<p><br></p>') {
                    csvRows.push('Comments');
                    csvRows.push(this.stripHtml(individualEval.comments).replace(/\n/g, ' '));
                }
            });
        }
        
        csvRows.push('');
        csvRows.push(`Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`);
        
        // Create CSV content
        const csvContent = csvRows.join('\n');
        
        // Create download link
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Evaluation_Report_${this.escapeHtml(teamData.groupName || 'Team').replace(/[^a-z0-9]/gi, '_')}_${this.escapeHtml(stage.name).replace(/[^a-z0-9]/gi, '_')}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    generateJSONReport(teamData, stage, evalData, teamParams, individualParams, teamTotal, individualTotal) {
        const teamMarksData = evalData.teamMarksData || {};
        const teamMarks = evalData.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
        const members = teamData.members || [];
        const individualEvaluations = evalData.individualEvaluations || {};
        
        const reportData = {
            header: {
                department: 'DEPARTMENT OF INFORMATION TECHNOLOGY',
                college: 'GOVERNMENT ENGINEERING COLLEGE IDUKKI',
                course: 'ITD 334 MINI PROJECT',
                evaluation: stage.name,
                generatedOn: new Date().toISOString()
            },
            team: {
                name: teamData.groupName || 'N/A',
                topic: teamData.topic || null,
                guide: teamData.guideName || null,
                members: (teamData.members || []).map((member, index) => ({
                    serialNumber: index + 1,
                    name: member.name || 'N/A',
                    ktuid: member.ktuid || 'N/A'
                }))
            },
            teamEvaluation: {
                totalMarks: teamTotal,
                marksObtained: teamMarks !== null && teamMarks !== undefined ? teamMarks : 0,
                parameters: teamParams.map(param => ({
                    name: param.name,
                    marksObtained: teamMarksData[param.name] || 0,
                    maximumMarks: param.maxMarks
                })),
                comments: evalData.teamComments && evalData.teamComments.trim() !== '' && evalData.teamComments.trim() !== '<p><br></p>' ? this.stripHtml(evalData.teamComments) : null
            },
            individualEvaluations: members.map((member, index) => {
                const userId = member.userId || member.ktuid;
                const individualEval = individualEvaluations[userId] || {};
                const studentMarks = individualEval.marks !== null && individualEval.marks !== undefined ? individualEval.marks : 0;
                
                return {
                    serialNumber: index + 1,
                    name: member.name || 'N/A',
                    ktuid: member.ktuid || 'N/A',
                    isAbsent: individualEval.isAbsent || false,
                    totalMarks: individualTotal,
                    marksObtained: studentMarks,
                    parameters: individualParams.map(param => ({
                        name: param.name,
                        marksObtained: individualEval.marksData?.[param.name] || 0,
                        maximumMarks: param.maxMarks
                    })),
                    comments: individualEval.comments && individualEval.comments.trim() !== '' && individualEval.comments.trim() !== '<p><br></p>' ? this.stripHtml(individualEval.comments) : null
                };
            })
        };
        
        // Create JSON content
        const jsonContent = JSON.stringify(reportData, null, 2);
        
        // Create download link
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Evaluation_Report_${this.escapeHtml(teamData.groupName || 'Team').replace(/[^a-z0-9]/gi, '_')}_${this.escapeHtml(stage.name).replace(/[^a-z0-9]/gi, '_')}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    async generateConsolidatedReport(stage, stageIndex, format) {
        try {
            // Load all teams
            const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
            const teamsSnapshot = await getDocs(teamsQuery);
            
            const teams = [];
            teamsSnapshot.forEach(doc => {
                const data = doc.data();
                if (!data.deleted) {
                    teams.push({
                        id: doc.id,
                        groupName: data.groupName || 'Unnamed Team',
                        ...data
                    });
                }
            });
            
            // Load evaluation data for all teams
            const teamsWithEvaluations = await Promise.all(teams.map(async (team) => {
                try {
                    const evalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${team.id}_${stageIndex}`));
                    const evalData = evalDoc.exists() ? evalDoc.data() : {};
                    return { ...team, evaluation: evalData };
                } catch (error) {
                    console.error(`Error loading evaluation for team ${team.id}:`, error);
                    return { ...team, evaluation: {} };
                }
            }));
            
            // Apply team order settings
            const sortedTeamsWithEvaluations = await this.applyTeamOrder(teamsWithEvaluations);
            
            // Get mark parameters
            const teamParams = stage.teamMarkParams || [];
            const individualParams = stage.individualMarkParams || [];
            const teamTotal = teamParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
            const individualTotal = individualParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
            
            // Generate based on format
            if (format === 'csv') {
                this.generateConsolidatedCSVReport(sortedTeamsWithEvaluations, stage, teamParams, individualParams, teamTotal, individualTotal);
            } else if (format === 'json') {
                this.generateConsolidatedJSONReport(sortedTeamsWithEvaluations, stage, teamParams, individualParams, teamTotal, individualTotal);
            } else {
                // For PDF/HTML/DOCX, generate a consolidated HTML report
                const reportContent = this.generateConsolidatedReportContent(sortedTeamsWithEvaluations, stage, teamParams, individualParams, teamTotal, individualTotal);
                
                if (format === 'pdf') {
                    await this.generatePDFReport(reportContent, { groupName: 'All Teams' }, stage);
                } else if (format === 'html') {
                    this.generateHTMLReport(reportContent, { groupName: 'All Teams' }, stage);
                } else if (format === 'docx') {
                    await this.generateDOCXReport(reportContent, { groupName: 'All Teams' }, stage);
                }
            }
        } catch (error) {
            console.error('Error generating consolidated report:', error);
            throw error;
        }
    },
    
    generateConsolidatedCSVReport(teamsWithEvaluations, stage, teamParams, individualParams, teamTotal, individualTotal) {
        const csvRows = [];
        
        // Header information
        csvRows.push('DEPARTMENT OF INFORMATION TECHNOLOGY');
        csvRows.push('GOVERNMENT ENGINEERING COLLEGE IDUKKI');
        csvRows.push('ITD 334 MINI PROJECT');
        csvRows.push('');
        csvRows.push(`Evaluation: ${stage.name} - CONSOLIDATED REPORT`);
        csvRows.push('');
        
        // Summary row
        csvRows.push('Summary');
        csvRows.push(`Total Teams,${teamsWithEvaluations.length}`);
        csvRows.push(`Teams with Evaluations,${teamsWithEvaluations.filter(t => t.evaluation && Object.keys(t.evaluation).length > 0).length}`);
        csvRows.push('');
        
        // Team data
        teamsWithEvaluations.forEach((team, teamIndex) => {
            csvRows.push(`Team ${teamIndex + 1}: ${team.groupName || 'Unnamed Team'}`);
            csvRows.push('Field,Value');
            csvRows.push(`Topic,${team.topic || 'N/A'}`);
            csvRows.push(`Guide,${team.guideName || 'N/A'}`);
            csvRows.push('');
            csvRows.push('Team Members');
            csvRows.push('Sl. No.,Name,KTU ID');
            (team.members || []).forEach((member, index) => {
                csvRows.push(`${index + 1},${member.name || 'N/A'},${member.ktuid || 'N/A'}`);
            });
            csvRows.push('');
            
            const evalData = team.evaluation || {};
            const teamMarksData = evalData.teamMarksData || {};
            const teamMarks = evalData.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
            
            // Team Evaluation
            if (teamTotal > 0) {
                csvRows.push('Team Evaluation');
                if (teamParams.length > 0) {
                    csvRows.push('Parameter,Marks Obtained,Maximum Marks');
                    teamParams.forEach(param => {
                        const paramMarks = teamMarksData[param.name] || 0;
                        csvRows.push(`${param.name},${paramMarks},${param.maxMarks}`);
                    });
                    csvRows.push(`Total,${teamMarks},${teamTotal}`);
                } else {
                    csvRows.push(`Total Team Marks,${teamMarks},${teamTotal}`);
                }
                csvRows.push('');
            }
            
            // Individual Evaluations
            const individualEvaluations = evalData.individualEvaluations || {};
            (team.members || []).forEach((member, index) => {
                const userId = member.userId || member.ktuid;
                const individualEval = individualEvaluations[userId] || {};
                const studentMarks = individualEval.marks !== null && individualEval.marks !== undefined ? individualEval.marks : 0;
                const isAbsent = individualEval.isAbsent || false;
                
                csvRows.push(`Student ${index + 1}: ${member.name || 'N/A'}${isAbsent ? ' [Absent]' : ''}`);
                csvRows.push(`Marks,${studentMarks},${individualTotal}`);
                csvRows.push('');
            });
            
            csvRows.push('---');
            csvRows.push('');
        });
        
        csvRows.push(`Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`);
        
        // Create CSV content
        const csvContent = csvRows.join('\n');
        
        // Create download link
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Consolidated_Evaluation_Report_${this.escapeHtml(stage.name).replace(/[^a-z0-9]/gi, '_')}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    generateConsolidatedJSONReport(teamsWithEvaluations, stage, teamParams, individualParams, teamTotal, individualTotal) {
        const reportData = {
            header: {
                department: 'DEPARTMENT OF INFORMATION TECHNOLOGY',
                college: 'GOVERNMENT ENGINEERING COLLEGE IDUKKI',
                course: 'ITD 334 MINI PROJECT',
                evaluation: stage.name,
                reportType: 'CONSOLIDATED REPORT',
                generatedOn: new Date().toISOString(),
                summary: {
                    totalTeams: teamsWithEvaluations.length,
                    teamsWithEvaluations: teamsWithEvaluations.filter(t => t.evaluation && Object.keys(t.evaluation).length > 0).length
                }
            },
            teams: teamsWithEvaluations.map((team, teamIndex) => {
                const evalData = team.evaluation || {};
                const teamMarksData = evalData.teamMarksData || {};
                const teamMarks = evalData.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
                const individualEvaluations = evalData.individualEvaluations || {};
                
                return {
                    teamNumber: teamIndex + 1,
                    teamName: team.groupName || 'Unnamed Team',
                    topic: team.topic || null,
                    guide: team.guideName || null,
                    members: (team.members || []).map((member, index) => ({
                        serialNumber: index + 1,
                        name: member.name || 'N/A',
                        ktuid: member.ktuid || 'N/A'
                    })),
                    teamEvaluation: {
                        totalMarks: teamTotal,
                        marksObtained: teamMarks !== null && teamMarks !== undefined ? teamMarks : 0,
                        parameters: teamParams.map(param => ({
                            name: param.name,
                            marksObtained: teamMarksData[param.name] || 0,
                            maximumMarks: param.maxMarks
                        })),
                        comments: evalData.teamComments && evalData.teamComments.trim() !== '' && evalData.teamComments.trim() !== '<p><br></p>' ? this.stripHtml(evalData.teamComments) : null
                    },
                    individualEvaluations: (team.members || []).map((member, index) => {
                        const userId = member.userId || member.ktuid;
                        const individualEval = individualEvaluations[userId] || {};
                        const studentMarks = individualEval.marks !== null && individualEval.marks !== undefined ? individualEval.marks : 0;
                        
                        return {
                            serialNumber: index + 1,
                            name: member.name || 'N/A',
                            ktuid: member.ktuid || 'N/A',
                            isAbsent: individualEval.isAbsent || false,
                            totalMarks: individualTotal,
                            marksObtained: studentMarks,
                            parameters: individualParams.map(param => ({
                                name: param.name,
                                marksObtained: individualEval.marksData?.[param.name] || 0,
                                maximumMarks: param.maxMarks
                            })),
                            comments: individualEval.comments && individualEval.comments.trim() !== '' && individualEval.comments.trim() !== '<p><br></p>' ? this.stripHtml(individualEval.comments) : null
                        };
                    })
                };
            })
        };
        
        // Create JSON content
        const jsonContent = JSON.stringify(reportData, null, 2);
        
        // Create download link
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Consolidated_Evaluation_Report_${this.escapeHtml(stage.name).replace(/[^a-z0-9]/gi, '_')}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    
    generateConsolidatedReportContent(teamsWithEvaluations, stage, teamParams, individualParams, teamTotal, individualTotal) {
        let html = `
            <div style="font-family: 'Montserrat', 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 40px; line-height: 1.8; color: #2d3748; background: #ffffff;">
                <!-- First Page - Centered Header with Total Teams -->
                <div style="min-height: 80vh; display: flex; flex-direction: column; justify-content: center; align-items: center; page-break-after: always;">
                    <!-- Header -->
                    <div style="text-align: center; padding: 40px 30px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); border: 1px solid rgba(0, 0, 0, 0.06);">
                        <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">DEPARTMENT OF INFORMATION TECHNOLOGY</div>
                        <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">GOVERNMENT ENGINEERING COLLEGE IDUKKI</div>
                        <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 25px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">ITD 334 MINI PROJECT</div>
                        <div style="font-family: 'Lato', sans-serif; font-size: 26px; font-weight: 700; margin-top: 25px; margin-bottom: 30px; padding: 18px 40px; background: #f8fafc; border-radius: 12px; display: inline-block; color: #1f2937; border: 2px solid rgba(0, 0, 0, 0.08);">
                            ${this.escapeHtml(stage.name)} - CONSOLIDATED REPORT
                        </div>
                        <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase; margin-top: 30px;">
                            Total Teams: <span style="font-weight: 700;">${teamsWithEvaluations.length}</span>
                        </div>
                    </div>
                </div>
        `;
        
        // Generate report for each team (without header)
        teamsWithEvaluations.forEach((team, teamIndex) => {
            const evalData = team.evaluation || {};
            html += `<div style="margin-bottom: ${teamIndex < teamsWithEvaluations.length - 1 ? '0' : '20px'};">`;
            html += this.generateReportContent(team, stage, evalData, teamParams, individualParams, teamTotal, individualTotal, true);
            html += `</div>`;
            
            // Add page break between teams (except last one) with minimal margin
            if (teamIndex < teamsWithEvaluations.length - 1) {
                html += '<div style="page-break-after: always;"></div>';
            }
        });
        
                html += `
                <!-- Footer -->
                <div style="margin-top: 30px; padding: 20px; background: #f8fafc; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); text-align: right; border: 1px solid rgba(0, 0, 0, 0.06);">
                    <div style="font-family: 'Lato', sans-serif; font-size: 13px; color: #6b7280; font-weight: 500;">Generated on: <span style="color: #1f2937; font-weight: 600;">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
                </div>
            </div>
        `;
        
        return html;
    },
    
    stripHtml(html) {
        const tmp = document.createElement('DIV');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    },
    
    // Student Mini Project View
    async loadStudentMiniProject() {
        if (this.isAdmin || this.userRole === 'guide') return;
        
        const container = document.getElementById('miniproject-content');
        if (!container) return;
        
        try {
            // Find team where this student is a member
            const teamsQuery = query(collection(window.firebaseDb, 'projectGroups')); // Keep collection name for backward compatibility
            const teamsSnapshot = await getDocs(teamsQuery);
            
            let studentTeam = null;
            // Get student's KTU ID from user data
            const userDoc = await getDoc(doc(window.firebaseDb, 'users', this.currentUser.uid));
            const userData = userDoc.exists() ? userDoc.data() : {};
            const studentKtuid = userData.username || '';
            
            teamsSnapshot.forEach(doc => {
                const team = doc.data();
                if (team.deleted) return; // Skip deleted teams
                
                const members = team.members || [];
                // Check if student is a member by KTU ID or user ID
                const isMember = members.some(m => 
                    (m.ktuid && m.ktuid === studentKtuid) || 
                    (m.userId && m.userId === this.currentUser.uid) ||
                    (typeof m === 'string' && m === studentKtuid)
                );
                if (isMember) {
                    studentTeam = {
                        id: doc.id,
                        ...team
                    };
                }
            });
            
            if (!studentTeam) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-project-diagram" style="font-size: 3rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
                        <p>You haven't been assigned to a project team yet.</p>
                    </div>
                `;
                return;
            }
            
            // Load evaluation stages
            const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
            const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
            
            // Load all evaluations for this team
            const evaluations = {};
            for (let i = 0; i < stages.length; i++) {
                try {
                    const evalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${studentTeam.id}_${i}`));
                    if (evalDoc.exists()) {
                        evaluations[i] = evalDoc.data();
                    }
                } catch (error) {
                    console.error(`Error loading evaluation for stage ${i}:`, error);
                }
            }
            
            // Get student's individual evaluation data
            // studentKtuid already declared above
            const studentUserId = this.currentUser.uid;
            
            // Store team ID for problem statements
            this.currentStudentTeamId = studentTeam.id;
            
            container.innerHTML = `
                <div class="miniproject-card">
                    <div class="project-header">
                        <h2><i class="fas fa-project-diagram"></i> ${this.escapeHtml(studentTeam.groupName || 'My Project Team')}</h2>
                    </div>
                    <div class="project-info-grid">
                        <div class="info-card info-card-blue">
                            <div class="info-card-icon" style="background: linear-gradient(135deg, #3b82f6, #2563eb);">
                                <i class="fas fa-users"></i>
                            </div>
                            <div class="info-card-content">
                                <h4>Team Members</h4>
                                <div class="members-list-compact">
                                    ${(studentTeam.members || []).map(member => `
                                        <span class="member-badge">${this.escapeHtml(member.name || member.ktuid)}</span>
                                `).join('')}
                            </div>
                        </div>
                            </div>
                        <div class="info-card info-card-green">
                            <div class="info-card-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                                <i class="fas fa-book"></i>
                            </div>
                            <div class="info-card-content">
                                <h4>Project Topic</h4>
                                <p class="info-card-text">${this.escapeHtml(studentTeam.topic || 'Not assigned')}</p>
                                ${studentTeam.area ? `<div class="info-card-meta"><i class="fas fa-tag"></i> ${this.escapeHtml(studentTeam.area)}</div>` : ''}
                                ${studentTeam.subArea ? `<div class="info-card-meta"><i class="fas fa-tags"></i> ${this.escapeHtml(studentTeam.subArea)}</div>` : ''}
                            </div>
                        </div>
                        <div class="info-card info-card-purple">
                            <div class="info-card-icon" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);">
                                <i class="fas fa-user-tie"></i>
                        </div>
                            <div class="info-card-content">
                                <h4>Guide</h4>
                                <p class="info-card-text">${this.escapeHtml(studentTeam.guideName || 'Not assigned')}</p>
                            </div>
                        </div>
                    </div>
                    
                    
                    <!-- Problem Statement Section -->
                    <div class="problem-statements-section" style="margin-top: 2rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                            <h3 class="section-title"><i class="fas fa-file-alt"></i> Problem Statements</h3>
                            <button type="button" class="btn btn-primary" onclick="app.showProblemStatementModal()">
                                <i class="fas fa-plus"></i> Add Problem Statement
                            </button>
                        </div>
                        <div id="problem-statements-list" class="problem-statements-list">
                            <p class="empty-state">Loading problem statements...</p>
                        </div>
                    </div>
                        
                        ${stages.length > 0 ? `
                            <div class="evaluations-section" style="margin-top: 2rem;">
                                <h3 class="section-title"><i class="fas fa-clipboard-check"></i> Evaluations</h3>
                                <div class="evaluations-grid">
                                    ${stages.map((stage, index) => {
                                        const evalData = evaluations[index];
                                        const pptRequired = stage.pptRequired || false;
                                    // Get mark parameters (even for pending evaluations)
                                    const teamParams = stage.teamMarkParams || [];
                                    const individualParams = stage.individualMarkParams || [];
                                    const teamTotal = teamParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
                                    const individualTotal = individualParams.reduce((sum, p) => sum + (p.maxMarks || 0), 0);
                                    
                                    if (!evalData) {
                                        return `
                                            <div class="evaluation-card evaluation-pending">
                                                <div class="evaluation-header">
                                                    <h4><i class="fas fa-clock"></i> ${this.escapeHtml(stage.name)}</h4>
                                                    <span class="status-badge status-pending">Pending</span>
                                                </div>
                                                <p class="evaluation-status-text">Evaluation not yet completed.</p>
                                                ${teamTotal > 0 || individualTotal > 0 ? `
                                                    <div class="marks-section marks-pending-info">
                                                        ${teamTotal > 0 ? `
                                                            <div class="marks-header">
                                                                <span class="marks-label"><i class="fas fa-users"></i> Team Marks (Total)</span>
                                                                <span class="marks-value marks-pending">0 / ${teamTotal}</span>
                                                            </div>
                                                        ` : ''}
                                                        ${individualTotal > 0 ? `
                                                            <div class="marks-header" style="margin-top: 0.75rem;">
                                                                <span class="marks-label"><i class="fas fa-user"></i> Individual Marks (Total)</span>
                                                                <span class="marks-value marks-pending">0 / ${individualTotal}</span>
                                                            </div>
                                                        ` : ''}
                                                    </div>
                                                ` : ''}
                                            </div>
                                        `;
                                    }
                                        
                                        // Get student's individual evaluation
                                        const studentEval = evalData.individualEvaluations?.[studentUserId] || 
                                                           evalData.individualEvaluations?.[studentKtuid] || null;
                                        
                                        // Get team marks data (parameter-based or legacy)
                                        const teamMarksData = evalData.teamMarksData || {};
                                        const teamMarks = evalData.teamMarks || (Object.values(teamMarksData).reduce((sum, m) => sum + (parseFloat(m) || 0), 0));
                                        
                                        return `
                                            <div class="evaluation-card evaluation-completed">
                                                <div class="evaluation-header">
                                                    <h4><i class="fas fa-check-circle"></i> ${this.escapeHtml(stage.name)}</h4>
                                                    <span class="status-badge status-completed">Completed</span>
                                                </div>
                                                
                                                ${teamTotal > 0 || teamMarks !== null && teamMarks !== undefined ? `
                                                    <div class="marks-section team-marks">
                                                        <div class="marks-header">
                                                            <span class="marks-label"><i class="fas fa-users"></i> Team Marks</span>
                                                            <span class="marks-value marks-team">${teamMarks !== null && teamMarks !== undefined ? teamMarks : 0} / ${teamTotal}</span>
                                                        </div>
                                                        ${teamParams.length > 0 ? `
                                                            <div class="marks-breakdown">
                                                                ${teamParams.map(param => {
                                                                    const paramMarks = teamMarksData[param.name] || 0;
                                                                    return `
                                                                        <div class="breakdown-item">
                                                                            <span class="breakdown-label">${this.escapeHtml(param.name)}</span>
                                                                            <span class="breakdown-value">${paramMarks} / ${param.maxMarks}</span>
                                                                        </div>
                                                                    `;
                                                                }).join('')}
                                                                <div class="breakdown-total">
                                                                    <span class="breakdown-label"><strong>Total:</strong></span>
                                                                    <span class="breakdown-value"><strong>${teamMarks !== null && teamMarks !== undefined ? teamMarks : 0} / ${teamTotal}</strong></span>
                                                                </div>
                                                            </div>
                                                        ` : ''}
                                                        ${evalData.teamComments ? `
                                                            <div class="comments-section">
                                                                <div class="comments-label"><i class="fas fa-comment"></i> Team Comments</div>
                                                                <div class="comments-text formatted-content">${evalData.teamComments}</div>
                                                            </div>
                                                        ` : ''}
                                                    </div>
                                                ` : ''}
                                                
                                                ${individualTotal > 0 || studentEval ? `
                                                    <div class="marks-section individual-marks ${studentEval?.isAbsent ? 'marks-absent' : ''}">
                                                        <div class="marks-header">
                                                            <span class="marks-label">
                                                                <i class="fas fa-user"></i> Your Individual Marks
                                                                ${studentEval?.isAbsent ? '<span class="absent-badge"><i class="fas fa-user-times"></i> Absent</span>' : ''}
                                                            </span>
                                                            <span class="marks-value marks-individual">${studentEval && studentEval.marks !== null && studentEval.marks !== undefined ? studentEval.marks : 0} / ${individualTotal}</span>
                                                        </div>
                                                        ${studentEval?.isAbsent ? `
                                                            <div class="absent-notice">
                                                                <i class="fas fa-info-circle"></i> You were marked as absent for this evaluation.
                                                            </div>
                                                        ` : ''}
                                                        ${!studentEval?.isAbsent && individualParams.length > 0 ? `
                                                            <div class="marks-breakdown">
                                                                ${individualParams.map(param => {
                                                                    const paramMarks = studentEval?.marksData?.[param.name] || 0;
                                                                    return `
                                                                        <div class="breakdown-item">
                                                                            <span class="breakdown-label">${this.escapeHtml(param.name)}</span>
                                                                            <span class="breakdown-value">${paramMarks} / ${param.maxMarks}</span>
                                                                        </div>
                                                                    `;
                                                                }).join('')}
                                                                <div class="breakdown-total">
                                                                    <span class="breakdown-label"><strong>Total:</strong></span>
                                                                    <span class="breakdown-value"><strong>${studentEval && studentEval.marks !== null && studentEval.marks !== undefined ? studentEval.marks : 0} / ${individualTotal}</strong></span>
                                                                </div>
                                                            </div>
                                                        ` : ''}
                                                        ${studentEval?.comments ? `
                                                            <div class="comments-section">
                                                                <div class="comments-label"><i class="fas fa-comment"></i> Individual Comments</div>
                                                                <div class="comments-text formatted-content">${studentEval.comments}</div>
                                                            </div>
                                                        ` : ''}
                                                    </div>
                                                ` : `
                                                    <div class="marks-section individual-marks pending">
                                                        <p class="evaluation-status-text"><i class="fas fa-hourglass-half"></i> Your individual evaluation is not yet available.</p>
                                                    </div>
                                                `}
                                                
                                                ${pptRequired ? `
                                                    <!-- PPT Upload Section for this Stage -->
                                                    <div class="stage-ppt-section" style="margin-top: 1rem; padding: 1rem; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border-color);">
                                                        <h4 style="margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--text-primary);">
                                                            <i class="fas fa-file-powerpoint"></i> PPT for ${this.escapeHtml(stage.name)}
                                                        </h4>
                                                        <div id="ppt-container-stage-${index}">
                                                            <div id="ppt-current-link-stage-${index}" style="display: none; margin-bottom: 0.75rem; padding: 0.75rem; background: #f0f9ff; border-radius: 6px; border: 1px solid #bae6fd;">
                                                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                                                    <div style="flex: 1;">
                                                                        <strong style="color: var(--text-primary); font-size: 0.9rem;"><i class="fas fa-file-powerpoint"></i> PPT Link:</strong>
                                                                        <a id="ppt-link-url-stage-${index}" href="#" target="_blank" style="margin-left: 0.5rem; color: var(--primary-color); text-decoration: none; font-size: 0.85rem; word-break: break-all;">
                                                                            <span id="ppt-link-text-stage-${index}"></span>
                                                                        </a>
                                                                    </div>
                                                                    <button type="button" class="btn btn-secondary btn-sm" onclick="app.removeStagePPT(${index})" style="margin-left: 0.5rem;">
                                                                        <i class="fas fa-trash"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div id="ppt-link-form-stage-${index}">
                                                                <div style="display: flex; gap: 0.5rem; align-items: flex-start;">
                                                                    <input type="url" id="team-ppt-link-stage-${index}" class="form-input" placeholder="https://drive.google.com/file/d/..." style="flex: 1; font-size: 0.9rem;">
                                                                    <button type="button" class="btn btn-primary btn-sm" onclick="app.saveStagePPT(${index})">
                                                                        <i class="fas fa-save"></i> Save
                                                                    </button>
                                                                </div>
                                                                <p style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">
                                                                    <em>Upload PPT to Google Drive/OneDrive/Dropbox and paste shareable link</em>
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ` : ''}
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
            
            // Load problem statements and stage PPTs after rendering
            setTimeout(() => {
                this.loadProblemStatements();
                stages.forEach((stage, index) => {
                    if (stage.pptRequired) {
                        this.loadStagePPT(index);
                    }
                });
            }, 100);
        } catch (error) {
            // Handle permission errors gracefully
            if (error.code === 'permission-denied' || error.message?.includes('permission')) {
                console.warn('Project teams not accessible. Please update Firestore security rules.');
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
    },
    
    // Problem Statement Functions
    showProblemStatementModal() {
        const modal = document.getElementById('problem-statement-modal');
        if (!modal) return;
        
        // Reset form
        const form = document.getElementById('problem-statement-form');
        if (form) {
            form.reset();
        }
        
        modal.style.display = 'flex';
        
        // Focus on title field after a short delay to ensure modal is visible
        setTimeout(() => {
            const titleInput = document.getElementById('problem-title');
            if (titleInput) {
                titleInput.focus();
            }
        }, 100);
    },
    
    closeProblemStatementModal() {
        const modal = document.getElementById('problem-statement-modal');
        if (modal) {
            modal.style.display = 'none';
            document.getElementById('problem-statement-form').reset();
        }
    },
    
    async saveProblemStatement() {
        if (!this.currentStudentTeamId) {
            alert('Error: Team ID not found. Please refresh the page.');
            return;
        }
        
        const titleInput = document.getElementById('problem-title');
        const problemStatementInput = document.getElementById('problem-statement') || document.getElementById('problem-statement-text');
        const areaInput = document.getElementById('problem-area');
        const solutionInput = document.getElementById('problem-solution');
        
        if (!titleInput || !problemStatementInput || !areaInput || !solutionInput) {
            alert('Error: Form fields not found. Please refresh the page.');
            console.error('Missing form fields:', {
                titleInput: !!titleInput,
                problemStatementInput: !!problemStatementInput,
                areaInput: !!areaInput,
                solutionInput: !!solutionInput
            });
            return;
        }
        
        const title = titleInput.value.trim();
        const problemStatement = problemStatementInput.value.trim();
        const area = areaInput.value.trim();
        const solution = solutionInput.value.trim();
        
        // Check which fields are missing and show specific error
        const missingFields = [];
        if (!title) missingFields.push('Title');
        if (!problemStatement) missingFields.push('Problem Statement');
        if (!area) missingFields.push('Area/Technology');
        if (!solution) missingFields.push('Solution');
        
        if (missingFields.length > 0) {
            alert(`Please fill in the following required fields: ${missingFields.join(', ')}`);
            // Focus on the first missing field
            if (!title && titleInput) {
                titleInput.focus();
            } else if (!problemStatement && problemStatementInput) {
                problemStatementInput.focus();
            } else if (!area && areaInput) {
                areaInput.focus();
            } else if (!solution && solutionInput) {
                solutionInput.focus();
            }
            return;
        }
        
        try {
            // Save problem statement to Firestore
            const problemStatementData = {
                teamId: this.currentStudentTeamId,
                title: title,
                problemStatement: problemStatement,
                area: area,
                solution: solution,
                preferred: false,
                approved: false,
                createdAt: new Date().toISOString(),
                createdBy: this.currentUser.uid
            };
            
            await addDoc(collection(window.firebaseDb, 'problemStatements'), problemStatementData);
            
            alert('Problem statement added successfully!');
            this.closeProblemStatementModal();
            await this.loadProblemStatements();
        } catch (error) {
            console.error('Error saving problem statement:', error);
            alert('Error saving problem statement. Please try again.');
        }
    },
    
    async loadProblemStatements() {
        if (!this.currentStudentTeamId) return;
        
        const container = document.getElementById('problem-statements-list');
        if (!container) return;
        
        try {
            const problemStatementsQuery = query(
                collection(window.firebaseDb, 'problemStatements'),
                where('teamId', '==', this.currentStudentTeamId)
            );
            const snapshot = await getDocs(problemStatementsQuery);
            
            const problemStatements = [];
            snapshot.forEach(doc => {
                problemStatements.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // Sort by createdAt in descending order (newest first)
            problemStatements.sort((a, b) => {
                const dateA = a.createdAt || '';
                const dateB = b.createdAt || '';
                return dateB.localeCompare(dateA);
            });
            
            if (problemStatements.length === 0) {
                container.innerHTML = '<p class="empty-state">No problem statements added yet. Click "Add Problem Statement" to get started.</p>';
                return;
            }
            
            container.innerHTML = problemStatements.map((ps, index) => `
                <div class="problem-statement-item" style="margin-bottom: 1rem; padding: 1.25rem; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 0.5rem 0; color: var(--text-primary); font-size: 1.1rem;">
                                ${this.escapeHtml(ps.title)}
                                ${ps.preferred ? '<span style="margin-left: 0.5rem; padding: 2px 8px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 0.75rem; font-weight: 600;"><i class="fas fa-star"></i> Preferred</span>' : ''}
                                ${ps.approved ? '<span style="margin-left: 0.5rem; padding: 2px 8px; background: #d1fae5; color: #065f46; border-radius: 4px; font-size: 0.75rem; font-weight: 600;"><i class="fas fa-check-circle"></i> Approved</span>' : ''}
                            </h4>
                            <div style="margin-bottom: 0.5rem;">
                                <span style="padding: 4px 10px; background: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 0.85rem; font-weight: 500;">
                                    <i class="fas fa-tag"></i> ${this.escapeHtml(ps.area)}
                                </span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            ${!ps.preferred ? `
                                <button type="button" class="btn btn-secondary btn-sm" onclick="app.markPreferredProblemStatement('${ps.id}')" title="Mark as Preferred">
                                    <i class="fas fa-star"></i>
                                </button>
                            ` : ''}
                            <button type="button" class="btn btn-secondary btn-sm" onclick="app.deleteProblemStatement('${ps.id}')" title="${ps.approved ? 'Delete (Approved - This will also remove from team project details)' : 'Delete'}">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div style="margin-bottom: 0.75rem;">
                        <strong style="font-size: 0.9rem; color: var(--text-secondary);">Problem Statement:</strong>
                        <p style="margin: 0.25rem 0 0 0; color: var(--text-primary); white-space: pre-wrap;">${this.escapeHtml(ps.problemStatement)}</p>
                    </div>
                    ${ps.solution ? `
                        <div style="margin-bottom: 0.75rem;">
                            <strong style="font-size: 0.9rem; color: var(--text-secondary);">Solution:</strong>
                            <p style="margin: 0.25rem 0 0 0; color: var(--text-primary); white-space: pre-wrap;">${this.escapeHtml(ps.solution)}</p>
                        </div>
                    ` : ''}
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading problem statements:', error);
            container.innerHTML = '<p class="error-message">Error loading problem statements.</p>';
        }
    },
    
    async markPreferredProblemStatement(problemStatementId) {
        if (!this.currentStudentTeamId) return;
        
        try {
            // First, unmark all other preferred problem statements for this team
            const problemStatementsQuery = query(
                collection(window.firebaseDb, 'problemStatements'),
                where('teamId', '==', this.currentStudentTeamId)
            );
            const snapshot = await getDocs(problemStatementsQuery);
            
            const updatePromises = [];
            snapshot.forEach(doc => {
                if (doc.data().preferred) {
                    updatePromises.push(updateDoc(doc.ref, { preferred: false }));
                }
            });
            await Promise.all(updatePromises);
            
            // Mark the selected one as preferred
            await updateDoc(doc(window.firebaseDb, 'problemStatements', problemStatementId), {
                preferred: true
            });
            
            await this.loadProblemStatements();
        } catch (error) {
            console.error('Error marking preferred problem statement:', error);
            alert('Error updating preferred problem statement. Please try again.');
        }
    },
    
    async deleteProblemStatement(problemStatementId) {
        // Check if the problem statement is approved
        let isApproved = false;
        let teamId = null;
        
        try {
            const psDoc = await getDoc(doc(window.firebaseDb, 'problemStatements', problemStatementId));
            if (psDoc.exists()) {
                const psData = psDoc.data();
                isApproved = psData.approved || false;
                teamId = psData.teamId || null;
                
                if (isApproved) {
                    if (!confirm('This problem statement has been approved by the admin. Deleting it will also remove it from your team\'s project details. Are you sure you want to delete it?')) {
                        return;
                    }
                } else {
                    if (!confirm('Are you sure you want to delete this problem statement?')) {
                        return;
                    }
                }
            } else {
                if (!confirm('Are you sure you want to delete this problem statement?')) {
                    return;
                }
            }
        } catch (error) {
            console.error('Error checking problem statement:', error);
            if (!confirm('Are you sure you want to delete this problem statement?')) {
                return;
            }
        }
        
        try {
            // Delete from Firestore
            await deleteDoc(doc(window.firebaseDb, 'problemStatements', problemStatementId));
            
            // If it was approved, also remove it from team details
            if (isApproved && teamId) {
                try {
                    const teamRef = doc(window.firebaseDb, 'projectGroups', teamId);
                    const teamDoc = await getDoc(teamRef);
                    
                    if (teamDoc.exists()) {
                        const teamData = teamDoc.data();
                        // Clear team details if they match the deleted problem statement
                        await updateDoc(teamRef, {
                            topic: '',
                            problemStatement: '',
                            area: ''
                        });
                    }
                } catch (error) {
                    console.warn('Error updating team details after deletion:', error);
                    // Continue even if team update fails
                }
            }
            
            alert('Problem statement deleted successfully!');
            await this.loadProblemStatements();
        } catch (error) {
            console.error('Error deleting problem statement:', error);
            alert('Error deleting problem statement. Please try again.');
        }
    },
    
    // Stage PPT Link Functions
    async loadStagePPT(stageIndex) {
        if (!this.currentStudentTeamId) return;
        
        try {
            const evalDoc = await getDoc(doc(window.firebaseDb, 'evaluations', `${this.currentStudentTeamId}_${stageIndex}`));
            const evalData = evalDoc.exists() ? evalDoc.data() : {};
            const pptUrl = evalData.pptUrl || '';
            const pptFileName = evalData.pptFileName || '';
            
            const currentLinkDiv = document.getElementById(`ppt-current-link-stage-${stageIndex}`);
            const linkForm = document.getElementById(`ppt-link-form-stage-${stageIndex}`);
            const linkUrl = document.getElementById(`ppt-link-url-stage-${stageIndex}`);
            const linkText = document.getElementById(`ppt-link-text-stage-${stageIndex}`);
            const linkInput = document.getElementById(`team-ppt-link-stage-${stageIndex}`);
            
            if (!currentLinkDiv || !linkForm) return;
            
            if (pptUrl) {
                currentLinkDiv.style.display = 'block';
                linkForm.style.display = 'none';
                if (linkUrl) linkUrl.href = pptUrl;
                if (linkText) linkText.textContent = pptFileName || pptUrl.substring(0, 50) + (pptUrl.length > 50 ? '...' : '');
                if (linkInput) linkInput.value = pptUrl;
            } else {
                currentLinkDiv.style.display = 'none';
                linkForm.style.display = 'block';
                if (linkInput) linkInput.value = '';
            }
        } catch (error) {
            console.error(`Error loading stage ${stageIndex} PPT:`, error);
        }
    },
    
    async saveStagePPT(stageIndex) {
        if (!this.currentStudentTeamId) {
            alert('Error: Team ID not found. Please refresh the page.');
            return;
        }
        
        const linkInput = document.getElementById(`team-ppt-link-stage-${stageIndex}`);
        if (!linkInput) return;
        
        const pptLink = linkInput.value.trim();
        if (!pptLink) {
            alert('Please enter a PPT link/URL.');
            return;
        }
        
        // Basic URL validation
        try {
            new URL(pptLink);
        } catch (error) {
            alert('Please enter a valid URL. Make sure it starts with http:// or https://');
            return;
        }
        
        try {
            // Extract filename from URL if possible
            let fileName = 'Project PPT';
            try {
                const urlParts = pptLink.split('/');
                const lastPart = urlParts[urlParts.length - 1];
                if (lastPart && lastPart.includes('.')) {
                    fileName = lastPart.split('?')[0];
                }
            } catch (e) {
                // Use default name if extraction fails
            }
            
            const evalDocId = `${this.currentStudentTeamId}_${stageIndex}`;
            const evalDocRef = doc(window.firebaseDb, 'evaluations', evalDocId);
            const evalDoc = await getDoc(evalDocRef);
            
            if (evalDoc.exists()) {
                // Update existing evaluation document
                await updateDoc(evalDocRef, {
                    pptUrl: pptLink,
                    pptFileName: fileName
                });
            } else {
                // Create new evaluation document with PPT info
                await setDoc(evalDocRef, {
                    teamId: this.currentStudentTeamId,
                    stageIndex: stageIndex,
                    pptUrl: pptLink,
                    pptFileName: fileName,
                    createdAt: new Date().toISOString()
                });
            }
            
            alert('PPT link saved successfully!');
            await this.loadStagePPT(stageIndex);
        } catch (error) {
            console.error(`Error saving stage ${stageIndex} PPT link:`, error);
            alert('Error saving PPT link. Please try again.');
        }
    },
    
    async removeStagePPT(stageIndex) {
        if (!confirm('Are you sure you want to remove the PPT link?')) {
            return;
        }
        
        if (!this.currentStudentTeamId) return;
        
        try {
            const evalDocId = `${this.currentStudentTeamId}_${stageIndex}`;
            const evalDocRef = doc(window.firebaseDb, 'evaluations', evalDocId);
            const evalDoc = await getDoc(evalDocRef);
            
            if (evalDoc.exists()) {
                const evalData = evalDoc.data();
                // Remove PPT fields but keep other evaluation data
                await updateDoc(evalDocRef, {
                    pptUrl: '',
                    pptFileName: ''
                });
            }
            
            await this.loadStagePPT(stageIndex);
        } catch (error) {
            console.error(`Error removing stage ${stageIndex} PPT link:`, error);
            alert('Error removing PPT link. Please try again.');
        }
    },
    
    // Admin: Load all problem statements
    async loadAllProblemStatements() {
        if (!this.isAdmin) return;
        
        const container = document.getElementById('all-problem-statements-list');
        const tableContainer = document.getElementById('teams-approved-topics-table');
        if (!container || !tableContainer) return;
        
        try {
            const problemStatementsQuery = query(
                collection(window.firebaseDb, 'problemStatements')
            );
            const snapshot = await getDocs(problemStatementsQuery);
            
            // Get all teams
            const teamsQuery = query(collection(window.firebaseDb, 'projectGroups'));
            const teamsSnapshot = await getDocs(teamsQuery);
            const teamsMap = {};
            teamsSnapshot.forEach(doc => {
                teamsMap[doc.id] = doc.data();
            });
            
            // Load teams and approved topics table
            await this.loadTeamsApprovedTopicsTable(teamsMap, snapshot);
            
            const problemStatements = [];
            snapshot.forEach(doc => {
                const ps = doc.data();
                problemStatements.push({
                    id: doc.id,
                    ...ps,
                    team: teamsMap[ps.teamId] || null
                });
            });
            
            if (problemStatements.length === 0) {
                container.innerHTML = '<p class="empty-state">No problem statements submitted yet.</p>';
                return;
            }
            
            // Group problem statements by team
            const groupedByTeam = {};
            problemStatements.forEach(ps => {
                const teamId = ps.teamId || 'unknown';
                const teamName = ps.team ? (ps.team.groupName || 'Unknown Team') : 'Unknown Team';
                
                if (!groupedByTeam[teamId]) {
                    groupedByTeam[teamId] = {
                        teamId: teamId,
                        teamName: teamName,
                        teamData: ps.team,
                        problemStatements: []
                    };
                }
                groupedByTeam[teamId].problemStatements.push(ps);
            });
            
            // Sort problem statements within each team by createdAt (newest first)
            Object.keys(groupedByTeam).forEach(teamId => {
                groupedByTeam[teamId].problemStatements.sort((a, b) => {
                const dateA = a.createdAt || '';
                const dateB = b.createdAt || '';
                return dateB.localeCompare(dateA);
                });
            });
            
            // Apply team order settings
            const teamGroupsArray = Object.values(groupedByTeam);
            // Convert to team objects for ordering
            const teamsForOrdering = teamGroupsArray
                .filter(tg => tg.teamData)
                .map(tg => ({
                    id: tg.teamId,
                    ...tg.teamData
                }));
            
            // Apply team order
            const orderedTeams = await this.applyTeamOrder(teamsForOrdering);
            
            // Create a map of ordered team IDs
            const orderMap = new Map();
            orderedTeams.forEach((team, index) => {
                orderMap.set(team.id, index);
            });
            
            // Sort team groups according to the order
            const sortedTeams = teamGroupsArray.sort((a, b) => {
                const orderA = orderMap.has(a.teamId) ? orderMap.get(a.teamId) : 9999;
                const orderB = orderMap.has(b.teamId) ? orderMap.get(b.teamId) : 9999;
                return orderA - orderB;
            });
            
            // Render grouped by teams - SIMPLE CLEAN STRUCTURE with collapsible
            container.innerHTML = sortedTeams.map((teamGroup, teamIndex) => {
                const teamId = `team-${teamIndex}`;
                return `
                    <div style="margin-bottom: 2rem; width: 100%;">
                        <div class="team-header-collapsible" onclick="app.toggleTeamProblemStatements('${teamId}')" style="padding: 1rem 1.5rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; margin-bottom: 1rem; cursor: pointer; user-select: none; transition: all 0.2s;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <h3 style="margin: 0; color: white; font-size: 1.25rem; font-weight: 600; display: flex; align-items: center; gap: 0.75rem;">
                                        <i class="fas fa-users"></i> ${this.escapeHtml(teamGroup.teamName)}
                                    </h3>
                                    ${teamGroup.teamData && teamGroup.teamData.guideName ? `
                                        <p style="margin: 0.5rem 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 0.9rem;">
                                            <i class="fas fa-user-tie"></i> Guide: ${this.escapeHtml(teamGroup.teamData.guideName)}
                                        </p>
                                    ` : ''}
                                </div>
                                <i class="fas fa-chevron-down team-toggle-icon" id="icon-${teamId}" style="color: white; font-size: 1.2rem; transition: transform 0.3s; transform: rotate(-90deg);"></i>
                            </div>
                        </div>
                        <div class="team-problem-statements-content" id="content-${teamId}" style="display: none;">
                            ${teamGroup.problemStatements.map(ps => {
                                return `
                                    <div style="margin-bottom: 2rem; background: white; border-radius: 8px; border: 1px solid #e2e8f0; ${ps.approved ? 'border-left: 4px solid #10b981;' : ''}; overflow: hidden;">
                                        <div style="padding: 1.5rem; border-bottom: 1px solid #e2e8f0;">
                                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="flex: 1;">
                                                    <h4 style="margin: 0 0 0.5rem 0; color: #1e293b; font-size: 1.15rem;">
                                ${this.escapeHtml(ps.title)}
                                ${ps.preferred ? '<span style="margin-left: 0.5rem; padding: 3px 10px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 0.8rem; font-weight: 600;"><i class="fas fa-star"></i> Preferred</span>' : ''}
                                ${ps.approved ? '<span style="margin-left: 0.5rem; padding: 3px 10px; background: #d1fae5; color: #065f46; border-radius: 4px; font-size: 0.8rem; font-weight: 600;"><i class="fas fa-check-circle"></i> Approved</span>' : ''}
                            </h4>
                                <span style="padding: 4px 10px; background: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 0.85rem; font-weight: 500;">
                                    <i class="fas fa-tag"></i> ${this.escapeHtml(ps.area)}
                                </span>
                        </div>
                        ${!ps.approved ? `
                                                    <button type="button" class="btn btn-primary" onclick="app.approveProblemStatement('${ps.id}', '${ps.teamId}')" style="margin-left: 1rem;">
                                <i class="fas fa-check"></i> Approve
                            </button>
                        ` : ''}
                    </div>
                                        </div>
                                        <div class="problem-container" style="background: #f9fafb; padding: 1.5rem; border-bottom: ${ps.solution ? '1px solid #e5e7eb' : 'none'}; width: 100%; max-width: 100%; min-width: 100%; box-sizing: border-box; display: block;">
                                            <div style="font-size: 0.95rem; color: #64748b; margin-bottom: 0.75rem; font-weight: 600; width: 100%; display: block;">
                                                <i class="fas fa-file-alt"></i> Problem Statement:
                                            </div>
                                            <div class="problem-text" style="color: #1e293b; white-space: pre-wrap; line-height: 1.6; font-size: 0.95rem; word-break: break-word; overflow-wrap: break-word; width: 100%; max-width: 100%; min-width: 100%; display: block; box-sizing: border-box;">${this.escapeHtml(ps.problemStatement)}</div>
                    </div>
                    ${ps.solution ? `
                                            <div class="solution-container" style="background: #f0fdf4; padding: 1.5rem; width: 100%; max-width: 100%; min-width: 100%; box-sizing: border-box; display: block;">
                                                <div style="font-size: 0.95rem; color: #64748b; margin-bottom: 0.75rem; font-weight: 600; width: 100%; display: block;">
                                                    <i class="fas fa-lightbulb"></i> Solution:
                                                </div>
                                                <div class="solution-text" style="color: #1e293b; white-space: pre-wrap; line-height: 1.6; font-size: 0.95rem; word-break: break-word; overflow-wrap: break-word; width: 100%; max-width: 100%; min-width: 100%; display: block; box-sizing: border-box;">${this.escapeHtml(ps.solution)}</div>
                        </div>
                    ` : ''}
                </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading all problem statements:', error);
            container.innerHTML = '<p class="error-message">Error loading problem statements.</p>';
            const tableContainer = document.getElementById('teams-approved-topics-table');
            if (tableContainer) {
                tableContainer.innerHTML = '<p class="error-message">Error loading teams and approved topics.</p>';
            }
        }
    },
    
    // Toggle team problem statements visibility
    toggleTeamProblemStatements(teamId) {
        const content = document.getElementById(`content-${teamId}`);
        const icon = document.getElementById(`icon-${teamId}`);
        
        if (!content || !icon) return;
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.style.transform = 'rotate(0deg)';
        } else {
            content.style.display = 'none';
            icon.style.transform = 'rotate(-90deg)';
        }
    },
    
    // Load teams and approved topics table
    async loadTeamsApprovedTopicsTable(teamsMap, problemStatementsSnapshot) {
        const tableContainer = document.getElementById('teams-approved-topics-table');
        if (!tableContainer) return;
        
        try {
            // Get all problem statements (both approved and pending)
            const allProblemStatements = [];
            const approvedProblemStatements = [];
            problemStatementsSnapshot.forEach(doc => {
                const ps = doc.data();
                if (ps.teamId) {
                    allProblemStatements.push({
                        id: doc.id,
                        ...ps,
                        team: teamsMap[ps.teamId] || null
                    });
                    if (ps.approved) {
                        approvedProblemStatements.push({
                            id: doc.id,
                            ...ps,
                            team: teamsMap[ps.teamId] || null
                        });
                    }
                }
            });
            
            // Get all teams and their approved topics
            const teamsWithApprovedTopics = [];
            Object.keys(teamsMap).forEach(teamId => {
                const team = teamsMap[teamId];
                const approvedPS = approvedProblemStatements.find(ps => ps.teamId === teamId);
                const hasAnyProblemStatements = allProblemStatements.some(ps => ps.teamId === teamId);
                
                teamsWithApprovedTopics.push({
                    teamId: teamId,
                    teamName: team.groupName || 'Unknown Team',
                    guideName: team.guideName || 'Not assigned',
                    approvedTopic: approvedPS ? approvedPS.title : (hasAnyProblemStatements ? 'Approval Pending' : 'No Problem Statements Uploaded'),
                    approvedArea: approvedPS ? approvedPS.area : '-',
                    approvedProblemStatement: approvedPS ? approvedPS.problemStatement : '-',
                    hasApproved: !!approvedPS,
                    hasAnyProblemStatements: hasAnyProblemStatements,
                    team: team // Keep team object for ordering
                });
            });
            
            // Apply team order settings
            const teamsForOrdering = teamsWithApprovedTopics.map(t => ({
                id: t.teamId,
                ...t.team
            }));
            const orderedTeams = await this.applyTeamOrder(teamsForOrdering);
            
            // Create a map of ordered team IDs
            const orderMap = new Map();
            orderedTeams.forEach((team, index) => {
                orderMap.set(team.id, index);
            });
            
            // Sort teams according to the order
            teamsWithApprovedTopics.sort((a, b) => {
                const orderA = orderMap.has(a.teamId) ? orderMap.get(a.teamId) : 9999;
                const orderB = orderMap.has(b.teamId) ? orderMap.get(b.teamId) : 9999;
                return orderA - orderB;
            });
            
            if (teamsWithApprovedTopics.length === 0) {
                tableContainer.innerHTML = '<p class="empty-state">No teams found.</p>';
                return;
            }
            
            // Create table
            tableContainer.innerHTML = `
                <table style="width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow);">
                    <thead>
                        <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                            <th style="padding: 1rem; text-align: left; font-weight: 600; font-size: 0.95rem; width: 30%; min-width: 250px; white-space: nowrap;">Team Name</th>
                            <th style="padding: 1rem; text-align: left; font-weight: 600; font-size: 0.95rem;">Guide</th>
                            <th style="padding: 1rem; text-align: left; font-weight: 600; font-size: 0.95rem;">Approved Topic</th>
                            <th style="padding: 1rem; text-align: left; font-weight: 600; font-size: 0.95rem;">Area/Technology</th>
                            <th style="padding: 1rem; text-align: left; font-weight: 600; font-size: 0.95rem;">Problem Statement</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${teamsWithApprovedTopics.map(team => {
                            const rowBgColor = team.hasApproved ? '' : (team.hasAnyProblemStatements ? 'background: #fffbeb;' : 'background: #fef2f2;');
                            return `
                            <tr style="border-bottom: 1px solid var(--border-color); ${rowBgColor}">
                                <td style="padding: 1rem; font-weight: 600; color: var(--text-primary); width: 30%; min-width: 250px; white-space: nowrap;">
                                    <i class="fas fa-users" style="margin-right: 0.5rem; color: var(--primary-color);"></i>
                                    ${this.escapeHtml(team.teamName)}
                                </td>
                                <td style="padding: 1rem; color: var(--text-secondary);">
                                    <i class="fas fa-user-tie" style="margin-right: 0.5rem;"></i>
                                    ${this.escapeHtml(team.guideName)}
                                </td>
                                <td style="padding: 1rem; color: var(--text-primary); ${team.hasApproved ? 'font-weight: 500;' : 'color: var(--text-secondary); font-style: italic;'}">
                                    ${team.hasApproved ? `<span style="color: #10b981;"><i class="fas fa-check-circle" style="margin-right: 0.5rem;"></i></span>` : (team.hasAnyProblemStatements ? `<span style="color: #f59e0b;"><i class="fas fa-clock" style="margin-right: 0.5rem;"></i></span>` : `<span style="color: #ef4444;"><i class="fas fa-exclamation-circle" style="margin-right: 0.5rem;"></i></span>`)}
                                    ${this.escapeHtml(team.approvedTopic)}
                                </td>
                                <td style="padding: 1rem; color: var(--text-primary);">
                                    ${team.hasApproved ? `
                                        <span style="padding: 4px 10px; background: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 0.85rem; font-weight: 500;">
                                            <i class="fas fa-tag"></i> ${this.escapeHtml(team.approvedArea)}
                                        </span>
                                    ` : '<span style="color: var(--text-secondary);">-</span>'}
                                </td>
                                <td style="padding: 1rem; color: var(--text-primary); max-width: 400px;">
                                    ${team.hasApproved ? `
                                        <div style="max-height: 100px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5; font-size: 0.9rem; color: var(--text-secondary);">
                                            ${this.escapeHtml(team.approvedProblemStatement.length > 150 ? team.approvedProblemStatement.substring(0, 150) + '...' : team.approvedProblemStatement)}
                                        </div>
                                    ` : '<span style="color: var(--text-secondary);">-</span>'}
                                </td>
                            </tr>
                        `;
                        }).join('')}
                    </tbody>
                </table>
            `;
            
            // Show print button after table is loaded
            const printBtn = document.getElementById('print-teams-topics-report-btn');
            if (printBtn) {
                printBtn.style.display = 'inline-flex';
            }
            
            // Store data for printing
            this.teamsApprovedTopicsData = teamsWithApprovedTopics;
        } catch (error) {
            console.error('Error loading teams and approved topics table:', error);
            tableContainer.innerHTML = '<p class="error-message">Error loading teams and approved topics.</p>';
        }
    },
    
    // Print teams and approved topics report
    printTeamsApprovedTopicsReport() {
        if (!this.teamsApprovedTopicsData || this.teamsApprovedTopicsData.length === 0) {
            alert('No data available to print.');
            return;
        }
        
        const printWindow = window.open('', '_blank');
        const currentDate = new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Teams and Approved Topics Report</title>
                <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Lato:wght@400;600;700&display=swap" rel="stylesheet">
                <style>
                    @media print {
                        @page {
                            margin: 1.5cm;
                            size: A4 landscape;
                        }
                        body {
                            margin: 0;
                            padding: 0;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        .no-print {
                            display: none;
                        }
                        * {
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                    }
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    body {
                        font-family: 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        margin: 0;
                        padding: 30px;
                        color: #1e293b;
                        background: #ffffff;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 35px;
                        padding: 25px;
                        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                        background-color: #6366f1;
                        border-radius: 12px;
                        box-shadow: 0 10px 25px rgba(99, 102, 241, 0.2);
                        color: white;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .header h1 {
                        margin: 0 0 15px 0;
                        font-family: 'Montserrat', sans-serif;
                        font-size: 32px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 1.5px;
                        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                    }
                    .header .subtitle {
                        font-size: 16px;
                        font-weight: 400;
                        opacity: 0.95;
                        margin: 8px 0;
                    }
                    .header .stats {
                        display: flex;
                        justify-content: center;
                        gap: 30px;
                        margin-top: 20px;
                        flex-wrap: wrap;
                    }
                    .header .stat-item {
                        background: rgba(255, 255, 255, 0.2);
                        padding: 10px 20px;
                        border-radius: 8px;
                        backdrop-filter: blur(10px);
                    }
                    .header .stat-label {
                        font-size: 12px;
                        opacity: 0.9;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                    }
                    .header .stat-value {
                        font-size: 24px;
                        font-weight: 700;
                        margin-top: 5px;
                    }
                    table {
                        width: 100%;
                        border-collapse: separate;
                        border-spacing: 0;
                        margin-top: 25px;
                        font-size: 13px;
                        background: white;
                        border-radius: 10px;
                        overflow: hidden;
                        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    th {
                        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                        background-color: #6366f1;
                        color: white !important;
                        padding: 16px 12px;
                        text-align: left;
                        font-weight: 700;
                        font-family: 'Montserrat', sans-serif;
                        font-size: 13px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        border: none;
                        position: relative;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    th:not(:last-child)::after {
                        content: '';
                        position: absolute;
                        right: 0;
                        top: 20%;
                        height: 60%;
                        width: 1px;
                        background: rgba(255, 255, 255, 0.3);
                    }
                    td {
                        padding: 14px 12px;
                        border-bottom: 1px solid #cbd5e1;
                        vertical-align: top;
                        font-family: 'Lato', sans-serif;
                    }
                    tr:last-child td {
                        border-bottom: none;
                    }
                    tr:nth-child(even) {
                        background: #eff6ff;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    tr.pending-approval {
                        background: linear-gradient(90deg, #fffbeb 0%, #fef3c7 100%);
                        background-color: #fffbeb;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    tr.pending-approval:hover {
                        background: linear-gradient(90deg, #fef3c7 0%, #fde68a 100%);
                        background-color: #fef3c7;
                    }
                    tr.no-upload {
                        background: linear-gradient(90deg, #fef2f2 0%, #fee2e2 100%);
                        background-color: #fef2f2;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    tr.no-upload:hover {
                        background: linear-gradient(90deg, #fee2e2 0%, #fecaca 100%);
                        background-color: #fee2e2;
                    }
                    tr:hover:not(.no-approval) {
                        background: #dbeafe;
                        transition: background 0.2s;
                    }
                    .badge {
                        display: inline-block;
                        padding: 6px 12px;
                        border-radius: 6px;
                        font-size: 11px;
                        font-weight: 600;
                        font-family: 'Montserrat', sans-serif;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 5px;
                    }
                    .badge-approved {
                        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                        background-color: #10b981;
                        color: white !important;
                        box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .badge-area {
                        background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                        background-color: #6366f1;
                        color: white !important;
                        box-shadow: 0 2px 4px rgba(99, 102, 241, 0.3);
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .badge-pending {
                        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                        background-color: #f59e0b;
                        color: white !important;
                        box-shadow: 0 2px 4px rgba(245, 158, 11, 0.3);
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .badge-no-upload {
                        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                        background-color: #ef4444;
                        color: white !important;
                        box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3);
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .team-name {
                        font-weight: 700;
                        font-family: 'Montserrat', sans-serif;
                        color: #6366f1;
                        font-size: 14px;
                    }
                    .guide-name {
                        color: #1e40af;
                        font-weight: 500;
                    }
                    .topic-text {
                        font-weight: 600;
                        color: #1e293b;
                        line-height: 1.5;
                    }
                    .problem-statement-text {
                        font-size: 12px;
                        line-height: 1.6;
                        color: #1e293b;
                        white-space: pre-wrap;
                    }
                    .footer {
                        margin-top: 40px;
                        text-align: center;
                        font-size: 12px;
                        color: #1e40af;
                        border-top: 2px solid #cbd5e1;
                        padding-top: 20px;
                        font-family: 'Lato', sans-serif;
                    }
                    .footer .logo-text {
                        font-family: 'Montserrat', sans-serif;
                        font-weight: 700;
                        font-size: 16px;
                        color: #6366f1;
                        margin-bottom: 5px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Teams and Approved Topics Report</h1>
                    <p class="subtitle">IGNITE Mini Project Management System</p>
                    <div class="stats">
                        <div class="stat-item">
                            <div class="stat-label">Generated On</div>
                            <div class="stat-value" style="font-size: 14px; font-weight: 600;">${currentDate}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Total Teams</div>
                            <div class="stat-value">${this.teamsApprovedTopicsData.length}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Approved Topics</div>
                            <div class="stat-value">${this.teamsApprovedTopicsData.filter(t => t.hasApproved).length}</div>
                        </div>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 20%;">Team Name</th>
                            <th style="width: 18%;">Guide</th>
                            <th style="width: 22%;">Approved Topic</th>
                            <th style="width: 15%;">Area/Technology</th>
                            <th style="width: 25%;">Problem Statement</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        this.teamsApprovedTopicsData.forEach(team => {
            const statusClass = team.hasApproved ? '' : (team.hasAnyProblemStatements ? 'pending-approval' : 'no-upload');
            html += `
                <tr class="${statusClass}">
                    <td>
                        <div class="team-name">👥 ${this.escapeHtml(team.teamName)}</div>
                    </td>
                    <td>
                        <div class="guide-name">👔 ${this.escapeHtml(team.guideName)}</div>
                    </td>
                    <td>
                        ${team.hasApproved ? `
                            <span class="badge badge-approved">✓ Approved</span>
                            <div class="topic-text" style="margin-top: 8px;">${this.escapeHtml(team.approvedTopic)}</div>
                        ` : (team.hasAnyProblemStatements ? `
                            <span class="badge badge-pending">⏳ Approval Pending</span>
                        ` : `
                            <span class="badge badge-no-upload">⚠ No Problem Statements Uploaded</span>
                        `)}
                    </td>
                    <td>
                        ${team.hasApproved ? `
                            <span class="badge badge-area">${this.escapeHtml(team.approvedArea)}</span>
                        ` : '<span style="color: #1e40af; font-weight: 500;">-</span>'}
                    </td>
                    <td>
                        <div class="problem-statement-text">${team.hasApproved ? this.escapeHtml(team.approvedProblemStatement) : '<span style="color: #1e40af; font-weight: 500;">-</span>'}</div>
                    </td>
                </tr>
            `;
        });
        
        html += `
                    </tbody>
                </table>
                <div class="footer">
                    <div class="logo-text">IGNITE</div>
                    <p>This report was generated from the IGNITE Mini Project Management System</p>
                    <p style="margin-top: 5px; font-size: 11px;">© ${new Date().getFullYear()} IGNITE - Empowering Dreams, One Step at a Time</p>
                </div>
            </body>
            </html>
        `;
        
        printWindow.document.write(html);
        printWindow.document.close();
        
        // Wait for content to load, then print
        setTimeout(() => {
            printWindow.print();
        }, 250);
    },
    
    async approveProblemStatement(problemStatementId, teamId) {
        if (!this.isAdmin) return;
        
        if (!confirm('Are you sure you want to approve this problem statement? This will update the team\'s mini project details.')) {
            return;
        }
        
        try {
            // Get the problem statement
            const psDoc = await getDoc(doc(window.firebaseDb, 'problemStatements', problemStatementId));
            if (!psDoc.exists()) {
                alert('Problem statement not found.');
                return;
            }
            
            const psData = psDoc.data();
            
            // Update all problem statements for this team - unapprove others
            const problemStatementsQuery = query(
                collection(window.firebaseDb, 'problemStatements'),
                where('teamId', '==', teamId)
            );
            const snapshot = await getDocs(problemStatementsQuery);
            
            const updatePromises = [];
            snapshot.forEach(doc => {
                if (doc.data().approved) {
                    updatePromises.push(updateDoc(doc.ref, { approved: false }));
                }
            });
            await Promise.all(updatePromises);
            
            // Approve the selected problem statement
            await updateDoc(doc(window.firebaseDb, 'problemStatements', problemStatementId), {
                approved: true
            });
            
            // Update team's mini project details
            const teamRef = doc(window.firebaseDb, 'projectGroups', teamId);
            await updateDoc(teamRef, {
                topic: psData.title,
                problemStatement: psData.problemStatement,
                area: psData.area
            });
            
            alert('Problem statement approved and team details updated successfully!');
            await this.loadAllProblemStatements();
        } catch (error) {
            console.error('Error approving problem statement:', error);
            alert('Error approving problem statement. Please try again.');
        }
    }
};

// Make app available globally for onclick handlers
window.app = app;

// Ensure showCreateTeamModal is accessible (for debugging)
if (typeof window.app.showCreateTeamModal !== 'function') {
    console.error('showCreateTeamModal function not found in app object');
    console.log('Available methods:', Object.keys(window.app).filter(key => typeof window.app[key] === 'function'));
}

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
    // Buttons use simple onclick handlers - no setup needed
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
