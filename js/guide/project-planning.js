// Guide Project Planning module
import { escapeHtml } from '../utils/helpers.js';

export function createGuideProjectPlanningModule(app) {
    return {
        // Note: We don't define loadGuideProjectPlanning here
        // to avoid overriding the comprehensive implementation in app.js
        // The comprehensive version includes verification buttons, user stories, 
        // product backlogs, card sorting, and schedule verification views
        
        async loadProjectPlanning() {
            // This function is kept for backward compatibility but project planning is now in mini project
            // Redirect to mini project if accessed directly
            if (document.getElementById('project-planning')) {
                // Student project planning page - load it
                await app.loadStudentMiniProject();
            } else {
                // Guide project planning - use comprehensive version from app.js
                await app.loadGuideProjectPlanning();
            }
        }
    };
}

