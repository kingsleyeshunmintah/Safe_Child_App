import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  getDocs
} from 'firebase/firestore';
import { auth } from '../config/firebase';
import { db } from '../config/firebase';

const requireDatabase = () => {
  if (!db) throw new Error('Firebase database is not configured.');
  if (!auth?.currentUser) throw new Error('You must be signed in to save student records.');
  return db;
};

const subscribeCollection = (collectionName, callback, filters = []) => {
  if (!db) {
    callback([]);
    return () => {};
  }

  const source = filters.length
    ? query(collection(db, collectionName), ...filters)
    : collection(db, collectionName);

  return onSnapshot(
    source,
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    (error) => {
      console.error(`Unable to load ${collectionName}:`, error);
      callback([]);
    }
  );
};

const addRecord = async (collectionName, data) => {
  const reference = await addDoc(collection(requireDatabase(), collectionName), {
    ...data,
    createdByUid: auth.currentUser.uid,
    createdAt: serverTimestamp()
  });
  console.info(`Firebase write succeeded: ${collectionName}/${reference.id}`);
  return { id: reference.id, ...data };
};

const updateRecord = async (collectionName, id, data) => {
  await updateDoc(doc(requireDatabase(), collectionName, id), {
    ...data,
    updatedAt: serverTimestamp()
  });
};

export const subscribeStudents = (callback) => subscribeCollection('students', callback);
export const subscribeStudentsForUser = (callback, userProfile) => {
  if (!userProfile) {
    callback([]);
    return () => {};
  }
  if (userProfile?.role === 'teacher') {
    let byUid = [];
    let byEmail = [];
    const publish = () => {
      const records = [...byUid, ...byEmail].filter((student, index, list) => list.findIndex((item) => item.id === student.id) === index);
      callback(records);
    };
    const unsubscribeUid = subscribeCollection('students', (records) => { byUid = records; publish(); }, [where('teacherUid', '==', auth.currentUser.uid)]);
    const unsubscribeEmail = subscribeCollection('students', (records) => { byEmail = records; publish(); }, [where('teacherEmail', '==', userProfile.email)]);
    return () => { unsubscribeUid(); unsubscribeEmail(); };
  }
  if (userProfile?.role !== 'parent') return subscribeStudents(callback);
  return subscribeCollection('students', callback, [where('guardianEmail', '==', userProfile.email)]);
};
export const addStudentRecord = (data) => addRecord('students', data);
export const updateStudentRecord = (id, data) => updateRecord('students', id, data);
export const deleteStudentRecord = async (id) => deleteDoc(doc(requireDatabase(), 'students', id));
export const subscribePickups = (callback, userProfile) => {
  if (!userProfile) {
    callback([]);
    return () => {};
  }
  if (userProfile?.role !== 'parent') return subscribeCollection('pickup_requests', callback);
  return subscribeCollection('pickup_requests', callback, [where('createdByUid', '==', auth.currentUser.uid)]);
};
export const addPickupRequestRecord = async (data) => {
  const database = requireDatabase();
  const reference = await addDoc(collection(database, 'pickup_requests'), {
    ...data,
    createdByUid: auth.currentUser.uid,
    createdAt: serverTimestamp()
  });
  const pinCode = data.pinCode || String(
    [...reference.id].reduce((total, character) => total + character.charCodeAt(0), 0) % 10000
  ).padStart(4, '0');
  if (!data.pinCode) await updateDoc(reference, { pinCode });
  return { id: reference.id, ...data, pinCode };
};
export const updatePickupStatusRecord = (id, status) => updateRecord('pickup_requests', id, { status });
export const subscribeAuthorizedContacts = (callback, userProfile) => {
  if (!userProfile) {
    callback([]);
    return () => {};
  }
  if (userProfile?.role !== 'parent') return subscribeCollection('authorized_contacts', callback);
  return subscribeCollection('authorized_contacts', callback, [where('createdByUid', '==', auth.currentUser.uid)]);
};
export const addAuthorizedContactRecord = (data) => addRecord('authorized_contacts', data);
export const subscribeAttendance = (callback, userProfile, attendanceDate) => {
  if (!userProfile) {
    callback([]);
    return () => {};
  }
  if (userProfile?.role === 'parent') {
    callback([]);
    return () => {};
  }

  let students = [];
  let teacherStudents = [];
  let teacherEmailStudents = [];
  let attendance = [];
  const date = attendanceDate || new Date().toISOString().slice(0, 10);
  const publish = () => {
    const attendanceByStudent = new Map();
    attendance.forEach((record) => {
      if (record.studentId && !attendanceByStudent.has(record.studentId)) attendanceByStudent.set(record.studentId, record);
    });
    callback(students.map((student) => {
      const record = attendanceByStudent.get(student.id);
      return {
        id: record?.id || `${student.id}_${date}`,
        studentId: student.id,
        name: `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Unnamed student',
        grade: student.grade || 'Unassigned',
        guardian: student.guardianName || 'No guardian details',
        status: record?.status || '',
        note: record?.note || '',
        attendanceDate: date,
        hasAttendanceRecord: Boolean(record)
      };
    }));
  };
  const unsubscribeStudents = userProfile?.role === 'teacher'
    ? (() => {
      const publishTeacherStudents = () => {
        students = [...teacherStudents, ...teacherEmailStudents].filter((student, index, list) => list.findIndex((item) => item.id === student.id) === index);
        publish();
      };
      const unsubscribeUid = subscribeCollection('students', (records) => { teacherStudents = records; publishTeacherStudents(); }, [where('teacherUid', '==', auth.currentUser.uid)]);
      const unsubscribeEmail = subscribeCollection('students', (records) => { teacherEmailStudents = records; publishTeacherStudents(); }, [where('teacherEmail', '==', userProfile.email)]);
      return () => { unsubscribeUid(); unsubscribeEmail(); };
    })()
    : subscribeCollection('students', (records) => { students = records; publish(); });
  const unsubscribeAttendance = subscribeCollection('attendance', (records) => { attendance = records; publish(); }, [where('attendanceDate', '==', date)]);
  return () => { unsubscribeStudents(); unsubscribeAttendance(); };
};
export const updateAttendanceRecord = async (student, status, note = '', attendanceDate) => {
  const studentId = typeof student === 'string' ? student : student.id;
  const date = attendanceDate || new Date().toISOString().slice(0, 10);
  const attendanceId = `${studentId}_${date}`;
  const database = requireDatabase();
  const fields = {
    studentId,
    status,
    note,
    attendanceDate: date,
    updatedAt: serverTimestamp()
  };
  const existing = await getDocs(query(collection(database, 'attendance'), where('studentId', '==', studentId), where('attendanceDate', '==', date)));
  if (existing.docs.length) {
    await updateDoc(existing.docs[0].ref, fields);
  } else {
    await setDoc(doc(database, 'attendance', attendanceId), { ...fields, createdByUid: auth.currentUser.uid, createdAt: serverTimestamp() });
  }
};
export const getAttendanceHistory = async (studentId, startDate, endDate) => {
  const snapshot = await getDocs(query(
    collection(requireDatabase(), 'attendance'),
    where('studentId', '==', studentId),
    where('attendanceDate', '>=', startDate),
    where('attendanceDate', '<=', endDate)
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data(), date: item.data().attendanceDate }));
};
export const subscribeAlerts = (callback) => subscribeCollection('alerts', callback);
export const addAlertRecord = (data) => addRecord('alerts', data);
export const updateAlertStatusRecord = (id, status) => updateRecord('alerts', id, { status });
export const subscribeBusSchedules = (callback) => subscribeCollection('bus_schedules', callback);
export const addBusScheduleRecord = (data) => addRecord('bus_schedules', data);
export const subscribePtaMeetings = (callback) => subscribeCollection('pta_meetings', callback);
export const addPtaMeetingRecord = (data) => addRecord('pta_meetings', data);
export const updatePtaRsvpRecord = (id, rsvpStatus) => updateRecord('pta_meetings', id, { rsvpStatus });
export const subscribeAnnouncements = (callback) => subscribeCollection('announcements', callback);
export const publishAnnouncementRecord = (data) => addRecord('announcements', data);
export const subscribePickupAudits = (callback, userProfile) => {
  if (!userProfile) {
    callback([]);
    return () => {};
  }
  if (userProfile?.role === 'parent') {
    callback([]);
    return () => {};
  }
  return subscribeCollection('pickup_audits', callback);
};
export const addPickupAuditRecord = (data) => addRecord('pickup_audits', data);
export const subscribeIpBlocks = (callback) => subscribeCollection('ip_blocks', callback);
export const addIpBlockRecord = (data) => addRecord('ip_blocks', data);
export const removeIpBlockRecord = async (id) => deleteDoc(doc(requireDatabase(), 'ip_blocks', id));

export const getConnectedChildren = (studentsList = [], userProfile = null) => {
  if (!userProfile) return [];
  const userEmail = (userProfile.email || '').toLowerCase().trim();
  const userName = (userProfile.displayName || '').toLowerCase().trim();

  return studentsList.filter((student) => {
    const guardianEmail = (student.guardianEmail || '').toLowerCase().trim();
    const guardianName = (student.guardianName || '').toLowerCase().trim();
    return (userEmail && guardianEmail === userEmail) ||
      (userName && guardianName && guardianName === userName);
  });
};