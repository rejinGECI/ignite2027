// Seminar — admin module
import { escapeHtml } from '../utils/helpers.js';
import {
    doc, getDoc, setDoc, collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    SEMINAR_SCHEDULE_FIELDS,
    SEMINAR_SCORING_CATEGORIES,
    DEFAULT_PRESENTER_PARAMS,
    DEFAULT_QUESTIONER_PARAMS,
    getDefaultSeminarSettings,
    getDefaultSeminar,
    getSyllabusScoringParams,
    normalizeScoringParams,
    categoryParamTotal,
    ensureSeminarTopics,
    ensureSeminarEvaluation,
    getLockedTopic,
    getSeminarDisplayTopic,
    formatPresentationSlot,
    formatTime12h,
    statusBadge,
    MIN_SEMINAR_TOPICS,
    normalizePaperStatus,
    ensureTitleAbstract,
    hasTitleAbstractSubmission,
    ensureSeminarPpt,
    hasPptSubmission,
    pickFairQuestioners,
    updateFairnessAfterPick,
    sumParamScores,
    equallyAllotGuidesToStudents,
    buildSeminarGuideAllotmentGroups,
    appendPresentationSlot,
    buildPresentationSlotGroups,
    canMarkSeminarCategory,
    resolveSeminarGuideId,
    buildEvaluatorMeta,
    computeSeminarGrandTotal
} from '../utils/seminarConfig.js?v=eval13';

const PAPER_TYPE_LABELS = {
    paper: 'Research paper',
    article: 'Article',
    docs: 'Documentation',
    other: 'Other'
};

const SLOT_CTX = 'seminar-slots';

export function createAdminSeminarModule(app) {
    return {
        async getSeminarSettings() {
            const ref = doc(window.firebaseDb, 'settings', 'seminar');
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const data = snap.data();
                const defaults = getDefaultSeminarSettings();
                return {
                    ...defaults,
                    ...data,
                    schedule: Object.fromEntries(
                        SEMINAR_SCHEDULE_FIELDS.map(f => [
                            f.key,
                            (data.schedule || {})[f.key] || ''
                        ])
                    ),
                    scoringParams: normalizeScoringParams(data.scoringParams),
                    guideAssignments: data.guideAssignments || {},
                    presentationAssignments: data.presentationAssignments || {},
                    presentationSlots: data.presentationSlots || [],
                    presentations: data.presentations || [],
                    questionFairness: data.questionFairness || {},
                    questionSettings: {
                        ...defaults.questionSettings,
                        ...(data.questionSettings || {})
                    }
                };
            }
            return getDefaultSeminarSettings();
        },

        async saveSeminarSettings(partial) {
            const ref = doc(window.firebaseDb, 'settings', 'seminar');
            await setDoc(ref, {
                ...partial,
                updatedAt: new Date().toISOString(),
                updatedBy: app.currentUser?.uid || null
            }, { merge: true });
            app._seminarSettingsCache = null;
        },

        async loadSeminarAdmin() {
            if (!app.isAdmin) return;
            const settings = await this.getSeminarSettings();
            app.seminarSettings = settings;

            await this.renderSeminarAdminOverview(settings);
            await this.renderSeminarGuideAllotmentSummary(settings);
            await this.renderSeminarStudents(settings);
            this.renderSeminarSlots(settings);
            this.renderSeminarScoringParams(settings);
            this.renderSeminarScheduleForm(settings);
            await this.renderPresentationScheduleSummary(settings);
            await this.refreshSeminarEvaluationList();
            this.bindSeminarAdminTabs();
            this.setupSeminarAdminSearch();
            this.setupSeminarEvalSearch();
            this.setupSeminarConsolidatedSearch();
        },

        showSeminarAdminTab(tabId) {
            document.querySelectorAll('.seminar-admin-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tabId);
            });
            document.querySelectorAll('.seminar-admin-panel').forEach(p => {
                p.classList.toggle('active', p.id === `seminar-admin-${tabId}`);
            });
            if (tabId === 'evaluation') this.refreshSeminarEvaluationList();
            if (tabId === 'consolidated') this.renderSeminarConsolidatedMarks();
        },

        setupSeminarEvalSearch() {
            const searchInput = document.getElementById('search-seminar-eval');
            if (!searchInput || searchInput.dataset.bound) return;
            searchInput.dataset.bound = 'true';
            searchInput.addEventListener('input', () => {
                const term = searchInput.value.toLowerCase().trim();
                document.querySelectorAll('#seminar-admin-eval-list .seminar-eval-shortcut-row').forEach(row => {
                    const name = row.dataset.name || '';
                    const ktuid = row.dataset.ktuid || '';
                    row.style.display = (!term || name.includes(term) || ktuid.includes(term)) ? '' : 'none';
                });
            });
        },

        async refreshSeminarEvaluationList() {
            const el = document.getElementById('seminar-admin-eval-list');
            if (!el) return;
            el.innerHTML = '<p class="form-hint">Loading students…</p>';
            try {
                const settings = await this.getSeminarSettings();
                const students = await this.fetchSeminarStudents();
                const guides = await this.fetchGuides();
                const guideMap = Object.fromEntries(guides.map(g => [g.id, g.name || g.email || 'Guide']));
                const maxP = settings.questionSettings?.maxParticipationMarks ?? 10;
                const fairness = settings.questionFairness || {};

                if (!students.length) {
                    el.innerHTML = '<p class="form-hint">No students found.</p>';
                    return;
                }

                students.sort((a, b) => a.name.localeCompare(b.name));
                el.innerHTML = students.map(s => {
                    const t = s.seminar?.totals || {};
                    const grand = computeSeminarGrandTotal(t, maxP);
                    const times = fairness[s.id]?.times || 0;
                    const gid = s.seminar?.guideId || settings.guideAssignments?.[s.id];
                    const absent = s.seminar?.evaluation?.isAbsent
                        ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">Absent</span>'
                        : '';
                    return `
                        <div class="seminar-eval-shortcut-row"
                            data-name="${escapeHtml((s.name || '').toLowerCase())}"
                            data-ktuid="${escapeHtml((s.ktuid || '').toLowerCase())}">
                            <div>
                                <strong>${escapeHtml(s.name)}</strong>
                                <small>(${escapeHtml(s.ktuid)})</small>
                                ${absent}
                                <div class="form-hint" style="margin:0.15rem 0 0;">
                                    Guide: ${gid ? escapeHtml(guideMap[gid] || gid) : '—'} ·
                                    Audience Q ×${times} ·
                                    G ${t.guideMarks || 0} · C ${t.coordinatorMarks || 0} ·
                                    P ${t.presentationMarks || 0} · R ${t.reportMarks || 0} ·
                                    Part ${Math.min(t.questionMarks || 0, maxP)}
                                </div>
                            </div>
                            <span><strong>${grand}</strong>/100</span>
                            <button type="button" class="btn btn-sm btn-primary" onclick="app.openSeminarEvaluation('${escapeHtml(s.id)}')">
                                <i class="fas fa-clipboard-check"></i> Evaluate
                            </button>
                        </div>`;
                }).join('');
            } catch (err) {
                console.error(err);
                el.innerHTML = '<p class="form-hint">Failed to load evaluation list.</p>';
            }
        },

        setupSeminarAdminSearch() {
            const searchInput = document.getElementById('search-seminar-students');
            if (!searchInput || searchInput.dataset.bound) return;
            searchInput.dataset.bound = 'true';
            searchInput.addEventListener('input', () => {
                const term = searchInput.value.toLowerCase().trim();
                document.querySelectorAll('#seminar-admin-students-list .forge-lab-admin-student-card').forEach(card => {
                    const name = card.dataset.name || '';
                    const ktuid = card.dataset.ktuid || '';
                    card.style.display = (!term || name.includes(term) || ktuid.includes(term)) ? '' : 'none';
                });
            });
        },

        async toggleSeminarEnabled() {
            const settings = await this.getSeminarSettings();
            const currentlyEnabled = settings.enabled !== false;
            const enabled = !currentlyEnabled;
            await this.saveSeminarSettings({ enabled });
            alert(enabled ? 'Seminar module enabled for students.' : 'Seminar module disabled.');
            await this.loadSeminarAdmin();
        },

        bindSeminarAdminTabs() {
            document.querySelectorAll('.seminar-admin-tab').forEach(tab => {
                if (tab.dataset.bound) return;
                tab.dataset.bound = 'true';
                tab.addEventListener('click', () => {
                    this.showSeminarAdminTab(tab.dataset.tab);
                });
            });
        },

        renderSeminarScheduleForm(settings) {
            const el = document.getElementById('seminar-admin-schedule-form');
            if (!el) return;
            el.innerHTML = SEMINAR_SCHEDULE_FIELDS.map(f => `
                <div class="form-group seminar-schedule-field">
                    <label><strong>${f.step}. ${escapeHtml(f.label)}</strong></label>
                    <input type="date" class="form-input seminar-schedule-input" data-key="${f.key}"
                        value="${escapeHtml(settings.schedule?.[f.key] || '')}">
                </div>
            `).join('');
        },

        async saveSeminarSchedule() {
            const schedule = Object.fromEntries(
                SEMINAR_SCHEDULE_FIELDS.map(f => [f.key, ''])
            );
            document.querySelectorAll('.seminar-schedule-input').forEach(inp => {
                if (schedule.hasOwnProperty(inp.dataset.key)) {
                    schedule[inp.dataset.key] = inp.value || '';
                }
            });
            await this.saveSeminarSettings({ schedule });
            alert('Schedule saved.');
            await this.loadSeminarAdmin();
        },

        formatSeminarReportDate(dateStr) {
            if (!dateStr) return '—';
            const d = new Date(`${dateStr}T12:00:00`);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('en-IN', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
            });
        },

        buildSeminarScheduleReportHtml(settings, slotAssignments) {
            const generatedOn = new Date().toLocaleDateString('en-IN', {
                day: '2-digit', month: 'long', year: 'numeric'
            });
            const updatedAt = settings.updatedAt
                ? new Date(settings.updatedAt).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
                : generatedOn;

            const scheduleRows = SEMINAR_SCHEDULE_FIELDS.map(f => ({
                step: f.step,
                label: f.label,
                date: settings.schedule?.[f.key] || ''
            }));

            const filledDeadlines = scheduleRows.filter(r => r.date).length;
            const slots = [...(settings.presentationSlots || [])].sort((a, b) => {
                const dateCmp = (a.date || '').localeCompare(b.date || '');
                if (dateCmp !== 0) return dateCmp;
                return (a.startTime || '').localeCompare(b.startTime || '');
            });

            const deadlineRows = scheduleRows.map((row, idx) => `
                <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                    <td style="padding: 10px 14px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${row.step}</td>
                    <td style="padding: 10px 14px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(row.label)}</td>
                    <td style="padding: 10px 14px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${escapeHtml(this.formatSeminarReportDate(row.date))}</td>
                </tr>
            `).join('');

            const slotRows = slots.length
                ? slots.map((slot, idx) => {
                    const student = slotAssignments[slot.id];
                    const timeRange = slot.startTime && slot.endTime
                        ? `${formatTime12h(slot.startTime)} – ${formatTime12h(slot.endTime)}`
                        : '—';
                    return `
                        <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                            <td style="padding: 10px 14px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                            <td style="padding: 10px 14px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(this.formatSeminarReportDate(slot.date))}</td>
                            <td style="padding: 10px 14px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(timeRange)}</td>
                            <td style="padding: 10px 14px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${student ? escapeHtml(student.name) : '—'}</td>
                            <td style="padding: 10px 14px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; font-weight: 500; border-bottom: 1px solid #e5e7eb;">${student ? escapeHtml(student.ktuid) : '—'}</td>
                        </tr>
                    `;
                }).join('')
                : `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #6b7280; font-family: 'Lato', sans-serif; font-size: 13px;">No presentation slots configured yet.</td></tr>`;

            const assignedSlots = slots.filter(s => slotAssignments[s.id]).length;

            return `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Seminar Schedule Report</title>
                    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap" rel="stylesheet">
                    <style>
                        @media print {
                            @page { size: A4; margin: 1cm; }
                            body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        }
                        body {
                            font-family: 'Lato', sans-serif;
                            color: #2d3748;
                            line-height: 1.5;
                            margin: 0;
                            padding: 0;
                            background-color: #ffffff;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    </style>
                </head>
                <body>
                    <div style="max-width: 900px; margin: 20px auto; padding: 20px; background: #ffffff;">
                        <div style="text-align: center; margin-bottom: 30px; padding: 30px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); border: 1px solid rgba(0, 0, 0, 0.06);">
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">DEPARTMENT OF INFORMATION TECHNOLOGY</div>
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">GOVERNMENT ENGINEERING COLLEGE IDUKKI</div>
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 20px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">SEMINAR MODULE</div>
                            <div style="font-family: 'Lato', sans-serif; font-size: 24px; font-weight: 700; margin-top: 20px; padding: 15px 35px; background: #f8fafc; border-radius: 12px; display: inline-block; color: #1f2937; border: 2px solid rgba(0, 0, 0, 0.08);">
                                Tentative Schedule
                            </div>
                        </div>

                        <div style="margin-bottom: 30px; padding: 24px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                            <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 16px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Overview</h3>
                            <div style="display: grid; gap: 10px;">
                                <div style="display: flex; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                                    <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 180px; font-size: 13px;">Schedule updated:</span>
                                    <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${escapeHtml(updatedAt)}</span>
                                </div>
                                <div style="display: flex; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                                    <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 180px; font-size: 13px;">Submission deadlines set:</span>
                                    <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${filledDeadlines} of ${scheduleRows.length}</span>
                                </div>
                                <div style="display: flex; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                                    <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 180px; font-size: 13px;">Presentation slots:</span>
                                    <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${slots.length} (${assignedSlots} assigned)</span>
                                </div>
                            </div>
                        </div>

                        <div style="margin-bottom: 30px; padding: 24px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                            <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 16px 0; color: #1f2937; border-left: 4px solid #6366f1; padding-left: 12px;">Seminar Timeline</h3>
                            <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                                <thead>
                                    <tr>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; width: 8%;">Sl. No.</th>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Activity</th>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 38%;">Deadline</th>
                                    </tr>
                                </thead>
                                <tbody>${deadlineRows}</tbody>
                            </table>
                        </div>

                        <div style="margin-bottom: 30px; padding: 24px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                            <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 16px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">Presentation Slots</h3>
                            <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                                <thead>
                                    <tr>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; width: 6%;">Sl. No.</th>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 28%;">Date</th>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 22%;">Time</th>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Presenter</th>
                                        <th style="padding: 10px 14px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 14%;">KTU ID</th>
                                    </tr>
                                </thead>
                                <tbody>${slotRows}</tbody>
                            </table>
                        </div>

                        <div style="margin-top: 20px; text-align: right; font-size: 11px; color: #6b7280; padding-top: 12px; border-top: 1px solid #e5e7eb; font-family: 'Lato', sans-serif; font-weight: 500;">
                            Generated on: ${escapeHtml(generatedOn)}
                        </div>
                    </div>
                </body>
                </html>
            `;
        },

        async generateSeminarScheduleReport() {
            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents();
            const slotAssignments = {};
            for (const s of students) {
                const slotId = s.seminar.presentationSlotId || settings.presentationAssignments?.[s.id];
                if (slotId) slotAssignments[slotId] = s;
            }

            const hasSchedule = SEMINAR_SCHEDULE_FIELDS.some(f => settings.schedule?.[f.key]);
            const hasSlots = (settings.presentationSlots || []).length > 0;
            if (!hasSchedule && !hasSlots) {
                alert('No schedule data found. Save submission deadlines and/or presentation slots first.');
                return;
            }

            const reportContent = this.buildSeminarScheduleReportHtml(settings, slotAssignments);
            try {
                await app.generatePDFReport(
                    reportContent,
                    { groupName: 'Seminar' },
                    { name: 'Seminar Schedule' }
                );
            } catch (error) {
                console.error(error);
                alert('Error generating schedule report. Please allow popups and try again.');
            }
        },

        getSeminarActor() {
            if (app.isAdmin) {
                return {
                    uid: app.currentUser?.uid || 'admin',
                    name: app.currentUser?.displayName || app.currentUser?.email || 'Admin',
                    role: 'admin'
                };
            }
            if (app.isGuide) {
                try {
                    const session = JSON.parse(sessionStorage.getItem('guideSession') || '{}');
                    return {
                        uid: session.uid || app.currentUser?.uid || null,
                        name: session.name || session.email || 'Faculty',
                        role: 'guide'
                    };
                } catch (e) {
                    return { uid: null, name: 'Faculty', role: 'guide' };
                }
            }
            return null;
        },

        renderSeminarScoringParams(settings) {
            const qCount = document.getElementById('seminar-questions-per-pres');
            const maxPart = document.getElementById('seminar-max-participation');
            if (qCount) qCount.value = settings.questionSettings?.questionsPerPresentation ?? 2;
            if (maxPart) maxPart.value = settings.questionSettings?.maxParticipationMarks ?? 10;

            const info = document.getElementById('seminar-scoring-syllabus-info');
            if (info) {
                const sp = settings.scoringParams;
                const g = categoryParamTotal(sp.guide);
                const c = categoryParamTotal(sp.coordinator);
                const p = categoryParamTotal(sp.presentation);
                const r = categoryParamTotal(sp.report);
                const qMax = settings.questionSettings?.maxParticipationMarks ?? 10;
                const total = g + c + p + r + qMax;
                info.innerHTML = `
                    <p class="form-hint" style="margin:0;">
                        <strong>Current CIE total:</strong> ${total}
                        (Guide ${g} + Coordinator ${c} + Presentation ${p} + Report ${r} + Participation cap ${qMax}).
                        Syllabus target: <strong>100</strong>, pass mark <strong>50</strong>.
                    </p>`;
            }

            SEMINAR_SCORING_CATEGORIES.forEach(cat => {
                if (cat.key === 'questioner') return; // rendered separately with Q settings
                const container = document.getElementById(`seminar-scoring-${cat.key}`);
                if (!container) return;
                const params = settings.scoringParams[cat.key] || [];
                container.innerHTML = params.map((p, i) => `
                    <div class="seminar-param-row" data-param-id="${escapeHtml(p.id)}">
                        <input type="text" class="form-input seminar-param-label" data-idx="${i}" value="${escapeHtml(p.label)}" placeholder="Parameter name">
                        <input type="number" class="form-input seminar-param-max" data-idx="${i}" min="0" max="100" value="${p.maxMarks}" style="width:80px;">
                        <input type="text" class="form-input seminar-param-desc" data-idx="${i}" value="${escapeHtml(p.description || '')}" placeholder="Description">
                        <button type="button" class="btn btn-sm btn-danger" title="Remove" onclick="this.closest('.seminar-param-row').remove()"><i class="fas fa-times"></i></button>
                    </div>
                `).join('') || '<p class="form-hint">No parameters — add one below.</p>';
            });

            const qEl = document.getElementById('seminar-scoring-questioner');
            if (qEl) {
                const params = settings.scoringParams.questioner || [];
                qEl.innerHTML = params.map((p, i) => `
                    <div class="seminar-param-row" data-param-id="${escapeHtml(p.id)}">
                        <input type="text" class="form-input seminar-param-label" data-idx="${i}" value="${escapeHtml(p.label)}" placeholder="Parameter name">
                        <input type="number" class="form-input seminar-param-max" data-idx="${i}" min="0" max="100" value="${p.maxMarks}" style="width:80px;">
                        <input type="text" class="form-input seminar-param-desc" data-idx="${i}" value="${escapeHtml(p.description || '')}" placeholder="Description">
                        <button type="button" class="btn btn-sm btn-danger" title="Remove" onclick="this.closest('.seminar-param-row').remove()"><i class="fas fa-times"></i></button>
                    </div>
                `).join('');
            }
        },

        addSeminarScoringParam(categoryKey) {
            const container = document.getElementById(`seminar-scoring-${categoryKey}`);
            if (!container) return;
            const hint = container.querySelector('.form-hint');
            if (hint) hint.remove();
            const id = `p_${Date.now()}`;
            container.insertAdjacentHTML('beforeend', `
                <div class="seminar-param-row" data-param-id="${id}">
                    <input type="text" class="form-input seminar-param-label" value="" placeholder="Parameter name">
                    <input type="number" class="form-input seminar-param-max" min="0" max="100" value="5" style="width:80px;">
                    <input type="text" class="form-input seminar-param-desc" value="" placeholder="Description">
                    <button type="button" class="btn btn-sm btn-danger" title="Remove" onclick="this.closest('.seminar-param-row').remove()"><i class="fas fa-times"></i></button>
                </div>
            `);
        },

        collectScoringParams(container) {
            if (!container) return [];
            const rows = container.querySelectorAll('.seminar-param-row');
            return [...rows].map((row, i) => ({
                id: row.dataset.paramId || `p_${i}`,
                label: row.querySelector('.seminar-param-label')?.value.trim() || `Param ${i + 1}`,
                maxMarks: parseInt(row.querySelector('.seminar-param-max')?.value, 10) || 0,
                description: row.querySelector('.seminar-param-desc')?.value.trim() || ''
            }));
        },

        async saveSeminarScoringParams() {
            const guide = this.collectScoringParams(document.getElementById('seminar-scoring-guide'));
            const coordinator = this.collectScoringParams(document.getElementById('seminar-scoring-coordinator'));
            const presentation = this.collectScoringParams(document.getElementById('seminar-scoring-presentation'));
            const report = this.collectScoringParams(document.getElementById('seminar-scoring-report'));
            const questioner = this.collectScoringParams(document.getElementById('seminar-scoring-questioner'));
            const questionsPerPresentation = parseInt(document.getElementById('seminar-questions-per-pres')?.value, 10) || 2;
            const maxParticipationMarks = parseInt(document.getElementById('seminar-max-participation')?.value, 10) || 10;
            await this.saveSeminarSettings({
                scoringParams: {
                    guide, coordinator, presentation, report, questioner,
                    presenter: presentation
                },
                questionSettings: { questionsPerPresentation, maxParticipationMarks }
            });
            alert('Scoring parameters saved.');
            await this.loadSeminarAdmin();
        },

        async resetSeminarScoringToSyllabus() {
            if (!confirm('Reset all mark components to ITQ413 syllabus defaults (Guide 20 + Coordinator 20 + Presentation 30 + Report 20 + Participation 10 = 100)?')) return;
            const scoringParams = getSyllabusScoringParams();
            await this.saveSeminarSettings({
                scoringParams,
                questionSettings: { questionsPerPresentation: 2, maxParticipationMarks: 10 }
            });
            alert('Restored syllabus CIE mark split.');
            await this.loadSeminarAdmin();
        },

        async clearDummySeminarEvaluations() {
            if (!confirm('Clear ALL dummy/test seminar marks (component scores, audience Q scores, fairness counters tied only to dummy entries)? Real (non-dummy) marks are kept.')) return;

            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents();
            let clearedComponents = 0;
            let clearedQuestions = 0;

            for (const s of students) {
                const ref = doc(window.firebaseDb, 'userData', s.id);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                if (!data.seminar) continue;
                ensureSeminarEvaluation(data.seminar);
                const evalObj = data.seminar.evaluation;
                let changed = false;

                if (evalObj.isAbsent && evalObj.absentMarkedBy?.isDummy) {
                    evalObj.isAbsent = false;
                    evalObj.absentReason = '';
                    evalObj.absentMarkedBy = null;
                    evalObj.absentAt = null;
                    changed = true;
                }

                for (const key of Object.keys(evalObj.components || {})) {
                    const comp = evalObj.components[key];
                    if (comp?.evaluators && typeof comp.evaluators === 'object') {
                        for (const [id, ev] of Object.entries(comp.evaluators)) {
                            if (ev?.isDummy || ev?.markedBy?.isDummy) {
                                delete comp.evaluators[id];
                                changed = true;
                            }
                        }
                    }
                    if (comp?.markedBy?.isDummy || comp?.isDummy) {
                        delete evalObj.components[key];
                        clearedComponents++;
                        changed = true;
                    }
                }
                evalObj.markHistory = (evalObj.markHistory || []).filter(h => !h.isDummy && !h.markedBy?.isDummy);

                const sp = settings.scoringParams;
                data.seminar.totals = data.seminar.totals || {};
                data.seminar.totals.guideMarks = sumParamScores(evalObj.components.guide?.scores, sp.guide);
                data.seminar.totals.coordinatorMarks = sumParamScores(evalObj.components.coordinator?.scores, sp.coordinator);
                data.seminar.totals.presentationMarks = sumParamScores(evalObj.components.presentation?.scores, sp.presentation);
                data.seminar.totals.reportMarks = sumParamScores(evalObj.components.report?.scores, sp.report);

                if (changed) {
                    await setDoc(ref, { seminar: data.seminar }, { merge: true });
                }
            }

            const presentations = (settings.presentations || []).map(pres => {
                const next = { ...pres, questionerScores: { ...(pres.questionerScores || {}) }, questionerMeta: { ...(pres.questionerMeta || {}) } };
                const meta = next.questionerMeta || {};
                for (const qid of Object.keys(meta)) {
                    if (meta[qid]?.isDummy || meta[qid]?.markedBy?.isDummy) {
                        delete next.questionerScores[qid];
                        delete next.questionerMeta[qid];
                        next.questionerIds = (next.questionerIds || []).filter(id => id !== qid);
                        clearedQuestions++;
                    }
                }
                // Also clear score blobs flagged via _isDummy on scores object
                for (const qid of Object.keys(next.questionerScores || {})) {
                    if (next.questionerScores[qid]?._isDummy) {
                        delete next.questionerScores[qid];
                        delete next.questionerMeta[qid];
                        next.questionerIds = (next.questionerIds || []).filter(id => id !== qid);
                        clearedQuestions++;
                    }
                }
                if (pres.presenterScores?._isDummy || pres.evaluationMeta?.isDummy) {
                    next.presenterScores = {};
                    if (next.evaluationMeta) delete next.evaluationMeta;
                }
                if (pres.presenterEvaluatorScores) {
                    next.presenterEvaluatorScores = { ...pres.presenterEvaluatorScores };
                    for (const [id, ev] of Object.entries(next.presenterEvaluatorScores)) {
                        if (ev?.isDummy || ev?.markedBy?.isDummy || ev?.scores?._isDummy) {
                            delete next.presenterEvaluatorScores[id];
                        }
                    }
                }
                return next;
            });

            // Rebuild fairness from remaining non-dummy questioner picks
            let fairness = {};
            presentations.forEach((pres, idx) => {
                const ids = pres.questionerIds || [];
                if (ids.length) fairness = updateFairnessAfterPick(fairness, ids, pres.presentationIndex ?? idx);
            });

            await this.saveSeminarSettings({ presentations, questionFairness: fairness });
            await this.recalculateSeminarQuestionTotals(settings, presentations);

            // Refresh grand totals after Q recalc
            for (const s of students) {
                const ref = doc(window.firebaseDb, 'userData', s.id);
                const snap = await getDoc(ref);
                if (!snap.exists()) continue;
                const data = snap.data();
                if (!data.seminar) continue;
                ensureSeminarEvaluation(data.seminar);
                const maxP = settings.questionSettings?.maxParticipationMarks ?? 10;
                data.seminar.totals.grandTotal = computeSeminarGrandTotal(data.seminar.totals, maxP);
                await setDoc(ref, { seminar: data.seminar }, { merge: true });
            }

            alert(`Dummy data cleared.\nComponent entries removed: ${clearedComponents}\nAudience Q entries removed: ${clearedQuestions}`);
            await this.loadSeminarAdmin();
        },

        stripSeminarDummyFlag(entry) {
            if (!entry || typeof entry !== 'object') return false;
            let changed = false;
            if (entry.isDummy) {
                entry.isDummy = false;
                changed = true;
            }
            if (entry.markedBy?.isDummy) {
                entry.markedBy = { ...entry.markedBy, isDummy: false };
                changed = true;
            }
            if (entry.scores && Object.prototype.hasOwnProperty.call(entry.scores, '_isDummy')) {
                delete entry.scores._isDummy;
                changed = true;
            }
            return changed;
        },

        async promoteDummySeminarEvaluations() {
            if (!confirm('Keep all dummy/test seminar marks and convert them to official CIE (remove the dummy flag and peach highlight)? Scores are not deleted.')) return;

            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents({ force: true });
            let converted = 0;

            for (const s of students) {
                const ref = doc(window.firebaseDb, 'userData', s.id);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                if (!data.seminar) continue;
                ensureSeminarEvaluation(data.seminar);
                const evalObj = data.seminar.evaluation;
                let changed = false;

                if (this.stripSeminarDummyFlag(evalObj.absentMarkedBy)) changed = true;

                for (const key of Object.keys(evalObj.components || {})) {
                    const comp = evalObj.components[key];
                    if (this.stripSeminarDummyFlag(comp)) {
                        converted += 1;
                        changed = true;
                    }
                    if (comp?.evaluators && typeof comp.evaluators === 'object') {
                        for (const ev of Object.values(comp.evaluators)) {
                            if (this.stripSeminarDummyFlag(ev)) {
                                converted += 1;
                                changed = true;
                            }
                        }
                    }
                }
                (evalObj.markHistory || []).forEach(h => {
                    if (this.stripSeminarDummyFlag(h)) changed = true;
                });
                (data.seminar.questionHistory || []).forEach(h => {
                    if (this.stripSeminarDummyFlag(h)) changed = true;
                });

                if (changed) {
                    const sp = settings.scoringParams;
                    data.seminar.totals = data.seminar.totals || {};
                    data.seminar.totals.guideMarks = sumParamScores(evalObj.components.guide?.scores, sp.guide);
                    data.seminar.totals.coordinatorMarks = sumParamScores(evalObj.components.coordinator?.scores, sp.coordinator);
                    data.seminar.totals.presentationMarks = sumParamScores(evalObj.components.presentation?.scores, sp.presentation);
                    data.seminar.totals.reportMarks = sumParamScores(evalObj.components.report?.scores, sp.report);
                    const maxP = settings.questionSettings?.maxParticipationMarks ?? 10;
                    data.seminar.totals.grandTotal = computeSeminarGrandTotal(data.seminar.totals, maxP);
                    await setDoc(ref, { seminar: data.seminar }, { merge: true });
                }
            }

            const presentations = (settings.presentations || []).map(pres => {
                const next = {
                    ...pres,
                    questionerScores: { ...(pres.questionerScores || {}) },
                    questionerMeta: { ...(pres.questionerMeta || {}) },
                    presenterEvaluatorScores: { ...(pres.presenterEvaluatorScores || {}) }
                };
                if (this.stripSeminarDummyFlag(next.evaluationMeta)) converted += 1;
                if (next.presenterScores?._isDummy) {
                    delete next.presenterScores._isDummy;
                    converted += 1;
                }
                for (const ev of Object.values(next.presenterEvaluatorScores)) {
                    if (this.stripSeminarDummyFlag(ev)) converted += 1;
                }
                for (const meta of Object.values(next.questionerMeta)) {
                    if (this.stripSeminarDummyFlag(meta)) converted += 1;
                }
                for (const scores of Object.values(next.questionerScores)) {
                    if (scores?._isDummy) {
                        delete scores._isDummy;
                        converted += 1;
                    }
                }
                return next;
            });

            await this.saveSeminarSettings({ presentations });
            this.invalidateSeminarCaches();
            alert(`Dummy flag removed. ${converted} dummy mark record(s) are now official CIE.`);
            await this.loadSeminarAdmin();
            if (typeof this.renderSeminarConsolidatedMarks === 'function') {
                await this.renderSeminarConsolidatedMarks(true);
            }
        },

        renderSeminarSlots(settings) {
            const rowsEl = document.getElementById(`slot-rows-${SLOT_CTX}`);
            if (!rowsEl) return;
            const slots = settings.presentationSlots || [];
            rowsEl.innerHTML = slots.length
                ? slots.map(s => this.renderSlotRow(SLOT_CTX, s)).join('')
                : '<p class="form-hint forge-lab-no-slots-msg">No presentation slots yet.</p>';
        },

        renderSlotRow(ctx, slot) {
            const id = escapeHtml(slot.id);
            return `
                <div class="forge-lab-custom-slot-row" data-row-id="${id}">
                    <div class="forge-lab-custom-slot-field"><label>Date</label>
                        <input type="date" class="form-input forge-lab-slot-date" value="${escapeHtml(slot.date || '')}"></div>
                    <div class="forge-lab-custom-slot-field"><label>Start</label>
                        <input type="time" class="form-input forge-lab-slot-start" value="${escapeHtml(slot.startTime || '')}"></div>
                    <div class="forge-lab-custom-slot-field"><label>End</label>
                        <input type="time" class="form-input forge-lab-slot-end" value="${escapeHtml(slot.endTime || '')}"></div>
                    <button type="button" class="btn btn-sm btn-danger" onclick="app.removeSeminarSlotRow('${id}')"><i class="fas fa-times"></i></button>
                </div>`;
        },

        addSeminarSlotRow() {
            const rowsEl = document.getElementById(`slot-rows-${SLOT_CTX}`);
            if (!rowsEl) return;
            const msg = rowsEl.querySelector('.forge-lab-no-slots-msg');
            if (msg) msg.remove();
            rowsEl.insertAdjacentHTML('beforeend', this.renderSlotRow(SLOT_CTX, {
                id: `slot_${Date.now()}`, date: '', startTime: '', endTime: ''
            }));
        },

        removeSeminarSlotRow(rowId) {
            const rowsEl = document.getElementById(`slot-rows-${SLOT_CTX}`);
            const row = rowsEl?.querySelector(`[data-row-id="${rowId}"]`);
            if (row) row.remove();
            if (!rowsEl?.querySelector('.forge-lab-custom-slot-row')) {
                rowsEl.innerHTML = '<p class="form-hint forge-lab-no-slots-msg">No presentation slots yet.</p>';
            }
        },

        collectSeminarSlots() {
            const rowsEl = document.getElementById(`slot-rows-${SLOT_CTX}`);
            if (!rowsEl) return [];
            return [...rowsEl.querySelectorAll('.forge-lab-custom-slot-row')].map(row => ({
                id: row.dataset.rowId,
                date: row.querySelector('.forge-lab-slot-date')?.value || '',
                startTime: (row.querySelector('.forge-lab-slot-start')?.value || '').slice(0, 5),
                endTime: (row.querySelector('.forge-lab-slot-end')?.value || '').slice(0, 5)
            }));
        },

        async saveSeminarPresentationSlots() {
            const slots = this.collectSeminarSlots();
            for (const s of slots) {
                if (!s.date || !s.startTime || !s.endTime) {
                    alert('Each slot needs date, start, and end time.');
                    return;
                }
            }
            await this.saveSeminarSettings({ presentationSlots: slots });
            alert('Presentation slots saved.');
            await this.loadSeminarAdmin();
        },

        async fetchSeminarStudents({ force = false } = {}) {
            const cache = app._seminarStudentsCache;
            if (!force && cache?.students?.length && (Date.now() - (cache.at || 0)) < 120000) {
                return cache.students;
            }

            const usersSnap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'student')));
            const students = await Promise.all(usersSnap.docs.map(async (userDoc) => {
                const u = userDoc.data();
                const dataSnap = await getDoc(doc(window.firebaseDb, 'userData', userDoc.id));
                const userData = dataSnap.exists() ? dataSnap.data() : {};
                const seminar = userData.seminar || getDefaultSeminar();
                ensureSeminarTopics(seminar);
                ensureSeminarEvaluation(seminar);
                return {
                    id: userDoc.id,
                    name: u.name || u.username || 'Unknown',
                    ktuid: u.username || '',
                    seminar,
                    userData
                };
            }));

            app._seminarStudentsCache = { students, at: Date.now() };
            // Lightweight roster for modal (names only)
            app._seminarRosterCache = {
                at: Date.now(),
                byId: Object.fromEntries(students.map(s => [s.id, { id: s.id, name: s.name, ktuid: s.ktuid }]))
            };
            return students;
        },

        invalidateSeminarCaches() {
            app._seminarStudentsCache = null;
            app._seminarGuidesCache = null;
            app._seminarSettingsCache = null;
        },

        async fetchOneSeminarStudent(studentId) {
            const userSnap = await getDoc(doc(window.firebaseDb, 'users', studentId));
            const dataSnap = await getDoc(doc(window.firebaseDb, 'userData', studentId));
            const u = userSnap.exists() ? userSnap.data() : {};
            const userData = dataSnap.exists() ? dataSnap.data() : {};
            const seminar = userData.seminar || getDefaultSeminar();
            ensureSeminarTopics(seminar);
            ensureSeminarEvaluation(seminar);
            const student = {
                id: studentId,
                name: u.name || u.username || 'Unknown',
                ktuid: u.username || '',
                seminar,
                userData
            };
            // Keep cache entry fresh for this student
            if (app._seminarStudentsCache?.students) {
                const idx = app._seminarStudentsCache.students.findIndex(s => s.id === studentId);
                if (idx >= 0) app._seminarStudentsCache.students[idx] = student;
            }
            return student;
        },

        async getSeminarSettingsCached({ force = false } = {}) {
            const cache = app._seminarSettingsCache;
            if (!force && cache?.settings && (Date.now() - (cache.at || 0)) < 60000) {
                return cache.settings;
            }
            const settings = await this.getSeminarSettings();
            app._seminarSettingsCache = { settings, at: Date.now() };
            return settings;
        },

        async fetchGuides({ force = false } = {}) {
            const cache = app._seminarGuidesCache;
            if (!force && cache?.guides && (Date.now() - (cache.at || 0)) < 300000) {
                return cache.guides;
            }
            const snap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'guide')));
            const guides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            app._seminarGuidesCache = { guides, at: Date.now() };
            return guides;
        },

        getSeminarRoster() {
            if (app._seminarRosterCache?.byId) return app._seminarRosterCache.byId;
            if (app._seminarStudentsCache?.students) {
                return Object.fromEntries(
                    app._seminarStudentsCache.students.map(s => [s.id, { id: s.id, name: s.name, ktuid: s.ktuid }])
                );
            }
            return {};
        },

        async ensureSeminarRoster() {
            let roster = this.getSeminarRoster();
            if (Object.keys(roster).length) return roster;
            // Build roster from users only (no per-student userData) — fast
            const usersSnap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'student')));
            roster = {};
            usersSnap.docs.forEach(d => {
                const u = d.data();
                roster[d.id] = {
                    id: d.id,
                    name: u.name || u.username || 'Unknown',
                    ktuid: u.username || ''
                };
            });
            app._seminarRosterCache = { byId: roster, at: Date.now() };
            return roster;
        },

        async randomAllotSeminarGuides() {
            if (!confirm('Randomly assign guides to all students with equal faculty load? This replaces current assignments.')) return;
            const students = await this.fetchSeminarStudents();
            const guides = await this.fetchGuides();
            if (!guides.length) { alert('No guides found. Create guides first.'); return; }
            if (!students.length) { alert('No students found.'); return; }

            const { guideAssignments, loadByGuide } = equallyAllotGuidesToStudents(students, guides);
            const now = new Date().toISOString();

            for (const student of students) {
                const guideId = guideAssignments[student.id];
                const ref = doc(window.firebaseDb, 'userData', student.id);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                if (!data.seminar) data.seminar = getDefaultSeminar();
                data.seminar.guideId = guideId;
                await setDoc(ref, { seminar: data.seminar }, { merge: true });
            }

            await this.saveSeminarSettings({
                guideAssignments,
                guideLoadByGuide: loadByGuide,
                guideAllottedAt: now
            });

            const loads = Object.values(loadByGuide);
            const min = Math.min(...loads);
            const max = Math.max(...loads);
            alert(`Guides assigned to ${students.length} students.\nFaculty load: ${min}–${max} students per guide (equal distribution).`);
            await this.loadSeminarAdmin();
        },

        async renderSeminarGuideAllotmentSummary(settings) {
            const el = document.getElementById('seminar-guide-allotment-summary');
            if (!el) return;

            const students = await this.fetchSeminarStudents();
            const guides = await this.fetchGuides();
            const assignments = settings.guideAssignments || {};
            const assignedCount = Object.keys(assignments).length;

            if (!assignedCount) {
                el.innerHTML = '<p class="form-hint">No guide allotments yet. Run random allotment above to assign faculty.</p>';
                return;
            }

            const groups = buildSeminarGuideAllotmentGroups(students, guides, assignments);
            const allottedAt = settings.guideAllottedAt
                ? new Date(settings.guideAllottedAt).toLocaleString()
                : '—';

            const facultyCards = groups.map(g => `
                <div class="seminar-faculty-allotment-card">
                    <div class="seminar-faculty-allotment-header">
                        <div>
                            <strong>${escapeHtml(g.guideName)}</strong>
                            ${g.guideEmail ? `<div class="form-hint">${escapeHtml(g.guideEmail)}</div>` : ''}
                        </div>
                        <span class="badge">${g.students.length} student${g.students.length === 1 ? '' : 's'}</span>
                    </div>
                    ${g.students.length
                        ? `<ul class="seminar-faculty-student-list">${g.students.map(s =>
                            `<li>${escapeHtml(s.name)} <small>(${escapeHtml(s.ktuid)})</small></li>`
                        ).join('')}</ul>`
                        : '<p class="form-hint">No students assigned.</p>'}
                </div>
            `).join('');

            const loadCounts = groups.map(g => g.students.length);
            const minLoad = loadCounts.length ? Math.min(...loadCounts) : 0;
            const maxLoad = loadCounts.length ? Math.max(...loadCounts) : 0;

            el.innerHTML = `
                <p class="form-hint">Last allotted: ${escapeHtml(allottedAt)} · ${assignedCount} students · Load per faculty: ${minLoad}–${maxLoad}</p>
                <div class="seminar-faculty-allotment-grid">${facultyCards}</div>
            `;
        },

        downloadSeminarCsv(filename, csv) {
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
        },

        buildSeminarGuideAllotmentReportHtml(groups, settings) {
            const allottedAt = settings.guideAllottedAt
                ? new Date(settings.guideAllottedAt).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'long', year: 'numeric'
                })
                : new Date().toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'long', year: 'numeric'
                });
            const loads = groups.map(g => g.students.length);
            const totalAssigned = groups.reduce((sum, g) => sum + g.students.length, 0);
            const minLoad = loads.length ? Math.min(...loads) : 0;
            const maxLoad = loads.length ? Math.max(...loads) : 0;
            const generatedOn = new Date().toLocaleDateString('en-IN', {
                day: '2-digit', month: 'long', year: 'numeric'
            });

            const facultySections = groups.map(g => `
                <div style="margin-bottom: 30px; padding: 24px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-inside: avoid;">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: #1f2937; border-left: 4px solid #6366f1; padding-left: 12px; letter-spacing: 0.5px;">
                        ${escapeHtml(g.guideName)}
                        <span style="font-family: 'Lato', sans-serif; font-size: 13px; font-weight: 600; color: #6366f1; margin-left: 8px;">(${g.students.length} student${g.students.length === 1 ? '' : 's'})</span>
                    </h3>
                    ${g.guideEmail ? `<p style="font-family: 'Lato', sans-serif; font-size: 13px; color: #6b7280; margin: 0 0 16px 16px;">${escapeHtml(g.guideEmail)}</p>` : ''}
                    ${g.students.length ? `
                        <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
                            <thead>
                                <tr>
                                    <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; text-align: center; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: 12px; border-bottom: 2px solid #e5e7eb; width: 8%;">Sl. No.</th>
                                    <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; text-align: left; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: 12px; border-bottom: 2px solid #e5e7eb;">Student Name</th>
                                    <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; text-align: left; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: 12px; border-bottom: 2px solid #e5e7eb; width: 22%;">KTU ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${g.students.map((s, idx) => `
                                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                                        <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.name)}</td>
                                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; font-weight: 500; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.ktuid)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : '<p style="font-family: Lato, sans-serif; font-size: 13px; color: #6b7280; margin: 0 0 0 16px;">No students assigned.</p>'}
                </div>
            `).join('');

            const masterRows = [];
            groups.forEach(g => {
                g.students.forEach(s => {
                    masterRows.push({ s, g });
                });
            });
            masterRows.sort((a, b) =>
                a.g.guideName.localeCompare(b.g.guideName) || a.s.name.localeCompare(b.s.name)
            );

            return `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Seminar Guide Allotment Report</title>
                    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap" rel="stylesheet">
                    <style>
                        @media print {
                            @page { size: A4; margin: 1cm; }
                            body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        }
                        body {
                            font-family: 'Lato', sans-serif;
                            color: #2d3748;
                            line-height: 1.5;
                            margin: 0;
                            padding: 0;
                            background-color: #ffffff;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    </style>
                </head>
                <body>
                    <div style="max-width: 900px; margin: 20px auto; padding: 20px; background: #ffffff;">
                        <div style="text-align: center; margin-bottom: 30px; padding: 30px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); border: 1px solid rgba(0, 0, 0, 0.06);">
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">DEPARTMENT OF INFORMATION TECHNOLOGY</div>
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">GOVERNMENT ENGINEERING COLLEGE IDUKKI</div>
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 20px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">SEMINAR MODULE</div>
                            <div style="font-family: 'Lato', sans-serif; font-size: 24px; font-weight: 700; margin-top: 20px; padding: 15px 35px; background: #f8fafc; border-radius: 12px; display: inline-block; color: #1f2937; border: 2px solid rgba(0, 0, 0, 0.08);">
                                Guide Allotment Report
                            </div>
                        </div>

                        <div style="margin-bottom: 30px; padding: 24px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                            <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 16px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                            <div style="display: grid; gap: 10px;">
                                <div style="display: flex; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                                    <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 180px; font-size: 13px;">Allotment date:</span>
                                    <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${escapeHtml(allottedAt)}</span>
                                </div>
                                <div style="display: flex; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                                    <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 180px; font-size: 13px;">Students assigned:</span>
                                    <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${totalAssigned}</span>
                                </div>
                                <div style="display: flex; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                                    <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 180px; font-size: 13px;">Faculty guides:</span>
                                    <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${groups.length}</span>
                                </div>
                                <div style="display: flex; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                                    <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 180px; font-size: 13px;">Load per faculty:</span>
                                    <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${minLoad}–${maxLoad} students (equal distribution)</span>
                                </div>
                            </div>
                        </div>

                        <div style="margin-bottom: 20px;">
                            <h3 style="font-family: 'Montserrat', sans-serif; font-size: 20px; font-weight: 700; margin: 0 0 20px 0; color: #1f2937; border-left: 4px solid #6366f1; padding-left: 12px; letter-spacing: 0.5px;">Faculty-wise Guide Allotment</h3>
                            ${facultySections}
                        </div>

                        <div style="margin-bottom: 30px; padding: 24px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-before: auto;">
                            <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 16px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">Complete Student Allotment List</h3>
                            <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                                <thead>
                                    <tr>
                                        <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: center; border-bottom: 2px solid #e5e7eb; width: 6%;">Sl. No.</th>
                                        <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student Name</th>
                                        <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 14%;">KTU ID</th>
                                        <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Faculty Guide</th>
                                        <th style="padding: 10px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 22%;">Guide Email</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${masterRows.map(({ s, g }, idx) => `
                                        <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                                            <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.name)}</td>
                                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; font-weight: 500; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.ktuid)}</td>
                                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(g.guideName)}</td>
                                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(g.guideEmail || '—')}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>

                        <div style="margin-top: 20px; text-align: right; font-size: 11px; color: #6b7280; padding-top: 12px; border-top: 1px solid #e5e7eb; font-family: 'Lato', sans-serif; font-weight: 500;">
                            Generated on: ${escapeHtml(generatedOn)}
                        </div>
                    </div>
                </body>
                </html>
            `;
        },

        async generateSeminarGuideAllotmentReport() {
            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents();
            const guides = await this.fetchGuides();
            const assignments = settings.guideAssignments || {};
            if (!Object.keys(assignments).length) {
                alert('No guide allotments found. Run guide allotment first.');
                return;
            }

            const groups = buildSeminarGuideAllotmentGroups(students, guides, assignments);
            const reportContent = this.buildSeminarGuideAllotmentReportHtml(groups, settings);

            try {
                await app.generatePDFReport(
                    reportContent,
                    { groupName: 'Seminar' },
                    { name: 'Guide Allotment Report' }
                );
            } catch (error) {
                console.error(error);
                alert('Error generating PDF report. Please allow popups and try again.');
            }
        },

        async generateSeminarFacultyGuideReport() {
            await this.generateSeminarGuideAllotmentReport();
        },

        async randomAllotSeminarPresentations() {
            // Legacy entry point — schedule is generated under Schedule & Presentation
            await this.generateSeminarPresentationSchedule();
        },

        async generateSeminarPresentationSchedule() {
            const capacityInput = document.getElementById('seminar-students-per-slot');
            const capacity = parseInt(capacityInput?.value, 10);
            if (!capacity || capacity < 1) {
                alert('Enter a valid number of students per slot (at least 1).');
                return;
            }

            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents();
            if (!students.length) { alert('No students found.'); return; }

            const existingSlots = settings.presentationSlots || [];
            const presentationAssignments = { ...(settings.presentationAssignments || {}) };
            const assignedIds = new Set(Object.keys(presentationAssignments));
            const unassigned = students.filter(s => !assignedIds.has(s.id));

            if (!unassigned.length) {
                alert('All students already have a presentation slot.');
                return;
            }

            const takeCount = Math.min(capacity, unassigned.length);
            const nextLabel = `Slot ${existingSlots.length + 1}`;
            if (!confirm(
                `Generate ${nextLabel} with ${takeCount} student${takeCount === 1 ? '' : 's'} ` +
                `(${unassigned.length} still unassigned)?\n\nExisting slots are kept.`
            )) return;

            const { slot, assignedStudents } = appendPresentationSlot(
                unassigned,
                capacity,
                existingSlots
            );
            if (!slot || !assignedStudents.length) {
                alert('Could not create a slot.');
                return;
            }

            const presentations = [...(settings.presentations || [])];
            let index = presentations.length;
            const now = Date.now();

            for (const student of assignedStudents) {
                presentationAssignments[student.id] = slot.id;
                presentations.push({
                    id: `pres_${student.id}_${now}_${index}`,
                    studentId: student.id,
                    slotId: slot.id,
                    status: 'scheduled',
                    questionerIds: [],
                    questionerScores: {},
                    presenterScores: {},
                    presentationIndex: index
                });
                index += 1;

                const ref = doc(window.firebaseDb, 'userData', student.id);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                if (!data.seminar) data.seminar = getDefaultSeminar();
                data.seminar.presentationSlotId = slot.id;
                await setDoc(ref, { seminar: data.seminar }, { merge: true });
            }

            await this.saveSeminarSettings({
                presentationSlots: [...existingSlots, slot],
                presentationAssignments,
                presentations,
                presentationAllottedAt: new Date().toISOString(),
                presentationSlotCapacity: capacity
            });

            const remaining = unassigned.length - assignedStudents.length;
            alert(
                `${slot.label} created with ${assignedStudents.length} student(s).` +
                (remaining ? ` ${remaining} student(s) still unassigned.` : ' All students are now assigned.')
            );
            await this.loadSeminarAdmin();
        },

        async renderPresentationScheduleSummary(settings) {
            const el = document.getElementById('seminar-presentation-schedule-summary');
            if (!el) return;

            const capacityInput = document.getElementById('seminar-students-per-slot');
            if (capacityInput && settings.presentationSlotCapacity) {
                capacityInput.value = settings.presentationSlotCapacity;
            }

            const slots = settings.presentationSlots || [];
            const assignments = settings.presentationAssignments || {};
            const students = await this.fetchSeminarStudents();
            const assignedCount = Object.keys(assignments).length;
            const unassignedCount = Math.max(0, students.length - assignedCount);

            if (!slots.length) {
                el.innerHTML = `
                    <p class="form-hint">No presentation slots yet.
                    ${students.length ? `${students.length} student(s) available to assign.` : ''}</p>
                `;
                this.renderSeminarEvalShortcuts(settings, students);
                return;
            }

            const groups = buildPresentationSlotGroups(students, slots, assignments);

            el.innerHTML = `
                <div class="seminar-guide-summary" style="margin-bottom: 0.75rem;">
                    <div class="seminar-guide-stat">
                        <strong>${slots.length}</strong>
                        <span>Slots</span>
                    </div>
                    <div class="seminar-guide-stat">
                        <strong>${assignedCount}</strong>
                        <span>Students assigned</span>
                    </div>
                    <div class="seminar-guide-stat">
                        <strong>${unassignedCount}</strong>
                        <span>Still unassigned</span>
                    </div>
                </div>
                <div class="seminar-topics-list">
                    ${groups.map(g => `
                        <div class="seminar-paper-card">
                            <div class="seminar-topic-card-header">
                                <strong>${escapeHtml(g.slotLabel)}</strong>
                                <span class="badge">${g.students.length} student${g.students.length === 1 ? '' : 's'}</span>
                            </div>
                            ${g.students.length
                                ? `<p class="form-hint" style="margin:0.35rem 0 0;">${g.students.map(s => escapeHtml(s.name)).join(', ')}</p>`
                                : '<p class="form-hint" style="margin:0.35rem 0 0;">No students assigned</p>'}
                        </div>
                    `).join('')}
                </div>
            `;
            this.renderSeminarEvalShortcuts(settings, students);
        },

        renderSeminarEvalShortcuts(settings, students) {
            const el = document.getElementById('seminar-presentation-eval-summary');
            if (!el) return;
            const maxP = settings.questionSettings?.maxParticipationMarks ?? 10;
            const fairness = settings.questionFairness || {};
            const neverAsked = students.filter(s => !(fairness[s.id]?.times)).length;
            const list = students.slice(0, 40).map(s => {
                const t = s.seminar?.totals || {};
                const grand = computeSeminarGrandTotal(t, maxP);
                const times = fairness[s.id]?.times || 0;
                return `
                    <div class="seminar-eval-shortcut-row">
                        <span>${escapeHtml(s.name)} <small>(Q×${times})</small></span>
                        <span><strong>${grand}</strong>/100</span>
                        <button type="button" class="btn btn-sm btn-primary" onclick="app.openSeminarEvaluation('${escapeHtml(s.id)}')">Evaluate</button>
                    </div>`;
            }).join('');
            el.innerHTML = `
                <p class="form-hint">${neverAsked} student(s) have never been called for audience Q (fairness prefers them).</p>
                <div class="seminar-eval-shortcut-list">${list || '<p class="form-hint">No students.</p>'}</div>
            `;
        },

        buildSeminarPresentationSlotReportHtml(groups, capacity) {
            const totalStudents = groups.reduce((n, g) => n + g.students.length, 0);
            const sections = groups.map(g => {
                const rows = g.students.length
                    ? g.students.map((s, idx) => `
                        <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                            <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.name)}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.ktuid || '—')}</td>
                        </tr>
                    `).join('')
                    : `<tr><td colspan="3" style="padding: 12px; text-align: center; color: #6b7280; font-size: 12px;">No students in this slot</td></tr>`;

                return `
                    <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-inside: avoid;">
                        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 16px; font-weight: 700; margin: 0 0 6px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">
                            ${escapeHtml(g.slotLabel)}
                            <span style="font-weight: 500; color: #6b7280; font-size: 13px;"> · ${g.students.length} student${g.students.length === 1 ? '' : 's'}</span>
                        </h3>
                        <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 10px;">
                            <thead>
                                <tr>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb; width: 8%;">#</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 28%;">KTU ID</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            }).join('');

            const summary = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; gap: 8px;">
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 200px; font-size: 13px;">Slots:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${groups.length}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 200px; font-size: 13px;">Students assigned:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${totalStudents}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 200px; font-size: 13px;">Students per slot (capacity):</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${capacity || '—'}</span>
                        </div>
                    </div>
                </div>
            `;

            return this.seminarReportShell('Presentation Slot Schedule Report', summary + sections);
        },

        async generateSeminarPresentationSlotReport() {
            try {
                const settings = await this.getSeminarSettings();
                const slots = settings.presentationSlots || [];
                if (!slots.length) {
                    alert('Generate a presentation schedule first.');
                    return;
                }
                const students = await this.fetchSeminarStudents();
                const groups = buildPresentationSlotGroups(students, slots, settings.presentationAssignments || {});
                const html = this.buildSeminarPresentationSlotReportHtml(
                    groups,
                    settings.presentationSlotCapacity
                );
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Presentation Slot Schedule Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating slot report. Please allow popups and try again.');
            }
        },

        async renderSeminarAdminOverview(settings) {
            const el = document.getElementById('seminar-admin-overview');
            if (!el) return;
            const students = await this.fetchSeminarStudents();
            const guides = await this.fetchGuides();
            const assignedGuides = Object.keys(settings.guideAssignments || {}).length;
            const assignedPres = Object.keys(settings.presentationAssignments || {}).length;

            el.innerHTML = `
                <div class="admin-card" style="margin-bottom: 1rem;">
                    <h3><i class="fas fa-toggle-on"></i> Module status</h3>
                    <p class="form-hint">When disabled, students see a message instead of seminar content.</p>
                    <button type="button" class="btn ${settings.enabled !== false ? 'btn-secondary' : 'btn-primary'}" onclick="app.toggleSeminarEnabled()">
                        <i class="fas fa-power-off"></i> ${settings.enabled !== false ? 'Disable seminar module' : 'Enable seminar module'}
                    </button>
                    <span class="badge" style="margin-left: 0.75rem;">${settings.enabled !== false ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div class="summary-grid">
                    <div class="summary-card"><div class="summary-value">${students.length}</div><div class="summary-label">Students</div></div>
                    <div class="summary-card"><div class="summary-value">${guides.length}</div><div class="summary-label">Guides</div></div>
                    <div class="summary-card"><div class="summary-value">${assignedGuides}</div><div class="summary-label">Guide assignments</div></div>
                    <div class="summary-card"><div class="summary-value">${assignedPres}</div><div class="summary-label">Presentation slots</div></div>
                </div>
            `;
        },

        async renderSeminarStudents(settings) {
            const el = document.getElementById('seminar-admin-students-list');
            if (!el) return;
            const students = await this.fetchSeminarStudents();
            const guides = await this.fetchGuides();
            const guideMap = Object.fromEntries(guides.map(g => [g.id, g.name || g.email]));
            const slotMap = Object.fromEntries((settings.presentationSlots || []).map(s => [s.id, s]));

            if (!students.length) {
                el.innerHTML = '<p class="empty-state">No students found.</p>';
                return;
            }

            el.innerHTML = students.map(s => {
                const sem = s.seminar;
                ensureSeminarTopics(sem);
                ensureSeminarEvaluation(sem);
                const gid = sem.guideId || settings.guideAssignments[s.id];
                const slotId = sem.presentationSlotId || settings.presentationAssignments[s.id];
                const slot = slotMap[slotId];
                const pres = (settings.presentations || []).find(p => p.studentId === s.id);
                const t = sem.totals || {};
                const maxP = settings.questionSettings?.maxParticipationMarks ?? 10;
                const grand = computeSeminarGrandTotal(t, maxP);
                const locked = getLockedTopic(sem);
                const displayTopic = getSeminarDisplayTopic(sem);
                const topicCount = (sem.topics || []).length;
                const approvedCount = (sem.topics || []).filter(tpc => tpc.status === 'approved').length;
                const topicLabel = locked
                    ? locked.title
                    : (displayTopic?.title || '—');
                const topicStatus = locked
                    ? 'Locked (final)'
                    : (topicCount ? `${topicCount} submitted, ${approvedCount} approved` : 'No topics');
                const absentBadge = sem.evaluation?.isAbsent
                    ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">Absent</span>'
                    : '';

                return `
                    <div class="forge-lab-admin-student-card" data-name="${escapeHtml(s.name.toLowerCase())}" data-ktuid="${escapeHtml(s.ktuid.toLowerCase())}">
                        <h4>${escapeHtml(s.name)} <small>(${escapeHtml(s.ktuid)})</small> ${absentBadge}</h4>
                        <p><strong>Guide:</strong> ${gid ? escapeHtml(guideMap[gid] || gid) : '—'}</p>
                        <p><strong>Topic:</strong> ${escapeHtml(topicLabel)} <span class="badge">${escapeHtml(topicStatus)}</span></p>
                        <p><strong>Papers:</strong> ${(sem.papers || []).length} · <strong>Presentation:</strong> ${slot ? escapeHtml(formatPresentationSlot(slot)) : '—'}</p>
                        <p class="seminar-score-breakdown">
                            <strong>CIE:</strong>
                            Guide ${t.guideMarks || 0} · Coord ${t.coordinatorMarks || 0} ·
                            Pres ${t.presentationMarks || 0} · Report ${t.reportMarks || 0} ·
                            Participation ${Math.min(t.questionMarks || 0, maxP)}
                            = <strong>${grand}/100</strong>
                        </p>
                        <button type="button" class="btn btn-sm btn-primary" onclick="app.openSeminarEvaluation('${escapeHtml(s.id)}')">
                            <i class="fas fa-clipboard-check"></i> ${pres?.status === 'completed' || grand > 0 ? 'View / edit marks' : 'Evaluate'}
                        </button>
                    </div>`;
            }).join('');
        },

        renderSeminarEvalComponentFields(categoryKey, params, existingScores, actor, studentGuideId, disabled) {
            const canMark = canMarkSeminarCategory(categoryKey, actor, studentGuideId);
            const locked = disabled || !canMark;
            return (params || []).map(p => {
                const max = parseFloat(p.maxMarks) || 0;
                let val = existingScores?.[p.id];
                if (val !== undefined && val !== null && val !== '' && parseFloat(val) > max) {
                    val = max;
                }
                return `
                <div class="form-group">
                    <label>${escapeHtml(p.label)} (max ${max})</label>
                    <input type="number" class="form-input seminar-comp-score seminar-mark-input" data-category="${categoryKey}" data-param="${p.id}"
                        min="0" max="${max}" step="0.5"
                        value="${val ?? ''}" ${locked ? 'disabled' : ''}
                        oninput="app.clampSeminarMarkInput(this)">
                </div>`;
            }).join('');
        },

        clampSeminarMarkInput(inp) {
            if (!inp) return true;
            const min = inp.min !== '' ? parseFloat(inp.min) : 0;
            const max = inp.max !== '' ? parseFloat(inp.max) : Infinity;
            if (inp.value === '' || inp.value == null) {
                inp.classList.remove('seminar-mark-invalid');
                return true;
            }
            let v = parseFloat(inp.value);
            if (isNaN(v)) {
                inp.value = '';
                inp.classList.remove('seminar-mark-invalid');
                return true;
            }
            if (v < min) v = min;
            if (v > max) v = max;
            const stepped = Math.round(v * 2) / 2;
            if (parseFloat(inp.value) !== stepped) {
                inp.value = stepped;
            }
            inp.classList.remove('seminar-mark-invalid');
            return true;
        },

        validateSeminarEvalMarks() {
            const inputs = document.querySelectorAll('#seminar-eval-body .seminar-mark-input, #seminar-eval-body .seminar-q-score');
            const errors = [];
            inputs.forEach(inp => {
                if (inp.disabled) return;
                if (inp.value === '' || inp.value == null) {
                    inp.classList.remove('seminar-mark-invalid');
                    return;
                }
                const v = parseFloat(inp.value);
                const min = inp.min !== '' ? parseFloat(inp.min) : 0;
                const max = inp.max !== '' ? parseFloat(inp.max) : Infinity;
                if (isNaN(v) || v < min || v > max) {
                    inp.classList.add('seminar-mark-invalid');
                    const label = inp.closest('.form-group')?.querySelector('label')?.textContent
                        || inp.previousElementSibling?.textContent
                        || inp.dataset.param
                        || 'Mark';
                    errors.push(`${label.trim()}: must be between ${min} and ${max}`);
                    this.clampSeminarMarkInput(inp);
                } else {
                    inp.classList.remove('seminar-mark-invalid');
                }
            });
            return errors;
        },

        renderSeminarQuestionerBlock(qid, qsName, qParams, scores = {}, meta = {}, isNew = false) {
            const fields = (qParams || []).map(p => {
                const max = parseFloat(p.maxMarks) || 0;
                let val = scores?.[p.id];
                if (val !== undefined && val !== null && val !== '' && parseFloat(val) > max) val = max;
                return `
                    <label>${escapeHtml(p.label)} (max ${max})</label>
                    <input type="number" class="form-input seminar-q-score seminar-mark-input" data-qid="${qid}" data-param="${p.id}"
                        min="0" max="${max}" step="0.5" value="${val ?? ''}"
                        oninput="app.clampSeminarMarkInput(this)">
                `;
            }).join('');
            const absentQ = meta?.isAbsent ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">Absent</span>' : '';
            return `
                <div class="seminar-q-eval-block" data-qid="${qid}" data-new="${isNew ? '1' : '0'}">
                    <div class="seminar-q-eval-head">
                        <strong>${escapeHtml(qsName || qid)}</strong>
                        ${isNew ? '<span class="badge">New</span>' : ''}
                        ${absentQ}
                        <label class="seminar-inline-check"><input type="checkbox" class="seminar-q-absent" data-qid="${qid}" ${meta?.isAbsent ? 'checked' : ''}> Mark absent</label>
                        <button type="button" class="btn btn-sm btn-danger seminar-cancel-q-btn" title="Cancel this call"
                            onclick="app.cancelSeminarQuestionerCall('${escapeHtml(qid)}')">
                            <i class="fas fa-times"></i> Cancel call
                        </button>
                    </div>
                    ${fields}
                    ${meta?.markedBy ? `<p class="form-hint">Marked by ${escapeHtml(meta.markedBy.name || '')}${meta.isDummy ? ' (dummy)' : ''}</p>` : ''}
                </div>`;
        },

        cancelSeminarQuestionerCall(qid) {
            if (!qid) return;
            if (!confirm('Cancel this audience question call? Marks for this student on this presentation will be removed.')) return;

            const block = document.querySelector(`.seminar-q-eval-block[data-qid="${qid}"]`);
            const wasNew = block?.dataset.new === '1' || (app._seminarEvalPicked || []).includes(qid);

            if (block) block.remove();

            app._seminarEvalPicked = (app._seminarEvalPicked || []).filter(id => id !== qid);
            app._seminarEvalRemoved = [...new Set([...(app._seminarEvalRemoved || []), qid])];

            const container = document.getElementById('seminar-eval-questioners');
            if (container && !container.querySelector('.seminar-q-eval-block')) {
                container.innerHTML = '<p class="form-hint">No audience questioners called yet.</p>';
            }

            const pickBtn = document.getElementById('seminar-pick-q-btn');
            if (pickBtn) pickBtn.disabled = false;

            const banner = document.getElementById('seminar-picked-names');
            if (banner && wasNew) {
                // Refresh banner text from remaining new picks
                const remaining = app._seminarEvalPicked || [];
                if (!remaining.length) {
                    banner.style.display = 'none';
                    banner.innerHTML = '';
                }
            }
        },

        async openSeminarEvaluation(studentId) {
            if (!app.isAdmin && !app.isGuide) return;
            const actor = this.getSeminarActor();

            const modal = document.getElementById('seminar-eval-modal');
            const body = document.getElementById('seminar-eval-body');
            if (!modal || !body) return;

            // Open immediately so the click feels responsive
            modal.style.display = 'flex';
            body.innerHTML = `
                <div class="seminar-eval-loading" style="padding:2rem; text-align:center;">
                    <p><i class="fas fa-spinner fa-spin"></i> Loading evaluation…</p>
                </div>`;

            try {
                const [settings, student, guides, roster] = await Promise.all([
                    this.getSeminarSettingsCached(),
                    this.fetchOneSeminarStudent(studentId),
                    this.fetchGuides(),
                    this.ensureSeminarRoster()
                ]);

                if (!student) {
                    body.innerHTML = '<p class="form-hint">Student not found.</p>';
                    return;
                }

                ensureSeminarEvaluation(student.seminar);
                const evalObj = student.seminar.evaluation;
                let pres = (settings.presentations || []).find(p => p.studentId === studentId);

                // Auto-create a presentation record if missing so faculty can still mark CIE components
                if (!pres) {
                    const presentations = [...(settings.presentations || [])];
                    pres = {
                        id: `pres_${studentId}_${Date.now()}`,
                        studentId,
                        slotId: student.seminar.presentationSlotId || settings.presentationAssignments?.[studentId] || null,
                        status: 'scheduled',
                        questionerIds: [],
                        questionerScores: {},
                        questionerMeta: {},
                        presenterScores: {},
                        presentationIndex: presentations.length
                    };
                    presentations.push(pres);
                    await this.saveSeminarSettings({ presentations });
                    settings.presentations = presentations;
                    app._seminarSettingsCache = { settings, at: Date.now() };
                }

                const studentGuideId = resolveSeminarGuideId(student.seminar, settings, studentId);
                const assignedGuideName = studentGuideId
                    ? (guides.find(g => g.id === studentGuideId)?.name || guides.find(g => g.id === studentGuideId)?.email || studentGuideId)
                    : null;
                const sp = settings.scoringParams;
                const qPer = settings.questionSettings?.questionsPerPresentation || 2;
                const maxPart = settings.questionSettings?.maxParticipationMarks ?? 10;
                const already = pres.questionerIds || [];
                const need = Math.max(0, qPer - already.length);
                const otherStudentIds = Object.keys(roster).filter(id => id !== studentId);

                const markedByLine = (comp) => {
                    if (!comp?.markedBy) return '';
                    const m = comp.markedBy;
                    return `<p class="form-hint seminar-marked-by">Last marked by <strong>${escapeHtml(m.name || m.uid)}</strong> (${escapeHtml(m.role || '')})${m.isDummy || comp.isDummy ? ' · <em>dummy</em>' : ''} · ${m.at ? new Date(m.at).toLocaleString() : (comp.markedAt ? new Date(comp.markedAt).toLocaleString() : '')}</p>`;
                };

                const catBlock = (key, title, hint) => {
                    if (!canMarkSeminarCategory(key, actor, studentGuideId)) return '';
                    const cat = SEMINAR_SCORING_CATEGORIES.find(c => c.key === key);
                    const comp = evalObj.components?.[key];
                    let scores = comp?.scores;
                    if (key === 'presentation' && !scores && pres.presenterScores) scores = pres.presenterScores;
                    const extraEntries = [];
                    if (key === 'presentation' && pres?.presenterEvaluatorScores) {
                        extraEntries.push(...Object.values(pres.presenterEvaluatorScores));
                    }
                    const allEvaluators = this.collectSeminarComponentEvaluators(
                        comp, evalObj.markHistory || [], key, sp[key], extraEntries
                    );
                    const evaluatorLines = allEvaluators.length
                        ? `<div class="seminar-eval-all-markers">${allEvaluators.map(ev => {
                            const adminCls = ev.markedBy?.role === 'admin' ? ' seminar-cons-marker-admin' : '';
                            return `<div class="seminar-cons-marker${adminCls}">${escapeHtml(ev.label)}: <strong>${escapeHtml(String(ev.marks))}</strong></div>`;
                        }).join('')}</div>`
                        : markedByLine(comp);
                    return `
                        <div class="seminar-eval-category">
                            <h5>${escapeHtml(title)} <small>(max ${categoryParamTotal(sp[key])})</small></h5>
                            <p class="form-hint">${escapeHtml(hint || cat?.whoMarks || '')}</p>
                            ${this.renderSeminarEvalComponentFields(key, sp[key], scores, actor, studentGuideId, evalObj.isAbsent)}
                            ${evaluatorLines}
                        </div>
                    `;
                };

                const editableBlocks = [
                    catBlock('guide', 'Seminar Guide (20)', assignedGuideName
                        ? `Assigned guide: ${assignedGuideName}`
                        : 'Assigned seminar guide marks'),
                    catBlock('coordinator', 'Seminar Coordinator (20)', 'Diary & attendance'),
                    catBlock('presentation', 'Presentation — IEC (30)', 'Clarity, interactions, slides'),
                    catBlock('report', 'Report — IEC (20)', 'Technical report quality')
                ].filter(Boolean).join('');

                const canMarkAudience = canMarkSeminarCategory('questioner', actor, studentGuideId);
                const t = student.seminar.totals || {};
                const otherSummary = `
                    <p class="form-hint seminar-eval-other-summary">
                        Current CIE (all components): Guide ${t.guideMarks || 0} · Coord ${t.coordinatorMarks || 0} ·
                        Pres ${t.presentationMarks || 0} · Report ${t.reportMarks || 0} ·
                        Participation ${Math.min(t.questionMarks || 0, maxPart)} ·
                        <strong>Total ${computeSeminarGrandTotal(t, maxPart)}/100</strong>
                    </p>
                `;

                const questionerBlocks = already.map(qid => {
                    const qs = roster[qid];
                    return this.renderSeminarQuestionerBlock(
                        qid,
                        qs?.name || qid,
                        sp.questioner || [],
                        pres.questionerScores?.[qid] || {},
                        pres.questionerMeta?.[qid] || {},
                        false
                    );
                }).join('');

                const neverAsked = otherStudentIds.filter(id => !(settings.questionFairness?.[id]?.times)).length;
                const otherStudents = otherStudentIds.length;

                body.innerHTML = `
                    <input type="hidden" id="seminar-eval-student-id" value="${escapeHtml(studentId)}">
                    <input type="hidden" id="seminar-eval-pres-id" value="${escapeHtml(pres.id)}">
                    <div class="seminar-eval-header">
                        <div>
                            <h3 style="margin:0;">Evaluate: ${escapeHtml(student.name)}</h3>
                            <p class="form-hint" style="margin:0.25rem 0 0;">${escapeHtml(student.ktuid)} · Topic: ${escapeHtml(getSeminarDisplayTopic(student.seminar)?.title || '—')}</p>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="app.closeSeminarEvalModal()"><i class="fas fa-times"></i></button>
                    </div>

                    <div class="seminar-eval-flags">
                        <label class="seminar-inline-check">
                            <input type="checkbox" id="seminar-eval-absent" ${evalObj.isAbsent ? 'checked' : ''}>
                            Mark presenter <strong>Absent</strong> (zeros presentation session; other CIE components still editable)
                        </label>
                        <label class="seminar-inline-check">
                            <input type="checkbox" id="seminar-eval-dummy">
                            Save as <strong>dummy / test</strong> marks
                        </label>
                        <p class="form-hint" style="margin:0.25rem 0 0;">
                            Leave this unchecked for official CIE. If marks already show <em>[dummy]</em>, uncheck this and Save — or use <strong>Convert dummy to official</strong> on Consolidated marks.
                        </p>
                    </div>
                    <div class="form-group" id="seminar-absent-reason-wrap" style="${evalObj.isAbsent ? '' : 'display:none;'}">
                        <label>Absent reason (optional)</label>
                        <input type="text" id="seminar-eval-absent-reason" class="form-input" value="${escapeHtml(evalObj.absentReason || '')}">
                    </div>

                    ${otherSummary}

                    <div class="seminar-eval-grid">
                        ${editableBlocks || '<p class="form-hint">No CIE components available for your role on this student.</p>'}
                    </div>

                    ${canMarkAudience ? `
                    <div class="seminar-eval-audience">
                        <h5><i class="fas fa-random"></i> Audience questions (Overall participation, cap ${maxPart})</h5>
                        <p class="form-hint">Syllabus: Overall participation is based on involvement during other students' presentations. Fair pick prefers students never asked yet — <strong>${neverAsked} of ${otherStudents}</strong> other students still at 0 (excludes the presenter).</p>
                        <div id="seminar-eval-questioners">${questionerBlocks || '<p class="form-hint">No audience questioners called yet.</p>'}</div>
                        <div class="seminar-eval-audience-actions">
                            <button type="button" class="btn btn-secondary" id="seminar-pick-q-btn" onclick="app.pickSeminarQuestioners()" ${need <= 0 ? 'disabled' : ''}>
                                <i class="fas fa-random"></i> Call random student${need > 1 ? `s (${need})` : ''}
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="app.pickSeminarQuestioners(1)" ${already.length >= otherStudents ? 'disabled' : ''}>
                                Call one more
                            </button>
                        </div>
                        <div id="seminar-picked-names" class="seminar-callout-banner" style="display:none;"></div>
                    </div>
                    ` : ''}

                    <div class="seminar-eval-footer">
                        <button type="button" class="btn btn-primary" onclick="app.saveSeminarEvaluation()">
                            <i class="fas fa-save"></i> Save marks
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="app.closeSeminarEvalModal()">Cancel</button>
                    </div>
                `;

                app._seminarEvalPicked = [];
                app._seminarEvalRemoved = [];
                const absentCb = document.getElementById('seminar-eval-absent');
                if (absentCb) {
                    absentCb.addEventListener('change', () => {
                        const wrap = document.getElementById('seminar-absent-reason-wrap');
                        if (wrap) wrap.style.display = absentCb.checked ? '' : 'none';
                    });
                }
            } catch (err) {
                console.error(err);
                body.innerHTML = `
                    <p class="form-hint">Failed to load evaluation. ${escapeHtml(err?.message || '')}</p>
                    <button type="button" class="btn btn-secondary" onclick="app.closeSeminarEvalModal()">Close</button>`;
            }
        },

        async pickSeminarQuestioners(forceCount) {
            if (forceCount && typeof forceCount === 'object') forceCount = undefined;

            const studentId = document.getElementById('seminar-eval-student-id')?.value;
            const presId = document.getElementById('seminar-eval-pres-id')?.value;
            const [settings, roster] = await Promise.all([
                this.getSeminarSettingsCached(),
                this.ensureSeminarRoster()
            ]);
            const pres = settings.presentations.find(p => p.id === presId);
            const allIds = Object.keys(roster).filter(id => id !== studentId);
            const removed = new Set(app._seminarEvalRemoved || []);
            const already = [
                ...(pres?.questionerIds || []).filter(id => !removed.has(id)),
                ...(app._seminarEvalPicked || [])
            ];
            const qPer = settings.questionSettings?.questionsPerPresentation || 2;
            const need = forceCount != null
                ? Math.min(Number(forceCount) || 1, Math.max(0, allIds.length - already.length))
                : Math.max(0, qPer - already.length);
            if (need <= 0) {
                alert('No more questioner slots for this presentation (or everyone already called).');
                return;
            }
            const eligible = allIds.filter(id => !already.includes(id));
            const picked = pickFairQuestioners(eligible, settings.questionFairness, pres?.presentationIndex ?? 0, need);
            app._seminarEvalPicked = [...(app._seminarEvalPicked || []), ...picked];
            app._seminarEvalRemoved = (app._seminarEvalRemoved || []).filter(id => !picked.includes(id));

            const names = picked.map(id => {
                const s = roster[id];
                const times = settings.questionFairness?.[id]?.times || 0;
                return `${s?.name || id} (${times === 0 ? 'first chance' : `${times} prior`})`;
            });
            const el = document.getElementById('seminar-picked-names');
            if (el) {
                el.style.display = 'block';
                el.innerHTML = `<strong>Call on now:</strong> ${escapeHtml(names.join(', '))}`;
            }

            const container = document.getElementById('seminar-eval-questioners');
            const qParams = settings.scoringParams.questioner || [];
            if (container) {
                const empty = container.querySelector('.form-hint');
                if (empty && !container.querySelector('.seminar-q-eval-block')) empty.remove();
                picked.forEach(qid => {
                    if (container.querySelector(`.seminar-q-eval-block[data-qid="${qid}"]`)) return;
                    const qs = roster[qid];
                    container.insertAdjacentHTML('beforeend',
                        this.renderSeminarQuestionerBlock(qid, qs?.name || qid, qParams, {}, {}, true)
                    );
                });
            }

            const stillNeed = qPer - already.length - picked.length;
            const pickBtn = document.getElementById('seminar-pick-q-btn');
            if (pickBtn && stillNeed <= 0 && forceCount == null) pickBtn.disabled = true;
        },

        closeSeminarEvalModal() {
            const modal = document.getElementById('seminar-eval-modal');
            if (modal) modal.style.display = 'none';
            app._seminarEvalPicked = [];
            app._seminarEvalRemoved = [];
        },

        async saveSeminarEvaluation() {
            const actor = this.getSeminarActor();
            if (!actor) { alert('Not authorized.'); return; }

            document.querySelectorAll('#seminar-eval-body .seminar-mark-input, #seminar-eval-body .seminar-q-score')
                .forEach(inp => this.clampSeminarMarkInput(inp));
            const validationErrors = this.validateSeminarEvalMarks();
            if (validationErrors.length) {
                alert('Fix invalid marks (must be within min/max):\n\n' + validationErrors.slice(0, 8).join('\n'));
                return;
            }

            const studentId = document.getElementById('seminar-eval-student-id')?.value;
            const presId = document.getElementById('seminar-eval-pres-id')?.value;
            const isDummy = Boolean(document.getElementById('seminar-eval-dummy')?.checked);
            const isAbsent = Boolean(document.getElementById('seminar-eval-absent')?.checked);
            const absentReason = document.getElementById('seminar-eval-absent-reason')?.value.trim() || '';

            const settings = await this.getSeminarSettingsCached({ force: true });
            const presIdx = settings.presentations.findIndex(p => p.id === presId);
            if (presIdx < 0) return;

            const student = await this.fetchOneSeminarStudent(studentId);
            const studentGuideId = resolveSeminarGuideId(student?.seminar, settings, studentId);
            const sp = settings.scoringParams;
            const maxPart = settings.questionSettings?.maxParticipationMarks ?? 10;
            const meta = buildEvaluatorMeta(actor, isDummy);

            const presenterRef = doc(window.firebaseDb, 'userData', studentId);
            const presenterSnap = await getDoc(presenterRef);
            const presenterData = presenterSnap.exists() ? presenterSnap.data() : {};
            if (!presenterData.seminar) presenterData.seminar = getDefaultSeminar();
            ensureSeminarEvaluation(presenterData.seminar);
            const evalObj = presenterData.seminar.evaluation;

            if (isAbsent) {
                evalObj.isAbsent = true;
                evalObj.absentReason = absentReason;
                evalObj.absentMarkedBy = meta;
                evalObj.absentAt = meta.at;
            } else if (evalObj.isAbsent) {
                evalObj.isAbsent = false;
                evalObj.absentReason = '';
                evalObj.absentMarkedBy = null;
                evalObj.absentAt = null;
            }

            const categories = ['guide', 'coordinator', 'presentation', 'report'];
            for (const cat of categories) {
                if (!canMarkSeminarCategory(cat, actor, studentGuideId)) continue;
                const inputs = document.querySelectorAll(`.seminar-comp-score[data-category="${cat}"]:not([disabled])`);
                if (!inputs.length) continue;
                const scores = {};
                let any = false;
                inputs.forEach(inp => {
                    if (inp.value === '' || inp.value == null) return;
                    scores[inp.dataset.param] = parseFloat(inp.value) || 0;
                    any = true;
                });
                if (!any && !evalObj.components[cat]) continue;
                if (!any) continue;

                const prevComp = evalObj.components[cat] || {};
                const evaluatorId = this.seminarEvaluatorKey(meta);
                evalObj.components[cat] = {
                    scores,
                    markedBy: meta,
                    markedAt: meta.at,
                    isDummy,
                    evaluators: {
                        ...(prevComp.evaluators || {}),
                        [evaluatorId]: {
                            scores: { ...scores },
                            markedBy: meta,
                            markedAt: meta.at,
                            isDummy
                        }
                    }
                };
                evalObj.markHistory = evalObj.markHistory || [];
                evalObj.markHistory.push({
                    component: cat,
                    scores: { ...scores },
                    markedBy: meta,
                    markedAt: meta.at,
                    isDummy,
                    action: 'save'
                });
            }

            const totals = presenterData.seminar.totals || {};
            totals.guideMarks = sumParamScores(evalObj.components.guide?.scores, sp.guide);
            totals.coordinatorMarks = sumParamScores(evalObj.components.coordinator?.scores, sp.coordinator);
            totals.presentationMarks = sumParamScores(evalObj.components.presentation?.scores, sp.presentation);
            totals.reportMarks = sumParamScores(evalObj.components.report?.scores, sp.report);

            const pres = { ...settings.presentations[presIdx] };
            pres.presenterScores = { ...(evalObj.components.presentation?.scores || {}) };
            if (!pres.presenterEvaluatorScores) pres.presenterEvaluatorScores = {};
            if (evalObj.components.presentation?.scores) {
                const evaluatorId = this.seminarEvaluatorKey(meta);
                pres.presenterEvaluatorScores = {
                    ...pres.presenterEvaluatorScores,
                    [evaluatorId]: {
                        scores: { ...evalObj.components.presentation.scores },
                        markedBy: meta,
                        markedAt: meta.at,
                        isDummy
                    }
                };
            }
            if (isDummy) {
                pres.presenterScores._isDummy = true;
                pres.evaluationMeta = meta;
            }
            if (!pres.questionerScores) pres.questionerScores = {};
            if (!pres.questionerMeta) pres.questionerMeta = {};

            const removed = [...new Set(app._seminarEvalRemoved || [])];
            const newPickers = (app._seminarEvalPicked || []).filter(id => !removed.includes(id));
            pres.questionerIds = [...new Set([...(pres.questionerIds || []), ...newPickers])]
                .filter(id => !removed.includes(id));

            for (const qid of removed) {
                delete pres.questionerScores[qid];
                delete pres.questionerMeta[qid];
            }

            const clampScore = (raw, paramId, params) => {
                const p = (params || []).find(x => x.id === paramId);
                const max = parseFloat(p?.maxMarks);
                let v = parseFloat(raw);
                if (isNaN(v)) return 0;
                if (!isNaN(max) && v > max) v = max;
                if (v < 0) v = 0;
                return v;
            };

            for (const cat of ['guide', 'coordinator', 'presentation', 'report']) {
                const comp = evalObj.components[cat];
                if (!comp?.scores) continue;
                Object.keys(comp.scores).forEach(pid => {
                    comp.scores[pid] = clampScore(comp.scores[pid], pid, sp[cat]);
                });
                const eid = this.seminarEvaluatorKey(meta);
                if (comp.evaluators?.[eid]) {
                    comp.evaluators[eid].scores = { ...comp.scores };
                }
            }
            totals.guideMarks = sumParamScores(evalObj.components.guide?.scores, sp.guide);
            totals.coordinatorMarks = sumParamScores(evalObj.components.coordinator?.scores, sp.coordinator);
            totals.presentationMarks = sumParamScores(evalObj.components.presentation?.scores, sp.presentation);
            totals.reportMarks = sumParamScores(evalObj.components.report?.scores, sp.report);
            if (evalObj.components.presentation?.scores) {
                pres.presenterScores = { ...evalObj.components.presentation.scores };
                const evaluatorId = this.seminarEvaluatorKey(meta);
                if (pres.presenterEvaluatorScores?.[evaluatorId]) {
                    pres.presenterEvaluatorScores[evaluatorId].scores = { ...evalObj.components.presentation.scores };
                }
                if (isDummy) {
                    pres.presenterScores._isDummy = true;
                    pres.evaluationMeta = meta;
                }
            }

            document.querySelectorAll('.seminar-q-score').forEach(inp => {
                const qid = inp.dataset.qid;
                if (removed.includes(qid)) return;
                if (!pres.questionerScores[qid]) {
                    pres.questionerScores[qid] = {};
                }
                if (inp.value !== '') {
                    pres.questionerScores[qid][inp.dataset.param] = clampScore(inp.value, inp.dataset.param, sp.questioner);
                }
            });

            document.querySelectorAll('.seminar-q-absent').forEach(cb => {
                const qid = cb.dataset.qid;
                if (removed.includes(qid)) return;
                const prev = pres.questionerMeta[qid] || {};
                pres.questionerMeta[qid] = {
                    ...prev,
                    isAbsent: cb.checked,
                    markedBy: meta,
                    isDummy: prev.isDummy || isDummy,
                    at: meta.at
                };
                if (cb.checked) {
                    const qParams = sp.questioner || [];
                    if (!pres.questionerScores[qid]) {
                       pres.questionerScores[qid] = {};
                    }
                    qParams.forEach(p => {
                      pres.questionerScores[qid][p.id] = 0;
                    });
                }
            });

            for (const qid of newPickers) {
                if (!pres.questionerScores[qid]) {
                  pres.questionerScores[qid] = {};
                }
                if (!pres.questionerMeta[qid]) {
                  pres.questionerMeta[qid] = { markedBy: meta, isDummy, at: meta.at };
                } else {
                  pres.questionerMeta[qid] = {
                        ...pres.questionerMeta[qid],
                        markedBy: meta,
                        isDummy: pres.questionerMeta[qid].isDummy || isDummy,
                        at: meta.at
                    };
                }
                if (isDummy) {
                  pres.questionerScores[qid]._isDummy = true;
                }
            }

            for (const qid of Object.keys(pres.questionerScores)) {
                if (removed.includes(qid)) continue;
                if (!pres.questionerMeta[qid]) {
                  pres.questionerMeta[qid] = { markedBy: meta, isDummy, at: meta.at };
                }
            }

            const qPerPres = settings.questionSettings?.questionsPerPresentation || 2;
            if (pres.questionerIds.length >= qPerPres || (evalObj.components.presentation && Object.keys(evalObj.components.presentation.scores || {}).length)) {
            pres.status = isAbsent ? 'absent' : 'completed';
            }
            pres.evaluatedAt = meta.at;

            const presentations = [...settings.presentations];
            presentations[presIdx] = pres;

            let fairness = { ...(settings.questionFairness || {}) };
            if (newPickers.length) {
                fairness = updateFairnessAfterPick(fairness, newPickers, pres.presentationIndex ?? presIdx);
            }
            for (const qid of removed) {
                if (!fairness[qid]) continue;
                const prevF = fairness[qid];
                const times = Math.max(0, (prevF.times || 1) - 1);
                if (times === 0) delete fairness[qid];
                else fairness[qid] = { ...prevF, times };
            }

            await this.saveSeminarSettings({ presentations, questionFairness: fairness });
            await this.recalculateSeminarQuestionTotals(settings, presentations);


            // Re-read question marks after recalc
            const refreshed = await getDoc(presenterRef);
            const refreshedData = refreshed.exists() ? refreshed.data() : presenterData;
            if (!refreshedData.seminar) refreshedData.seminar = presenterData.seminar;
            ensureSeminarEvaluation(refreshedData.seminar);
            refreshedData.seminar.evaluation = evalObj;
            refreshedData.seminar.totals = {
                ...refreshedData.seminar.totals,
                guideMarks: totals.guideMarks,
                coordinatorMarks: totals.coordinatorMarks,
                presentationMarks: totals.presentationMarks,
                reportMarks: totals.reportMarks
            };
            refreshedData.seminar.totals.grandTotal = computeSeminarGrandTotal(refreshedData.seminar.totals, maxPart);
            await setDoc(presenterRef, { seminar: refreshedData.seminar }, { merge: true });

            this.closeSeminarEvalModal();
            this.invalidateSeminarCaches();
            alert(isDummy ? 'Dummy evaluation saved (can be cleared from Scoring tab).' : 'Evaluation saved.');
            if (app.isAdmin) await this.loadSeminarAdmin();
            else if (typeof this.loadGuideSeminar === 'function') await this.loadGuideSeminar();
            else if (typeof app.loadGuideSeminar === 'function') await app.loadGuideSeminar();
        },

        async recalculateSeminarQuestionTotals(settings, presentations) {
            const students = await this.fetchSeminarStudents();
            const qParams = settings.scoringParams.questioner || [];
            const maxPart = settings.questionSettings?.maxParticipationMarks ?? 10;
            const evaluatedAt = new Date().toISOString();

            for (const s of students) {
                let total = 0;
                const history = [];
                for (const pres of presentations) {
                    const scores = pres.questionerScores?.[s.id];
                    if (!scores || !Object.keys(scores).length) continue;
                    const meta = pres.questionerMeta?.[s.id];
                    if (meta?.isAbsent) {
                        history.push({
                            presentationId: pres.id,
                            presenterId: pres.studentId,
                            marks: 0,
                            isAbsent: true,
                            at: pres.evaluatedAt || evaluatedAt
                        });
                        continue;
                    }
                    const clean = { ...scores };
                    delete clean._isDummy;
                    const marks = sumParamScores(clean, qParams);
                    total += marks;
                    history.push({
                        presentationId: pres.id,
                        presenterId: pres.studentId,
                        marks,
                        isDummy: Boolean(scores._isDummy || meta?.isDummy),
                        at: pres.evaluatedAt || evaluatedAt
                    });
                }
                total = Math.min(total, maxPart);
                const ref = doc(window.firebaseDb, 'userData', s.id);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                if (!data.seminar) data.seminar = getDefaultSeminar();
                ensureSeminarEvaluation(data.seminar);
                data.seminar.totals = data.seminar.totals || {};
                data.seminar.totals.questionMarks = total;
                data.seminar.totals.grandTotal = computeSeminarGrandTotal(data.seminar.totals, maxPart);
                data.seminar.questionHistory = history;
                await setDoc(ref, { seminar: data.seminar }, { merge: true });
            }
        },

        seminarEvaluatorRoleLabel(role) {
            if (role === 'admin') return 'Admin';
            if (role === 'guide') return 'Faculty';
            return role || '';
        },

        seminarEvaluatorKey(markedBy) {
            if (markedBy?.uid) return String(markedBy.uid);
            if (markedBy?.role === 'admin') return '_admin';
            const name = (markedBy?.name || '').replace(/[./#[\]*$]/g, '_').trim();
            return name ? `_n_${name}` : '_unknown';
        },

        formatSeminarEvaluatorLabel(markedBy, isDummy = false) {
            if (!markedBy) return '';
            const name = markedBy.name || markedBy.uid || 'Unknown';
            const role = this.seminarEvaluatorRoleLabel(markedBy.role);
            const dummy = (isDummy || markedBy.isDummy) ? ' [dummy]' : '';
            return role ? `${name} (${role})${dummy}` : `${name}${dummy}`;
        },

        seminarComponentHasScores(comp) {
            if (!comp?.scores || typeof comp.scores !== 'object') return false;
            return Object.keys(comp.scores).some(k => k !== '_isDummy' && comp.scores[k] !== '' && comp.scores[k] != null);
        },

        collectSeminarComponentEvaluators(comp, history = [], categoryKey, params = [], extraEntries = []) {
            const byKey = new Map();
            const add = (entry, fallbackId) => {
                if (!entry) return;
                const scores = { ...(entry.scores || {}) };
                delete scores._isDummy;
                const markedBy = entry.markedBy || null;
                if (!this.seminarComponentHasScores({ scores }) && !markedBy) return;
                if (!this.seminarComponentHasScores({ scores })) return;
                const id = this.seminarEvaluatorKey(markedBy) || fallbackId || '_unknown';
                const at = entry.markedAt || markedBy?.at || '';
                const prev = byKey.get(id);
                if (prev?.at && at && prev.at > at) return;
                byKey.set(id, {
                    id,
                    scores,
                    markedBy,
                    isDummy: Boolean(entry.isDummy || markedBy?.isDummy),
                    at,
                    label: this.formatSeminarEvaluatorLabel(markedBy, entry.isDummy) || 'Unknown',
                    marks: sumParamScores(scores, params),
                    role: this.seminarEvaluatorRoleLabel(markedBy?.role)
                });
            };

            (history || []).filter(h => h.component === categoryKey || (categoryKey === 'presentation' && h.component === 'presenter')).forEach(h => add(h));
            if (comp?.evaluators && typeof comp.evaluators === 'object') {
                Object.entries(comp.evaluators).forEach(([id, ev]) => add(ev, id));
            }
            add(comp);
            (extraEntries || []).forEach(ev => add(ev));

            return [...byKey.values()].sort((a, b) => {
                const rank = (e) => (e.markedBy?.role === 'admin' ? 0 : 1);
                if (rank(a) !== rank(b)) return rank(a) - rank(b);
                return (a.label || '').localeCompare(b.label || '');
            });
        },

        seminarCsvCell(value) {
            const s = value == null ? '' : String(value);
            if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        },

        getSeminarParticipationEvaluators(studentId, settings) {
            const seen = new Map();
            for (const pres of settings.presentations || []) {
                const scores = pres.questionerScores?.[studentId];
                const meta = pres.questionerMeta?.[studentId];
                if (!scores && !meta) continue;
                const markedBy = meta?.markedBy;
                const key = markedBy?.uid || markedBy?.name || 'unknown';
                if (!seen.has(key)) {
                    seen.set(key, this.formatSeminarEvaluatorLabel(markedBy, meta?.isDummy || scores?._isDummy));
                }
            }
            return [...seen.values()].filter(Boolean);
        },

        async collectSeminarConsolidatedData({ force = false } = {}) {
            if (force) this.invalidateSeminarCaches();
            const [settings, students, guides] = await Promise.all([
                this.getSeminarSettings(),
                this.fetchSeminarStudents({ force }),
                this.fetchGuides({ force })
            ]);
            const guideMap = Object.fromEntries(guides.map(g => [g.id, g.name || g.email || 'Guide']));
            const sp = settings.scoringParams || {};
            const maxP = settings.questionSettings?.maxParticipationMarks ?? 10;
            const maxes = {
                guide: categoryParamTotal(sp.guide),
                coordinator: categoryParamTotal(sp.coordinator),
                presentation: categoryParamTotal(sp.presentation),
                report: categoryParamTotal(sp.report),
                participation: maxP
            };
            const sorted = [...students].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            const rows = sorted.map((s, index) => {
                const sem = s.seminar || getDefaultSeminar();
                ensureSeminarEvaluation(sem);
                const t = sem.totals || {};
                const comps = sem.evaluation?.components || {};
                const gid = sem.guideId || settings.guideAssignments?.[s.id];
                const slotId = sem.presentationSlotId || settings.presentationAssignments?.[s.id];
                const slot = (settings.presentationSlots || []).find(sl => sl.id === slotId);
                const displayTopic = getSeminarDisplayTopic(sem);
                const locked = getLockedTopic(sem);
                const grand = computeSeminarGrandTotal(t, maxP);
                const catKeys = ['guide', 'coordinator', 'presentation', 'report'];
                const categories = {};
                let dummy = false;
                let markedCount = 0;
                const totalKeys = {
                    guide: 'guideMarks',
                    coordinator: 'coordinatorMarks',
                    presentation: 'presentationMarks',
                    report: 'reportMarks'
                };
                const history = sem.evaluation?.markHistory || [];
                const presRec = (settings.presentations || []).find(p => p.studentId === s.id);
                for (const key of catKeys) {
                    const comp = comps[key] || (key === 'presentation' ? comps.presenter : null);
                    const extraEntries = [];
                    if (key === 'presentation' && presRec) {
                        if (presRec.presenterEvaluatorScores) {
                            extraEntries.push(...Object.values(presRec.presenterEvaluatorScores));
                        }
                        if (presRec.presenterScores && presRec.evaluationMeta) {
                            extraEntries.push({
                                scores: presRec.presenterScores,
                                markedBy: presRec.evaluationMeta,
                                markedAt: presRec.evaluatedAt || presRec.evaluationMeta?.at || '',
                                isDummy: Boolean(presRec.presenterScores?._isDummy || presRec.evaluationMeta?.isDummy)
                            });
                        }
                    }
                    const evaluators = this.collectSeminarComponentEvaluators(
                        comp, history, key, sp[key], extraEntries
                    );
                    const fromTotal = parseFloat(t[totalKeys[key]]);
                    const hasComponent = this.seminarComponentHasScores(comp);
                    const hasTotal = !isNaN(fromTotal) && fromTotal > 0;
                    const has = evaluators.length > 0 || hasComponent || hasTotal;
                    if (has) markedCount += 1;
                    if (evaluators.some(ev => ev.isDummy) || comp?.isDummy || comp?.markedBy?.isDummy) dummy = true;
                    let marks = '';
                    if (has) {
                        if (hasComponent || hasTotal) {
                            marks = !isNaN(fromTotal) ? fromTotal : (sumParamScores(comp?.scores, sp[key]) || 0);
                        } else {
                            marks = evaluators[0]?.marks ?? 0;
                        }
                    }
                    const marker = evaluators.length
                        ? evaluators.map(ev => `${ev.label}: ${ev.marks}`).join('; ')
                        : this.formatSeminarEvaluatorLabel(comp?.markedBy, comp?.isDummy);
                    categories[key] = {
                        marks,
                        max: maxes[key],
                        marker,
                        role: this.seminarEvaluatorRoleLabel(comp?.markedBy?.role),
                        name: comp?.markedBy?.name || '',
                        scores: comp?.scores || {},
                        has,
                        dummy: Boolean(comp?.isDummy || comp?.markedBy?.isDummy || evaluators.some(ev => ev.isDummy)),
                        at: comp?.markedAt || comp?.markedBy?.at || '',
                        evaluators
                    };
                }

                const partMarks = Math.min(parseFloat(t.questionMarks) || 0, maxP);
                const partEvaluators = this.getSeminarParticipationEvaluators(s.id, settings);
                const qTimes = settings.questionFairness?.[s.id]?.times || 0;
                if ((sem.questionHistory || []).some(h => h.isDummy)) dummy = true;

                let status = 'pending';
                if (sem.evaluation?.isAbsent) status = 'absent';
                else if (markedCount === catKeys.length) status = 'complete';
                else if (markedCount > 0 || partMarks > 0) status = 'partial';

                const statusLabel = {
                    complete: 'CIE complete',
                    partial: 'CIE in progress',
                    pending: 'No CIE yet',
                    absent: 'Absent'
                }[status];

                return {
                    index: index + 1,
                    id: s.id,
                    name: s.name || '',
                    ktuid: s.ktuid || '',
                    guideName: gid ? (guideMap[gid] || gid) : '',
                    topic: displayTopic?.title || '',
                    topicStatus: locked ? 'locked' : (displayTopic?.status || ''),
                    papers: (sem.papers || []).length,
                    slot: slot ? formatPresentationSlot(slot) : '',
                    absent: Boolean(sem.evaluation?.isAbsent),
                    categories,
                    participation: {
                        marks: partMarks,
                        max: maxP,
                        markers: partEvaluators,
                        times: qTimes
                    },
                    grand,
                    maxTotal: 100,
                    status,
                    statusLabel,
                    dummy,
                    searchText: [
                        s.name, s.ktuid, guideMap[gid], displayTopic?.title,
                        categories.guide.marker, categories.coordinator.marker,
                        categories.presentation.marker, categories.report.marker,
                        partEvaluators.join(' ')
                    ].join(' ').toLowerCase(),
                    markHistory: sem.evaluation?.markHistory || []
                };
            });

            const evaluatedRows = rows.filter(r => r.status === 'complete' || r.status === 'partial');
            const stats = {
                total: rows.length,
                complete: rows.filter(r => r.status === 'complete').length,
                partial: rows.filter(r => r.status === 'partial').length,
                pending: rows.filter(r => r.status === 'pending').length,
                absent: rows.filter(r => r.status === 'absent').length,
                dummy: rows.filter(r => r.dummy).length,
                byComponent: {
                    guide: rows.filter(r => r.categories.guide.has).length,
                    coordinator: rows.filter(r => r.categories.coordinator.has).length,
                    presentation: rows.filter(r => r.categories.presentation.has).length,
                    report: rows.filter(r => r.categories.report.has).length,
                    participation: rows.filter(r => (parseFloat(r.participation?.marks) || 0) > 0).length
                },
                classAverage: rows.length
                    ? Math.round((rows.reduce((sum, r) => sum + (parseFloat(r.grand) || 0), 0) / rows.length) * 10) / 10
                    : 0,
                markedAverage: evaluatedRows.length
                    ? Math.round((evaluatedRows.reduce((sum, r) => sum + (parseFloat(r.grand) || 0), 0) / evaluatedRows.length) * 10) / 10
                    : 0,
                markedCount: evaluatedRows.length
            };

            return { settings, students: sorted, guides, guideMap, sp, maxes, rows, stats };
        },

        seminarConsolidatedStatusBadge(row) {
            const cls = {
                complete: 'seminar-cons-badge-complete',
                partial: 'seminar-cons-badge-partial',
                pending: 'seminar-cons-badge-pending',
                absent: 'seminar-cons-badge-absent'
            }[row.status] || '';
            return `<span class="seminar-cons-badge ${cls}">${escapeHtml(row.statusLabel)}</span>`;
        },

        seminarConsolidatedMarksCell(cat) {
            if (!cat?.has && (cat?.marks === '' || cat?.marks == null)) {
                return `<td class="seminar-cons-empty">—</td>`;
            }
            const dummy = cat.dummy ? ' seminar-cons-dummy' : '';
            const evaluators = cat.evaluators || [];
            const lines = evaluators.length
                ? evaluators.map(ev => {
                    const adminCls = ev.markedBy?.role === 'admin' ? ' seminar-cons-marker-admin' : '';
                    return `<div class="seminar-cons-marker${adminCls}">${escapeHtml(ev.label)}: <strong>${escapeHtml(String(ev.marks))}</strong></div>`;
                }).join('')
                : (cat.marker
                    ? `<div class="seminar-cons-marker">${escapeHtml(cat.marker)}</div>`
                    : '<div class="seminar-cons-marker">Evaluator not recorded</div>');
            return `<td class="seminar-cons-marks${dummy}">
                <strong>${escapeHtml(String(cat.marks))}</strong><small>/${escapeHtml(String(cat.max))}</small>
                ${lines}
            </td>`;
        },

        setupSeminarConsolidatedSearch() {
            const searchInput = document.getElementById('search-seminar-consolidated');
            if (!searchInput || searchInput.dataset.bound) return;
            searchInput.dataset.bound = 'true';
            searchInput.addEventListener('input', () => this.filterSeminarConsolidatedTable());
        },

        filterSeminarConsolidatedTable() {
            const term = (document.getElementById('search-seminar-consolidated')?.value || '').toLowerCase().trim();
            const filter = document.getElementById('filter-seminar-consolidated')?.value || '';
            const componentFilters = ['guide', 'coordinator', 'presentation', 'report', 'participation'];
            let visible = 0;
            document.querySelectorAll('#seminar-consolidated-table tbody tr').forEach(row => {
                const matchText = !term || (row.dataset.search || '').includes(term);
                const matchFilter = !filter
                    || row.dataset.status === filter
                    || (filter === 'dummy' && row.dataset.dummy === '1')
                    || (filter === 'evaluated' && (row.dataset.status === 'complete' || row.dataset.status === 'partial'))
                    || (componentFilters.includes(filter) && row.dataset[filter] === '1');
                const show = matchText && matchFilter;
                row.style.display = show ? '' : 'none';
                if (show) visible += 1;
            });
            const countEl = document.getElementById('seminar-consolidated-visible-count');
            if (countEl) countEl.textContent = String(visible);
            document.querySelectorAll('.seminar-cons-stat-card[data-filter]').forEach(card => {
                card.classList.toggle('is-active', Boolean(filter) && (card.dataset.filter || '') === filter);
            });
        },

        filterSeminarConsolidatedBy(filter) {
            const sel = document.getElementById('filter-seminar-consolidated');
            if (!sel) return;
            sel.value = sel.value === filter ? '' : (filter || '');
            this.filterSeminarConsolidatedTable();
        },

        seminarConsStatCard({ filter = '', value, label, hint, tone = 'neutral', ofTotal = null, suffix = '' }) {
            const pct = ofTotal ? Math.min(100, Math.round((Number(value) / ofTotal) * 100)) : null;
            const bar = pct != null
                ? `<span class="seminar-cons-stat-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>`
                : '';
            return `
                <button type="button" class="seminar-cons-stat-card seminar-cons-stat-${tone}"
                    data-filter="${escapeHtml(filter)}"
                    ${filter ? `onclick="app.filterSeminarConsolidatedBy('${escapeHtml(filter)}')"` : 'disabled'}
                    title="${escapeHtml(hint || label)}">
                    <span class="seminar-cons-stat-value">${escapeHtml(String(value))}${suffix ? `<small>${escapeHtml(suffix)}</small>` : ''}${ofTotal != null ? `<small> / ${ofTotal}</small>` : ''}</span>
                    <span class="seminar-cons-stat-label">${escapeHtml(label)}</span>
                    ${hint ? `<span class="seminar-cons-stat-hint">${escapeHtml(hint)}</span>` : ''}
                    ${bar}
                </button>`;
        },

        async renderSeminarConsolidatedMarks(force = false) {
            if (force && typeof force === 'object') force = false;
            const wrap = document.getElementById('seminar-consolidated-table-wrap');
            const statsEl = document.getElementById('seminar-consolidated-stats');
            if (!wrap) return;
            wrap.innerHTML = '<p class="form-hint"><i class="fas fa-spinner fa-spin"></i> Loading consolidated marks…</p>';
            try {
                const data = await this.collectSeminarConsolidatedData({ force: Boolean(force) });
                app._seminarConsolidatedCache = data;
                const { rows, stats, maxes } = data;

                if (statsEl) {
                    const n = stats.total;
                    const bc = stats.byComponent;
                    statsEl.className = 'seminar-cons-stats';
                    statsEl.innerHTML = `
                        <p class="seminar-cons-stats-legend">
                            CIE is out of 100: Guide ${maxes.guide} + Coordinator ${maxes.coordinator} + Presentation ${maxes.presentation} + Report ${maxes.report} + Participation ${maxes.participation}.
                            A student is <strong>CIE complete</strong> when Guide, Coordinator, Presentation and Report are all entered.
                            Click a card to list those students.
                        </p>
                        <h4 class="seminar-cons-stats-heading">Marks entered, by CIE part</h4>
                        <div class="seminar-cons-stat-grid">
                            ${this.seminarConsStatCard({ filter: 'guide', value: bc.guide, ofTotal: n, label: `Guide (${maxes.guide})`, hint: 'Assigned seminar guide has entered marks', tone: bc.guide === n ? 'ok' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'coordinator', value: bc.coordinator, ofTotal: n, label: `Coordinator (${maxes.coordinator})`, hint: 'Admin coordinator marks (diary & attendance)', tone: bc.coordinator === n ? 'ok' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'presentation', value: bc.presentation, ofTotal: n, label: `Presentation (${maxes.presentation})`, hint: 'IEC faculty or admin presentation marks', tone: bc.presentation === n ? 'ok' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'report', value: bc.report, ofTotal: n, label: `Report (${maxes.report})`, hint: 'Admin report marks', tone: bc.report === n ? 'ok' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'participation', value: bc.participation, ofTotal: n, label: `Participation (${maxes.participation})`, hint: 'Audience-question marks awarded', tone: 'neutral' })}
                        </div>
                        <h4 class="seminar-cons-stats-heading">How far CIE marking has got</h4>
                        <div class="seminar-cons-stat-grid">
                            ${this.seminarConsStatCard({ filter: 'complete', value: stats.complete, ofTotal: n, label: 'CIE complete', hint: 'Guide + Coordinator + Presentation + Report all entered', tone: 'ok' })}
                            ${this.seminarConsStatCard({ filter: 'partial', value: stats.partial, ofTotal: n, label: 'CIE in progress', hint: 'At least one CIE part entered, others still empty', tone: stats.partial ? 'info' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'pending', value: stats.pending, ofTotal: n, label: 'No CIE yet', hint: 'No Guide, Coordinator, Presentation or Report marks', tone: stats.pending ? 'muted' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'absent', value: stats.absent, ofTotal: n, label: 'Marked absent', hint: 'Presenter marked absent for the session', tone: stats.absent ? 'danger' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'dummy', value: stats.dummy, ofTotal: n, label: 'Dummy / test', hint: 'Has dummy marks — convert to official or clear them', tone: stats.dummy ? 'dummy' : 'neutral' })}
                            ${this.seminarConsStatCard({ filter: 'evaluated', value: stats.markedAverage, suffix: ' /100', label: `Avg of ${stats.markedCount} with marks`, hint: 'Average CIE among students who have at least one part entered', tone: 'neutral' })}
                            ${this.seminarConsStatCard({ filter: '', value: stats.classAverage, suffix: ' /100', label: `Class avg (all ${n})`, hint: 'Average over every student; unmarked students count as 0', tone: 'neutral' })}
                        </div>
                    `;
                }

                if (!rows.length) {
                    wrap.innerHTML = '<p class="empty-state">No students found.</p>';
                    return;
                }

                wrap.innerHTML = `
                    <p class="form-hint" style="margin:0 0 0.5rem;">
                        Showing <strong id="seminar-consolidated-visible-count">${rows.length}</strong> of ${rows.length}.
                        Each component lists <strong>every evaluator</strong> who saved marks, including <strong>Admin</strong>.
                        The large number is the current CIE value (last saved).
                    </p>
                    <table id="seminar-consolidated-table" class="forge-lab-admin-table seminar-cons-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Student</th>
                                <th>KTU ID</th>
                                <th>Assigned guide</th>
                                <th>Guide (${maxes.guide})</th>
                                <th>Coordinator (${maxes.coordinator})</th>
                                <th>Presentation (${maxes.presentation})</th>
                                <th>Report (${maxes.report})</th>
                                <th>Participation (${maxes.participation})</th>
                                <th>Total</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => {
                                const partMarker = row.participation.markers.length
                                    ? `<div class="seminar-cons-marker">${escapeHtml(row.participation.markers.join('; '))} · Q×${row.participation.times}</div>`
                                    : `<div class="seminar-cons-marker">Q×${row.participation.times}</div>`;
                                return `
                                <tr data-status="${escapeHtml(row.status)}" data-dummy="${row.dummy ? '1' : '0'}"
                                    data-guide="${row.categories.guide.has ? '1' : '0'}"
                                    data-coordinator="${row.categories.coordinator.has ? '1' : '0'}"
                                    data-presentation="${row.categories.presentation.has ? '1' : '0'}"
                                    data-report="${row.categories.report.has ? '1' : '0'}"
                                    data-participation="${(parseFloat(row.participation.marks) || 0) > 0 ? '1' : '0'}"
                                    data-search="${escapeHtml(row.searchText)}">
                                    <td>${row.index}</td>
                                    <td>
                                        <strong>${escapeHtml(row.name)}</strong>
                                        ${row.dummy ? '<div class="seminar-cons-marker">Dummy / test</div>' : ''}
                                        <div class="seminar-cons-topic">${escapeHtml(row.topic || '—')}</div>
                                    </td>
                                    <td>${escapeHtml(row.ktuid || '—')}</td>
                                    <td>${escapeHtml(row.guideName || '—')}</td>
                                    ${this.seminarConsolidatedMarksCell(row.categories.guide)}
                                    ${this.seminarConsolidatedMarksCell(row.categories.coordinator)}
                                    ${this.seminarConsolidatedMarksCell(row.categories.presentation)}
                                    ${this.seminarConsolidatedMarksCell(row.categories.report)}
                                    <td class="seminar-cons-marks">
                                        <strong>${escapeHtml(String(row.participation.marks))}</strong><small>/${escapeHtml(String(row.participation.max))}</small>
                                        ${partMarker}
                                    </td>
                                    <td class="seminar-cons-total"><strong>${escapeHtml(String(row.grand))}</strong><small>/100</small></td>
                                    <td>
                                        ${this.seminarConsolidatedStatusBadge(row)}
                                        <button type="button" class="btn btn-sm btn-secondary seminar-cons-eval-btn" onclick="app.openSeminarEvaluation('${escapeHtml(row.id)}')">
                                            Evaluate
                                        </button>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                `;
                this.setupSeminarConsolidatedSearch();
                this.filterSeminarConsolidatedTable();
            } catch (err) {
                console.error(err);
                wrap.innerHTML = `<p class="error-message">Failed to load consolidated marks.${err?.message ? ` (${escapeHtml(err.message)})` : ''}</p>`;
            }
        },

        seminarConsolidatedExcelAoa(data) {
            const { rows, maxes, sp, stats } = data;
            const generated = new Date().toLocaleString('en-IN');
            const totalsSheet = [
                ['DEPARTMENT OF INFORMATION TECHNOLOGY'],
                ['GOVERNMENT ENGINEERING COLLEGE IDUKKI'],
                ['ITQ413 SEMINAR — Consolidated CIE marks'],
                [`Generated: ${generated}`],
                [],
                ['Summary'],
                ['Students', stats.total],
                ['CIE complete (all 4 parts)', stats.complete],
                ['CIE in progress', stats.partial],
                ['No CIE yet', stats.pending],
                ['Absent', stats.absent],
                ['Dummy / test', stats.dummy],
                ['Guide marks entered', stats.byComponent?.guide ?? 0],
                ['Coordinator marks entered', stats.byComponent?.coordinator ?? 0],
                ['Presentation marks entered', stats.byComponent?.presentation ?? 0],
                ['Report marks entered', stats.byComponent?.report ?? 0],
                ['Participation marks entered', stats.byComponent?.participation ?? 0],
                [`Average of ${stats.markedCount} students with marks /100`, stats.markedAverage],
                ['Class average (all students, unmarked = 0) /100', stats.classAverage],
                [],
                [
                    'Sl. No.', 'Student', 'KTU ID', 'Assigned guide', 'Topic', 'Topic status', 'Papers', 'Slot', 'Absent',
                    `Guide marks (max ${maxes.guide})`, 'Guide evaluator', 'Guide evaluator role',
                    `Coordinator marks (max ${maxes.coordinator})`, 'Coordinator evaluator', 'Coordinator evaluator role',
                    `Presentation marks (max ${maxes.presentation})`, 'Presentation evaluator', 'Presentation evaluator role',
                    `Report marks (max ${maxes.report})`, 'Report evaluator', 'Report evaluator role',
                    `Participation marks (max ${maxes.participation})`, 'Participation evaluators', 'Audience Q count',
                    'Grand total', 'Max total', 'Status', 'Dummy / test'
                ]
            ];
            rows.forEach(row => {
                totalsSheet.push([
                    row.index, row.name, row.ktuid, row.guideName, row.topic, row.topicStatus, row.papers, row.slot,
                    row.absent ? 'Yes' : 'No',
                    row.categories.guide.marks, row.categories.guide.marker, row.categories.guide.role || '',
                    row.categories.coordinator.marks, row.categories.coordinator.marker, row.categories.coordinator.role || '',
                    row.categories.presentation.marks, row.categories.presentation.marker, row.categories.presentation.role || '',
                    row.categories.report.marks, row.categories.report.marker, row.categories.report.role || '',
                    row.participation.marks, row.participation.markers.join('; '), row.participation.times,
                    row.grand, 100, row.statusLabel, row.dummy ? 'Yes' : 'No'
                ]);
            });

            const paramHeader = ['Sl. No.', 'Student', 'KTU ID', 'Assigned guide'];
            const paramGroups = [
                ['guide', 'Guide'],
                ['coordinator', 'Coordinator'],
                ['presentation', 'Presentation'],
                ['report', 'Report']
            ];
            paramGroups.forEach(([key, label]) => {
                (sp[key] || []).forEach(p => {
                    paramHeader.push(`${label}: ${p.label} (max ${p.maxMarks})`);
                });
                paramHeader.push(`${label} total`);
            });
            paramHeader.push(`Participation (max ${maxes.participation})`, 'Grand total', 'Status');
            const paramsSheet = [
                ['ITQ413 SEMINAR — Parameter-level consolidated marks'],
                [`Generated: ${generated}`],
                [],
                paramHeader
            ];
            rows.forEach(row => {
                const line = [row.index, row.name, row.ktuid, row.guideName];
                paramGroups.forEach(([key]) => {
                    (sp[key] || []).forEach(p => {
                        const scores = row.categories[key].scores || {};
                        const v = scores[p.id];
                        line.push(v === '' || v == null ? '' : Number(parseFloat(v)) || 0);
                    });
                    line.push(row.categories[key].marks);
                });
                line.push(row.participation.marks, row.grand, row.statusLabel);
                paramsSheet.push(line);
            });

            const logSheet = [
                ['ITQ413 SEMINAR — Evaluator save log (including Admin)'],
                [`Generated: ${generated}`],
                [],
                ['Student', 'KTU ID', 'Component', 'Evaluator', 'Role', 'Dummy / test', 'Marked at', 'Parameter scores']
            ];
            rows.forEach(row => {
                const history = row.markHistory || [];
                if (!history.length) {
                    ['guide', 'coordinator', 'presentation', 'report'].forEach(key => {
                        const cat = row.categories[key];
                        const list = (cat.evaluators && cat.evaluators.length)
                            ? cat.evaluators
                            : (cat.has ? [{
                                label: cat.name || cat.marker || 'Unknown',
                                role: cat.role,
                                isDummy: cat.dummy,
                                at: cat.at,
                                scores: cat.scores
                            }] : []);
                        list.forEach(ev => {
                            const scores = Object.entries(ev.scores || cat.scores || {})
                                .filter(([k]) => k !== '_isDummy')
                                .map(([k, v]) => `${k}=${v}`)
                                .join('; ');
                            logSheet.push([
                                row.name, row.ktuid, key, ev.label || cat.marker, ev.role || cat.role,
                                ev.isDummy ? 'Yes' : 'No', ev.at || cat.at || '', scores
                            ]);
                        });
                    });
                    return;
                }
                history.forEach(h => {
                    const scores = Object.entries(h.scores || {})
                        .filter(([k]) => k !== '_isDummy')
                        .map(([k, v]) => `${k}=${v}`)
                        .join('; ');
                    logSheet.push([
                        row.name,
                        row.ktuid,
                        h.component || '',
                        h.markedBy?.name || '',
                        this.seminarEvaluatorRoleLabel(h.markedBy?.role),
                        (h.isDummy || h.markedBy?.isDummy) ? 'Yes' : 'No',
                        h.markedAt || h.markedBy?.at || '',
                        scores
                    ]);
                });
            });

            return { totalsSheet, paramsSheet, logSheet };
        },

        async exportSeminarConsolidatedMarksExcel() {
            if (!app.isAdmin) {
                alert('Only administrators can export consolidated seminar marks.');
                return;
            }
            if (typeof XLSX === 'undefined') {
                alert('Excel export library not loaded. Please refresh the page.');
                return;
            }
            try {
                const data = await this.collectSeminarConsolidatedData({ force: true });
                if (!data.rows.length) {
                    alert('No students found.');
                    return;
                }
                const { totalsSheet, paramsSheet, logSheet } = this.seminarConsolidatedExcelAoa(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(totalsSheet), 'CIE totals');
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(paramsSheet), 'Parameter marks');
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(logSheet), 'Evaluator log');
                const fname = `Seminar_Consolidated_CIE_Marks_${new Date().toISOString().slice(0, 10)}.xlsx`;
                XLSX.writeFile(wb, fname);
            } catch (error) {
                console.error('exportSeminarConsolidatedMarksExcel:', error);
                alert('Could not generate Excel file. Please try again.');
            }
        },

        async exportSeminarConsolidatedMarksCsv() {
            if (!app.isAdmin) {
                alert('Only administrators can export consolidated seminar marks.');
                return;
            }
            try {
                const data = await this.collectSeminarConsolidatedData({ force: true });
                const { rows, maxes } = data;
                const header = [
                    'Sl. No.', 'Student', 'KTU ID', 'Assigned guide', 'Topic', 'Topic status', 'Papers', 'Slot', 'Absent',
                    `Guide marks (max ${maxes.guide})`, 'Guide evaluator',
                    `Coordinator marks (max ${maxes.coordinator})`, 'Coordinator evaluator',
                    `Presentation marks (max ${maxes.presentation})`, 'Presentation evaluator',
                    `Report marks (max ${maxes.report})`, 'Report evaluator',
                    `Participation marks (max ${maxes.participation})`, 'Participation evaluators', 'Audience Q count',
                    'Grand total', 'Status', 'Dummy / test'
                ];
                const lines = [header.map(c => this.seminarCsvCell(c)).join(',')];
                rows.forEach(row => {
                    lines.push([
                        row.index, row.name, row.ktuid, row.guideName, row.topic, row.topicStatus, row.papers, row.slot,
                        row.absent ? 'Yes' : 'No',
                        row.categories.guide.marks, row.categories.guide.marker,
                        row.categories.coordinator.marks, row.categories.coordinator.marker,
                        row.categories.presentation.marks, row.categories.presentation.marker,
                        row.categories.report.marks, row.categories.report.marker,
                        row.participation.marks, row.participation.markers.join('; '), row.participation.times,
                        row.grand, row.statusLabel, row.dummy ? 'Yes' : 'No'
                    ].map(c => this.seminarCsvCell(c)).join(','));
                });
                this.downloadSeminarCsv(
                    `seminar-consolidated-cie-${new Date().toISOString().split('T')[0]}.csv`,
                    lines.join('\n')
                );
            } catch (error) {
                console.error('exportSeminarConsolidatedMarksCsv:', error);
                alert('Could not generate CSV file. Please try again.');
            }
        },

        async generateSeminarReport() {
            await this.exportSeminarConsolidatedMarksCsv();
        },

        async generateSeminarConsolidatedMarksPdf() {
            if (!app.isAdmin) {
                alert('Only administrators can export consolidated seminar marks.');
                return;
            }
            try {
                const data = await this.collectSeminarConsolidatedData({ force: true });
                const { rows, stats, maxes } = data;
                const tableRows = rows.map((row, idx) => `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 6px 8px; text-align: center; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${row.index}</td>
                        <td style="padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e5e7eb;">
                            <div style="font-weight: 700;">${escapeHtml(row.name)}</div>
                            <div style="color: #6b7280; font-size: 10px;">${escapeHtml(row.ktuid || '—')}</div>
                        </td>
                        <td style="padding: 6px 8px; font-size: 10px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(row.guideName || '—')}</td>
                        <td style="padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            ${row.categories.guide.has ? escapeHtml(String(row.categories.guide.marks)) : '—'}
                            <div style="color: #6b7280; font-size: 9px;">${escapeHtml(row.categories.guide.marker || '')}</div>
                        </td>
                        <td style="padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            ${row.categories.coordinator.has ? escapeHtml(String(row.categories.coordinator.marks)) : '—'}
                            <div style="color: #6b7280; font-size: 9px;">${escapeHtml(row.categories.coordinator.marker || '')}</div>
                        </td>
                        <td style="padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            ${row.categories.presentation.has ? escapeHtml(String(row.categories.presentation.marks)) : '—'}
                            <div style="color: #6b7280; font-size: 9px;">${escapeHtml(row.categories.presentation.marker || '')}</div>
                        </td>
                        <td style="padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e5e7eb; text-align: center;">
                            ${row.categories.report.has ? escapeHtml(String(row.categories.report.marks)) : '—'}
                            <div style="color: #6b7280; font-size: 9px;">${escapeHtml(row.categories.report.marker || '')}</div>
                        </td>
                        <td style="padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e5e7eb; text-align: center;">${escapeHtml(String(row.participation.marks))}</td>
                        <td style="padding: 6px 8px; font-size: 12px; font-weight: 700; border-bottom: 1px solid #e5e7eb; text-align: center;">${escapeHtml(String(row.grand))}</td>
                        <td style="padding: 6px 8px; font-size: 10px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(row.statusLabel)}</td>
                    </tr>
                `).join('');

                const body = `
                    <div style="margin-bottom: 18px; padding: 16px; background: #ffffff; border-radius: 12px; border: 1px solid rgba(0,0,0,0.06);">
                        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 16px; margin: 0 0 10px; border-left: 4px solid #6366f1; padding-left: 10px;">Summary</h3>
                        <div style="font-size: 12px; color: #4b5563;">
                            Students: <strong>${stats.total}</strong> · CIE complete: <strong>${stats.complete}</strong> ·
                            CIE in progress: <strong>${stats.partial}</strong> · No CIE yet: <strong>${stats.pending}</strong> ·
                            Absent: <strong>${stats.absent}</strong> ·
                            Avg of marked: <strong>${stats.markedAverage}/100</strong> ·
                            Class avg: <strong>${stats.classAverage}/100</strong>
                        </div>
                        <p style="font-size: 11px; color: #6b7280; margin: 8px 0 0;">
                            Guide ${maxes.guide} · Coordinator ${maxes.coordinator} (Admin) · Presentation ${maxes.presentation} (IEC/Admin) ·
                            Report ${maxes.report} (Admin) · Participation ${maxes.participation}
                        </p>
                    </div>
                    <div style="padding: 12px; background: #ffffff; border-radius: 12px; border: 1px solid rgba(0,0,0,0.06);">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">#</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">G/${maxes.guide}</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">C/${maxes.coordinator}</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">P/${maxes.presentation}</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">R/${maxes.report}</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">Q/${maxes.participation}</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: center; border-bottom: 2px solid #e5e7eb;">Total</th>
                                    <th style="padding: 8px; background: #f8fafc; font-size: 10px; text-align: left; border-bottom: 2px solid #e5e7eb;">Status</th>
                                </tr>
                            </thead>
                            <tbody>${tableRows || `<tr><td colspan="10" style="padding:12px; text-align:center; color:#6b7280;">No students</td></tr>`}</tbody>
                        </table>
                    </div>
                `;
                const html = this.seminarReportShell('Consolidated CIE Marks', body);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Consolidated CIE Marks' });
            } catch (error) {
                console.error(error);
                alert('Error generating consolidated marks PDF. Please allow popups and try again.');
            }
        },

        seminarReportShell(title, bodyHtml) {
            const generatedOn = new Date().toLocaleDateString('en-IN', {
                day: '2-digit', month: 'long', year: 'numeric'
            });
            return `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>${escapeHtml(title)}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Lato:wght@400;500;600;700&display=swap" rel="stylesheet">
                    <style>
                        @media print {
                            @page { size: A4; margin: 1cm; }
                            body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        }
                        body {
                            font-family: 'Lato', sans-serif;
                            color: #2d3748;
                            line-height: 1.5;
                            margin: 0;
                            padding: 0;
                            background-color: #ffffff;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    </style>
                </head>
                <body>
                    <div style="max-width: 900px; margin: 20px auto; padding: 20px; background: #ffffff;">
                        <div style="text-align: center; margin-bottom: 30px; padding: 30px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); border: 1px solid rgba(0, 0, 0, 0.06);">
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">DEPARTMENT OF INFORMATION TECHNOLOGY</div>
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 10px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">GOVERNMENT ENGINEERING COLLEGE IDUKKI</div>
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 20px; letter-spacing: 1.5px; color: #1f2937; text-transform: uppercase;">SEMINAR MODULE</div>
                            <div style="font-family: 'Lato', sans-serif; font-size: 24px; font-weight: 700; margin-top: 20px; padding: 15px 35px; background: #f8fafc; border-radius: 12px; display: inline-block; color: #1f2937; border: 2px solid rgba(0, 0, 0, 0.08);">
                                ${escapeHtml(title)}
                            </div>
                        </div>
                        ${bodyHtml}
                        <div style="margin-top: 20px; text-align: right; font-size: 11px; color: #6b7280; padding-top: 12px; border-top: 1px solid #e5e7eb; font-family: 'Lato', sans-serif; font-weight: 500;">
                            Generated on: ${escapeHtml(generatedOn)}
                        </div>
                    </div>
                </body>
                </html>
            `;
        },

        async getSeminarTopicReportContext() {
            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents();
            const guides = await this.fetchGuides();
            const guideMap = Object.fromEntries(guides.map(g => [g.id, g]));
            students.forEach(s => ensureSeminarTopics(s.seminar));
            students.sort((a, b) => a.name.localeCompare(b.name));
            return { settings, students, guides, guideMap };
        },

        buildSeminarTopicSubmissionsReportHtml(students, settings, guideMap) {
            let totalTopics = 0;
            let studentsWithTopics = 0;
            const belowMin = [];

            const sections = students.map(s => {
                const topics = s.seminar.topics || [];
                if (topics.length) studentsWithTopics += 1;
                totalTopics += topics.length;
                const gid = s.seminar.guideId || settings.guideAssignments?.[s.id];
                const guide = guideMap[gid];

                if (topics.length < MIN_SEMINAR_TOPICS) {
                    belowMin.push({
                        s,
                        guide,
                        count: topics.length,
                        shortfall: MIN_SEMINAR_TOPICS - topics.length
                    });
                }

                const rows = topics.length
                    ? topics.map((t, idx) => `
                        <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                            <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(t.title)}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(t.description || '—')}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(statusBadge(t.status))}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${t.submittedAt ? escapeHtml(new Date(t.submittedAt).toLocaleDateString('en-IN')) : '—'}</td>
                        </tr>
                    `).join('')
                    : `<tr><td colspan="5" style="padding: 12px; text-align: center; color: #6b7280; font-size: 12px;">No topics submitted</td></tr>`;

                return `
                    <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-inside: avoid;">
                        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 16px; font-weight: 700; margin: 0 0 6px 0; color: #1f2937; border-left: 4px solid #6366f1; padding-left: 12px;">
                            ${escapeHtml(s.name)} <span style="font-weight: 500; color: #6b7280; font-size: 13px;">(${escapeHtml(s.ktuid)})</span>
                        </h3>
                        <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 0 0 12px 16px;">
                            Guide: ${escapeHtml(guide?.name || '—')} · Topics: ${topics.length}${topics.length < MIN_SEMINAR_TOPICS ? ` (below minimum of ${MIN_SEMINAR_TOPICS})` : ''}
                        </p>
                        <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
                            <thead>
                                <tr>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb; width: 6%;">#</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 22%;">Title</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Description</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 14%;">Status</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 12%;">Submitted</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            }).join('');

            belowMin.sort((a, b) => a.count - b.count || a.s.name.localeCompare(b.s.name));

            const belowMinRows = belowMin.length
                ? belowMin.map((r, idx) => `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#fffbeb'};">
                        <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.guide?.name || '—')}</td>
                        <td style="padding: 8px 12px; text-align: center; color: #b45309; font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${r.count}</td>
                        <td style="padding: 8px 12px; text-align: center; color: #dc2626; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${r.shortfall}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="6" style="padding: 14px; text-align: center; color: #059669; font-size: 12px;">All students have submitted at least ${MIN_SEMINAR_TOPICS} topics.</td></tr>`;

            const summary = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; gap: 8px;">
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">Students:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${students.length}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">With submissions:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${studentsWithTopics}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">Total topics:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${totalTopics}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #fffbeb; border-radius: 8px; border-left: 3px solid #d97706;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">Below minimum (${MIN_SEMINAR_TOPICS}):</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #b45309; font-size: 13px;">${belowMin.length}</span>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: #1f2937; border-left: 4px solid #d97706; padding-left: 12px;">Students with fewer than ${MIN_SEMINAR_TOPICS} topic submissions</h3>
                    <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 0 0 14px 16px;">Minimum required: ${MIN_SEMINAR_TOPICS} topics per student</p>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #fde68a; width: 6%;">#</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Student</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a; width: 14%;">KTU ID</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a; width: 22%;">Guide</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #fde68a; width: 12%;">Submitted</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #fde68a; width: 12%;">Short by</th>
                            </tr>
                        </thead>
                        <tbody>${belowMinRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('Topic Submissions Report', summary + sections);
        },

        buildSeminarTopicApprovalsReportHtml(students, settings, guideMap) {
            let approved = 0;
            let rejected = 0;
            let pending = 0;
            let revision = 0;
            const rows = [];

            students.forEach(s => {
                const gid = s.seminar.guideId || settings.guideAssignments?.[s.id];
                const guide = guideMap[gid];
                (s.seminar.topics || []).forEach(t => {
                    if (t.status === 'approved') approved += 1;
                    else if (t.status === 'rejected') rejected += 1;
                    else if (t.status === 'needs_revision') revision += 1;
                    else pending += 1;
                    rows.push({ s, t, guide });
                });
            });

            rows.sort((a, b) =>
                (a.guide?.name || '').localeCompare(b.guide?.name || '') ||
                a.s.name.localeCompare(b.s.name) ||
                a.t.title.localeCompare(b.t.title)
            );

            const tableRows = rows.length
                ? rows.map((r, idx) => `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 8px 10px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.guide?.name || '—')}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.t.title)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${escapeHtml(statusBadge(r.t.status))}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.t.guideFeedback || '—')}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #6b7280;">No topics found.</td></tr>`;

            const body = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                        <div style="padding: 12px; background: #ecfdf5; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #059669;">${approved}</div><div style="font-size: 11px; color: #047857;">Approved</div></div>
                        <div style="padding: 12px; background: #fef2f2; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #dc2626;">${rejected}</div><div style="font-size: 11px; color: #b91c1c;">Rejected</div></div>
                        <div style="padding: 12px; background: #eff6ff; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #2563eb;">${pending}</div><div style="font-size: 11px; color: #1d4ed8;">Pending</div></div>
                        <div style="padding: 12px; background: #fffbeb; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #d97706;">${revision}</div><div style="font-size: 11px; color: #b45309;">Needs edit</div></div>
                    </div>
                </div>
                <div style="margin-bottom: 20px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">Guide Topic Approvals</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb;">#</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">KTU ID</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Topic</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Decision</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide comment</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('Guide Topic Approvals Report', body);
        },

        buildSeminarLockedTopicsReportHtml(students, settings, guideMap) {
            const lockedRows = students
                .map(s => {
                    const locked = getLockedTopic(s.seminar);
                    if (!locked) return null;
                    const gid = s.seminar.guideId || settings.guideAssignments?.[s.id];
                    return { s, locked, guide: guideMap[gid], lockedAt: s.seminar.topicsLockedAt };
                })
                .filter(Boolean)
                .sort((a, b) => (a.guide?.name || '').localeCompare(b.guide?.name || '') || a.s.name.localeCompare(b.s.name));

            const unlockedRows = students
                .filter(s => !getLockedTopic(s.seminar))
                .map(s => ({ s }))
                .sort((a, b) => a.s.name.localeCompare(b.s.name));

            const tableRows = lockedRows.length
                ? lockedRows.map((r, idx) => `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.guide?.name || '—')}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.locked.title)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.locked.description || '—')}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${r.lockedAt ? escapeHtml(new Date(r.lockedAt).toLocaleDateString('en-IN')) : '—'}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #6b7280;">No topics locked yet.</td></tr>`;

            const unlockedTableRows = unlockedRows.length
                ? unlockedRows.map((r, idx) => `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#fffbeb'};">
                        <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="3" style="padding: 14px; text-align: center; color: #059669; font-size: 12px;">All students have a locked final topic.</td></tr>`;

            const body = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; gap: 8px;">
                        <div style="display: flex; padding: 10px 14px; background: #ecfdf5; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 200px; font-size: 13px;">Students with locked topic:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${lockedRows.length}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #fffbeb; border-radius: 8px; border-left: 3px solid #d97706;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 200px; font-size: 13px;">Not yet locked:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${unlockedRows.length}</span>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-after: always;">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: #1f2937; border-left: 4px solid #d97706; padding-left: 12px;">Students whose topics are not locked yet</h3>
                    <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 0 0 14px 16px;">Guide has not locked a final topic for these students</p>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #fde68a; width: 8%;">#</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Student</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a; width: 28%;">KTU ID</th>
                            </tr>
                        </thead>
                        <tbody>${unlockedTableRows}</tbody>
                    </table>
                </div>

                <div style="margin-bottom: 20px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #6366f1; padding-left: 12px;">Locked Final Topics</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb;">#</th>
                                <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student</th>
                                <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">KTU ID</th>
                                <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide</th>
                                <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Final topic</th>
                                <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Description</th>
                                <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Locked on</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('Locked Topics Report', body);
        },

        async generateSeminarTopicSubmissionsReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarTopicSubmissionsReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Topic Submissions Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating topic submissions report. Please allow popups and try again.');
            }
        },

        async generateSeminarTopicApprovalsReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarTopicApprovalsReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Guide Topic Approvals Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating topic approvals report. Please allow popups and try again.');
            }
        },

        async generateSeminarLockedTopicsReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarLockedTopicsReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Locked Topics Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating locked topics report. Please allow popups and try again.');
            }
        },

        paperTypeLabel(type) {
            return PAPER_TYPE_LABELS[type] || 'Resource';
        },

        buildSeminarPaperUploadsReportHtml(students, settings, guideMap) {
            let totalPapers = 0;
            let studentsWithPapers = 0;
            const noPapers = [];

            const sections = students.map(s => {
                const papers = s.seminar.papers || [];
                if (papers.length) studentsWithPapers += 1;
                else noPapers.push(s);
                totalPapers += papers.length;

                const gid = s.seminar.guideId || settings.guideAssignments?.[s.id];
                const guide = guideMap[gid];
                const locked = getLockedTopic(s.seminar);

                const rows = papers.length
                    ? papers.map((p, idx) => {
                        const status = normalizePaperStatus(p.status);
                        return `
                        <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                            <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(p.title || 'Untitled')}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(this.paperTypeLabel(p.type))}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb; word-break: break-all;">${escapeHtml(p.url || '—')}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(statusBadge(status))}</td>
                            <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${p.submittedAt ? escapeHtml(new Date(p.submittedAt).toLocaleDateString('en-IN')) : '—'}</td>
                        </tr>`;
                    }).join('')
                    : `<tr><td colspan="6" style="padding: 12px; text-align: center; color: #6b7280; font-size: 12px;">No reference papers uploaded</td></tr>`;

                return `
                    <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-inside: avoid;">
                        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 16px; font-weight: 700; margin: 0 0 6px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">
                            ${escapeHtml(s.name)} <span style="font-weight: 500; color: #6b7280; font-size: 13px;">(${escapeHtml(s.ktuid)})</span>
                        </h3>
                        <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 0 0 12px 16px;">
                            Guide: ${escapeHtml(guide?.name || '—')} · Papers: ${papers.length}
                            · Final topic: ${escapeHtml(locked?.title || 'Not locked')}
                        </p>
                        <table style="width: 100%; border-collapse: separate; border-spacing: 0;">
                            <thead>
                                <tr>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb; width: 5%;">#</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 20%;">Title</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 12%;">Type</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Link</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 12%;">Status</th>
                                    <th style="padding: 8px 12px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 12%;">Submitted</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            }).join('');

            noPapers.sort((a, b) => a.name.localeCompare(b.name));
            const noPaperRows = noPapers.length
                ? noPapers.map((s, idx) => {
                    const gid = s.seminar.guideId || settings.guideAssignments?.[s.id];
                    const guide = guideMap[gid];
                    const locked = getLockedTopic(s.seminar);
                    return `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#fffbeb'};">
                        <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.name)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(s.ktuid)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(guide?.name || '—')}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(locked?.title || 'Not locked')}</td>
                    </tr>`;
                }).join('')
                : `<tr><td colspan="5" style="padding: 14px; text-align: center; color: #059669; font-size: 12px;">All students have uploaded at least one reference paper.</td></tr>`;

            const summary = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; gap: 8px;">
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">Students:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${students.length}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">With paper uploads:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${studentsWithPapers}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">Total reference papers:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${totalPapers}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #fffbeb; border-radius: 8px; border-left: 3px solid #d97706;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">No uploads yet:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #b45309; font-size: 13px;">${noPapers.length}</span>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: #1f2937; border-left: 4px solid #d97706; padding-left: 12px;">Students with no reference paper uploads</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #fde68a; width: 6%;">#</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Student</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a; width: 14%;">KTU ID</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a; width: 22%;">Guide</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Final topic</th>
                            </tr>
                        </thead>
                        <tbody>${noPaperRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('Reference Paper Uploads Report', summary + sections);
        },

        buildSeminarPaperVerificationsReportHtml(students, settings, guideMap) {
            let approved = 0;
            let rejected = 0;
            let pending = 0;
            let revision = 0;
            const rows = [];

            students.forEach(s => {
                const gid = s.seminar.guideId || settings.guideAssignments?.[s.id];
                const guide = guideMap[gid];
                (s.seminar.papers || []).forEach(p => {
                    const status = normalizePaperStatus(p.status);
                    if (status === 'approved') approved += 1;
                    else if (status === 'rejected') rejected += 1;
                    else if (status === 'needs_revision') revision += 1;
                    else pending += 1;
                    rows.push({ s, p, guide, status });
                });
            });

            rows.sort((a, b) =>
                (a.guide?.name || '').localeCompare(b.guide?.name || '') ||
                a.s.name.localeCompare(b.s.name) ||
                (a.p.title || '').localeCompare(b.p.title || '')
            );

            const tableRows = rows.length
                ? rows.map((r, idx) => {
                    const decisionLabel = r.status === 'needs_revision' ? 'Open for upload' : statusBadge(r.status);
                    return `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 8px 10px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.guide?.name || '—')}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.p.title || 'Untitled')}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${escapeHtml(decisionLabel)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.p.guideFeedback || '—')}</td>
                    </tr>`;
                }).join('')
                : `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #6b7280;">No reference papers found.</td></tr>`;

            const body = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                        <div style="padding: 12px; background: #ecfdf5; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #059669;">${approved}</div><div style="font-size: 11px; color: #047857;">Approved</div></div>
                        <div style="padding: 12px; background: #fef2f2; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #dc2626;">${rejected}</div><div style="font-size: 11px; color: #b91c1c;">Rejected</div></div>
                        <div style="padding: 12px; background: #eff6ff; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #2563eb;">${pending}</div><div style="font-size: 11px; color: #1d4ed8;">Pending</div></div>
                        <div style="padding: 12px; background: #fffbeb; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #d97706;">${revision}</div><div style="font-size: 11px; color: #b45309;">Open for upload</div></div>
                    </div>
                    <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 12px 0 0 0;">Total papers: ${rows.length}</p>
                </div>
                <div style="margin-bottom: 20px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">Guide Paper Verifications</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb;">#</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">KTU ID</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Paper</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Decision</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide comment</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('Guide Paper Verifications Report', body);
        },

        async generateSeminarPaperUploadsReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarPaperUploadsReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Reference Paper Uploads Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating paper uploads report. Please allow popups and try again.');
            }
        },

        async generateSeminarPaperVerificationsReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarPaperVerificationsReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Guide Paper Verifications Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating paper verifications report. Please allow popups and try again.');
            }
        },

        buildSeminarTitleAbstractSubmissionsReportHtml(students, settings, guideMap) {
            let submittedCount = 0;
            const notSubmitted = [];

            const sections = students.map(s => {
                const ta = ensureTitleAbstract(s.seminar);
                const status = normalizePaperStatus(ta.status);
                const hasSubmission = hasTitleAbstractSubmission(ta);
                const locked = getLockedTopic(s.seminar);

                if (hasSubmission) submittedCount += 1;
                else notSubmitted.push({ s, locked });

                if (!hasSubmission) {
                    return `
                    <div style="margin-bottom: 16px; padding: 16px 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-inside: avoid;">
                        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 15px; font-weight: 700; margin: 0 0 4px 0; color: #1f2937; border-left: 4px solid #d97706; padding-left: 12px;">
                            ${escapeHtml(s.name)} <span style="font-weight: 500; color: #6b7280; font-size: 12px;">(${escapeHtml(s.ktuid)})</span>
                        </h3>
                        <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 0 0 0 16px;">
                            Final topic: ${escapeHtml(locked?.title || 'Not locked')} · <strong style="color:#b45309;">Not submitted</strong>
                        </p>
                    </div>`;
                }

                return `
                    <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-inside: avoid;">
                        <h3 style="font-family: 'Montserrat', sans-serif; font-size: 16px; font-weight: 700; margin: 0 0 6px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">
                            ${escapeHtml(s.name)} <span style="font-weight: 500; color: #6b7280; font-size: 13px;">(${escapeHtml(s.ktuid)})</span>
                        </h3>
                        <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 0 0 12px 16px;">
                            Final topic: ${escapeHtml(locked?.title || 'Not locked')}
                            · Status: <strong>${escapeHtml(statusBadge(status))}</strong>
                            · Submitted: ${ta.submittedAt ? escapeHtml(new Date(ta.submittedAt).toLocaleDateString('en-IN')) : '—'}
                        </p>
                        <div style="padding: 12px 14px; background: #f8fafc; border-radius: 8px; margin-bottom: 10px;">
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 4px;">Title</div>
                            <div style="font-family: 'Lato', sans-serif; font-size: 14px; font-weight: 600; color: #1f2937;">${escapeHtml(ta.title || '—')}</div>
                        </div>
                        <div style="padding: 12px 14px; background: #f8fafc; border-radius: 8px;">
                            <div style="font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 4px;">Abstract</div>
                            <div style="font-family: 'Lato', sans-serif; font-size: 13px; color: #1f2937; white-space: pre-wrap;">${escapeHtml(ta.abstract || '—')}</div>
                        </div>
                        ${ta.guideFeedback ? `
                            <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #4b5563; margin: 10px 0 0 0;">
                                <strong>Guide comment:</strong> ${escapeHtml(ta.guideFeedback)}
                            </p>
                        ` : ''}
                    </div>
                `;
            }).join('');

            notSubmitted.sort((a, b) => a.s.name.localeCompare(b.s.name));
            const notSubmittedRows = notSubmitted.length
                ? notSubmitted.map((r, idx) => `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#fffbeb'};">
                        <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.locked?.title || 'Not locked')}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="4" style="padding: 14px; text-align: center; color: #059669; font-size: 12px;">All students have submitted title and abstract.</td></tr>`;

            const summary = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; gap: 8px;">
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">Students:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${students.length}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #059669;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">With title &amp; abstract:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #1f2937; font-size: 13px;">${submittedCount}</span>
                        </div>
                        <div style="display: flex; padding: 10px 14px; background: #fffbeb; border-radius: 8px; border-left: 3px solid #d97706;">
                            <span style="font-family: 'Montserrat', sans-serif; font-weight: 600; color: #4b5563; min-width: 220px; font-size: 13px;">Not submitted yet:</span>
                            <span style="font-family: 'Lato', sans-serif; font-weight: 600; color: #b45309; font-size: 13px;">${notSubmitted.length}</span>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-after: always;">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: #1f2937; border-left: 4px solid #d97706; padding-left: 12px;">Students with no title &amp; abstract submission</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #fde68a; width: 8%;">#</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Student</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a; width: 18%;">KTU ID</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Final topic</th>
                            </tr>
                        </thead>
                        <tbody>${notSubmittedRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('Title & Abstract Submissions Report', summary + sections);
        },

        buildSeminarTitleAbstractVerificationsReportHtml(students, settings, guideMap) {
            let approved = 0;
            let rejected = 0;
            let pending = 0;
            let revision = 0;
            let draft = 0;
            const rows = [];

            students.forEach(s => {
                const ta = ensureTitleAbstract(s.seminar);
                const status = normalizePaperStatus(ta.status);

                if (!hasTitleAbstractSubmission(ta) && status === 'draft') {
                    draft += 1;
                    return;
                }

                if (status === 'approved') approved += 1;
                else if (status === 'rejected') rejected += 1;
                else if (status === 'needs_revision') revision += 1;
                else pending += 1;

                rows.push({ s, ta, status });
            });

            rows.sort((a, b) => a.s.name.localeCompare(b.s.name));

            const tableRows = rows.length
                ? rows.map((r, idx) => {
                    const decisionLabel = r.status === 'needs_revision' ? 'Needs edit' : statusBadge(r.status);
                    return `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 8px 10px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.ta.title || '—')}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb; max-width: 240px;">${escapeHtml((r.ta.abstract || '').length > 120 ? `${r.ta.abstract.slice(0, 120)}…` : (r.ta.abstract || '—'))}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${escapeHtml(decisionLabel)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.ta.guideFeedback || '—')}</td>
                    </tr>`;
                }).join('')
                : `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #6b7280;">No title &amp; abstract submissions found.</td></tr>`;

            const body = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                        <div style="padding: 12px; background: #ecfdf5; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #059669;">${approved}</div><div style="font-size: 11px; color: #047857;">Approved</div></div>
                        <div style="padding: 12px; background: #fef2f2; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #dc2626;">${rejected}</div><div style="font-size: 11px; color: #b91c1c;">Rejected</div></div>
                        <div style="padding: 12px; background: #eff6ff; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #2563eb;">${pending}</div><div style="font-size: 11px; color: #1d4ed8;">Pending</div></div>
                        <div style="padding: 12px; background: #fffbeb; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #d97706;">${revision}</div><div style="font-size: 11px; color: #b45309;">Needs edit</div></div>
                    </div>
                    <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 12px 0 0 0;">
                        Submissions in report: ${rows.length}${draft ? ` · Not submitted yet: ${draft}` : ''}
                    </p>
                </div>
                <div style="margin-bottom: 20px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">Title &amp; Abstract Verifications</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb;">#</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">KTU ID</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Title</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Abstract</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Decision</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide comment</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('Guide Title & Abstract Verifications Report', body);
        },

        buildSeminarPptStatusReportHtml(students, settings, guideMap) {
            let uploaded = 0;
            let approved = 0;
            let rejected = 0;
            let pending = 0;
            let revision = 0;
            const notUploaded = [];
            const rows = [];

            students.forEach(s => {
                const ppt = ensureSeminarPpt(s.seminar);
                const status = normalizePaperStatus(ppt.status);
                const locked = getLockedTopic(s.seminar);
                const hasUpload = hasPptSubmission(ppt);

                if (!hasUpload) {
                    notUploaded.push({ s, locked });
                    return;
                }

                uploaded += 1;
                if (status === 'approved') approved += 1;
                else if (status === 'rejected') rejected += 1;
                else if (status === 'needs_revision') revision += 1;
                else pending += 1;

                rows.push({ s, ppt, status, locked });
            });

            notUploaded.sort((a, b) => a.s.name.localeCompare(b.s.name));
            rows.sort((a, b) => a.s.name.localeCompare(b.s.name));

            const notUploadedRows = notUploaded.length
                ? notUploaded.map((r, idx) => `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#fffbeb'};">
                        <td style="padding: 8px 12px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 12px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.locked?.title || 'Not locked')}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="4" style="padding: 14px; text-align: center; color: #059669; font-size: 12px;">All students have uploaded a PPT link.</td></tr>`;

            const tableRows = rows.length
                ? rows.map((r, idx) => {
                    const decisionLabel = r.status === 'needs_revision' ? 'Needs edit' : statusBadge(r.status);
                    return `
                    <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding: 8px 10px; text-align: center; color: #4b5563; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.name)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.s.ktuid)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.ppt.title || 'Presentation')}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${escapeHtml(decisionLabel)}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${r.ppt.submittedAt ? escapeHtml(new Date(r.ppt.submittedAt).toLocaleDateString('en-IN')) : '—'}</td>
                        <td style="padding: 8px 10px; color: #1f2937; font-family: 'Lato', sans-serif; font-size: 11px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(r.ppt.guideFeedback || '—')}</td>
                    </tr>`;
                }).join('')
                : `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #6b7280;">No PPT uploads found.</td></tr>`;

            const body = `
                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #059669; padding-left: 12px;">Summary</h3>
                    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;">
                        <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #1f2937;">${uploaded}</div><div style="font-size: 11px; color: #4b5563;">Uploaded</div></div>
                        <div style="padding: 12px; background: #ecfdf5; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #059669;">${approved}</div><div style="font-size: 11px; color: #047857;">Approved</div></div>
                        <div style="padding: 12px; background: #fef2f2; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #dc2626;">${rejected}</div><div style="font-size: 11px; color: #b91c1c;">Rejected</div></div>
                        <div style="padding: 12px; background: #eff6ff; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #2563eb;">${pending}</div><div style="font-size: 11px; color: #1d4ed8;">Pending</div></div>
                        <div style="padding: 12px; background: #fffbeb; border-radius: 8px; text-align: center;"><div style="font-size: 20px; font-weight: 700; color: #d97706;">${revision}</div><div style="font-size: 11px; color: #b45309;">Needs edit</div></div>
                    </div>
                    <p style="font-family: 'Lato', sans-serif; font-size: 12px; color: #6b7280; margin: 12px 0 0 0;">Not uploaded yet: ${notUploaded.length}</p>
                </div>

                <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06); page-break-after: always;">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: #1f2937; border-left: 4px solid #d97706; padding-left: 12px;">Students with no PPT upload</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #fde68a; width: 8%;">#</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Student</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a; width: 18%;">KTU ID</th>
                                <th style="padding: 8px 12px; background: #fffbeb; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #fde68a;">Final topic</th>
                            </tr>
                        </thead>
                        <tbody>${notUploadedRows}</tbody>
                    </table>
                </div>

                <div style="margin-bottom: 20px; padding: 20px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); border: 1px solid rgba(0, 0, 0, 0.06);">
                    <h3 style="font-family: 'Montserrat', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 14px 0; color: #1f2937; border-left: 4px solid #0284c7; padding-left: 12px;">PPT Upload Status</h3>
                    <table style="width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0, 0, 0, 0.06);">
                        <thead>
                            <tr>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: center; border-bottom: 2px solid #e5e7eb;">#</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Student</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">KTU ID</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">PPT title</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Status</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Submitted</th>
                                <th style="padding: 8px 10px; background: #f8fafc; color: #1f2937; font-weight: 700; font-family: 'Montserrat', sans-serif; font-size: 11px; text-align: left; border-bottom: 2px solid #e5e7eb;">Guide comment</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;

            return this.seminarReportShell('PPT Upload Status Report', body);
        },

        async generateSeminarTitleAbstractSubmissionsReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarTitleAbstractSubmissionsReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Title & Abstract Submissions Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating title & abstract submissions report. Please allow popups and try again.');
            }
        },

        async generateSeminarTitleAbstractVerificationsReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarTitleAbstractVerificationsReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'Guide Title & Abstract Verifications Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating title & abstract verifications report. Please allow popups and try again.');
            }
        },

        async generateSeminarPptStatusReport() {
            try {
                const { settings, students, guideMap } = await this.getSeminarTopicReportContext();
                const html = this.buildSeminarPptStatusReportHtml(students, settings, guideMap);
                await app.generatePDFReport(html, { groupName: 'Seminar' }, { name: 'PPT Upload Status Report' });
            } catch (error) {
                console.error(error);
                alert('Error generating PPT upload status report. Please allow popups and try again.');
            }
        }
    };
}
