import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Image, 
  Alert, 
  Modal,
  Linking
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/common/Card';
import { InputField } from '../../components/common/InputField';
import { Button } from '../../components/common/Button';
import { Avatar } from '../../components/common/Avatar';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../theme/theme';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { subscribeStudentsForUser, subscribeClassesForUser, addStudentRecord, updateStudentRecord, deleteStudentRecord, getConnectedChildren } from '../../services/dataService';

export const StudentRegistryScreen = ({ navigation }) => {
  const { user, userProfile } = useAuth();
  const userRole = userProfile?.role || null;

  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGrade, setSelectedGrade] = useState(userRole === 'parent' ? 'My Children' : 'All');
  
  // Registration Modal State
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [grade, setGrade] = useState('');
  const [guardianName, setGuardianName] = useState(userProfile?.displayName || '');
  const [guardianEmail, setGuardianEmail] = useState(userProfile?.email || '');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [teacherName, setTeacherName] = useState('Mr. Joshua Ofori');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [studentPhotoUri, setStudentPhotoUri] = useState(null);
  const [loading, setLoading] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [editStudent, setEditStudent] = useState(null);

  // Detail Modal State
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportSubject, setReportSubject] = useState('Safe Child student update');
  const [reportBody, setReportBody] = useState('');
  const grades = ['All', ...(userRole === 'parent' ? ['My Children'] : []), ...new Set(students.map((student) => student.grade).filter(Boolean))];

  // Open add modal and ensure guardian details are auto-filled for parent
  const handleOpenAddModal = () => {
    setGuardianName(userProfile?.displayName || '');
    setGuardianEmail(userProfile?.email || '');
    setAddModalVisible(true);
  };

  const handleOpenStudentDetails = (student) => {
    setSelectedStudent(student);
    setEditStudent({ ...student });
    setTeacherName(student.teacherName || '');
    setTeacherEmail(student.teacherEmail || '');
  };

  const handleSaveStudentDetails = async () => {
    if (!editStudent || userRole !== 'admin') return;
    if (!editStudent.firstName?.trim() || !editStudent.lastName?.trim() || !editStudent.guardianName?.trim()) {
      Alert.alert('Required Fields', 'First name, last name, and guardian name are required.');
      return;
    }
    try {
      setAssignmentLoading(true);
      const changes = {
        firstName: editStudent.firstName.trim(),
        lastName: editStudent.lastName.trim(),
        grade: editStudent.grade?.trim() || 'Unassigned',
        guardianName: editStudent.guardianName.trim(),
        guardianEmail: editStudent.guardianEmail?.trim().toLowerCase() || '',
        guardianPhone: editStudent.guardianPhone?.trim() || '',
        emergencyContact: editStudent.emergencyContact?.trim() || editStudent.guardianPhone?.trim() || '',
        teacherName: editStudent.teacherName?.trim() || '',
        teacherEmail: editStudent.teacherEmail?.trim().toLowerCase() || ''
      };
      await updateStudentRecord(editStudent.id, changes);
      setSelectedStudent((current) => ({ ...current, ...changes }));
      setEditStudent((current) => ({ ...current, ...changes }));
      Alert.alert('Student Updated', 'Student and parent details have been saved.');
    } catch (err) {
      Alert.alert('Unable to update student', err.message || 'Please check your connection and try again.');
    } finally {
      setAssignmentLoading(false);
    }
  };

  const handleDeleteStudent = () => {
    if (!selectedStudent || userRole !== 'admin') return;
    Alert.alert('Delete Student', `Delete ${selectedStudent.firstName} ${selectedStudent.lastName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteStudentRecord(selectedStudent.id);
          setSelectedStudent(null);
          Alert.alert('Student Deleted', 'The student record has been removed.');
        } catch (err) {
          Alert.alert('Unable to delete student', err.message || 'Please check your connection and try again.');
        }
      } }
    ]);
  };

  const parseCsvRow = (line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
      else value += character;
    }
    values.push(value.trim());
    return values;
  };

  const handleImportStudentsCsv = async () => {
    if (userRole !== 'admin') return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/csv', copyToCacheDirectory: true });
      if (result.canceled) return;
      setImportLoading(true);
      const csv = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const lines = csv.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error('CSV must include a header row and at least one student.');
      const headers = parseCsvRow(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const valueFor = (values, ...names) => {
        const index = names.map((name) => headers.indexOf(name)).find((position) => position >= 0);
        return index === undefined ? '' : values[index] || '';
      };
      let imported = 0;
      for (const line of lines.slice(1)) {
        const values = parseCsvRow(line);
        const first = valueFor(values, 'firstname', 'studentfirstname', 'name');
        const last = valueFor(values, 'lastname', 'studentlastname');
        if (!first) continue;
        await addStudentRecord({
          firstName: first,
          lastName: last || 'Imported',
          grade: valueFor(values, 'grade', 'gradelevel') || 'Unassigned',
          guardianName: valueFor(values, 'guardianname', 'parentname'),
          guardianEmail: valueFor(values, 'guardianemail', 'parentemail').toLowerCase(),
          guardianPhone: valueFor(values, 'guardianphone', 'parentphone'),
          emergencyContact: valueFor(values, 'emergencycontact'),
          teacherName: valueFor(values, 'teachername'),
          teacherEmail: valueFor(values, 'teacheremail').toLowerCase(),
          status: 'Active',
          attendanceRate: '100%'
        });
        imported += 1;
      }
      Alert.alert('Import Complete', `${imported} student record${imported === 1 ? '' : 's'} imported. You can now edit additional details.`);
    } catch (err) {
      Alert.alert('CSV Import Failed', err.message || 'Unable to import this CSV file.');
    } finally {
      setImportLoading(false);
    }
  };

  const handleCallGuardian = async () => {
    const phone = selectedStudent?.guardianPhone || selectedStudent?.emergencyContact;
    if (!phone) {
      Alert.alert('Phone unavailable', 'No guardian phone number is saved for this student.');
      return;
    }
    const url = `tel:${phone.replace(/[^0-9+]/g, '')}`;
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Unable to open phone', 'This device cannot open the phone dialer.');
    }
  };

  const handleOpenParentReport = () => {
    if (!selectedStudent?.guardianEmail) {
      Alert.alert('Email unavailable', 'No guardian email is saved for this student.');
      return;
    }
    setReportSubject(`Safe Child report: ${selectedStudent.firstName} ${selectedStudent.lastName}`);
    setReportBody(`Dear ${selectedStudent.guardianName || 'Parent/Guardian'},\n\nStudent: ${selectedStudent.firstName} ${selectedStudent.lastName}\nGrade: ${selectedStudent.grade || 'N/A'}\n\nReport:\n\nRegards,\nSafe Child Administration`);
    setReportModalVisible(true);
  };

  const handleSendParentReport = async () => {
    const email = selectedStudent?.guardianEmail;
    if (!email) return;
    const url = `mailto:${email}?subject=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}`;
    if (await Linking.canOpenURL(url)) {
      setReportModalVisible(false);
      await Linking.openURL(url);
    } else {
      Alert.alert('Unable to open email', 'No email application is available on this device.');
    }
  };

  // Live Firebase Firestore Realtime Subscription
  useEffect(() => {
    const unsubscribe = subscribeStudentsForUser((liveList) => {
      setStudents(liveList);
    }, userProfile);
    return () => unsubscribe();
  }, [userProfile]);

  useEffect(() => {
    const unsubscribe = subscribeClassesForUser(setClasses, userProfile);
    return () => unsubscribe();
  }, [userProfile]);

  const handlePickStudentPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Access to photos is required for student avatar upload.');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!res.canceled && res.assets.length > 0) {
      setStudentPhotoUri(res.assets[0].uri);
    }
  };

  const handleAddStudent = async () => {
    if (!firstName.trim() || !lastName.trim() || !guardianName.trim()) {
      Alert.alert('Required Fields', 'Please enter student full name and guardian name.');
      return;
    }

    setLoading(true);
    try {
      const currentTeacher = userRole === 'teacher' ? {
        teacherUid: user?.uid || '',
        teacherEmail: (user?.email || userProfile?.email || '').trim().toLowerCase(),
        teacherName: userProfile?.displayName || user?.displayName || teacherName.trim()
      } : {
        teacherUid: '',
        teacherEmail: teacherEmail.trim().toLowerCase(),
        teacherName: teacherName.trim()
      };
      const newStudentData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        grade,
        guardianName: guardianName.trim(),
        guardianEmail: guardianEmail.trim() || userProfile?.email || '',
        guardianPhone: guardianPhone.trim(),
        ...currentTeacher,
        classId: selectedClassId,
        className: classes.find((item) => item.id === selectedClassId)?.name || '',
        status: 'Active',
        photoUri: studentPhotoUri,
        attendanceRate: '100%',
        emergencyContact: guardianPhone.trim()
      };

      await addStudentRecord(newStudentData);
      setAddModalVisible(false);

      // Reset form
      setFirstName('');
      setLastName('');
      setTeacherEmail('');
      setSelectedClassId('');
      setStudentPhotoUri(null);

      Alert.alert('Student Saved to Database', `${newStudentData.firstName} ${newStudentData.lastName} has been registered and connected to your profile.`);
    } catch (err) {
      console.error('Student Firestore write failed:', err);
      Alert.alert(
        'Error Saving Student',
        `${err.message || 'Could not save student to Database.'}${err.code ? `\n\nDatabase code: ${err.code}` : ''}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTeacherAssignment = async () => {
    if (!selectedStudent || userRole !== 'admin') return;
    const normalizedEmail = teacherEmail.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      Alert.alert('Teacher Email Required', 'Enter the email address used by the teacher to sign in.');
      return;
    }

    try {
      setAssignmentLoading(true);
      await updateStudentRecord(selectedStudent.id, {
        teacherName: teacherName.trim(),
        teacherEmail: normalizedEmail
      });
      setSelectedStudent((current) => ({
        ...current,
        teacherName: teacherName.trim(),
        teacherEmail: normalizedEmail
      }));
      Alert.alert('Student Updated', 'The student has been reassigned to the new teacher.');
    } catch (err) {
      Alert.alert('Unable to update student', err.message || 'Please check your connection and try again.');
    } finally {
      setAssignmentLoading(false);
    }
  };

  // Filtered Students
  const filteredStudents = students.filter(st => {
    const fullName = `${st.firstName} ${st.lastName}`.toLowerCase();
    const guardian = (st.guardianName || '').toLowerCase();
    const query = searchQuery.toLowerCase();

    const matchesQuery = fullName.includes(query) || guardian.includes(query) || (st.grade || '').toLowerCase().includes(query);
    
    if (!matchesQuery) return false;

    if (selectedGrade === 'My Children') {
      const myChildren = getConnectedChildren(students, userProfile);
      return myChildren.some(c => c.id === st.id);
    }

    const matchesGrade = selectedGrade === 'All' || st.grade === selectedGrade;
    return matchesGrade;
  });

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.pageTitle}>Student Registry</Text>
            <Text style={styles.pageSubtitle}>Official Educal Complex student roster</Text>
          </View>
          {(userRole === 'admin' || userRole === 'teacher') && (
            <TouchableOpacity 
              style={styles.addBtn}
              onPress={handleOpenAddModal}
              activeOpacity={0.8}
            >
              <Ionicons name="person-add" size={18} color={COLORS.white} />
              <Text style={styles.addBtnText}>Add Student</Text>
            </TouchableOpacity>
          )}
          {userRole === 'admin' && (
            <TouchableOpacity
              style={[styles.addBtn, { marginLeft: SPACING.xs }]}
              onPress={handleImportStudentsCsv}
              disabled={importLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="document-attach-outline" size={18} color={COLORS.white} />
              <Text style={styles.addBtnText}>{importLoading ? 'Importing...' : 'Import CSV'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Search Input */}
        <InputField
          placeholder="Search student by name, guardian, or grade..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          iconName="search-outline"
          style={{ marginBottom: SPACING.sm }}
        />

        {/* Grade Filter Chips */}
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

        {/* Student Cards Grid */}
        {filteredStudents.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="school-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No Students Found</Text>
            <Text style={styles.emptySub}>No student records match your current search or filter criteria.</Text>
          </View>
        ) : (
          filteredStudents.map((st) => (
            <Card key={st.id} style={styles.studentCard}>
              <View style={styles.cardHeaderRow}>
                <Avatar uri={st.photoUri} size={54} />
                <View style={styles.cardMainInfo}>
                  <Text style={styles.studentFullName}>{st.firstName} {st.lastName}</Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.gradeBadge}>
                      <Text style={styles.gradeBadgeText}>{st.grade}</Text>
                    </View>
                    <View style={styles.statusBadge}>
                      <View style={styles.greenDot} />
                      <Text style={styles.statusBadgeText}>{st.status}</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity 
                  style={styles.detailBtn}
                  onPress={() => handleOpenStudentDetails(st)}
                >
                  <Ionicons name="chevron-forward" size={20} color={COLORS.safetyBlue} />
                </TouchableOpacity>
              </View>

              <View style={styles.cardMetaDivider} />

              <View style={styles.metaRow}>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>Guardian</Text>
                  <Text style={styles.metaValue}>{st.guardianName}</Text>
                </View>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>Assigned Teacher</Text>
                  <Text style={styles.metaValue}>{st.teacherName}</Text>
                </View>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>Attendance Rate</Text>
                  <Text style={[styles.metaValue, { color: COLORS.success, fontWeight: '800' }]}>
                    {st.attendanceRate}
                  </Text>
                </View>
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {/* Add Student Modal */}
      <Modal visible={addModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Register New Student</Text>
              <TouchableOpacity onPress={() => setAddModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <InputField
                label="First Name"
                value={firstName}
                onChangeText={setFirstName}
                placeholder="e.g. Kingsley"
                iconName="person-outline"
              />

              <InputField
                label="Last Name"
                value={lastName}
                onChangeText={setLastName}
                placeholder="e.g. Ofori"
                iconName="person-outline"
              />

              <InputField
                label="Grade Level"
                value={grade}
                onChangeText={setGrade}
                placeholder="e.g. Grade 4B"
                iconName="school-outline"
              />

              {userRole === 'teacher' && classes.length > 0 && (
                <View style={styles.classPickerBlock}>
                  <Text style={styles.photoUploadLabel}>Assigned Class</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {classes.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.classChip, selectedClassId === item.id && styles.classChipActive]}
                        onPress={() => {
                          setSelectedClassId(item.id);
                          if (item.grade) setGrade(item.grade);
                        }}
                      >
                        <Text style={[styles.classChipText, selectedClassId === item.id && styles.classChipTextActive]}>
                          {item.name || item.grade || item.id}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <InputField
                label="Guardian Full Name"
                value={guardianName}
                onChangeText={setGuardianName}
                placeholder="e.g. Georgette Gyamfuaah"
                iconName="people-outline"
              />

              <InputField
                label="Guardian Email"
                value={guardianEmail}
                onChangeText={setGuardianEmail}
                placeholder="e.g. guardian@example.com"
                iconName="mail-outline"
                keyboardType="email-address"
              />

              <InputField
                label="Guardian Phone"
                value={guardianPhone}
                onChangeText={setGuardianPhone}
                placeholder="e.g. +233 555-0182"
                iconName="call-outline"
                keyboardType="phone-pad"
              />

              <InputField
                label="Assigned Teacher"
                value={teacherName}
                onChangeText={setTeacherName}
                placeholder="e.g. Dr. Samuel O. Frimpong"
                iconName="easel-outline"
              />

              <InputField
                label="Teacher Email"
                value={teacherEmail}
                onChangeText={setTeacherEmail}
                placeholder="e.g. teacher@example.com"
                iconName="mail-outline"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {/* Student Photo Picker */}
              <Text style={styles.photoUploadLabel}>Student Profile Picture (Optional)</Text>
              <TouchableOpacity 
                style={styles.uploadArea} 
                onPress={handlePickStudentPhoto}
                activeOpacity={0.8}
              >
                {studentPhotoUri ? (
                  <Image source={{ uri: studentPhotoUri }} style={styles.uploadPreviewImage} />
                ) : (
                  <View style={styles.uploadPlaceholder}>
                    <Ionicons name="camera-outline" size={28} color={COLORS.safetyBlue} />
                    <Text style={styles.uploadText}>Select Student Photo</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Button
                title="Save Student"
                onPress={handleAddStudent}
                loading={loading}
                iconName="checkmark-circle-outline"
                style={{ marginTop: SPACING.sm }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Student Detail Modal */}
      <Modal visible={!!selectedStudent} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedStudent && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Student Profile Record</Text>
                  <TouchableOpacity onPress={() => setSelectedStudent(null)}>
                    <Ionicons name="close" size={24} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.detailHeaderBox}>
                  <Avatar uri={selectedStudent.photoUri} size={70} />
                  <Text style={styles.detailName}>{selectedStudent.firstName} {selectedStudent.lastName}</Text>
                  <Text style={styles.detailGrade}>{selectedStudent.grade} • Educal Complex</Text>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailItem}>
                    <Ionicons name="person-outline" size={18} color={COLORS.safetyBlue} />
                    <View style={styles.detailItemText}>
                      <Text style={styles.detailItemLabel}>Guardian</Text>
                      <Text style={styles.detailItemVal}>{selectedStudent.guardianName}</Text>
                    </View>
                  </View>

                  <View style={styles.detailItem}>
                    <Ionicons name="mail-outline" size={18} color={COLORS.safetyBlue} />
                    <View style={styles.detailItemText}>
                      <Text style={styles.detailItemLabel}>Guardian Email</Text>
                      <Text style={styles.detailItemVal}>{selectedStudent.guardianEmail}</Text>
                    </View>
                  </View>

                  <View style={styles.detailItem}>
                    <Ionicons name="call-outline" size={18} color={COLORS.safetyBlue} />
                    <View style={styles.detailItemText}>
                      <Text style={styles.detailItemLabel}>Guardian Phone</Text>
                      <Text style={styles.detailItemVal}>{selectedStudent.guardianPhone}</Text>
                    </View>
                  </View>

                  <View style={styles.detailItem}>
                    <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
                    <View style={styles.detailItemText}>
                      <Text style={styles.detailItemLabel}>Emergency Contact</Text>
                      <Text style={styles.detailItemVal}>{selectedStudent.emergencyContact}</Text>
                    </View>
                  </View>

                  <View style={styles.detailItem}>
                    <Ionicons name="easel-outline" size={18} color={COLORS.safetyBlue} />
                    <View style={styles.detailItemText}>
                      <Text style={styles.detailItemLabel}>Assigned Teacher</Text>
                      <Text style={styles.detailItemVal}>{selectedStudent.teacherName || 'Not assigned'}</Text>
                      <Text style={styles.detailItemVal}>{selectedStudent.teacherEmail || 'Teacher email not assigned'}</Text>
                    </View>
                  </View>
                </View>

                {userRole === 'admin' && (
                  <View style={styles.parentActionsRow}>
                    <TouchableOpacity style={styles.parentActionButton} onPress={handleCallGuardian}>
                      <Ionicons name="call-outline" size={18} color={COLORS.white} />
                      <Text style={styles.parentActionText}>Call Parent</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.parentActionButton, styles.emailActionButton]} onPress={handleOpenParentReport}>
                      <Ionicons name="mail-outline" size={18} color={COLORS.white} />
                      <Text style={styles.parentActionText}>Email Report</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {userRole === 'admin' && (
                  <>
                    <InputField
                      label="First Name"
                      value={editStudent?.firstName || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, firstName: value }))}
                      placeholder="Student first name"
                      iconName="person-outline"
                    />
                    <InputField
                      label="Last Name"
                      value={editStudent?.lastName || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, lastName: value }))}
                      placeholder="Student last name"
                      iconName="person-outline"
                    />
                    <InputField
                      label="Grade"
                      value={editStudent?.grade || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, grade: value }))}
                      placeholder="Grade level"
                      iconName="school-outline"
                    />
                    <InputField
                      label="Parent / Guardian Name"
                      value={editStudent?.guardianName || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, guardianName: value }))}
                      placeholder="Parent or guardian name"
                      iconName="people-outline"
                    />
                    <InputField
                      label="Parent / Guardian Email"
                      value={editStudent?.guardianEmail || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, guardianEmail: value }))}
                      placeholder="Parent email"
                      iconName="mail-outline"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <InputField
                      label="Parent / Guardian Phone"
                      value={editStudent?.guardianPhone || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, guardianPhone: value }))}
                      placeholder="Parent phone"
                      iconName="call-outline"
                      keyboardType="phone-pad"
                    />
                    <InputField
                      label="Emergency Contact"
                      value={editStudent?.emergencyContact || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, emergencyContact: value }))}
                      placeholder="Emergency contact"
                      iconName="alert-circle-outline"
                      keyboardType="phone-pad"
                    />
                    <InputField
                      label="Assigned Teacher"
                      value={editStudent?.teacherName || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, teacherName: value }))}
                      placeholder="Teacher full name"
                      iconName="easel-outline"
                    />
                    <InputField
                      label="Teacher Email"
                      value={editStudent?.teacherEmail || ''}
                      onChangeText={(value) => setEditStudent((current) => ({ ...current, teacherEmail: value }))}
                      placeholder="Teacher email"
                      iconName="mail-outline"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <Button
                      title="Save Student & Parent Details"
                      onPress={handleSaveStudentDetails}
                      loading={assignmentLoading}
                      iconName="save-outline"
                      style={{ marginTop: SPACING.sm }}
                    />
                    <Button
                      title="Delete Student"
                      onPress={handleDeleteStudent}
                      variant="danger"
                      iconName="trash-outline"
                      style={{ marginTop: SPACING.sm }}
                    />
                  </>
                )}

                <Button
                  title="Close Profile"
                  onPress={() => setSelectedStudent(null)}
                  variant="secondary"
                  style={{ marginTop: SPACING.md }}
                />
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={reportModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Email Parent Report</Text>
              <TouchableOpacity onPress={() => setReportModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.reportRecipient}>To: {selectedStudent?.guardianEmail}</Text>
            <InputField
              label="Subject"
              value={reportSubject}
              onChangeText={setReportSubject}
              iconName="text-outline"
            />
            <InputField
              label="Report Message"
              value={reportBody}
              onChangeText={setReportBody}
              placeholder="Write the report for the parent..."
              iconName="create-outline"
              multiline={true}
              numberOfLines={7}
            />
            <Button
              title="Open Email App"
              onPress={handleSendParentReport}
              iconName="send-outline"
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
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
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.safetyBlue,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    ...SHADOWS.small,
  },
  addBtnText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: 13,
    marginLeft: 4,
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
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    marginTop: SPACING.md,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginTop: SPACING.sm,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  studentCard: {
    marginBottom: SPACING.md,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardMainInfo: {
    flex: 1,
    marginLeft: SPACING.sm + 4,
  },
  studentFullName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  gradeBadge: {
    backgroundColor: COLORS.safetyBlueLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  gradeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.safetyBlue,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.successLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.success,
    marginRight: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.success,
  },
  detailBtn: {
    padding: 6,
  },
  cardMetaDivider: {
    height: 1,
    backgroundColor: COLORS.background,
    marginVertical: SPACING.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaCol: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 2,
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
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primaryNavy,
  },
  photoUploadLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  classPickerBlock: {
    marginBottom: SPACING.md,
  },
  classChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: RADIUS.full,
    marginRight: SPACING.xs,
    backgroundColor: COLORS.white,
  },
  classChipActive: {
    backgroundColor: COLORS.safetyBlue,
    borderColor: COLORS.safetyBlue,
  },
  classChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  classChipTextActive: {
    color: COLORS.white,
  },
  uploadArea: {
    height: 80,
    borderWidth: 1.5,
    borderColor: COLORS.surfaceBorder,
    borderStyle: 'dashed',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    marginBottom: SPACING.md,
  },
  uploadPlaceholder: {
    alignItems: 'center',
  },
  uploadText: {
    fontSize: 12,
    color: COLORS.safetyBlue,
    marginTop: 4,
    fontWeight: '500',
  },
  uploadPreviewImage: {
    width: '100%',
    height: '100%',
    borderRadius: RADIUS.md,
  },
  detailHeaderBox: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.background,
    marginBottom: SPACING.md,
  },
  detailName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.primaryNavy,
    marginTop: SPACING.xs,
  },
  detailGrade: {
    fontSize: 13,
    color: COLORS.safetyBlue,
    fontWeight: '600',
    marginTop: 2,
  },
  detailSection: {
    gap: 12,
  },
  parentActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.md,
  },
  parentActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  emailActionButton: {
    backgroundColor: COLORS.safetyBlue,
  },
  parentActionText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  reportRecipient: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginBottom: SPACING.md,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: SPACING.sm + 2,
    borderRadius: RADIUS.md,
  },
  detailItemText: {
    marginLeft: SPACING.sm,
    flex: 1,
  },
  detailItemLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  detailItemVal: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 1,
  },
});
