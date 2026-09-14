import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Alert, 
  Modal,
  Platform
} from 'react-native';
import { Card } from '../../components/common/Card';
import { InputField } from '../../components/common/InputField';
import { Button } from '../../components/common/Button';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { subscribeAttendance, updateAttendanceRecord, getAttendanceHistory } from '../../services/dataService';
import { useAuth } from '../../context/AuthContext';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDate = (date) => date.toLocaleDateString('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export const AttendanceScreen = () => {
  const { userProfile } = useAuth();
  const [roster, setRoster] = useState([]);
  const [selectedGrade, setSelectedGrade] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportStudent, setExportStudent] = useState(null);
  const [exportStartDate, setExportStartDate] = useState(toDateKey(new Date()));
  const [exportEndDate, setExportEndDate] = useState(toDateKey(new Date()));
  const [exporting, setExporting] = useState(false);
  const grades = ['All', ...new Set(roster.map((student) => student.grade).filter(Boolean))];

  // Note Modal State
  const [activeNoteStudent, setActiveNoteStudent] = useState(null);
  const [noteText, setNoteText] = useState('');

  // Live Firebase Subscription
  useEffect(() => {
    const unsubscribe = subscribeAttendance((liveRoster) => {
      setRoster(liveRoster);
    }, userProfile, toDateKey(selectedDate));
    return () => unsubscribe();
  }, [userProfile, selectedDate]);

  const moveDate = (days) => {
    setSelectedDate((currentDate) => {
      const nextDate = new Date(currentDate);
      nextDate.setDate(nextDate.getDate() + days);
      return nextDate;
    });
  };

  const goToToday = () => setSelectedDate(new Date());

  const toggleStatus = async (student, newStatus) => {
    if (userProfile?.role !== 'teacher' || student.status === newStatus) return;
    const existing = roster.find(r => r.studentId === student.studentId);
    const note = existing ? (existing.note || '') : '';
    try {
      await updateAttendanceRecord(student.studentId, newStatus, note, toDateKey(selectedDate));
    } catch (err) {
      Alert.alert('Unable to save attendance', err.message || 'Please check your connection and try again.');
    }
  };

  const handleOpenNoteModal = (student) => {
    if (userProfile?.role !== 'teacher') return;
    setActiveNoteStudent(student);
    setNoteText(student.note || '');
  };

  const handleSaveNote = async () => {
    if (userProfile?.role !== 'teacher') return;
    if (activeNoteStudent) {
      await updateAttendanceRecord(activeNoteStudent.studentId, activeNoteStudent.status, noteText.trim(), toDateKey(selectedDate));
      setActiveNoteStudent(null);
      setNoteText('');
      Alert.alert('Database Updated', 'Teacher note saved to Database.');
    }
  };

  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const downloadCsv = async (rows, filename) => {
    const csv = [
      ['Date', 'Student', 'Grade', 'Guardian', 'Status', 'Note'].map(escapeCsv).join(','),
      ...rows.map((row) => [row.date, row.name, row.grade, row.guardian, row.status, row.note].map(escapeCsv).join(','))
    ].join('\n');

    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const fileUri = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    Alert.alert('Attendance Saved', `CSV saved to local device storage as ${filename}.`);
  };

  const exportPdf = async (rows, title) => {
    const tableRows = rows.map((row) => `<tr><td>${row.date}</td><td>${row.name}</td><td>${row.grade}</td><td>${row.guardian}</td><td>${row.status}</td><td>${row.note || ''}</td></tr>`).join('');
    const html = `<html><body><h1>${title}</h1><table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>Date</th><th>Student</th><th>Grade</th><th>Guardian</th><th>Status</th><th>Note</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`;

    if (Platform.OS === 'web') {
      const printWindow = window.open('', '_blank');
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
      return;
    }

    const result = await Print.printToFileAsync({ html });
    const filename = `attendance-${Date.now()}.pdf`;
    const localUri = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.copyAsync({ from: result.uri, to: localUri });
    Alert.alert('Attendance Saved', `PDF saved to local device storage as ${filename}.`);
  };

  const handleExport = async (format, scope) => {
    try {
      setExporting(true);
      let rows = [];
      let title = '';
      if (scope === 'day') {
        rows = roster.map((row) => ({ ...row, date: toDateKey(selectedDate) }));
        title = `Attendance for ${formatDate(selectedDate)}`;
      } else {
        if (!exportStudent || !/^\d{4}-\d{2}-\d{2}$/.test(exportStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(exportEndDate) || exportStartDate > exportEndDate) {
          Alert.alert('Invalid export range', 'Select a student and enter dates as YYYY-MM-DD with the start date first.');
          return;
        }
        rows = (await getAttendanceHistory(exportStudent.studentId || exportStudent.id, exportStartDate, exportEndDate))
          .map((row) => ({
            ...row,
            name: exportStudent.name,
            grade: exportStudent.grade,
            guardian: exportStudent.guardian
          }));
        title = `${exportStudent.name} attendance (${exportStartDate} to ${exportEndDate})`;
      }

      if (!rows.length) {
        Alert.alert('Nothing to export', 'No attendance records were found for this selection.');
        return;
      }
      const filename = `attendance-${scope === 'day' ? toDateKey(selectedDate) : exportStudent.name.replace(/\s+/g, '-').toLowerCase()}`;
      if (format === 'csv') await downloadCsv(rows, `${filename}.csv`);
      else await exportPdf(rows, title);
      setExportModalVisible(false);
    } catch (err) {
      Alert.alert('Export failed', err.message || 'Unable to create the attendance export.');
    } finally {
      setExporting(false);
    }
  };

  const getBadgeStyle = (status) => {
    switch (status) {
      case 'Present': return { bg: COLORS.successLight, text: COLORS.success };
      case 'Late': return { bg: COLORS.warningLight, text: COLORS.warning };
      case 'Absent': default: return { bg: COLORS.dangerLight, text: COLORS.danger };
    }
  };

  // Filtered Roster
  const filteredRoster = roster.filter(st => {
    const nameMatch = (st.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || (st.guardian || '').toLowerCase().includes(searchQuery.toLowerCase());
    const gradeMatch = selectedGrade === 'All' || st.grade === selectedGrade;
    return nameMatch && gradeMatch;
  });

  // Calculate Stats
  const total = roster.length || 1;
  const presentCount = roster.filter(r => r.status === 'Present').length;
  const lateCount = roster.filter(r => r.status === 'Late').length;
  const absentCount = roster.filter(r => r.status === 'Absent').length;

  const presentPct = Math.round((presentCount / total) * 100);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.pageTitle}>Daily Attendance Roster</Text>
            <Text style={styles.pageSubtitle}>Assigned Class Roster • {formatDate(selectedDate)} </Text>
          </View>
        </View>

        <Button
          title="Export Attendance"
          onPress={() => setExportModalVisible(true)}
          variant="outline"
          iconName="download-outline"
          style={styles.exportButton}
        />

        <View style={styles.dateNavigator}>
          <TouchableOpacity style={styles.dateButton} onPress={() => moveDate(-1)}>
            <Ionicons name="chevron-back" size={20} color={COLORS.safetyBlue} />
          </TouchableOpacity>
          <View style={styles.dateCenter}>
            <Text style={styles.dateLabel}>{formatDate(selectedDate)}</Text>
            <TouchableOpacity onPress={goToToday}>
              <Text style={styles.todayLink}>Go to today</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.dateButton} onPress={() => moveDate(1)}>
            <Ionicons name="chevron-forward" size={20} color={COLORS.safetyBlue} />
          </TouchableOpacity>
        </View>

        {/* Analytics Summary Card */}
        <Card style={styles.analyticsCard}>
          <View style={styles.statBoxRow}>
            <View style={styles.statBox}>
              <Text style={[styles.statVal, { color: COLORS.success }]}>{presentCount}</Text>
              <Text style={styles.statLbl}>Present ({presentPct}%)</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statVal, { color: COLORS.warning }]}>{lateCount}</Text>
              <Text style={styles.statLbl}>Late Arrival</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statVal, { color: COLORS.danger }]}>{absentCount}</Text>
              <Text style={styles.statLbl}>Absent</Text>
            </View>
          </View>
        </Card>

        {/* Search & Filter Bar */}
        <InputField
          placeholder="Filter roster by student or guardian..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          iconName="search-outline"
          style={{ marginBottom: SPACING.xs }}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {grades.map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.gradeChip, selectedGrade === g && styles.gradeChipActive]}
              onPress={() => setSelectedGrade(g)}
            >
              <Text style={[styles.gradeChipText, selectedGrade === g && styles.gradeChipTextActive]}>
                {g}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Roster Table */}
        <Card title="Attendance Register">
          {filteredRoster.length === 0 ? (
            <Text style={styles.emptyText}>No attendance records found.</Text>
          ) : filteredRoster.map((student) => (
            <View key={student.id} style={styles.studentRow}>
              <View style={styles.studentHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{student.name}</Text>
                  <Text style={styles.studentSub}>{student.grade} • Guardian: {student.guardian}</Text>
                </View>
                {userProfile?.role === 'teacher' && (
                  <TouchableOpacity
                    style={styles.noteIconBtn}
                    onPress={() => handleOpenNoteModal(student)}
                  >
                    <Ionicons
                      name={student.note ? "document-text" : "document-text-outline"}
                      size={20}
                      color={student.note ? COLORS.safetyBlue : COLORS.textMuted}
                    />
                  </TouchableOpacity>
                )}
              </View>

              {student.note ? (
                <View style={styles.existingNoteBox}>
                  <Text style={styles.existingNoteText}>Note: {student.note}</Text>
                </View>
              ) : null}

              <View style={styles.statusButtonsRow}>
                {userProfile?.role === 'teacher' && ['Present', 'Absent', 'Late'].map((st) => {
                  const active = student.status === st;
                  const badge = getBadgeStyle(st);
                  return (
                    <TouchableOpacity
                      key={st}
                      style={[
                        styles.statusBtn,
                        active && { backgroundColor: badge.bg, borderColor: badge.text }
                      ]}
                      onPress={() => toggleStatus(student, st)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.statusBtnText, active && { color: badge.text, fontWeight: '700' }]}>
                        {st}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>

      <Modal visible={exportModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Export Attendance</Text>
              <TouchableOpacity onPress={() => setExportModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.exportHelp}>Export all students for the selected day, or one student across a date range.</Text>
            <Button title={`All Students • ${toDateKey(selectedDate)} • CSV`} onPress={() => handleExport('csv', 'day')} loading={exporting} iconName="document-text-outline" />
            <Button title={`All Students • ${toDateKey(selectedDate)} • PDF`} onPress={() => handleExport('pdf', 'day')} loading={exporting} iconName="document-outline" style={{ marginTop: SPACING.sm }} />
            <Text style={styles.exportSectionTitle}>Individual student history</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.studentExportPicker}>
              {roster.map((student) => (
                <TouchableOpacity key={student.studentId || student.id} style={[styles.studentExportChip, exportStudent?.studentId === student.studentId && styles.studentExportChipActive]} onPress={() => setExportStudent(student)}>
                  <Text style={[styles.studentExportChipText, exportStudent?.studentId === student.studentId && styles.studentExportChipTextActive]}>{student.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <InputField label="Start date (YYYY-MM-DD)" value={exportStartDate} onChangeText={setExportStartDate} placeholder="2026-09-01" iconName="calendar-outline" />
            <InputField label="End date (YYYY-MM-DD)" value={exportEndDate} onChangeText={setExportEndDate} placeholder="2026-09-08" iconName="calendar-outline" />
            <Button title="Individual Student • CSV" onPress={() => handleExport('csv', 'student')} loading={exporting} iconName="download-outline" />
            <Button title="Individual Student • PDF" onPress={() => handleExport('pdf', 'student')} loading={exporting} iconName="download-outline" style={{ marginTop: SPACING.sm }} />
          </View>
        </View>
      </Modal>

      {/* Teacher Note Modal */}
      <Modal visible={userProfile?.role === 'teacher' && !!activeNoteStudent} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Attendance Note</Text>
              <TouchableOpacity onPress={() => setActiveNoteStudent(null)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {activeNoteStudent && (
              <Text style={styles.studentNoteTitle}>{activeNoteStudent.name} ({activeNoteStudent.grade})</Text>
            )}

            <InputField
              label="Teacher / Guardian Explanation Note"
              value={noteText}
              onChangeText={setNoteText}
              placeholder="e.g. Medical reason, doctor appointment, late transport..."
              iconName="create-outline"
              multiline={true}
              numberOfLines={3}
            />

            <Button
              title="Save Note to Database"
              onPress={handleSaveNote}
              iconName="checkmark"
              style={{ marginTop: SPACING.sm }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  dateNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: RADIUS.md,
    padding: SPACING.xs,
    marginBottom: SPACING.md,
  },
  dateButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.safetyBlueLight,
  },
  dateCenter: {
    alignItems: 'center',
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  todayLink: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.safetyBlue,
    marginTop: 2,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  pageSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  saveBtn: {
    height: 40,
    paddingHorizontal: 12,
  },
  exportButton: {
    marginBottom: SPACING.md,
  },
  exportHelp: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
    lineHeight: 19,
  },
  exportSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  studentExportPicker: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
  },
  studentExportChip: {
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: COLORS.white,
  },
  studentExportChipActive: {
    backgroundColor: COLORS.safetyBlue,
    borderColor: COLORS.safetyBlue,
  },
  studentExportChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  studentExportChipTextActive: {
    color: COLORS.white,
  },
  analyticsCard: {
    marginBottom: SPACING.md,
  },
  statBoxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statVal: {
    fontSize: 20,
    fontWeight: '800',
  },
  statLbl: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.surfaceBorder,
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
  },
  gradeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    marginRight: 8,
  },
  gradeChipActive: {
    backgroundColor: COLORS.safetyBlue,
    borderColor: COLORS.safetyBlue,
  },
  gradeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  gradeChipTextActive: {
    color: COLORS.white,
  },
  studentRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.background,
  },
  emptyText: {
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
  studentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  studentSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  noteIconBtn: {
    padding: 6,
  },
  existingNoteBox: {
    backgroundColor: COLORS.safetyBlueLight,
    padding: SPACING.xs + 2,
    borderRadius: RADIUS.sm,
    marginBottom: 8,
  },
  existingNoteText: {
    fontSize: 12,
    color: COLORS.safetyBlue,
    fontStyle: 'italic',
  },
  statusButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  statusBtnText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  studentNoteTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.safetyBlue,
    marginBottom: SPACING.md,
  },
});
