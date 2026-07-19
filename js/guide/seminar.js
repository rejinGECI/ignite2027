// Seminar — guide module (topic review & lock)
import { escapeHtml } from '../utils/helpers.js';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    getDefaultSeminar,
    ensureSeminarTopics,
    getLockedTopic,
    isSeminarTopicsLocked,
    statusBadge,
    MIN_SEMINAR_TOPICS,
    normalizePaperStatus,
    isPaperPendingReview,
    ensureTitleAbstract
} from '../utils/seminarConfig.js?v=ta1';

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
                titleAbstractApproved: taStatus === 'approved'
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
                    ensureTitleAbstract(seminar);
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
                acc.papersPending += st.papersPending;
                acc.abstractPending += st.titleAbstractPending ? 1 : 0;
                return acc;
            }, { students: 0, pending: 0, locked: 0, awaiting: 0, noTopics: 0, papersPending: 0, abstractPending: 0 });

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
                        <div class="seminar-guide-stat ${stats.papersPending ? 'stat-warn' : ''}">
                            <strong>${stats.papersPending}</strong>
                            <span>Papers to review</span>
                        </div>
                        <div class="seminar-guide-stat ${stats.abstractPending ? 'stat-warn' : ''}">
                            <strong>${stats.abstractPending}</strong>
                            <span>Abstracts to review</span>
                        </div>
                    </div>

                    <div class="seminar-guide-toolbar">
                        <input type="search" id="guide-seminar-search" class="form-input search-input"
                            placeholder="Search student by name or KTU ID..." style="flex:1; max-width:360px;">
                        <select id="guide-seminar-filter" class="form-input" style="max-width:240px;">
                            <option value="all">All students</option>
                            <option value="pending">Topics need review</option>
                            <option value="papers">Papers need review</option>
                            <option value="abstract">Abstracts need review</option>
                            <option value="ready">Ready to lock</option>
                            <option value="locked">Locked</option>
                            <option value="none">No topics yet</option>
                        </select>
                    </div>

                    <p class="seminar-guide-howto">
                        <i class="fas fa-info-circle"></i>
                        Review topics → lock one final topic. Then verify <strong>reference papers</strong> and
                        <strong>title &amp; abstract</strong>: Approve, Reject, or Open for edit.
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
            if (st.titleAbstractPending) filterStatus = 'abstract';
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
                </article>
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
                        ${status !== 'approved' && status !== 'needs_revision' ? `
                            <button type="button" class="btn btn-sm btn-primary" onclick="app.guideApproveTitleAbstract('${escapeHtml(student.id)}')">
                                <i class="fas fa-check"></i> Approve
                            </button>
                        ` : ''}
                        ${status !== 'rejected' && status !== 'needs_revision' ? `
                            <button type="button" class="btn btn-sm btn-danger" onclick="app.guideRejectTitleAbstract('${escapeHtml(student.id)}')">
                                <i class="fas fa-times"></i> Reject
                            </button>
                        ` : ''}
                        ${status !== 'needs_revision' ? `
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideOpenTitleAbstractEdit('${escapeHtml(student.id)}')">
                                <i class="fas fa-undo"></i> Open for edit
                            </button>
                        ` : `
                            <p class="form-hint" style="margin:0;"><i class="fas fa-user-edit"></i> Waiting for student to edit and resubmit.</p>
                        `}
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
                        ${status !== 'needs_revision' ? `
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.guideOpenPaperUpload('${escapeHtml(student.id)}','${escapeHtml(paper.id)}')">
                                <i class="fas fa-upload"></i> Open for new upload
                            </button>
                        ` : `
                            <p class="form-hint" style="margin:0;"><i class="fas fa-user-edit"></i> Waiting for student to upload a new link.</p>
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
            // Enforce single lock
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
            alert('Final topic locked. Only this one topic is selected.');
            await this.loadGuideSeminar();
        },

        async guideUnlockSeminarTopics(studentId) {
            if (!confirm('Unlock topics for this student? They will be able to add topics again, and you can lock a different final topic later.')) {
                return;
            }
            const ref = doc(window.firebaseDb, 'userData', studentId);
            const snap = await getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            if (!data.seminar) data.seminar = getDefaultSeminar();
            ensureSeminarTopics(data.seminar);
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
