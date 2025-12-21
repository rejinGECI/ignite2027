// Data operations module
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function createDataOperationsModule(app) {
    return {
        async getUserDataRef() {
            if (!app.currentUser || app.isAdmin) return null;
            return doc(window.firebaseDb, 'userData', app.currentUser.uid);
        },
        
        async getUserData() {
            if (app.isAdmin) return null;
            const userDataRef = await app.getUserDataRef();
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
            if (app.isAdmin) return;
            const userDataRef = await app.getUserDataRef();
            if (!userDataRef) return;
            await setDoc(userDataRef, data, { merge: true });
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
        }
    };
}

