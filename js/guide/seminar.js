// Seminar — guide module (topic review & lock)
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    getDefaultSeminar,
    ensureSeminarTopics,
    getLockedTopic,
    isSeminarTopicsLocked,
    statusBadge,
    MIN_SEMINAR_TOPICS
} from '../utils/seminarConfig.js';

export function createGuideSeminarModule(app) {
    return {
        getGuideId() {
            try {
                const session = JSON.parse(sessionStorage.getItem('guideSession') || '{}');
                return session.uid || null;
            } catch (e) {
                return null;
            }
        },

        getStudentTopicStats(seminar) {
            const topics = ensureSeminarTopics(seminar);
            const locked = isSeminarTopicsLocked(seminar);
            return {
                total: topics.length,
                pending: topics.filter(t => t.status === 'submitted').length,
                approved: topics.filter(t => t.status === 'approved').length,
                rejected: topics.filter(t => t.status === 'rejected').length,
                locked,
                lockedTopic: getLockedTopic(seminar),
                minMet: topics.length >= MIN_SEMINAR_TOPICS
            };
        },

        async loadGuideSeminar() {
            if (!app.isGuide) return;
            const guideId = this.getGuideId();
            const el = document.getElementById('guide-seminar-content');
            if (!el) return;

            el.innerHTML = '<div class="loading-state">Loading assigned students...</div>';

            try {
                const settingsSnap = await getDoc(doc(window.firebaseDb, 'settings', 'seminar'));
                const settings = settingsSnap.exists() ? settingsSnap.data() : {};
                const assignments = settings.guideAssignments || {};

                const students = [];
                const usersSnap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'student')));

                for (const userDoc of usersSnap.docs) {
                    const uid = userDoc.id;
                    const dataSnap = await getDoc(doc(window.firebaseDb, 'userData', uid));
                    const userData = dataSnap.exists() ? dataSnap.data() : {};
                    const seminar = userData.seminar || getDefaultSeminar();
                    ensureSeminarTopics(seminar);
                    const assignedGuide = seminar.guideId || assignments[uid];
                    if (assignedGuide !== guideId) continue;

                    const u = userDoc.data();
                    students.push({
                        id: uid,
                        name: u.name || u.username || 'Student',
                        ktuid: u.username || '',
                        seminar,
                        userData
                    });
                }

                students.sort((a, b) => {
                    const sa = this.getStudentTopicStats(a.seminar);
                    const sb = this.getStudentTopicStats(b.seminar);
                    if (sa.locked !== sb.locked) return sa.locked ? 1 : -1;
                    if (sa.pending !== sb.pending) return sb.pending - sa.pending;
                    return a.name.localeCompare(b.name);
                });

                app._guideSeminarStudents = students;

                if (!students.length) {
                    el.innerHTML = `
                        <div class="seminar-guide-empty">
                            <i class="fas fa-user-graduate"></i>
                            <h3>No students assigned yet</h3>
                            <p>When admin allots guides, your students will appear here with their submitted topics.</p>
                        </div>`;
                    return;
                }

                this.renderGuideSeminarPage(students);
            } catch (err) {
                console.error(err);
                el.innerHTML = '<p class="error-message">Failed to load seminar students.</p>';
            }
        },

        renderGuideSeminarPage(students) {
            const el = document.getElementById('guide-seminar-content');
            if (!el) return;

            const stats = students.reduce((acc, s) => {
                const st = this.getStudentTopicStats(s.seminar);
                acc.students += 1;
                acc.pending += st.pending;
                acc.locked += st.locked ? 1 : 0;
                acc.awaiting += (!st.locked && st.total > 0) ? 1 : 0;
                acc.noTopics += st.total === 0 ? 1 : 0;
                return acc;
            }, { students: 0, pending: 0, locked: 0, awaiting: 0, noTopics: 0 });

            el.innerHTML = `
                <div class="seminar-guide-page">
                    <div class="seminar-guide-summary">
                        <div class="seminar-guide-stat">
                            <strong>${stats.students}</strong>
                            <span>Students</span>
                        </div>
                        <div class="seminar-guide-stat ${stats.pending ? 'stat-warn' : ''}">
                            <strong>${stats.pending}</strong>
                            <span>Topics to review</span>
                        </div>
                        <div class="seminar-guide-stat">
                            <strong>${stats.awaiting}</strong>
                            <span>Awaiting lock</span>
                        </div>
                        <div class="seminar-guide-stat stat-ok">
                            <strong>${stats.locked}</strong>
                            <span>Topics locked</span>
                        </div>
                    </div>

                    <div class="seminar-guide-toolbar">
                        <input type="search" id="guide-seminar-search" class="form-input search-input"
                            placeholder="Search student by name or KTU ID..." style="flex:1; max-width:360px;">
                        <select id="guide-seminar-filter" class="form-input" style="max-width:200px;">
                            <option value="all">All students</option>
                            <option value="pending">Needs review</option>
                            <option value="ready">Ready to lock</option>
                            <option value="locked">Locked</option>
                            <option value="none">No topics yet</option>
                        </select>
                    </div>

                    <p class="seminar-guide-howto">
                        <i class="fas fa-info-circle"></i>
                        Review each topic → <strong>Approve</strong> or <strong>Reject</strong> (with reason) → then
                        <strong>Lock as final</strong> on one approved topic. Students can keep adding topics until you lock.
                    </p>

                    <div id="guide-seminar-students" class="seminar-guide-students">
                        ${students.map(s => this.renderGuideStudentCard(s)).join('')}
                    </div>
                </div>
            `;

            this.bindGuideSeminarFilters();
        },

        bindGuideSeminarFilters() {
            const search = document.getElementById('guide-seminar-search');
            const filter = document.getElementById('guide-seminar-filter');
            if (search && !search.dataset.bound) {
                search.dataset.bound = 'true';
                search.addEventListener('input', () => this.applyGuideSeminarFilters());
            }
            if (filter && !filter.dataset.bound) {
                filter.dataset.bound = 'true';
                filter.addEventListener('change', () => this.applyGuideSeminarFilters());
            }
        },

        applyGuideSeminarFilters() {
            const term = (document.getElementById('guide-seminar-search')?.value || '').toLowerCase().trim();
            const filter = document.getElementById('guide-seminar-filter')?.value || 'all';
            document.querySelectorAll('.seminar-guide-student').forEach(card => {
                const name = card.dataset.name || '';
                const ktuid = card.dataset.ktuid || '';
                const status = card.dataset.status || '';
                const matchesSearch = !term || name.includes(term) || ktuid.includes(term);
                const matchesFilter = filter === 'all' || status === filter;
                card.style.display = matchesSearch && matchesFilter ? '' : 'none';
            });
        },

        renderGuideStudentCard(student) {
            const sem = student.seminar;
            const st = this.getStudentTopicStats(sem);
            const topics = ensureSeminarTopics(sem);

            let filterStatus = 'none';
            if (st.locked) filterStatus = 'locked';
            else if (st.pending > 0) filterStatus = 'pending';
            else if (st.approved > 0) filterStatus = 'ready';
            else if (st.total > 0) filterStatus = 'ready';

            const statusChip = st.locked
                ? '<span class="seminar-status-chip chip-locked"><i class="fas fa-lock"></i> Locked</span>'
                : st.pending > 0
                    ? `<span class="seminar-status-chip chip-pending"><i class="fas fa-clock"></i> ${st.pending} to review</span>`
                    : st.total === 0
                        ? '<span class="seminar-status-chip chip-empty">Waiting for topics</span>'
                        : st.approved > 0
                            ? '<span class="seminar-status-chip chip-ready"><i class="fas fa-check"></i> Ready to lock</span>'
                            : '<span class="seminar-status-chip chip-empty">All rejected</span>';

            const topicsHtml = topics.length
                ? topics.map((t, idx) => this.renderGuideTopicCard(student, t, idx, st.locked)).join('')
                : `<div class="seminar-guide-no-topics">
                        <i class="fas fa-inbox"></i>
                        <p>No topics submitted yet. Student should add at least ${MIN_SEMINAR_TOPICS} topics.</p>
                   </div>`;

            return `
                <article class="seminar-guide-student"
                    data-name="${escapeHtml(student.name.toLowerCase())}"
                    data-ktuid="${escapeHtml(student.ktuid.toLowerCase())}"
                    data-status="${filterStatus}">
                    <header class="seminar-guide-student-header">
                        <div>
                            <h3>${escapeHtml(student.name)}</h3>
                            <span class="seminar-guide-ktuid">${escapeHtml(student.ktuid)}</span>
                        </div>
                        <div class="seminar-guide-student-meta">
                            ${statusChip}
                            <span class="seminar-topic-count">${st.total} topic${st.total === 1 ? '' : 's'}
                                ${st.minMet ? '' : ` <small>(min ${MIN_SEMINAR_TOPICS})</small>`}
                            </span>
                        </div>
                    </header>

                    <div class="seminar-guide-stat-row">
                        <span><strong>${st.pending}</strong> pending</span>
                        <span><strong>${st.approved}</strong> approved</span>
                        <span><strong>${st.rejected}</strong> rejected</span>
                    </div>

                    ${st.lockedTopic ? `
                        <div class="seminar-final-topic-banner">
                            <i class="fas fa-lock"></i>
                            <div>
                                <strong>Final selected topic</strong>
                                <p>${escapeHtml(st.lockedTopic.title)}</p>
                            </div>
                        </div>
                    ` : ''}

                    <div class="seminar-topics-list">${topicsHtml}</div>
                </article>
            `;
        },

        renderGuideTopicCard(student, topic, idx, locked) {
            const isLocked = locked && topic.id === student.seminar.lockedTopicId;
            const statusLabel = isLocked ? 'Locked (final)' : statusBadge(topic.status);
            const canLock = !locked && topic.status === 'approved';
            const statusClass = isLocked ? 'locked' : topic.status;

            return `
                <div class="seminar-topic-card seminar-topic-status-${escapeHtml(statusClass)} ${isLocked ? 'seminar-topic-locked' : ''}">
                    <div class="seminar-topic-card-header">
                        <strong>${idx + 1}. ${escapeHtml(topic.title)}</strong>
                        <span class="badge badge-${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <p class="seminar-topic-desc">${escapeHtml(topic.description || 'No description provided.')}</p>
                    ${topic.guideFeedback ? `
                        <p class="seminar-topic-feedback"><i class="fas fa-comment"></i> ${escapeHtml(topic.guideFeedback)}</p>
                    ` : ''}
                    ${!locked ? `
                        <div class="seminar-guide-actions">
                            ${topic.status !== 'approved' ? `
                                <button type="button" class="btn btn-sm btn-primary" onclick="app.guideApproveSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')">
                                    <i class="fas fa-check"></i> Approve
                                </button>
                            ` : ''}
                            ${topic.status !== 'rejected' ? `
                                <button type="button" class="btn btn-sm btn-danger" onclick="app.guideRejectSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')">
                                    <i class="fas fa-times"></i> Reject
                                </button>
                            ` : ''}
                            ${canLock ? `
                                <button type="button" class="btn btn-sm btn-success" onclick="app.guideLockSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')">
                                    <i class="fas fa-lock"></i> Lock as final
                                </button>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        },

        async updateStudentSeminar(studentId, updater) {
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
            updater(data.seminar);
            await setDoc(ref, { seminar: data.seminar }, { merge: true });
            await this.loadGuideSeminar();
        },

        async guideApproveSeminarTopic(studentId, topicId) {
            const fb = prompt('Optional note for the student (approval feedback):') || '';
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
            if (isSeminarTopicsLocked(data.seminar)) {
                alert('Topics are already locked for this student.');
                return;
            }
            const topic = (data.seminar.topics || []).find(t => t.id === topicId);
            if (!topic) { alert('Topic not found.'); return; }
            topic.status = 'approved';
            topic.guideFeedback = fb;
            topic.reviewedAt = new Date().toISOString();
            await setDoc(ref, { seminar: data.seminar }, { merge: true });
            await this.loadGuideSeminar();
        },

        async guideRejectSeminarTopic(studentId, topicId) {
            const fb = prompt('Reason for rejection (shown to student):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please revise or propose a different topic.';
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
            if (isSeminarTopicsLocked(data.seminar)) {
                alert('Topics are already locked for this student.');
                return;
            }
            const topic = (data.seminar.topics || []).find(t => t.id === topicId);
            if (!topic) { alert('Topic not found.'); return; }
            topic.status = 'rejected';
            topic.guideFeedback = reason;
            topic.reviewedAt = new Date().toISOString();
            await setDoc(ref, { seminar: data.seminar }, { merge: true });
            await this.loadGuideSeminar();
        },

        async guideLockSeminarTopic(studentId, topicId) {
            if (!confirm('Lock this as the final topic? The student will not be able to add more topics.')) {
                return;
            }
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
            if (isSeminarTopicsLocked(data.seminar)) {
                alert('A topic is already locked for this student.');
                return;
            }
            const topic = (data.seminar.topics || []).find(t => t.id === topicId);
            if (!topic) { alert('Topic not found.'); return; }
            if (topic.status !== 'approved') {
                alert('Only an approved topic can be locked as final.');
                return;
            }
            data.seminar.lockedTopicId = topicId;
            data.seminar.topicsLockedAt = new Date().toISOString();
            data.seminar.topic = {
                title: topic.title,
                abstract: topic.description || '',
                status: 'final_approved',
                guideFeedback: topic.guideFeedback || '',
                submittedAt: topic.submittedAt || null
            };
            await setDoc(ref, { seminar: data.seminar }, { merge: true });
            alert('Final topic locked successfully.');
            await this.loadGuideSeminar();
        },

        async guideApproveTopic() {
            alert('Approve individual topics from the list, then lock one as final.');
        },
        async guideRejectTopic() {
            alert('Reject individual topics from the list.');
        },
        async guideFinalApproveTopic() {
            alert('Use “Lock as final” on an approved topic.');
        },

        async guideApprovePaper(studentId, paperId) {
            await this.updateStudentSeminar(studentId, s => {
                const p = (s.papers || []).find(x => x.id === paperId);
                if (p) p.status = 'guide_approved';
            });
        },
        async guideRejectPaper(studentId, paperId) {
            const fb = prompt('Feedback:') || '';
            await this.updateStudentSeminar(studentId, s => {
                const p = (s.papers || []).find(x => x.id === paperId);
                if (p) { p.status = 'guide_rejected'; p.guideFeedback = fb; }
            });
        },
        async guideApproveDraft(studentId) {
            await this.updateStudentSeminar(studentId, s => { s.draftReport.status = 'guide_approved'; });
        },
        async guideRejectDraft(studentId) {
            const fb = prompt('Feedback:') || '';
            await this.updateStudentSeminar(studentId, s => {
                s.draftReport.status = 'guide_rejected';
                s.draftReport.guideFeedback = fb;
            });
        },
        async guideApproveFinal(studentId) {
            await this.updateStudentSeminar(studentId, s => { s.finalReport.status = 'guide_approved'; });
        },
        async guideRejectFinal(studentId) {
            const fb = prompt('Feedback:') || '';
            await this.updateStudentSeminar(studentId, s => {
                s.finalReport.status = 'guide_rejected';
                s.finalReport.guideFeedback = fb;
            });
        }
    };
}
