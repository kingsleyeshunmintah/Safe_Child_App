import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, onSnapshot, query, orderBy, type DocumentData } from 'firebase/firestore';
import { Check, Edit3, Plus, Trash2, Upload, X } from 'lucide-react';
import { auth, db } from './firebase';
import { createRecord, deleteRecord, deleteUser, updateRecord, updateUser } from './services';
import type { RecordData, Role } from './types';

const roles: Role[] = ['admin', 'teacher', 'parent', 'security', 'pickup_verifier'];
const fieldLabel = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
const csvRow = (line: string) => {
  const values: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += character;
  }
  values.push(value.trim()); return values;
};
const csvValue = (headers: string[], values: string[], ...names: string[]) => {
  const position = names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
  return position === undefined ? '' : values[position] || '';
};
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const exportStudentsCsv = (students: RecordData[]) => {
  const columns = ['id', 'firstName', 'lastName', 'grade', 'guardianName', 'guardianEmail', 'guardianPhone', 'emergencyContact', 'teacherName', 'teacherEmail', 'classId', 'className', 'status'];
  const csv = [
    columns.map(fieldLabel).map(csvCell).join(','),
    ...students.map((student) => columns.map((column) => csvCell(student[column])).join(','))
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `safe-child-students-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
const exportAttendanceCsv = (records: RecordData[]) => {
  const columns = ['attendanceDate', 'studentName', 'grade', 'teacherName', 'teacherEmail', 'guardianName', 'status', 'note'];
  const csv = [
    columns.map(fieldLabel).map(csvCell).join(','),
    ...records.map((record) => columns.map((column) => csvCell(record[column])).join(','))
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `safe-child-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-layer" role="dialog"><div className="modal"><div className="modal-heading"><div><p className="eyebrow">DATA MANAGEMENT</p><h3>{title}</h3></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>{children}</div></div>;
}
function Actions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) { return <div className="row-actions"><button className="table-action" onClick={onEdit}><Edit3 size={14} /> Edit</button><button className="danger-button" onClick={onDelete}><Trash2 size={14} /> Delete</button></div>; }
function Field({ label, value, onChange, type = 'text', readOnly = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; readOnly?: boolean }) { return <label>{label}<input type={type} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} /></label>; }
function SaveBar({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: () => void }) { return <div className="modal-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" onClick={onSave} disabled={busy}>{busy ? 'Saving...' : 'Save changes'} <Check size={16} /></button></div>; }

export function UsersManagement() {
  const [users, setUsers] = useState<RecordData[]>([]); const [selected, setSelected] = useState<RecordData | null>(null); const [error, setError] = useState('');
  useEffect(() => onSnapshot(query(collection(db, 'users'), orderBy('displayName')), (snapshot) => setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (e) => setError(e.message)), []);
  const remove = async (user: RecordData) => { if (!confirm(`Delete ${String(user.displayName || user.email || 'this user')}? This removes the profile record; the authentication account requires server-side deletion.`)) return; try { await deleteUser(user.id); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete user.'); } };
  return <ManagementLayout title="Users" subtitle="Edit account details, roles, and profile records.">{error && <div className="notice error">{error}</div>}<section className="panel table-panel"><Table headers={['displayName', 'email', 'role', 'status']} rows={users} renderActions={(row) => <Actions onEdit={() => setSelected(row)} onDelete={() => remove(row)} />} />{selected && <UserModal record={selected} onClose={() => setSelected(null)} />}</section></ManagementLayout>;
}
function UserModal({ record, onClose }: { record: RecordData; onClose: () => void }) {
  const [form, setForm] = useState({ displayName: String(record.displayName || ''), email: String(record.email || ''), phone: String(record.phone || ''), role: String(record.role || 'parent'), status: String(record.status || 'Active') }); const [busy, setBusy] = useState(false); const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => { setBusy(true); try { await updateUser(record.id, form); onClose(); } catch { setBusy(false); } };
  return <Modal title="Edit user account" onClose={onClose}><Field label="Display name" value={form.displayName} onChange={(value) => set('displayName', value)} /><Field label="Email" value={form.email} onChange={(value) => set('email', value)} type="email" /><Field label="Phone" value={form.phone} onChange={(value) => set('phone', value)} /><label>Role<select value={form.role} onChange={(event) => set('role', event.target.value)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label><Field label="Status" value={form.status} onChange={(value) => set('status', value)} /><SaveBar busy={busy} onCancel={onClose} onSave={save} /></Modal>;
}

export function StudentsManagement() {
  const [students, setStudents] = useState<RecordData[]>([]); const [users, setUsers] = useState<RecordData[]>([]); const [classes, setClasses] = useState<RecordData[]>([]); const [selected, setSelected] = useState<RecordData | null>(null); const [addOpen, setAddOpen] = useState(false); const [importing, setImporting] = useState(false); const [search, setSearch] = useState(''); const [error, setError] = useState('');
  useEffect(() => onSnapshot(collection(db, 'students'), (snapshot) => setStudents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (e) => setError(e.message)), []);
  useEffect(() => onSnapshot(collection(db, 'users'), (snapshot) => setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))), []);
  useEffect(() => onSnapshot(collection(db, 'classes'), (snapshot) => setClasses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))), []);
  const parents = users.filter((user) => user.role === 'parent'); const teachers = users.filter((user) => user.role === 'teacher');
  useEffect(() => {
    if (!students.length || !teachers.length) return;
    students.forEach((student) => {
      const assignedClass = classes.find((item) => item.id === student.classId || (student.className && item.name === student.className));
      const teacher = teachers.find((user) =>
        (student.teacherUid && user.id === student.teacherUid)
        || (student.teacherEmail && String(user.email || '').toLowerCase() === String(student.teacherEmail).toLowerCase())
        || (student.teacherName && String(user.displayName || '').toLowerCase() === String(student.teacherName).toLowerCase())
        || (assignedClass?.teacherUid && user.id === assignedClass.teacherUid)
        || (assignedClass?.teacherEmail && String(user.email || '').toLowerCase() === String(assignedClass.teacherEmail).toLowerCase())
      );
      if (!teacher || (student.teacherUid === teacher.id && String(student.teacherEmail || '').toLowerCase() === String(teacher.email || '').toLowerCase())) return;
      updateRecord('students', student.id, {
        teacherUid: teacher.id,
        teacherEmail: String(teacher.email || '').toLowerCase(),
        teacherName: teacher.displayName || student.teacherName || ''
      }).catch((error) => setError(error instanceof Error ? error.message : 'Unable to normalize teacher assignment.'));
    });
  }, [students, teachers, classes]);
  const visible = useMemo(() => students.filter((student) => JSON.stringify(student).toLowerCase().includes(search.toLowerCase())), [students, search]);
  const remove = async (student: RecordData) => { if (!confirm(`Delete ${String(student.firstName || '')} ${String(student.lastName || '')}?`)) return; try { await deleteRecord('students', student.id); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete student.'); } };
  const importCsv = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setImporting(true); const reader = new FileReader(); reader.onload = async () => { try { const lines = String(reader.result || '').split(/\r?\n/).filter(Boolean); if (lines.length < 2) throw new Error('CSV needs a header and at least one row.'); const headers = csvRow(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, '')); for (const line of lines.slice(1)) { const values = csvRow(line); const firstName = csvValue(headers, values, 'firstname', 'studentfirstname', 'name'); if (!firstName) continue; await createRecord('students', { firstName, lastName: csvValue(headers, values, 'lastname', 'studentlastname') || 'Imported', grade: csvValue(headers, values, 'grade', 'gradelevel') || 'Unassigned', guardianName: csvValue(headers, values, 'guardianname', 'parentname'), guardianEmail: csvValue(headers, values, 'guardianemail', 'parentemail').toLowerCase(), guardianPhone: csvValue(headers, values, 'guardianphone', 'parentphone'), emergencyContact: csvValue(headers, values, 'emergencycontact'), teacherName: csvValue(headers, values, 'teachername'), teacherEmail: csvValue(headers, values, 'teacheremail').toLowerCase(), status: 'Active' }); } } catch (e) { setError(e instanceof Error ? e.message : 'CSV import failed.'); } finally { setImporting(false); event.target.value = ''; } }; reader.readAsText(file); };
  return <ManagementLayout title="Students" subtitle="Add, import, edit, assign, remove, and export student records."><div className="management-actions"><div className="search"><input placeholder="Search students..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="secondary" onClick={() => exportStudentsCsv(visible)} disabled={!visible.length}>Export CSV</button><button className="secondary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add student</button><label className="primary upload"><Upload size={16} />{importing ? 'Importing...' : 'Import CSV'}<input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={importing} /></label></div>{error && <div className="notice error">{error}</div>}<section className="panel table-panel"><Table headers={['firstName', 'lastName', 'grade', 'guardianName', 'className']} rows={visible} renderActions={(row) => <Actions onEdit={() => setSelected(row)} onDelete={() => remove(row)} />} />{selected && <StudentModal record={selected} parents={parents} teachers={teachers} classes={classes} onClose={() => setSelected(null)} />}{addOpen && <StudentModal parents={parents} teachers={teachers} classes={classes} onClose={() => setAddOpen(false)} />}</section></ManagementLayout>;
}
function StudentModal({ record, parents, teachers, classes, onClose }: { record?: RecordData; parents: RecordData[]; teachers: RecordData[]; classes: RecordData[]; onClose: () => void }) {
  const [form, setForm] = useState({ firstName: String(record?.firstName || ''), lastName: String(record?.lastName || ''), grade: String(record?.grade || ''), guardianName: String(record?.guardianName || ''), guardianEmail: String(record?.guardianEmail || ''), guardianPhone: String(record?.guardianPhone || ''), emergencyContact: String(record?.emergencyContact || ''), teacherName: String(record?.teacherName || ''), teacherEmail: String(record?.teacherEmail || ''), teacherUid: String(record?.teacherUid || ''), classId: String(record?.classId || ''), className: String(record?.className || ''), status: String(record?.status || 'Active'), photoUri: String(record?.photoUri || '') }); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => { if (!form.firstName.trim() || !form.lastName.trim()) { setError('First name and last name are required.'); return; } setBusy(true); setError(''); try { const parent = parents.find((user) => String(user.email || '').toLowerCase() === form.guardianEmail.toLowerCase()); const teacher = teachers.find((user) => String(user.email || '').toLowerCase() === form.teacherEmail.toLowerCase()); const fields = { ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), guardianName: parent?.displayName || form.guardianName.trim(), guardianEmail: parent?.email || form.guardianEmail.trim().toLowerCase(), guardianPhone: parent?.phone || parent?.phoneNumber || parent?.mobile || form.guardianPhone.trim(), emergencyContact: form.emergencyContact.trim(), teacherName: teacher?.displayName || form.teacherName.trim(), status: form.status.trim() || 'Active' }; if (record) await updateRecord('students', record.id, fields); else await createRecord('students', fields); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save student profile.'); setBusy(false); } };
  const selectParent = (email: string) => { const parent = parents.find((item) => String(item.email || '').toLowerCase() === email.toLowerCase()); setForm((current) => ({ ...current, guardianEmail: String(parent?.email || email), guardianName: String(parent?.displayName || ''), guardianPhone: String(parent?.phone || parent?.phoneNumber || parent?.mobile || '') })); };
  const selectClass = (classId: string) => { const selectedClass = classes.find((item) => item.id === classId); const teacherEmail = String(selectedClass?.teacherEmail || ''); const teacher = teachers.find((item) => String(item.email || '').toLowerCase() === teacherEmail.toLowerCase()); setForm((current) => ({ ...current, classId, className: String(selectedClass?.name || ''), grade: String(selectedClass?.grade || ''), teacherEmail, teacherUid: String(selectedClass?.teacherUid || teacher?.id || ''), teacherName: String(selectedClass?.teacherName || teacher?.displayName || '') })); };
  const selectTeacher = (teacherEmail: string) => { const teacher = teachers.find((item) => String(item.email || '').toLowerCase() === teacherEmail.toLowerCase()); const teacherClass = classes.find((item) => String(item.teacherEmail || '').toLowerCase() === teacherEmail.toLowerCase()); setForm((current) => ({ ...current, teacherEmail, teacherUid: String(teacher?.id || ''), teacherName: String(teacher?.displayName || ''), ...(teacherClass ? { classId: teacherClass.id, className: String(teacherClass.name || ''), grade: String(teacherClass.grade || '') } : {}) })); };
  return <Modal title={record ? 'Edit student and assignments' : 'Add student'} onClose={onClose}>{error && <div className="notice error">{error}</div>}<Field label="First name" value={form.firstName} onChange={(value) => set('firstName', value)} /><Field label="Last name" value={form.lastName} onChange={(value) => set('lastName', value)} /><Field label="Grade" value={form.grade} readOnly={Boolean(form.classId)} onChange={(value) => set('grade', value)} /><label>Parent account<select value={form.guardianEmail} onChange={(event) => selectParent(event.target.value)}><option value="">Select parent</option>{parents.map((parent) => <option key={parent.id} value={String(parent.email || '')}>{String(parent.displayName || parent.email)}</option>)}</select></label><Field label="Guardian name" value={form.guardianName} readOnly={Boolean(form.guardianEmail)} onChange={(value) => set('guardianName', value)} /><Field label="Guardian email" value={form.guardianEmail} readOnly={Boolean(form.guardianEmail)} onChange={(value) => set('guardianEmail', value)} type="email" /><Field label="Guardian phone" value={form.guardianPhone} readOnly={Boolean(form.guardianEmail)} onChange={(value) => set('guardianPhone', value)} /><Field label="Emergency contact" value={form.emergencyContact} onChange={(value) => set('emergencyContact', value)} /><label>Teacher<select value={form.teacherEmail} onChange={(event) => selectTeacher(event.target.value)}><option value="">Select teacher</option>{teachers.map((teacher) => <option key={teacher.id} value={String(teacher.email || '')}>{String(teacher.displayName || teacher.email)}</option>)}</select></label><label>Grade class<select value={form.classId} onChange={(event) => selectClass(event.target.value)}><option value="">Select class</option>{classes.map((item) => <option key={item.id} value={item.id}>{String(item.name || item.grade || item.id)}{item.teacherName ? ` · ${String(item.teacherName)}` : ''}</option>)}</select></label><Field label="Status" value={form.status} onChange={(value) => set('status', value)} /><Field label="Photo URL" value={form.photoUri} onChange={(value) => set('photoUri', value)} /><SaveBar busy={busy} onCancel={onClose} onSave={save} /></Modal>;
}

export function ClassesManagement() {
  const [classes, setClasses] = useState<RecordData[]>([]); const [teachers, setTeachers] = useState<RecordData[]>([]); const [open, setOpen] = useState(false); const [selected, setSelected] = useState<RecordData | null>(null);
  useEffect(() => onSnapshot(collection(db, 'classes'), (snapshot) => setClasses(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))), []);
  useEffect(() => onSnapshot(collection(db, 'users'), (snapshot) => setTeachers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RecordData)).filter((user) => user.role === 'teacher'))), []);
  return <ManagementLayout title="Grade Classes" subtitle="Create classes and assign teachers to manage their student groups."><div className="management-actions"><button className="primary" onClick={() => { setSelected(null); setOpen(true); }}><Plus size={16} /> Create grade class</button></div><section className="panel table-panel"><Table headers={['name', 'grade', 'teacherName', 'teacherEmail']} rows={classes} renderActions={(row) => <Actions onEdit={() => { setSelected(row); setOpen(true); }} onDelete={async () => { if (confirm(`Delete ${String(row.name || 'this class')}?`)) await deleteRecord('classes', row.id); }} />} />{open && <ClassModal record={selected || undefined} teachers={teachers} onClose={() => setOpen(false)} />}</section></ManagementLayout>;
}

export function ReportsManagement() {
  const [reports, setReports] = useState<RecordData[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<RecordData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let currentReports: RecordData[] = [];
    let currentAlerts: RecordData[] = [];
    const publish = () => {
      const getTime = (value: unknown) => value && typeof value === 'object' && 'toMillis' in value ? (value as { toMillis: () => number }).toMillis() : Date.parse(String(value || ''));
      const combined: RecordData[] = [...currentReports, ...currentAlerts.map((alert) => ({ ...alert, sourceCollection: 'alerts', reportType: 'Security alert', content: alert.description } as RecordData))];
      setReports(combined.sort((a, b) => getTime(b.createdAt || b.date || b.time) - getTime(a.createdAt || a.date || a.time)));
    };
    const unsubscribeReports = onSnapshot(collection(db, 'reports'), (snapshot) => { currentReports = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RecordData)); publish(); }, (e) => setError(e.message));
    const unsubscribeAlerts = onSnapshot(collection(db, 'alerts'), (snapshot) => { currentAlerts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RecordData)); publish(); }, (e) => setError(e.message));
    return () => { unsubscribeReports(); unsubscribeAlerts(); };
  }, []);
  const remove = async (report: RecordData) => {
    if (!confirm(`Delete ${String(report.title || 'this report')}?`)) return;
    try { await deleteRecord(String(report.sourceCollection || 'reports'), report.id); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete report.'); }
  };
  return <ManagementLayout title="Reports" subtitle="Create, review, edit, and remove incident and safety reports."><div className="management-actions"><button className="primary" onClick={() => { setSelected(null); setOpen(true); }}><Plus size={16} /> Add report</button></div>{error && <div className="notice error">{error}</div>}<section className="panel table-panel"><Table headers={['reportType', 'title', 'status', 'createdAt']} rows={reports} renderActions={(row) => <Actions onEdit={() => { setSelected(row); setOpen(true); }} onDelete={() => remove(row)} />} />{open && <ReportModal record={selected || undefined} onClose={() => setOpen(false)} />}</section></ManagementLayout>;
}
function ReportModal({ record, onClose }: { record?: RecordData; onClose: () => void }) {
  const [form, setForm] = useState({ reportType: String(record?.reportType || 'Incident'), title: String(record?.title || ''), content: String(record?.content || ''), status: String(record?.status || 'Draft') });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    setBusy(true);
    try {
      if (record) await updateRecord(String(record.sourceCollection || 'reports'), record.id, form);
      else await createRecord('reports', { ...form, createdByUserId: auth.currentUser?.uid });
      onClose();
    } catch { setBusy(false); }
  };
  return <Modal title={record ? 'Edit report' : 'Add report'} onClose={onClose}><label>Report type<select value={form.reportType} onChange={(event) => setForm({ ...form, reportType: event.target.value })}><option>Incident</option><option>Safety Assessment</option><option>Arrival Review</option><option>Administrative</option></select></label><Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} /><label>Content<textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} rows={8} /></label><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option>Draft</option><option>Reviewed</option><option>Resolved</option></select></label><SaveBar busy={busy} onCancel={onClose} onSave={save} /></Modal>;
}

export function AnnouncementsManagement() {
  const [announcements, setAnnouncements] = useState<RecordData[]>([]); const [open, setOpen] = useState(false); const [selected, setSelected] = useState<RecordData | null>(null); const [error, setError] = useState('');
  useEffect(() => onSnapshot(collection(db, 'announcements'), (snapshot) => setAnnouncements(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RecordData)).sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))), (e) => setError(e.message)), []);
  const remove = async (announcement: RecordData) => { if (!confirm(`Delete ${String(announcement.title || 'this announcement')}?`)) return; try { await deleteRecord('announcements', announcement.id); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete announcement.'); } };
  return <ManagementLayout title="Announcements" subtitle="Live bulletins published to the Safe Child app."><div className="management-actions"><button className="primary" onClick={() => { setSelected(null); setOpen(true); }}><Plus size={16} /> Add announcement</button></div>{error && <div className="notice error">{error}</div>}<section className="panel table-panel"><Table headers={['title', 'category', 'body', 'createdAt']} rows={announcements} renderActions={(row) => <Actions onEdit={() => { setSelected(row); setOpen(true); }} onDelete={() => remove(row)} />} />{open && <AnnouncementModal record={selected || undefined} onClose={() => setOpen(false)} />}</section></ManagementLayout>;
}
function AnnouncementModal({ record, onClose }: { record?: RecordData; onClose: () => void }) { const [form, setForm] = useState({ title: String(record?.title || ''), body: String(record?.body || ''), category: String(record?.category || 'General') }); const [busy, setBusy] = useState(false); const save = async () => { if (!form.title.trim() || !form.body.trim()) return; setBusy(true); try { if (record) await updateRecord('announcements', record.id, form); else await createRecord('announcements', { ...form, date: new Date().toISOString() }); onClose(); } catch { setBusy(false); } }; return <Modal title={record ? 'Edit announcement' : 'Add announcement'} onClose={onClose}><Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} /><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>General</option><option>Urgent</option><option>Events</option><option>Academic</option></select></label><label>Message<textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} rows={7} /></label><SaveBar busy={busy} onCancel={onClose} onSave={save} /></Modal>; }

export function AttendanceManagement() {
  const today = new Date().toISOString().slice(0, 10);
  const [records, setRecords] = useState<RecordData[]>([]); const [students, setStudents] = useState<RecordData[]>([]); const [users, setUsers] = useState<RecordData[]>([]); const [mode, setMode] = useState<'day' | 'range'>('day'); const [date, setDate] = useState(today); const [startDate, setStartDate] = useState(today); const [endDate, setEndDate] = useState(today); const [teacher, setTeacher] = useState(''); const [grade, setGrade] = useState(''); const [error, setError] = useState('');
  useEffect(() => onSnapshot(collection(db, 'students'), (snapshot) => setStudents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RecordData))), (e) => setError(e.message)), []);
  useEffect(() => onSnapshot(collection(db, 'users'), (snapshot) => setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RecordData))), (e) => setError(e.message)), []);
  useEffect(() => onSnapshot(collection(db, 'attendance'), (snapshot) => setRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RecordData))), (e) => setError(e.message)), []);
  const teachers = users.filter((user) => user.role === 'teacher');
  const grades = [...new Set(students.map((student) => String(student.grade || '')).filter(Boolean))].sort();
  const rows = records.map((record) => {
    const student = students.find((item) => item.id === record.studentId);
    const teacherEmail = String(record.teacherEmail || student?.teacherEmail || '').toLowerCase();
    const teacherRecord = teachers.find((item) => String(item.email || '').toLowerCase() === teacherEmail || item.id === student?.teacherUid);
    return { ...record, attendanceDate: String(record.attendanceDate || '').slice(0, 10), studentName: record.studentName || `${student?.firstName || ''} ${student?.lastName || ''}`.trim() || 'Unknown student', grade: record.grade || student?.grade || '—', guardianName: record.guardianName || student?.guardianName || '—', teacherName: record.teacherName || student?.teacherName || teacherRecord?.displayName || '—', teacherEmail: teacherEmail || String(teacherRecord?.email || '') };
  }).filter((record) => {
    const inDates = mode === 'day' ? record.attendanceDate === date : record.attendanceDate >= startDate && record.attendanceDate <= endDate;
    const teacherMatch = !teacher || record.teacherEmail === teacher.toLowerCase();
    const gradeMatch = !grade || record.grade === grade;
    return inDates && teacherMatch && gradeMatch;
  }).sort((a, b) => String(b.attendanceDate).localeCompare(String(a.attendanceDate)));
  return <ManagementLayout title="Attendance" subtitle="Export attendance for a day or date range by teacher and grade."><div className="attendance-filters"><label>View<select value={mode} onChange={(event) => setMode(event.target.value as 'day' | 'range')}><option value="day">Single day</option><option value="range">Date range</option></select></label>{mode === 'day' ? <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label> : <><label>From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></>}<label>Teacher<select value={teacher} onChange={(event) => setTeacher(event.target.value)}><option value="">All teachers</option>{teachers.map((item) => <option key={item.id} value={String(item.email || '').toLowerCase()}>{String(item.displayName || item.email)}</option>)}</select></label><label>Grade<select value={grade} onChange={(event) => setGrade(event.target.value)}><option value="">All grades</option>{grades.map((item) => <option key={item}>{item}</option>)}</select></label><button className="primary" onClick={() => exportAttendanceCsv(rows)} disabled={!rows.length}>Export CSV</button></div>{error && <div className="notice error">{error}</div>}<section className="panel table-panel"><Table headers={['attendanceDate', 'studentName', 'grade', 'teacherName', 'guardianName', 'status', 'note']} rows={rows} renderActions={() => <span className="muted">Read only</span>} />{!rows.length && <div className="empty"><p>No attendance records match these filters.</p></div>}</section></ManagementLayout>;
}
function ClassModal({ record, teachers, onClose }: { record?: RecordData; teachers: RecordData[]; onClose: () => void }) { const [form, setForm] = useState({ name: String(record?.name || ''), grade: String(record?.grade || ''), teacherEmail: String(record?.teacherEmail || ''), teacherUid: String(record?.teacherUid || ''), teacherName: String(record?.teacherName || '') }); const [busy, setBusy] = useState(false); const save = async () => { setBusy(true); try { const teacher = teachers.find((item) => String(item.email || '').toLowerCase() === form.teacherEmail.toLowerCase()); const fields = { ...form, teacherUid: String(teacher?.id || form.teacherUid || ''), teacherName: teacher?.displayName || form.teacherName }; if (record) await updateRecord('classes', record.id, fields); else await createRecord('classes', fields); onClose(); } catch { setBusy(false); } }; return <Modal title={record ? 'Edit grade class' : 'Create grade class'} onClose={onClose}><Field label="Class name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} /><Field label="Grade" value={form.grade} onChange={(value) => setForm({ ...form, grade: value })} /><label>Teacher<select value={form.teacherEmail} onChange={(event) => { const teacherEmail = event.target.value; const teacher = teachers.find((item) => String(item.email || '').toLowerCase() === teacherEmail.toLowerCase()); setForm({ ...form, teacherEmail, teacherUid: String(teacher?.id || ''), teacherName: String(teacher?.displayName || '') }); }}><option value="">Select teacher</option>{teachers.map((teacher) => <option key={teacher.id} value={String(teacher.email || '')}>{String(teacher.displayName || teacher.email)}</option>)}</select></label><SaveBar busy={busy} onCancel={onClose} onSave={save} /></Modal>; }

function ManagementLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <div className="content"><div className="page-heading"><div><p className="eyebrow">ADMIN MANAGEMENT</p><h2>{title}</h2><p className="muted">{subtitle}</p></div></div>{children}</div>; }
function Table({ headers, rows, renderActions }: { headers: string[]; rows: RecordData[]; renderActions: (row: RecordData) => React.ReactNode }) { return rows.length ? <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{fieldLabel(header)}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{headers.map((header) => <td key={header}>{String(row[header] ?? '—')}</td>)}<td>{renderActions(row)}</td></tr>)}</tbody></table></div> : <div className="empty"><p>No records found.</p></div>; }
