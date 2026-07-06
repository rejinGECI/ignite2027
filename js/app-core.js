// Core app object - contains state and methods that haven't been extracted yet
// This file will be gradually reduced as we extract more modules

// This file contains the remaining app methods that haven't been extracted to modules yet
// It will be imported and merged with module methods in the main app.js

// Note: This is a temporary structure. As we extract more modules, code will move from here
// to appropriate module files (dashboard, calendar, dreams, habits, progress, admin, guide, etc.)

export function createAppCore() {
    return {
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
        }
    };
}

