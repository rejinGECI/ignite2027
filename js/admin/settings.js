// Admin Settings module
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createAdminSettingsModule(app) {
    return {
        async loadAdminSettings() {
            if (!app.isAdmin) return;
            
            try {
                const goLiveDate = await app.getGoLiveDate();
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
                
                // Load problem statement presentation status
                await app.loadProblemStatementPresentationStatus();
            } catch (error) {
                console.error('Error loading admin settings:', error);
            }
        },
        
        async saveGoLiveDate() {
            if (!app.isAdmin) {
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
                    updatedBy: app.currentUser.uid
                }, { merge: true });
                
                // Show success
                if (statusDiv) {
                    statusDiv.innerHTML = '<div class="csv-success">Go-live date saved successfully! All streaks and statistics will be recalculated.</div>';
                }
                
                // Reload the settings page to show updated date
                await app.loadAdminSettings();
                
                // Refresh dashboard and statistics for all users
                if (!app.isAdmin) {
                    await app.updateDashboard();
                    await app.updateStatistics();
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
        
        async loadProblemStatementPresentationStatus() {
            if (!app.isAdmin) return;
            
            try {
                const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'problemStatement'));
                const isOver = settingsDoc.exists() && settingsDoc.data().presentationOver === true;
                
                const checkbox = document.getElementById('problem-statement-presentation-over');
                if (checkbox) {
                    checkbox.checked = isOver;
                }
            } catch (error) {
                console.error('Error loading problem statement presentation status:', error);
            }
        },
        
        async toggleProblemStatementPresentation() {
            if (!app.isAdmin) {
                alert('Only administrators can change this setting.');
                return;
            }
            
            const checkbox = document.getElementById('problem-statement-presentation-over');
            const statusDiv = document.getElementById('problem-statement-presentation-status');
            
            if (!checkbox) return;
            
            const isOver = checkbox.checked;
            
            try {
                const settingsRef = doc(window.firebaseDb, 'settings', 'problemStatement');
                const settingsDoc = await getDoc(settingsRef);
                
                if (settingsDoc.exists()) {
                    await updateDoc(settingsRef, {
                        presentationOver: isOver,
                        updatedAt: serverTimestamp(),
                        updatedBy: app.currentUser.uid
                    });
                } else {
                    await setDoc(settingsRef, {
                        presentationOver: isOver,
                        createdAt: serverTimestamp(),
                        createdBy: app.currentUser.uid,
                        updatedAt: serverTimestamp(),
                        updatedBy: app.currentUser.uid
                    });
                }
                
                if (statusDiv) {
                    statusDiv.innerHTML = `<div class="csv-success" style="margin-top: 0.5rem;">
                        <strong>Setting updated!</strong> Problem statement presentation is now ${isOver ? 'marked as over' : 'active'}.
                    </div>`;
                    setTimeout(() => {
                        if (statusDiv) statusDiv.innerHTML = '';
                    }, 3000);
                }
            } catch (error) {
                console.error('Error updating problem statement presentation status:', error);
                alert('Error updating setting. Please try again.');
                // Revert checkbox
                checkbox.checked = !isOver;
            }
        },
        
        async isProblemStatementPresentationOver() {
            try {
                const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'problemStatement'));
                return settingsDoc.exists() && settingsDoc.data().presentationOver === true;
            } catch (error) {
                console.error('Error checking problem statement presentation status:', error);
                return false; // Default to false if error
            }
        },
        
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
            const enabled = await app.isMiniProjectEnabled();
            
            // Show/hide navigation items
            const studentNav = document.getElementById('nav-miniproject');
            const adminNav = document.getElementById('admin-miniproject-nav');
            const adminSettingsNav = document.getElementById('admin-miniproject-settings-nav');
            
            // Always show mini project nav items for admin (regardless of enabled status)
            // Admin can enable/disable the module from settings
            if (studentNav) studentNav.style.display = enabled ? 'block' : 'none';
            if (adminNav) adminNav.style.display = app.isAdmin ? 'block' : 'none';
            if (adminSettingsNav) adminSettingsNav.style.display = app.isAdmin ? 'block' : 'none';
        },
        
        async updateProjectPlanningVisibility() {
            // Project planning visibility is controlled by mini project settings
            // This is a placeholder - actual implementation may vary
            await app.updateMiniProjectVisibility();
        }
    };
}

