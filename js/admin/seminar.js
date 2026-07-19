// Seminar — admin module
import { escapeHtml } from '../utils/helpers.js';
import {
    doc, getDoc, setDoc, collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    SEMINAR_SCHEDULE_FIELDS,
    DEFAULT_PRESENTER_PARAMS,
    DEFAULT_QUESTIONER_PARAMS,
    getDefaultSeminarSettings,
    getDefaultSeminar,
    ensureSeminarTopics,
    getLockedTopic,
    getSeminarDisplayTopic,
    formatPresentationSlot,
    formatTime12h,
    statusBadge,
    MIN_SEMINAR_TOPICS,
    normalizePaperStatus,
    pickFairQuestioners,
    updateFairnessAfterPick,
    sumParamScores,
    equallyAllotGuidesToStudents,
    buildSeminarGuideAllotmentGroups
} from '../utils/seminarConfig.js';

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
                    scoringParams: {
                        presenter: data.scoringParams?.presenter?.length ? data.scoringParams.presenter : defaults.scoringParams.presenter,
                        questioner: data.scoringParams?.questioner?.length ? data.scoringParams.questioner : defaults.scoringParams.questioner
                    },
                    guideAssignments: data.guideAssignments || {},
                    presentationAssignments: data.presentationAssignments || {},
                    presentationSlots: data.presentationSlots || [],
                    presentations: data.presentations || [],
                    questionFairness: data.questionFairness || {},
                    questionSettings: data.questionSettings || defaults.questionSettings
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
            this.bindSeminarAdminTabs();
            this.setupSeminarAdminSearch();
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
                    const id = tab.dataset.tab;
                    document.querySelectorAll('.seminar-admin-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.seminar-admin-panel').forEach(p => p.classList.remove('active'));
                    tab.classList.add('active');
                    const panel = document.getElementById(`seminar-admin-${id}`);
                    if (panel) panel.classList.add('active');
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

        renderSeminarScoringParams(settings) {
            const presEl = document.getElementById('seminar-scoring-presenter');
            const qEl = document.getElementById('seminar-scoring-questioner');
            const qCount = document.getElementById('seminar-questions-per-pres');
            if (qCount) qCount.value = settings.questionSettings?.questionsPerPresentation ?? 3;

            const renderParams = (params, container) => {
                if (!container) return;
                container.innerHTML = params.map((p, i) => `
                    <div class="seminar-param-row" data-param-id="${escapeHtml(p.id)}">
                        <input type="text" class="form-input seminar-param-label" data-idx="${i}" value="${escapeHtml(p.label)}" placeholder="Parameter name">
                        <input type="number" class="form-input seminar-param-max" data-idx="${i}" min="1" max="100" value="${p.maxMarks}" style="width:80px;">
                        <input type="text" class="form-input seminar-param-desc" data-idx="${i}" value="${escapeHtml(p.description || '')}" placeholder="Description">
                    </div>
                `).join('');
            };
            renderParams(settings.scoringParams.presenter, presEl);
            renderParams(settings.scoringParams.questioner, qEl);
        },

        collectScoringParams(container) {
            if (!container) return [];
            const rows = container.querySelectorAll('.seminar-param-row');
            return [...rows].map((row, i) => ({
                id: row.dataset.paramId || `p_${i}`,
                label: row.querySelector('.seminar-param-label')?.value.trim() || `Param ${i + 1}`,
                maxMarks: parseInt(row.querySelector('.seminar-param-max')?.value, 10) || 5,
                description: row.querySelector('.seminar-param-desc')?.value.trim() || ''
            }));
        },

        async saveSeminarScoringParams() {
            const presenter = this.collectScoringParams(document.getElementById('seminar-scoring-presenter'));
            const questioner = this.collectScoringParams(document.getElementById('seminar-scoring-questioner'));
            const questionsPerPresentation = parseInt(document.getElementById('seminar-questions-per-pres')?.value, 10) || 3;
            await this.saveSeminarSettings({
                scoringParams: { presenter, questioner },
                questionSettings: { questionsPerPresentation }
            });
            alert('Scoring parameters saved.');
            await this.loadSeminarAdmin();
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

        async fetchSeminarStudents() {
            const usersSnap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'student')));
            const students = [];
            for (const userDoc of usersSnap.docs) {
                const u = userDoc.data();
                const dataSnap = await getDoc(doc(window.firebaseDb, 'userData', userDoc.id));
                const userData = dataSnap.exists() ? dataSnap.data() : {};
                const seminar = userData.seminar || getDefaultSeminar();
                ensureSeminarTopics(seminar);
                students.push({
                    id: userDoc.id,
                    name: u.name || u.username || 'Unknown',
                    ktuid: u.username || '',
                    seminar,
                    userData
                });
            }
            return students;
        },

        async fetchGuides() {
            const snap = await getDocs(query(collection(window.firebaseDb, 'users'), where('role', '==', 'guide')));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
            const settings = await this.getSeminarSettings();
            const slots = settings.presentationSlots || [];
            if (!slots.length) { alert('Add presentation slots first.'); return; }

            const students = await this.fetchSeminarStudents();
            if (!students.length) { alert('No students.'); return; }
            if (!confirm(`Randomly assign ${slots.length} slot(s) to ${students.length} students?`)) return;

            const shuffledStudents = [...students].sort(() => Math.random() - 0.5);
            const shuffledSlots = [...slots].sort(() => Math.random() - 0.5);
            const presentationAssignments = {};
            const presentations = [];
            const now = new Date().toISOString();

            for (let i = 0; i < shuffledStudents.length; i++) {
                const slot = shuffledSlots[i % shuffledSlots.length];
                const sid = shuffledStudents[i].id;
                presentationAssignments[sid] = slot.id;
                presentations.push({
                    id: `pres_${sid}_${Date.now()}`,
                    studentId: sid,
                    slotId: slot.id,
                    status: 'scheduled',
                    questionerIds: [],
                    questionerScores: {},
                    presenterScores: {},
                    presentationIndex: i
                });
                const ref = doc(window.firebaseDb, 'userData', sid);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                if (!data.seminar) data.seminar = getDefaultSeminar();
                data.seminar.presentationSlotId = slot.id;
                await setDoc(ref, { seminar: data.seminar }, { merge: true });
            }

            await this.saveSeminarSettings({
                presentationAssignments,
                presentations,
                presentationAllottedAt: now,
                questionFairness: {}
            });
            alert('Presentation slots randomly assigned.');
            await this.loadSeminarAdmin();
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
                const gid = sem.guideId || settings.guideAssignments[s.id];
                const slotId = sem.presentationSlotId || settings.presentationAssignments[s.id];
                const slot = slotMap[slotId];
                const pres = (settings.presentations || []).find(p => p.studentId === s.id);
                const presScore = pres ? sumParamScores(pres.presenterScores, settings.scoringParams.presenter) : 0;
                const qScore = sem.totals?.questionMarks || 0;
                const locked = getLockedTopic(sem);
                const displayTopic = getSeminarDisplayTopic(sem);
                const topicCount = (sem.topics || []).length;
                const approvedCount = (sem.topics || []).filter(t => t.status === 'approved').length;
                const topicLabel = locked
                    ? locked.title
                    : (displayTopic?.title || '—');
                const topicStatus = locked
                    ? 'Locked (final)'
                    : (topicCount ? `${topicCount} submitted, ${approvedCount} approved` : 'No topics');

                return `
                    <div class="forge-lab-admin-student-card" data-name="${escapeHtml(s.name.toLowerCase())}" data-ktuid="${escapeHtml(s.ktuid.toLowerCase())}">
                        <h4>${escapeHtml(s.name)} <small>(${escapeHtml(s.ktuid)})</small></h4>
                        <p><strong>Guide:</strong> ${gid ? escapeHtml(guideMap[gid] || gid) : '—'}</p>
                        <p><strong>Topic:</strong> ${escapeHtml(topicLabel)} <span class="badge">${escapeHtml(topicStatus)}</span></p>
                        <p><strong>Papers:</strong> ${(sem.papers || []).length} · <strong>Presentation:</strong> ${slot ? escapeHtml(formatPresentationSlot(slot)) : '—'}</p>
                        <p><strong>Scores:</strong> Presentation ${presScore} + Questions ${qScore} = <strong>${presScore + qScore}</strong></p>
                        ${pres ? `
                            <button type="button" class="btn btn-sm btn-primary" onclick="app.openSeminarEvaluation('${escapeHtml(s.id)}')">
                                <i class="fas fa-clipboard-check"></i> ${pres.status === 'completed' ? 'View / edit scores' : 'Evaluate presentation'}
                            </button>
                        ` : ''}
                    </div>`;
            }).join('');
        },

        async openSeminarEvaluation(studentId) {
            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents();
            const student = students.find(s => s.id === studentId);
            if (!student) return;
            const pres = (settings.presentations || []).find(p => p.studentId === studentId);
            if (!pres) { alert('No presentation record for this student.'); return; }

            const modal = document.getElementById('seminar-eval-modal');
            const body = document.getElementById('seminar-eval-body');
            if (!modal || !body) return;

            const allIds = students.map(s => s.id).filter(id => id !== studentId);
            const already = pres.questionerIds || [];
            const need = (settings.questionSettings?.questionsPerPresentation || 3) - already.length;
            const eligible = allIds.filter(id => !already.includes(id));

            const presenterFields = (settings.scoringParams.presenter || []).map(p => `
                <div class="form-group">
                    <label>${escapeHtml(p.label)} (max ${p.maxMarks})</label>
                    <input type="number" class="form-input seminar-pres-score" data-param="${p.id}" min="0" max="${p.maxMarks}"
                        value="${pres.presenterScores?.[p.id] ?? ''}">
                </div>
            `).join('');

            const questionerSection = already.map((qid, idx) => {
                const qs = students.find(s => s.id === qid);
                const qParams = settings.scoringParams.questioner || [];
                const fields = qParams.map(p => `
                    <label>${escapeHtml(p.label)} (max ${p.maxMarks})</label>
                    <input type="number" class="form-input seminar-q-score" data-qid="${qid}" data-param="${p.id}"
                        min="0" max="${p.maxMarks}" value="${pres.questionerScores?.[qid]?.[p.id] ?? ''}">
                `).join('');
                return `<div class="seminar-q-eval-block"><strong>${escapeHtml(qs?.name || qid)}</strong>${fields}</div>`;
            }).join('');

            body.innerHTML = `
                <input type="hidden" id="seminar-eval-student-id" value="${escapeHtml(studentId)}">
                <input type="hidden" id="seminar-eval-pres-id" value="${escapeHtml(pres.id)}">
                <h4>Presenter: ${escapeHtml(student.name)}</h4>
                <p><strong>Topic:</strong> ${escapeHtml(getSeminarDisplayTopic(student.seminar)?.title || '—')}</p>
                <h5>Presenter scores</h5>${presenterFields}
                <h5 style="margin-top:1rem;">Question askers</h5>
                <div id="seminar-eval-questioners">${questionerSection || '<p class="form-hint">No questioners picked yet.</p>'}</div>
                ${need > 0 && eligible.length ? `
                    <button type="button" class="btn btn-secondary" onclick="app.pickSeminarQuestioners()">
                        <i class="fas fa-random"></i> Pick ${need} questioner(s) fairly
                    </button>
                    <div id="seminar-picked-names" class="form-hint"></div>
                ` : ''}
                <div style="margin-top:1rem;">
                    <button type="button" class="btn btn-primary" onclick="app.saveSeminarEvaluation()">Save scores</button>
                    <button type="button" class="btn btn-secondary" onclick="app.closeSeminarEvalModal()">Cancel</button>
                </div>
            `;
            app._seminarEvalPicked = [];
            modal.style.display = 'flex';
        },

        async pickSeminarQuestioners() {
            const studentId = document.getElementById('seminar-eval-student-id')?.value;
            const presId = document.getElementById('seminar-eval-pres-id')?.value;
            const settings = await this.getSeminarSettings();
            const pres = settings.presentations.find(p => p.id === presId);
            const students = await this.fetchSeminarStudents();
            const allIds = students.map(s => s.id).filter(id => id !== studentId);
            const already = [...(pres?.questionerIds || []), ...(app._seminarEvalPicked || [])];
            const need = (settings.questionSettings?.questionsPerPresentation || 3) - already.length;
            const eligible = allIds.filter(id => !already.includes(id));
            const picked = pickFairQuestioners(eligible, settings.questionFairness, pres?.presentationIndex ?? 0, need);
            app._seminarEvalPicked = [...(app._seminarEvalPicked || []), ...picked];

            const names = picked.map(id => students.find(s => s.id === id)?.name || id).join(', ');
            const el = document.getElementById('seminar-picked-names');
            if (el) el.innerHTML = `<strong>Call on:</strong> ${escapeHtml(names)}`;

            const container = document.getElementById('seminar-eval-questioners');
            const qParams = settings.scoringParams.questioner || [];
            if (container) {
                const empty = container.querySelector('.form-hint');
                if (empty && !container.querySelector('.seminar-q-eval-block')) empty.remove();
                picked.forEach(qid => {
                    if (container.querySelector(`.seminar-q-score[data-qid="${qid}"]`)) return;
                    const qs = students.find(s => s.id === qid);
                    const fields = qParams.map(p => `
                        <label>${escapeHtml(p.label)} (max ${p.maxMarks})</label>
                        <input type="number" class="form-input seminar-q-score" data-qid="${qid}" data-param="${p.id}"
                            min="0" max="${p.maxMarks}" value="">
                    `).join('');
                    container.insertAdjacentHTML('beforeend',
                        `<div class="seminar-q-eval-block"><strong>${escapeHtml(qs?.name || qid)}</strong> <span class="badge">New</span>${fields}</div>`
                    );
                });
            }

            const stillNeed = (settings.questionSettings?.questionsPerPresentation || 3) - already.length - picked.length;
            const pickBtn = document.querySelector('#seminar-eval-body button[onclick="app.pickSeminarQuestioners()"]');
            if (pickBtn && stillNeed <= 0) pickBtn.style.display = 'none';
        },

        closeSeminarEvalModal() {
            const modal = document.getElementById('seminar-eval-modal');
            if (modal) modal.style.display = 'none';
            app._seminarEvalPicked = [];
        },

        async saveSeminarEvaluation() {
            const studentId = document.getElementById('seminar-eval-student-id')?.value;
            const presId = document.getElementById('seminar-eval-pres-id')?.value;
            const settings = await this.getSeminarSettings();
            const presIdx = settings.presentations.findIndex(p => p.id === presId);
            if (presIdx < 0) return;

            const pres = { ...settings.presentations[presIdx] };
            pres.presenterScores = {};
            document.querySelectorAll('.seminar-pres-score').forEach(inp => {
                pres.presenterScores[inp.dataset.param] = parseFloat(inp.value) || 0;
            });

            if (!pres.questionerScores) pres.questionerScores = {};
            const newPickers = app._seminarEvalPicked || [];
            pres.questionerIds = [...new Set([...(pres.questionerIds || []), ...newPickers])];

            document.querySelectorAll('.seminar-q-score').forEach(inp => {
                const qid = inp.dataset.qid;
                if (!pres.questionerScores[qid]) pres.questionerScores[qid] = {};
                pres.questionerScores[qid][inp.dataset.param] = parseFloat(inp.value) || 0;
            });

            for (const qid of newPickers) {
                if (!pres.questionerScores[qid]) pres.questionerScores[qid] = {};
            }

            const qPerPres = settings.questionSettings?.questionsPerPresentation || 3;
            if (pres.questionerIds.length >= qPerPres) {
                pres.status = 'completed';
            }
            pres.evaluatedAt = new Date().toISOString();

            const presentations = [...settings.presentations];
            presentations[presIdx] = pres;

            let fairness = settings.questionFairness || {};
            if (newPickers.length) {
                fairness = updateFairnessAfterPick(fairness, newPickers, pres.presentationIndex ?? presIdx);
            }

            const presenterTotal = sumParamScores(pres.presenterScores, settings.scoringParams.presenter);
            const presenterRef = doc(window.firebaseDb, 'userData', studentId);
            const presenterSnap = await getDoc(presenterRef);
            const presenterData = presenterSnap.exists() ? presenterSnap.data() : {};
            if (!presenterData.seminar) presenterData.seminar = getDefaultSeminar();
            presenterData.seminar.totals = presenterData.seminar.totals || {};
            presenterData.seminar.totals.presentationMarks = presenterTotal;
            await setDoc(presenterRef, { seminar: presenterData.seminar }, { merge: true });

            await this.recalculateSeminarQuestionTotals(settings, presentations);

            await this.saveSeminarSettings({ presentations, questionFairness: fairness });
            this.closeSeminarEvalModal();
            alert('Evaluation saved.');
            await this.loadSeminarAdmin();
        },

        async recalculateSeminarQuestionTotals(settings, presentations) {
            const students = await this.fetchSeminarStudents();
            const qParams = settings.scoringParams.questioner || [];
            const evaluatedAt = new Date().toISOString();

            for (const s of students) {
                let total = 0;
                const history = [];
                for (const pres of presentations) {
                    const scores = pres.questionerScores?.[s.id];
                    if (!scores || !Object.keys(scores).length) continue;
                    const marks = sumParamScores(scores, qParams);
                    if (marks <= 0) continue;
                    total += marks;
                    history.push({
                        presentationId: pres.id,
                        presenterId: pres.studentId,
                        marks,
                        at: pres.evaluatedAt || evaluatedAt
                    });
                }
                const ref = doc(window.firebaseDb, 'userData', s.id);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : {};
                if (!data.seminar) data.seminar = getDefaultSeminar();
                data.seminar.totals = data.seminar.totals || { presentationMarks: 0, questionMarks: 0 };
                data.seminar.totals.questionMarks = total;
                data.seminar.questionHistory = history;
                await setDoc(ref, { seminar: data.seminar }, { merge: true });
            }
        },

        async generateSeminarReport() {
            const settings = await this.getSeminarSettings();
            const students = await this.fetchSeminarStudents();
            const guides = await this.fetchGuides();
            const guideMap = Object.fromEntries(guides.map(g => [g.id, g.name]));

            let csv = 'Name,KTU ID,Guide,Topic,Topic Status,Papers,Presentation Slot,Presentation Score,Question Score,Total\n';
            for (const s of students) {
                const sem = s.seminar;
                const gid = sem.guideId || settings.guideAssignments[s.id];
                const slotId = sem.presentationSlotId || settings.presentationAssignments[s.id];
                const slot = (settings.presentationSlots || []).find(sl => sl.id === slotId);
                const pres = (settings.presentations || []).find(p => p.studentId === s.id);
                const pScore = pres ? sumParamScores(pres.presenterScores, settings.scoringParams.presenter) : 0;
                const qScore = sem.totals?.questionMarks || 0;
                const displayTopic = getSeminarDisplayTopic(sem);
                const locked = getLockedTopic(sem);
                const row = [
                    s.name, s.ktuid, guideMap[gid] || '',
                    (displayTopic?.title || '').replace(/,/g, ';'),
                    locked ? 'locked' : (displayTopic?.status || ''),
                    (sem.papers || []).length,
                    slot ? formatPresentationSlot(slot).replace(/,/g, ';') : '',
                    pScore, qScore, pScore + qScore
                ];
                csv += row.map(c => `"${c}"`).join(',') + '\n';
            }

            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `seminar-report-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
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
        }
    };
}
