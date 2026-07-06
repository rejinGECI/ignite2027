// Authentication module
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createAuthModule(app) {
    return {
        checkAuthState: function() {
            // Check Firebase auth for admin and students (guides use Firestore login)
            // Only check if Firebase is initialized
            if (window.firebaseAuth) {
                onAuthStateChanged(window.firebaseAuth, async (user) => {
                    // Prevent navigation when creating a guide account
                    if (app.isCreatingGuide) {
                        return;
                    }
                    
                    // Check if guide is logged in (stored in sessionStorage)
                    const guideSession = sessionStorage.getItem('guideSession');
                    if (guideSession) {
                        try {
                            const guideData = JSON.parse(guideSession);
                            app.currentUser = {
                                uid: guideData.uid,
                                email: guideData.email,
                                displayName: guideData.name
                            };
                            app.userRole = 'guide';
                            app.isAdmin = false;
                            app.isGuide = true;
                            await app.loadUserData();
                            app.showApp();
                            return;
                        } catch (e) {
                            sessionStorage.removeItem('guideSession');
                        }
                    }
                    
                    if (user) {
                        app.currentUser = user;
                        await app.loadUserData();
                        app.showApp();
                    } else {
                        app.showLogin();
                    }
                });
            } else {
                // Firebase not initialized, show login
                app.showLogin();
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
                        app.currentUser = {
                            uid: guideDoc.id,
                            email: guideData.email,
                            displayName: guideData.name
                        };
                        app.userRole = 'guide';
                        app.isAdmin = false;
                        app.isGuide = true;
                        
                        // Store guide session
                        sessionStorage.setItem('guideSession', JSON.stringify({
                            uid: guideDoc.id,
                            email: guideData.email,
                            name: guideData.name
                        }));
                        
                        // Show app
                        app.showApp();
                        await app.loadUserData();
                        app.showPage('guide-dashboard');
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
                    app.currentUser = userCredential.user;
                    const userDoc = await getDoc(doc(window.firebaseDb, 'users', userCredential.user.uid));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        app.userRole = userData.role || 'student';
                        app.isAdmin = app.userRole === 'admin';
                        app.isGuide = app.userRole === 'guide';
                        
                        // Show app first
                        app.showApp();
                        
                        // Navigate to appropriate page and load data based on role
                        if (app.isAdmin) {
                            // Show admin progress page (home page) and load data
                            app.showPage('admin-progress');
                        } else if (app.isGuide) {
                            // Load guide data and show guide dashboard
                            await app.loadUserData();
                            app.showPage('guide-dashboard');
                        } else {
                            // Load student data
                            await app.loadUserData();
                        }
                    } else {
                        // User document doesn't exist - might be a new account
                        // Try to determine role from email format
                        if (email.includes('@student.local')) {
                            app.userRole = 'student';
                            app.isAdmin = false;
                            app.isGuide = false;
                            app.showApp();
                            await app.loadUserData();
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
            
            if (app.currentUser && window.firebaseAuth) {
                try {
                    await signOut(window.firebaseAuth);
                } catch (e) {
                    // Ignore errors if not using Firebase Auth
                }
            }
            
            // Clear saved page state on logout
            localStorage.removeItem('currentPage');
            
            app.currentUser = null;
            app.isAdmin = false;
            app.isGuide = false;
            app.userRole = null;
            app.showLogin();
        },
        
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
        
        setupCSVUpload: function() {
            const csvInput = document.getElementById('csv-file-input');
            
            if (csvInput && !csvInput.hasAttribute('data-listener-attached')) {
                // Add change event listener to input
                csvInput.addEventListener('change', (event) => {
                    if (event.target.files && event.target.files.length > 0) {
                        app.handleCSVUpload(event);
                    }
                });
                csvInput.setAttribute('data-listener-attached', 'true');
            }
        },
        
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
                        
                        await app.createStudentAccount(ktuid, name);
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
                await app.loadStudentsList();
                
                // Clear file input
                event.target.value = '';
            } catch (error) {
                statusDiv.innerHTML = `<div class="csv-error">Error reading CSV file: ${error.message}</div>`;
            }
        }
    };
}

