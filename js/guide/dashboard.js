// Guide Dashboard module
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createGuideDashboardModule(app) {
    return {
        // Note: We don't define loadGuideDashboard or loadGuideTeams here
        // to avoid overriding the comprehensive implementations in app.js
        // The comprehensive versions include evaluation data, problem statements, etc.
        
        async checkIfGuideIsEvaluator() {
            if (!app.currentUser || !app.currentUser.uid || app.userRole !== 'guide') {
                return false;
            }
            
            try {
                const settingsDoc = await getDoc(doc(window.firebaseDb, 'settings', 'miniproject'));
                const stages = settingsDoc.exists() ? (settingsDoc.data().evaluationStages || []) : [];
                
                for (let i = 0; i < stages.length; i++) {
                    const isEvaluator = await app.isEvaluatorForStage(app.currentUser.uid, i);
                    if (isEvaluator) {
                        return true;
                    }
                }
                return false;
            } catch (error) {
                console.error('Error checking if guide is evaluator:', error);
                return false;
            }
        }
    };
}

