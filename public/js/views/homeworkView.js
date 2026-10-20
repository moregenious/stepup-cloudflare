/**
 * Homework View for Students - Step Up English
 * Dedicated full-page view optimized for reading large texts, listening to audio recordings
 * with playback speed control, downloading study files, and mastering lesson vocabulary.
 */

import { store } from '../store.js';
import { auth } from '../auth.js';
import { AudioPlayer } from '../components/audioPlayer.js';
import { MONTH_NAMES } from '../data/seedData.js';

export const HomeworkView = {
  selectedLessonKey: null, // e.g. 'm1-l2' or null for latest

  render(container) {
    const user = auth.getCurrentUser();
    const student = (auth.isStudent() && user) ? (store.getStudentById(user.id) || user) : (store.getStudents()[0] || null);

    if (!student) {
      container.innerHTML = `
        <div class="empty-state" style="padding: var(--space-12) 0;">
          <div class="empty-state-icon">🎒</div>
          <div class="empty-state-title">Ученик не найден</div>
          <div class="empty-state-desc">Пожалуйста, войдите в систему как ученик.</div>
        </div>
      `;
      return;
    }

    const group = student.groupId ? store.getGroupById(student.groupId) : null;
    const textbookName = student.textbook || group?.textbook || '';

    // Find all conducted lessons for this student's group to provide history/archive
    const conductedLessons = student.id ? store.getConductedLessonsForStudent(student.id) : (textbookName ? store.getLessonPlans({ textbook: textbookName }).filter(p => p.isConducted) : []);

    // Latest unlocked lesson specifically for this student's group
    const latestLesson = student.id ? store.getLatestUnlockedLessonForStudent(student.id) : (textbookName ? store.getLatestUnlockedLessonForTextbook(textbookName) : null);

    // Active lesson to display
    let activeLesson = null;
    if (this.selectedLessonKey && conductedLessons.length > 0) {
      activeLesson = conductedLessons.find(l => `m${l.monthNumber}-l${l.lessonNumber}` === this.selectedLessonKey) || latestLesson;
    } else {
      activeLesson = latestLesson || (conductedLessons.length > 0 ? conductedLessons[conductedLessons.length - 1] : null);
    }

    // Resolve effective homework (if current lesson's homework is empty due to extra/holiday lessons)
    const effectiveHw = activeLesson ? store.getEffectiveHomeworkForLesson(textbookName, activeLesson.monthNumber, activeLesson.lessonNumber) : null;
    const isFromPrevious = Boolean(effectiveHw?.isFromPrevious);
    const hwText = (effectiveHw?.text || activeLesson?.homework?.text || '').trim();
    const hwDeadline = effectiveHw?.deadline || activeLesson?.homework?.deadline || 'к следующему уроку';

    // Filter files for student (exclude teacher_admin files)
    const allFiles = activeLesson?.files || [];
    let studentFiles = allFiles.filter(f => f.target !== 'teacher_admin');
    let isFilesFromPrevious = false;
    // If current lesson has no student files and homework is carried over, provide files/audio from that previous lesson
    if (studentFiles.length === 0 && effectiveHw?.sourceLesson?.files) {
      const prevStudentFiles = (effectiveHw.sourceLesson.files || []).filter(f => f.target !== 'teacher_admin');
      if (prevStudentFiles.length > 0) {
        studentFiles = prevStudentFiles;
        isFilesFromPrevious = true;
      }
    }
    const studentAudioFiles = studentFiles.filter(f => f.type === 'audio');
    const studentDocFiles = studentFiles.filter(f => f.type !== 'audio');

    container.innerHTML = `
      <div class="homework-view-wrapper">
        <!-- Header -->
        <div class="section-header" style="margin-bottom: var(--space-4);">
          <div class="section-title-wrap">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <a href="#student-cabinet" class="btn btn-ghost btn-sm" style="padding:4px 8px; font-weight:700; color:var(--color-primary); text-decoration:none;" title="Назад в кабинет">
                ← В кабинет
              </a>
              <span class="badge badge-planned" style="font-size:0.8rem; white-space:normal; word-break:break-word; max-width:100%;">Учебник: ${textbookName || 'General English'}</span>
            </div>
            <h1 class="homework-page-title" style="margin-bottom: 4px;">📚 Домашнее задание</h1>
            <p style="margin:0;">Материалы к следующему уроку, аудиозаписи с замедлением и прикрепленные файлы</p>
          </div>

          <!-- Archive / Lesson Selector if multiple lessons are conducted -->
          ${conductedLessons.length > 1 ? `
            <div class="homework-archive-selector-wrap">
              <label for="select-homework-lesson" class="homework-archive-label">
                Архив уроков:
              </label>
              <select id="select-homework-lesson" class="form-control form-control-sm homework-archive-select">
                ${conductedLessons.map(l => {
                  const key = `m${l.monthNumber}-l${l.lessonNumber}`;
                  const isCurrent = activeLesson && activeLesson.monthNumber === l.monthNumber && activeLesson.lessonNumber === l.lessonNumber;
                  const monthName = MONTH_NAMES.find(mn => mn.num === l.monthNumber)?.name || `Месяц ${l.monthNumber}`;
                  return `<option value="${key}" ${isCurrent ? 'selected' : ''}>${monthName} • Урок ${l.lessonNumber}: ${l.topic}</option>`;
                }).join('')}
              </select>
            </div>
          ` : ''}
        </div>

        ${activeLesson ? `
          <!-- Main Content Grid -->
          <div class="homework-layout-grid">
            <!-- Left / Main: Large Text Reader Card -->
            <div class="homework-main-col">
              <div class="card homework-reader-card">
                <div class="homework-reader-header">
                  <div class="homework-reader-header-content" style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                    <div>
                      <div class="homework-lesson-meta">
                        <span>${activeLesson.monthName || (MONTH_NAMES.find(mn => mn.num === activeLesson.monthNumber)?.name)}</span>
                        <span>•</span>
                        <span>Урок ${activeLesson.lessonNumber}</span>
                      </div>
                      <h2 class="homework-lesson-topic">«${activeLesson.topic}»</h2>
                    </div>

                    ${hwDeadline ? `
                      <div class="homework-deadline-pill">
                        <span style="font-size:1.1rem;">⏳</span>
                        <div>
                          <div style="font-size:0.7rem; text-transform:uppercase; font-weight:800; opacity:0.8;">Срок сдачи</div>
                          <div style="font-weight:700; font-size:0.85rem;">${hwDeadline}</div>
                        </div>
                      </div>
                    ` : ''}
                  </div>
                </div>

                <!-- Spacious Large Text Block -->
                <div class="homework-text-wrapper">
                  <div class="homework-text-label" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
                    <span>📝 Текст домашнего задания:</span>
                    ${isFromPrevious ? `
                      <div class="homework-carried-badge">
                        <span>📌</span>
                        <span>Задание с предыдущего урока (${effectiveHw.sourceLesson.monthName} • Урок ${effectiveHw.sourceLesson.lessonNumber})</span>
                      </div>
                    ` : ''}
                  </div>
                  <div class="homework-text-body">
                    ${hwText ? hwText : 'Домашнее задание для этого урока не задано (повторение пройденного материала).'}
                  </div>
                </div>

                <!-- Audio Recordings Section -->
                ${studentAudioFiles.length > 0 ? `
                  <div class="homework-audio-section">
                    <div class="homework-section-title">
                      <span>🎧 ${isFilesFromPrevious ? `Аудиозаписи к домашнему заданию (из Урока ${effectiveHw.sourceLesson.lessonNumber}):` : 'Аудиозаписи к уроку (с регулировкой скорости 0.5x – 1.25x):'}</span>
                    </div>
                    <div class="homework-audio-list">
                      ${studentAudioFiles.map((f, i) => AudioPlayer.renderPlayerHtml(f, `hw-audio-${i}`)).join('')}
                    </div>
                  </div>
                ` : ''}

                <!-- Downloadable Study Files Section -->
                ${studentDocFiles.length > 0 ? `
                  <div class="homework-files-section">
                    <div class="homework-section-title">
                      <span>📎 ${isFilesFromPrevious ? `Материалы к домашнему заданию (из Урока ${effectiveHw.sourceLesson.lessonNumber}):` : 'Прикрепленные учебные материалы и документы:'}</span>
                    </div>
                    <div class="homework-files-list">
                      ${studentDocFiles.map(f => {
                        const isWord = (f.name && (f.name.endsWith('.docx') || f.name.endsWith('.doc') || f.name.endsWith('.docm') || f.name.endsWith('.dotx'))) || f.type === 'document';
                        const isPdf = (f.name && f.name.endsWith('.pdf')) || f.type === 'pdf';
                        const fileIcon = isWord ? '📘' : isPdf ? '📑' : '🖼️';
                        const fileTag = isWord ? 'Документ Word' : isPdf ? 'Документ PDF' : 'Файл задания';

                        return `
                          <a href="${f.url}" download="${f.name}" class="file-attachment-badge" target="_blank" style="padding: 10px 14px; text-decoration:none;">
                            <span class="file-icon" style="font-size:1.5rem;">${fileIcon}</span>
                            <div style="flex:1;">
                              <div class="font-semibold text-sm" style="color:var(--color-text-main);">${f.name}</div>
                              <div class="text-xs text-muted">${fileTag} • ${f.size || 'Файл для скачивания'}</div>
                            </div>
                            <span class="btn btn-sm btn-primary" style="pointer-events:none; font-weight:700;">Скачать ⬇</span>
                          </a>
                        `;
                      }).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- Right: Vocabulary Bank Sidebar -->
            <div class="homework-side-col">
              <div class="card homework-vocab-card">
                <div class="homework-vocab-header">
                  <div>
                    <h3 style="font-size:1.1rem; font-weight:800; color:var(--color-text-main); margin:0;">
                      🔤 Новые слова урока
                    </h3>
                    <p class="text-xs text-muted" style="margin:2px 0 0 0;">
                      ${activeLesson.vocabulary ? activeLesson.vocabulary.length : 0} слов к этому занятию
                    </p>
                  </div>
                  <span class="badge" style="background:#e0e7ff; color:#3730a3; font-weight:700;">Word Bank</span>
                </div>

                <div class="homework-vocab-list">
                  ${(!activeLesson.vocabulary || activeLesson.vocabulary.length === 0) ? `
                    <div class="text-xs text-muted" style="text-align:center; padding:var(--space-6) 0;">
                      К этому уроку нет отдельного словаря
                    </div>
                  ` : activeLesson.vocabulary.map(v => {
                    const tr = v.transcription ? (v.transcription.startsWith('[') ? v.transcription : `[${v.transcription}]`) : '';
                    return `
                      <div class="homework-vocab-item">
                        <div class="vocab-word-row">
                          <span class="vocab-word">${v.word}</span>
                          ${tr ? `<span class="vocab-transcription">${tr}</span>` : ''}
                        </div>
                        <div class="vocab-translation">${v.translation}</div>
                        ${v.example ? `<div class="vocab-example">«${v.example}»</div>` : ''}
                      </div>
                    `;
                  }).join('')}
                </div>

                <div class="homework-vocab-footer">
                  <div class="text-xs text-muted" style="margin-bottom:8px;">
                    💡 Слова автоматически сохраняются в ваш персональный словарь
                  </div>
                  <a href="#vocabulary" class="btn btn-outline-primary btn-sm homework-vocab-btn" style="width:100%; text-decoration:none; justify-content:center;">
                    📖 Открыть полный словарь (${store.getTotalVocabularyCountForStudent(student.id)}) ➔
                  </a>
                </div>
              </div>
            </div>
          </div>
        ` : `
          <div class="card" style="padding: var(--space-12) var(--space-6); text-align:center;">
            <div style="font-size: 3.5rem; margin-bottom: var(--space-4);">🔒</div>
            <h2 style="font-size: 1.35rem; font-weight: 800; color: var(--color-text-main); margin-bottom: 8px;">
              Домашнее задание появится после первого проведенного урока
            </h2>
            <p class="text-muted" style="max-width: 520px; margin: 0 auto 20px; line-height: 1.5;">
              Преподаватель последовательно проводит занятия по учебнику. Как только пройдет урок, здесь сразу откроется задание, аудиозаписи и новые слова.
            </p>
            <a href="#student-cabinet" class="btn btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; gap:8px;">
              🎓 Вернуться в личный кабинет
            </a>
          </div>
        `}
      </div>
    `;

    this.bindEvents(container);
  },

  bindEvents(container) {
    AudioPlayer.bindAll(container);

    const lessonSelect = container.querySelector('#select-homework-lesson');
    if (lessonSelect) {
      lessonSelect.addEventListener('change', (e) => {
        this.selectedLessonKey = e.target.value;
        this.render(container);
      });
    }
  }
};
