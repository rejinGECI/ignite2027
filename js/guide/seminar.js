// Seminar — guide module (topic review & lock)
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    getDefaultSeminar,
    ensureSeminarTopics,
    ensureSeminarEvaluation,
    getLockedTopic,
    isSeminarTopicsLocked,
    statusBadge,
    MIN_SEMINAR_TOPICS,
    normalizePaperStatus,
    isPaperPendingReview,
    ensureTitleAbstract,
    ensureSeminarPpt,
    computeSeminarGrandTotal
} from '../utils/seminarConfig.js?v=eval9';

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
            const papers = seminar.papers || [];
            const ta = ensureTitleAbstract(seminar);
            const taStatus = normalizePaperStatus(ta.status);
            const ppt = ensureSeminarPpt(seminar);
            const pptStatus = normalizePaperStatus(ppt.status);
            return {
                total: topics.length,
                pending: topics.filter(t => t.status === 'submitted').length,
                approved: topics.filter(t => t.status === 'approved').length,
                rejected: topics.filter(t => t.status === 'rejected').length,
                revision: topics.filter(t => t.status === 'needs_revision').length,
                locked,
                lockedTopic: getLockedTopic(seminar),
                minMet: topics.length >= MIN_SEMINAR_TOPICS,
                papersTotal: papers.length,
                papersPending: papers.filter(p => isPaperPendingReview(p.status)).length,
                papersApproved: papers.filter(p => normalizePaperStatus(p.status) === 'approved').length,
                papersRevision: papers.filter(p => normalizePaperStatus(p.status) === 'needs_revision').length,
                titleAbstract: ta,
                titleAbstractStatus: taStatus,
                titleAbstractPending: taStatus === 'submitted',
                titleAbstractApproved: taStatus === 'approved',
                ppt,
                pptStatus,
                pptPending: pptStatus === 'submitted',
                pptApproved: pptStatus === 'approved'
            };
        },

        async loadGuideSeminar() {
            if (!app.isGuide) return;
            const guideId = this.getGuideId();
            const el = document.getElementById('guide-seminar-content');
            if (!el) return;

            if (!guideId) {
                el.innerHTML = '<p class="error-message">Guide session not found. Please log out and log in again.</p>';
                return;
            }

            el.innerHTML = '<div class="loading-state">Loading assigned students...</div>';

            try {
                let settings = {};
                try {
                    const settingsSnap = await getDoc(doc(window.firebaseDb, 'settings', 'seminar'));
                    settings = settingsSnap.exists() ? settingsSnap.data() : {};
                } catch (e) {
                    console.warn('Could not read settings/seminar', e);
                }
                const assignments = settings.guideAssignments || {};

                // Prefer assigned student IDs from allotment (avoids reading every student doc)
                const assignedIds = Object.entries(assignments)
                    .filter(([, gid]) => gid === guideId)
                    .map(([uid]) => uid);

                const students = [];
                const loadErrors = [];

                const loadOne = async (uid, userHint = null) => {
                    try {
                        let u = userHint;
                        if (!u) {
                            const userSnap = await getDoc(doc(window.firebaseDb, 'users', uid));
                            if (!userSnap.exists()) return;
                            u = userSnap.data();
                            if (u.role && u.role !== 'student') return;
                        }
                        const dataSnap = await getDoc(doc(window.firebaseDb, 'userData', uid));
                        const userData = dataSnap.exists() ? dataSnap.data() : {};
                        const seminar = userData.seminar || getDefaultSeminar();
                        ensureSeminarTopics(seminar);
                        ensureTitleAbstract(seminar);
                        ensureSeminarPpt(seminar);
                        ensureSeminarEvaluation(seminar);
                        const assignedGuide = seminar.guideId || assignments[uid];
                        if (assignedGuide !== guideId) return;
                        students.push({
                            id: uid,
                            name: u.name || u.username || 'Student',
                            ktuid: u.username || '',
                            seminar,
                            userData
                        });
                    } catch (e) {
                        console.warn('Skip student', uid, e);
                        loadErrors.push(uid);
                    }
                };

                if (assignedIds.length) {
                    await Promise.all(assignedIds.map(uid => loadOne(uid)));
                } else {
                    // Fallback: scan students, but never fail the whole page on one denied read
                    const usersSnap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'student')));
                    await Promise.all(usersSnap.docs.map(userDoc => loadOne(userDoc.id, userDoc.data())));
                }

                students.sort((a, b) => {
                    const sa = this.getStudentTopicStats(a.seminar);
                    const sb = this.getStudentTopicStats(b.seminar);
                    if (sa.locked !== sb.locked) return sa.locked ? 1 : -1;
                    if (sa.pending !== sb.pending) return sb.pending - sa.pending;
                    return a.name.localeCompare(b.name);
                });

                app._guideSeminarStudents = students;
                this.renderGuideSeminarPage(students);
            } catch (err) {
                console.error(err);
                el.innerHTML = `<p class="error-message">Failed to load seminar students.${err?.message ? ` (${escapeHtml(err.message)})` : ''}</p>`;
            }
        },

        renderGuideSeminarPage(students) {
            const el = document.getElementById('guide-seminar-content');
            if (!el) return;
            const guideId = this.getGuideId();
            const activeTab = app._guideSeminarTab === 'evaluation' ? 'evaluation' : 'mentees';

            const stats = students.reduce((acc, s) => {
                const st = this.getStudentTopicStats(s.seminar);
                acc.students += 1;
                acc.pending += st.pending;
                acc.locked += st.locked ? 1 : 0;
                acc.awaiting += (!st.locked && st.total > 0) ? 1 : 0;
                acc.noTopics += st.total === 0 ? 1 : 0;
                acc.papersPending += st.papersPending;
                acc.abstractPending += st.titleAbstractPending ? 1 : 0;
                acc.pptPending += st.pptPending ? 1 : 0;
                return acc;
            }, { students: 0, pending: 0, locked: 0, awaiting: 0, noTopics: 0, papersPending: 0, abstractPending: 0, pptPending: 0 });

            const menteeList = students.length
                ? students.map(s => this.renderGuideStudentCard(s)).join('')
                : `<div class="seminar-guide-empty" style="padding:1.5rem;">
                        <i class="fas fa-user-graduate"></i>
                        <h3>No mentees assigned yet</h3>
                        <p>When admin allots you as guide, your students appear here. Use the <strong>CIE evaluation</strong> tab for IEC presentation marks on any student.</p>
                   </div>`;

            el.innerHTML = `
                <div class="seminar-guide-page">
                    <div class="seminar-admin-tabs seminar-guide-tabs" role="tablist">
                        <button type="button" class="seminar-admin-tab ${activeTab === 'mentees' ? 'active' : ''}" data-guide-tab="mentees">
                            <i class="fas fa-user-graduate"></i> Mentees
                            <span class="badge">${stats.students}</span>
                        </button>
                        <button type="button" class="seminar-admin-tab ${activeTab === 'evaluation' ? 'active' : ''}" data-guide-tab="evaluation">
                            <i class="fas fa-clipboard-check"></i> CIE evaluation
                        </button>
                    </div>

                    <div id="guide-seminar-panel-mentees" class="seminar-guide-panel ${activeTab === 'mentees' ? 'active' : ''}" ${activeTab === 'mentees' ? '' : 'hidden'}>
                        <div class="seminar-guide-summary">
                            <div class="seminar-guide-stat">
                                <strong>${stats.students}</strong>
                                <span>Mentees</span>
                            </div>
                            <div class="seminar-guide-stat ${stats.pending ? 'stat-warn' : ''}">
                                <strong>${stats.pending}</strong>
                                <span>Topics to review</span>
                            </div>
                            <div class="seminar-guide-stat ${stats.papersPending ? 'stat-warn' : ''}">
                                <strong>${stats.papersPending}</strong>
                                <span>Papers to review</span>
                            </div>
                            <div class="seminar-guide-stat ${stats.abstractPending ? 'stat-warn' : ''}">
                                <strong>${stats.abstractPending}</strong>
                                <span>Abstracts to review</span>
                            </div>
                            <div class="seminar-guide-stat ${stats.pptPending ? 'stat-warn' : ''}">
                                <strong>${stats.pptPending}</strong>
                                <span>PPTs to review</span>
                            </div>
                        </div>

                        <div class="seminar-guide-toolbar">
                            <input type="search" id="guide-seminar-search" class="form-input search-input"
                                placeholder="Search mentee by name or KTU ID..." style="flex:1; max-width:360px;">
                            <select id="guide-seminar-filter" class="form-input" style="max-width:240px;">
                                <option value="all">All mentees</option>
                                <option value="pending">Topics need review</option>
                                <option value="papers">Papers need review</option>
                                <option value="abstract">Abstracts need review</option>
                                <option value="ppt">PPTs need review</option>
                                <option value="ready">Ready to lock</option>
                                <option value="locked">Locked</option>
                                <option value="none">No topics yet</option>
                            </select>
                        </div>

                        <p class="seminar-guide-howto">
                            <i class="fas fa-info-circle"></i>
                            Review topics → lock one final topic. Then verify <strong>papers</strong>,
                            <strong>title &amp; abstract</strong>, and <strong>PPT</strong>:
                            Approve, Reject, or Open for edit. Guide CIE marks (background &amp; relevance) are entered from the CIE evaluation tab for your mentees.
                        </p>

                        <div id="guide-seminar-students" class="seminar-guide-students">
                            ${menteeList}
                        </div>
                    </div>

                    <div id="guide-seminar-panel-evaluation" class="seminar-guide-panel ${activeTab === 'evaluation' ? 'active' : ''}" ${activeTab === 'evaluation' ? '' : 'hidden'}>
                        <div class="seminar-guide-eval-panel admin-card">
                            <h3 style="margin-top:0;"><i class="fas fa-clipboard-check"></i> CIE evaluation (IEC)</h3>
                            <p class="form-hint">
                                Mark <strong>Presentation</strong> and <strong>audience questions</strong> for any student.
                                <strong>Guide marks</strong> only for your mentees. Coordinator &amp; Report marks are admin-only.
                            </p>
                            <input type="search" id="guide-seminar-eval-search" class="form-input search-input"
                                placeholder="Search student by name or KTU ID..." style="max-width:420px; margin-bottom:0.75rem;">
                            <div id="guide-seminar-eval-list" class="seminar-eval-shortcut-list">
                                <p class="form-hint">Loading cohort…</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this.bindGuideSeminarTabs();
            this.bindGuideSeminarFilters();
            this.bindGuideSeminarEvalSearch();
            this.loadGuideSeminarEvalList(guideId);
        },

        bindGuideSeminarTabs() {
            document.querySelectorAll('.seminar-guide-tabs [data-guide-tab]').forEach(tab => {
                if (tab.dataset.bound) return;
                tab.dataset.bound = 'true';
                tab.addEventListener('click', () => {
                    const id = tab.dataset.guideTab;
                    app._guideSeminarTab = id;
                    document.querySelectorAll('.seminar-guide-tabs [data-guide-tab]').forEach(t => {
                        t.classList.toggle('active', t.dataset.guideTab === id);
                    });
                    document.querySelectorAll('.seminar-guide-panel').forEach(p => {
                        const match = p.id === `guide-seminar-panel-${id}`;
                        p.classList.toggle('active', match);
                        if (match) p.removeAttribute('hidden');
                        else p.setAttribute('hidden', '');
                    });
                });
            });
        },

        bindGuideSeminarEvalSearch() {
            const search = document.getElementById('guide-seminar-eval-search');
            if (!search || search.dataset.bound) return;
            search.dataset.bound = 'true';
            search.addEventListener('input', () => {
                const term = search.value.toLowerCase().trim();
                document.querySelectorAll('#guide-seminar-eval-list .seminar-eval-shortcut-row').forEach(row => {
                    const name = row.dataset.name || '';
                    const ktuid = row.dataset.ktuid || '';
                    row.style.display = (!term || name.includes(term) || ktuid.includes(term)) ? '' : 'none';
                });
            });
        },

        async loadGuideSeminarEvalList(guideId) {
            const el = document.getElementById('guide-seminar-eval-list');
            if (!el) return;
            try {
                let settings = {};
                try {
                    if (typeof app.getSeminarSettings === 'function') {
                        settings = await app.getSeminarSettings();
                    } else {
                        const snap = await getDoc(doc(window.firebaseDb, 'settings', 'seminar'));
                        settings = snap.exists() ? snap.data() : {};
                    }
                } catch (e) {
                    console.warn('Could not load seminar settings for eval list', e);
                }

                const usersSnap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'student')));
                const maxP = settings.questionSettings?.maxParticipationMarks ?? 10;
                const fairness = settings.questionFairness || {};
                const assignments = settings.guideAssignments || {};

                const rows = await Promise.all(usersSnap.docs.map(async (userDoc) => {
                    const u = userDoc.data();
                    const id = userDoc.id;
                    let seminar = getDefaultSeminar();
                    try {
                        const dataSnap = await getDoc(doc(window.firebaseDb, 'userData', id));
                        if (dataSnap.exists()) {
                            seminar = dataSnap.data().seminar || getDefaultSeminar();
                        }
                    } catch (e) {
                        seminar = getDefaultSeminar();
                    }
                    try { ensureSeminarEvaluation(seminar); } catch (e) { /* ignore */ }
                    const t = seminar.totals || {};
                    const grand = computeSeminarGrandTotal(t, maxP);
                    const times = fairness[id]?.times || 0;
                    const isMine = (seminar.guideId || assignments[id]) === guideId;
                    return {
                        id,
                        name: u.name || u.username || 'Student',
                        ktuid: u.username || '',
                        grand,
                        times,
                        isMine,
                        isAbsent: seminar.evaluation?.isAbsent
                    };
                }));

                rows.sort((a, b) => {
                    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                el.innerHTML = rows.map(s => `
                    <div class="seminar-eval-shortcut-row"
                        data-name="${escapeHtml((s.name || '').toLowerCase())}"
                        data-ktuid="${escapeHtml((s.ktuid || '').toLowerCase())}">
                        <span>
                            ${escapeHtml(s.name)}
                            ${s.isMine ? '<span class="badge">Your mentee</span>' : ''}
                            ${s.isAbsent ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">Absent</span>' : ''}
                            <small>(audience Q ×${s.times})</small>
                        </span>
                        <span><strong>${s.grand}</strong>/100</span>
                        <button type="button" class="btn btn-sm btn-primary" onclick="app.openSeminarEvaluation('${escapeHtml(s.id)}')">Evaluate</button>
                    </div>
                `).join('') || '<p class="form-hint">No students found.</p>';
            } catch (err) {
                console.error(err);
                el.innerHTML = `<p class="form-hint">Could not load evaluation list.${err?.message ? ` (${escapeHtml(err.message)})` : ''}</p>`;
            }
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
                const flags = (card.dataset.flags || '').split(/\s+/).filter(Boolean);
                const status = card.dataset.status || '';
                const matchesSearch = !term || name.includes(term) || ktuid.includes(term);
                const matchesFilter = filter === 'all'
                    || flags.includes(filter)
                    || status === filter;
                card.style.display = matchesSearch && matchesFilter ? '' : 'none';
            });
        },

        renderGuideStudentCard(student) {
            const sem = student.seminar;
            const st = this.getStudentTopicStats(sem);
            const topics = ensureSeminarTopics(sem);
            const papers = sem.papers || [];

            let filterStatus = 'none';
            if (st.pptPending) filterStatus = 'ppt';
            else if (st.titleAbstractPending) filterStatus = 'abstract';
            else if (st.papersPending > 0) filterStatus = 'papers';
            else if (st.locked) filterStatus = 'locked';
            else if (st.pending > 0) filterStatus = 'pending';
            else if (st.approved > 0) filterStatus = 'ready';
            else if (st.total > 0) filterStatus = 'ready';

            const filterFlags = [
                st.locked ? 'locked' : '',
                st.pending > 0 ? 'pending' : '',
                st.papersPending > 0 ? 'papers' : '',
                st.titleAbstractPending ? 'abstract' : '',
                st.pptPending ? 'ppt' : '',
                (!st.locked && st.approved > 0) ? 'ready' : '',
                st.total === 0 ? 'none' : ''
            ].filter(Boolean).join(' ');

            const statusChip = st.locked
                ? '<span class="seminar-status-chip chip-locked"><i class="fas fa-lock"></i> Locked</span>'
                : st.pending > 0
                    ? `<span class="seminar-status-chip chip-pending"><i class="fas fa-clock"></i> ${st.pending} to review</span>`
                    : st.total === 0
                        ? '<span class="seminar-status-chip chip-empty">Waiting for topics</span>'
                        : st.approved > 0
                            ? '<span class="seminar-status-chip chip-ready"><i class="fas fa-check"></i> Ready to lock</span>'
                            : '<span class="seminar-status-chip chip-empty">All rejected</span>';

            const paperChip = st.papersPending > 0
                ? `<span class="seminar-status-chip chip-pending"><i class="fas fa-book"></i> ${st.papersPending} paper${st.papersPending === 1 ? '' : 's'}</span>`
                : st.papersTotal > 0
                    ? `<span class="seminar-status-chip chip-ready"><i class="fas fa-book"></i> ${st.papersApproved}/${st.papersTotal} papers ok</span>`
                    : '';

            const abstractChip = st.titleAbstractPending
                ? '<span class="seminar-status-chip chip-pending"><i class="fas fa-align-left"></i> Abstract pending</span>'
                : st.titleAbstractApproved
                    ? '<span class="seminar-status-chip chip-ready"><i class="fas fa-align-left"></i> Abstract approved</span>'
                    : '';

            const pptChip = st.pptPending
                ? '<span class="seminar-status-chip chip-pending"><i class="fas fa-file-powerpoint"></i> PPT pending</span>'
                : st.pptApproved
                    ? '<span class="seminar-status-chip chip-ready"><i class="fas fa-file-powerpoint"></i> PPT approved</span>'
                    : '';

            const topicsHtml = topics.length
                ? topics.map((t, idx) => this.renderGuideTopicCard(student, t, idx, st.locked)).join('')
                : `<div class="seminar-guide-no-topics">
                        <i class="fas fa-inbox"></i>
                        <p>No topics submitted yet. Student should add at least ${MIN_SEMINAR_TOPICS} topics.</p>
                   </div>`;

            const papersHtml = papers.length
                ? papers.map((p, idx) => this.renderGuidePaperCard(student, p, idx)).join('')
                : `<div class="seminar-guide-no-topics">
                        <i class="fas fa-link"></i>
                        <p>${st.locked ? 'No reference papers uploaded yet.' : 'Papers unlock after you lock a final topic.'}</p>
                   </div>`;

            return `
                <article class="seminar-guide-student"
                    data-name="${escapeHtml(student.name.toLowerCase())}"
                    data-ktuid="${escapeHtml(student.ktuid.toLowerCase())}"
                    data-status="${filterStatus}"
                    data-flags="${filterFlags}">
                    <header class="seminar-guide-student-header">
                        <div>
                            <h3>${escapeHtml(student.name)}</h3>
                            <span class="seminar-guide-ktuid">${escapeHtml(student.ktuid)}</span>
                        </div>
                        <div class="seminar-guide-student-meta">
                            ${statusChip}
                            ${paperChip}
                            ${abstractChip}
                            ${pptChip}
                            <span class="seminar-topic-count">${st.total} topic${st.total === 1 ? '' : 's'}
                                ${st.minMet ? '' : ` <small>(min ${MIN_SEMINAR_TOPICS})</small>`}
                            </span>
                        </div>
                    </header>

                    <div class="seminar-guide-stat-row">
                        <span><strong>${st.pending}</strong> topics pending</span>
                        <span><strong>${st.approved}</strong> approved</span>
                        <span><strong>${st.rejected}</strong> rejected</span>
                        ${st.revision ? `<span><strong>${st.revision}</strong> with student for edit</span>` : ''}
                        <span><strong>${st.papersPending}</strong> papers pending</span>
                        <button type="button" class="btn btn-sm btn-primary" onclick="app.openSeminarEvaluation('${escapeHtml(student.id)}')">
                            <i class="fas fa-clipboard-check"></i> Evaluate CIE
                        </button>
                    </div>

                    ${st.lockedTopic ? `
                        <div class="seminar-final-topic-banner">
                            <i class="fas fa-lock"></i>
                            <div>
                                <strong>Final selected topic (only one can be locked)</strong>
                                <p>${escapeHtml(st.lockedTopic.title)}</p>
                            </div>
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideUnlockSeminarTopics('${escapeHtml(student.id)}')">
                                <i class="fas fa-unlock"></i> Unlock
                            </button>
                        </div>
                    ` : ''}

                    <h4 class="seminar-guide-subsection"><i class="fas fa-lightbulb"></i> Topics</h4>
                    <div class="seminar-topics-list">${topicsHtml}</div>

                    <h4 class="seminar-guide-subsection"><i class="fas fa-book"></i> Reference papers
                        <small>(${st.papersTotal})</small>
                    </h4>
                    <div class="seminar-papers-list">${papersHtml}</div>

                    <h4 class="seminar-guide-subsection"><i class="fas fa-align-left"></i> Title &amp; abstract</h4>
                    ${this.renderGuideTitleAbstractCard(student, st)}

                    <h4 class="seminar-guide-subsection"><i class="fas fa-file-powerpoint"></i> PPT</h4>
                    ${this.renderGuidePptCard(student, st)}
                </article>
            `;
        },

        renderGuidePptCard(student, st) {
            const ppt = st.ppt;
            const status = st.pptStatus;
            const hasContent = Boolean(ppt?.url?.trim());

            if (!st.locked) {
                return `<div class="seminar-guide-no-topics">
                    <i class="fas fa-file-powerpoint"></i>
                    <p>PPT unlocks after you lock a final topic.</p>
                </div>`;
            }

            if (!hasContent || status === 'draft') {
                return `<div class="seminar-guide-no-topics">
                    <i class="fas fa-file-powerpoint"></i>
                    <p>No PPT link submitted yet.</p>
                </div>`;
            }

            const statusLabel = status === 'needs_revision' ? 'Needs edit' : statusBadge(status);

            return `
                <div class="seminar-paper-card seminar-topic-status-${escapeHtml(status)}">
                    <div class="seminar-topic-card-header">
                        <strong>${escapeHtml(ppt.title || 'Presentation')}</strong>
                        <span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <p class="seminar-paper-meta">
                        <a href="${escapeHtml(ppt.url || '#')}" target="_blank" rel="noopener noreferrer">
                            <i class="fas fa-external-link-alt"></i> Open PPT link
                        </a>
                    </p>
                    ${ppt.url ? `<p class="seminar-paper-url form-hint">${escapeHtml(ppt.url)}</p>` : ''}
                    ${ppt.guideFeedback ? `
                        <p class="seminar-topic-feedback"><i class="fas fa-comment"></i> ${escapeHtml(ppt.guideFeedback)}</p>
                    ` : ''}
                    <div class="seminar-guide-actions">
                        ${status === 'submitted' ? `
                            <button type="button" class="btn btn-sm btn-primary" onclick="app.guideApprovePpt('${escapeHtml(student.id)}')">
                                <i class="fas fa-check"></i> Approve
                            </button>
                            <button type="button" class="btn btn-sm btn-danger" onclick="app.guideRejectPpt('${escapeHtml(student.id)}')">
                                <i class="fas fa-times"></i> Reject
                            </button>
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideOpenPptEdit('${escapeHtml(student.id)}')">
                                <i class="fas fa-undo"></i> Revert to student
                            </button>
                        ` : ''}
                        ${status === 'approved' ? `
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideOpenPptEdit('${escapeHtml(student.id)}')">
                                <i class="fas fa-undo"></i> Revert to student
                            </button>
                        ` : ''}
                        ${status === 'needs_revision' || status === 'rejected' ? `
                            <p class="form-hint" style="margin:0;"><i class="fas fa-user-edit"></i> Waiting for student to update and resubmit the PPT link.</p>
                        ` : ''}
                    </div>
                </div>
            `;
        },

        renderGuideTitleAbstractCard(student, st) {
            const ta = st.titleAbstract;
            const status = st.titleAbstractStatus;
            const hasContent = Boolean(ta?.title?.trim() || ta?.abstract?.trim());

            if (!st.locked) {
                return `<div class="seminar-guide-no-topics">
                    <i class="fas fa-align-left"></i>
                    <p>Title &amp; abstract unlock after you lock a final topic.</p>
                </div>`;
            }

            if (!hasContent || status === 'draft') {
                return `<div class="seminar-guide-no-topics">
                    <i class="fas fa-align-left"></i>
                    <p>No title &amp; abstract submitted yet.</p>
                </div>`;
            }

            const statusLabel = status === 'needs_revision' ? 'Needs edit' : statusBadge(status);

            return `
                <div class="seminar-paper-card seminar-topic-status-${escapeHtml(status)}">
                    <div class="seminar-topic-card-header">
                        <strong>${escapeHtml(ta.title || 'Untitled')}</strong>
                        <span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <p class="seminar-topic-desc">${escapeHtml(ta.abstract || '')}</p>
                    ${ta.guideFeedback ? `
                        <p class="seminar-topic-feedback"><i class="fas fa-comment"></i> ${escapeHtml(ta.guideFeedback)}</p>
                    ` : ''}
                    <div class="seminar-guide-actions">
                        ${status === 'submitted' ? `
                            <button type="button" class="btn btn-sm btn-primary" onclick="app.guideApproveTitleAbstract('${escapeHtml(student.id)}')">
                                <i class="fas fa-check"></i> Approve
                            </button>
                            <button type="button" class="btn btn-sm btn-danger" onclick="app.guideRejectTitleAbstract('${escapeHtml(student.id)}')">
                                <i class="fas fa-times"></i> Reject
                            </button>
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideOpenTitleAbstractEdit('${escapeHtml(student.id)}')">
                                <i class="fas fa-undo"></i> Open for edit
                            </button>
                        ` : ''}
                        ${status === 'approved' ? `
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideOpenTitleAbstractEdit('${escapeHtml(student.id)}')">
                                <i class="fas fa-undo"></i> Open for edit
                            </button>
                        ` : ''}
                        ${status === 'needs_revision' || status === 'rejected' ? `
                            <p class="form-hint" style="margin:0;"><i class="fas fa-user-edit"></i> Waiting for student to update and resubmit.</p>
                        ` : ''}
                    </div>
                </div>
            `;
        },

        paperTypeLabel(type) {
            const map = { paper: 'Research paper', article: 'Article', docs: 'Documentation', other: 'Other' };
            return map[type] || 'Resource';
        },

        renderGuidePaperCard(student, paper, idx) {
            const status = normalizePaperStatus(paper.status);
            const statusLabel = status === 'needs_revision' ? 'Open for upload' : statusBadge(status);

            return `
                <div class="seminar-paper-card seminar-topic-status-${escapeHtml(status)}">
                    <div class="seminar-topic-card-header">
                        <strong>${idx + 1}. ${escapeHtml(paper.title || 'Untitled')}</strong>
                        <span class="badge badge-${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <p class="seminar-paper-meta">
                        <span class="seminar-paper-type">${escapeHtml(this.paperTypeLabel(paper.type))}</span>
                        · <a href="${escapeHtml(paper.url || '#')}" target="_blank" rel="noopener noreferrer">
                            <i class="fas fa-external-link-alt"></i> Open link
                        </a>
                    </p>
                    ${paper.url ? `<p class="seminar-paper-url form-hint">${escapeHtml(paper.url)}</p>` : ''}
                    ${paper.guideFeedback ? `
                        <p class="seminar-topic-feedback"><i class="fas fa-comment"></i> ${escapeHtml(paper.guideFeedback)}</p>
                    ` : ''}
                    <div class="seminar-guide-actions">
                        ${status !== 'approved' && status !== 'needs_revision' ? `
                            <button type="button" class="btn btn-sm btn-primary" onclick="app.guideApprovePaper('${escapeHtml(student.id)}','${escapeHtml(paper.id)}')">
                                <i class="fas fa-check"></i> Approve
                            </button>
                        ` : ''}
                        ${status !== 'rejected' && status !== 'needs_revision' ? `
                            <button type="button" class="btn btn-sm btn-danger" onclick="app.guideRejectPaper('${escapeHtml(student.id)}','${escapeHtml(paper.id)}')">
                                <i class="fas fa-times"></i> Reject
                            </button>
                        ` : ''}
                        ${status !== 'needs_revision' && status !== 'rejected' ? `
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideOpenPaperUpload('${escapeHtml(student.id)}','${escapeHtml(paper.id)}')">
                                <i class="fas fa-upload"></i> Open for new upload
                            </button>
                        ` : `
                            <p class="form-hint" style="margin:0;"><i class="fas fa-user-edit"></i> Waiting for student to ${status === 'rejected' ? 'update & resubmit' : 'upload a new link'}.</p>
                        `}
                    </div>
                </div>
            `;
        },

        renderGuideTopicCard(student, topic, idx, locked) {
            const isLocked = locked && topic.id === student.seminar.lockedTopicId;
            const statusLabel = isLocked ? 'Locked (final)' : statusBadge(topic.status);
            const canLock = !locked && topic.status === 'approved';
            const statusClass = isLocked ? 'locked' : topic.status;
            const canRevert = !isLocked && topic.status !== 'needs_revision';

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
                            ${topic.status !== 'approved' && topic.status !== 'needs_revision' ? `
                                <button type="button" class="btn btn-sm btn-primary" onclick="app.guideApproveSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')">
                                    <i class="fas fa-check"></i> Approve
                                </button>
                            ` : ''}
                            ${topic.status !== 'rejected' && topic.status !== 'needs_revision' ? `
                                <button type="button" class="btn btn-sm btn-danger" onclick="app.guideRejectSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')">
                                    <i class="fas fa-times"></i> Reject
                                </button>
                            ` : ''}
                            ${canRevert ? `
                                <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideRevertSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')">
                                    <i class="fas fa-undo"></i> Send for edit
                                </button>
                            ` : ''}
                            ${canLock ? `
                                <button type="button" class="btn btn-sm btn-success" onclick="app.guideLockSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')" title="Only one topic can be locked as final">
                                    <i class="fas fa-lock"></i> Lock as final
                                </button>
                            ` : ''}
                        </div>
                        ${topic.status === 'approved' && !locked ? `
                            <p class="form-hint" style="margin-top:0.4rem;">Only one topic can be locked. Locking this will set it as the final topic.</p>
                        ` : ''}
                        ${topic.status === 'needs_revision' ? `
                            <p class="form-hint" style="margin-top:0.4rem;"><i class="fas fa-user-edit"></i> Waiting for student to edit and resubmit.</p>
                        ` : ''}
                    ` : isLocked ? `
                        <div class="seminar-guide-actions">
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideRevertSeminarTopic('${escapeHtml(student.id)}','${escapeHtml(topic.id)}')">
                                <i class="fas fa-undo"></i> Unlock &amp; send for edit
                            </button>
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
            ensureTitleAbstract(data.seminar);
            ensureSeminarPpt(data.seminar);
            if (!data.seminar.papers) data.seminar.papers = [];
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
            alert('Rejected. Student can update and resubmit this topic.');
            await this.loadGuideSeminar();
        },

        async guideLockSeminarTopic(studentId, topicId) {
            if (!confirm('Lock this as the only final topic? The student will not be able to add more topics, and no other topic can be locked.')) {
                return;
            }
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
            if (isSeminarTopicsLocked(data.seminar)) {
                alert('A topic is already locked for this student. Unlock it first if you need to change the final topic.');
                return;
            }
            const topic = (data.seminar.topics || []).find(t => t.id === topicId);
            if (!topic) { alert('Topic not found.'); return; }
            if (topic.status !== 'approved') {
                alert('Only an approved topic can be locked as final.');
                return;
            }
            // Enforce single lock; keep post-topic stages open even if unlocked later
            data.seminar.lockedTopicId = topicId;
            data.seminar.topicsLockedAt = new Date().toISOString();
            data.seminar.postTopicWorkflowOpen = true;
            data.seminar.topic = {
                title: topic.title,
                abstract: topic.description || '',
                status: 'final_approved',
                guideFeedback: topic.guideFeedback || '',
                submittedAt: topic.submittedAt || null
            };
            await setDoc(ref, { seminar: data.seminar }, { merge: true });
            alert('Final topic locked. Only this one topic is selected.');
            await this.loadGuideSeminar();
        },

        async guideUnlockSeminarTopics(studentId) {
            if (!confirm('Unlock topics for this student? They will be able to add/edit topics again. Reference papers, title/abstract, and PPT stay available if already unlocked.')) {
                return;
            }
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
            // Keep post-topic workflow open so papers / title / PPT remain usable
            if (data.seminar.lockedTopicId) {
                data.seminar.postTopicWorkflowOpen = true;
            }
            data.seminar.lockedTopicId = null;
            data.seminar.topicsLockedAt = null;
            if (data.seminar.topic) {
                data.seminar.topic.status = 'guide_approved';
            }
            await setDoc(ref, { seminar: data.seminar }, { merge: true });
            await this.loadGuideSeminar();
        },

        async guideRevertSeminarTopic(studentId, topicId) {
            const fb = prompt('Comment for the student (what to change):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please revise this topic and resubmit.';
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
            const topic = (data.seminar.topics || []).find(t => t.id === topicId);
            if (!topic) { alert('Topic not found.'); return; }

            // If this was the locked final topic, unlock so student can edit
            if (data.seminar.lockedTopicId === topicId) {
                data.seminar.postTopicWorkflowOpen = true;
                data.seminar.lockedTopicId = null;
                data.seminar.topicsLockedAt = null;
            }

            topic.status = 'needs_revision';
            topic.guideFeedback = reason;
            topic.reviewedAt = new Date().toISOString();
            await setDoc(ref, { seminar: data.seminar }, { merge: true });
            alert('Topic sent back to the student for editing.');
            await this.loadGuideSeminar();
        },

        async guideApproveTopic() {
            alert('Approve individual topics from the list, then lock one as final.');
        },
        async guideRejectTopic() {
            alert('Reject individual topics from the list.');
        },
        async guideFinalApproveTopic() {
            alert('Use “Lock as final” on an approved topic. Only one topic can be locked.');
        },

        async guideApprovePaper(studentId, paperId) {
            const fb = prompt('Optional note for the student (approval feedback):') || '';
            await this.updateStudentSeminar(studentId, s => {
                const p = (s.papers || []).find(x => x.id === paperId);
                if (!p) return;
                p.status = 'approved';
                p.guideFeedback = fb;
                p.reviewedAt = new Date().toISOString();
            });
        },

        async guideRejectPaper(studentId, paperId) {
            const fb = prompt('Reason for rejection (shown to student):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please provide a better / different reference.';
            await this.updateStudentSeminar(studentId, s => {
                const p = (s.papers || []).find(x => x.id === paperId);
                if (!p) return;
                p.status = 'rejected';
                p.guideFeedback = reason;
                p.reviewedAt = new Date().toISOString();
            });
            alert('Rejected. Student can update the link and resubmit.');
        },

        async guideOpenPaperUpload(studentId, paperId) {
            const fb = prompt('Comment for the student (what to change / upload):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please upload a new / updated reference link.';
            await this.updateStudentSeminar(studentId, s => {
                const p = (s.papers || []).find(x => x.id === paperId);
                if (!p) return;
                p.status = 'needs_revision';
                p.guideFeedback = reason;
                p.reviewedAt = new Date().toISOString();
            });
            alert('Paper opened for new upload. Student can edit and resubmit the link.');
        },

        async guideApproveTitleAbstract(studentId) {
            const fb = prompt('Optional note for the student (approval feedback):') || '';
            await this.updateStudentSeminar(studentId, s => {
                const ta = ensureTitleAbstract(s);
                ta.status = 'approved';
                ta.guideFeedback = fb;
                ta.reviewedAt = new Date().toISOString();
            });
        },

        async guideRejectTitleAbstract(studentId) {
            const fb = prompt('Reason for rejection (shown to student):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please revise the title and/or abstract.';
            await this.updateStudentSeminar(studentId, s => {
                const ta = ensureTitleAbstract(s);
                ta.status = 'rejected';
                ta.guideFeedback = reason;
                ta.reviewedAt = new Date().toISOString();
            });
            alert('Rejected. Student can update and resubmit the title & abstract.');
        },

        async guideOpenTitleAbstractEdit(studentId) {
            const fb = prompt('Comment for the student (what to change):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please revise the title and abstract and resubmit.';
            await this.updateStudentSeminar(studentId, s => {
                const ta = ensureTitleAbstract(s);
                ta.status = 'needs_revision';
                ta.guideFeedback = reason;
                ta.reviewedAt = new Date().toISOString();
            });
            alert('Title & abstract opened for edit. Student can update and resubmit.');
        },

        async guideApprovePpt(studentId) {
            const fb = prompt('Optional note for the student (approval feedback):') || '';
            await this.updateStudentSeminar(studentId, s => {
                const ppt = ensureSeminarPpt(s);
                ppt.status = 'approved';
                ppt.guideFeedback = fb;
                ppt.reviewedAt = new Date().toISOString();
            });
        },

        async guideRejectPpt(studentId) {
            const fb = prompt('Reason for rejection (shown to student):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please update the PPT and resubmit the link.';
            await this.updateStudentSeminar(studentId, s => {
                const ppt = ensureSeminarPpt(s);
                ppt.status = 'rejected';
                ppt.guideFeedback = reason;
                ppt.reviewedAt = new Date().toISOString();
            });
            alert('Rejected. Student can update and resubmit the PPT link.');
        },

        async guideOpenPptEdit(studentId) {
            const fb = prompt('Comment for the student (what to change):');
            if (fb === null) return;
            const reason = fb.trim() || 'Please update the PPT link and resubmit.';
            await this.updateStudentSeminar(studentId, s => {
                const ppt = ensureSeminarPpt(s);
                ppt.status = 'needs_revision';
                ppt.guideFeedback = reason;
                ppt.reviewedAt = new Date().toISOString();
            });
            alert('PPT reverted to student. They can update the link and resubmit.');
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
