/* nerd AI knowledge-base generator.
   Run once (offline) to emit public/js/nerdai-data.js — a static, zero-dep data file.
   Combines curated app intents + per-institution facts (from demo.db) + academic-help intents.
   Usage: DB_PATH=.../demo.db node --experimental-sqlite --no-warnings nerdai-build.js > out.js
*/
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const PW = '123456';
const CATS = [
  { id: 'start', icon: '', label: 'Getting started', intro: 'Signing in, accounts and finding your way around nerd.' },
  { id: 'attend', icon: '', label: 'Attendance & risk', intro: 'Your attendance, what academic risk means and how to improve it.' },
  { id: 'marks', icon: '', label: 'Marks & performance', intro: 'Marks, CGPA/SGPA, performance trends and predictions.' },
  { id: 'time', icon: '', label: 'Timetable', intro: 'Your weekly class schedule.' },
  { id: 'class', icon: '', label: 'Classroom & assignments', intro: 'Assignments, notes, PDF files, submissions and deadlines.' },
  { id: 'clubs', icon: '', label: 'Clubs', intro: 'Joining, leaving and rosters.' },
  { id: 'events', icon: '', label: 'Events & campus guide', intro: 'Campus events, registration, and the KPRIET campus guide.' },
  { id: 'notif', icon: '', label: 'Notifications & language', intro: 'Alerts, the notification centre and switching language.' },
  { id: 'inst', icon: '', label: 'Institutions', intro: 'The universities and colleges on nerd.' },
  { id: 'teach', icon: '', label: 'For teachers', intro: 'Attendance, marks, voice entry and more.' },
  { id: 'admin', icon: '', label: 'For admins', intro: 'People, portals, approvals and settings.' },
  { id: 'study', icon: '', label: 'Study help', intro: 'Friendly advice on attendance, exams, CGPA and student life.' },
  { id: 'about', icon: '', label: 'About nerd', intro: 'What nerd is and how this assistant works.' },
];

const intents = [];
let seq = 0;
function add(cat, q, a, opts = {}) {
  const id = opts.id || `${cat}-x${++seq}`;
  intents.push({ id, cat, q: Array.isArray(q) ? q : [q], a, link: opts.link || null, linkLabel: opts.linkLabel || null, chips: opts.chips || [] });
  return id;
}

/* ---------------- Getting started ---------------- */
add('start', ['how do i log in', 'how to login', 'sign in', 'where do i log in', 'login help', 'how can i sign in'],
  'Pick your institution from the home page, then choose the Student, Faculty or Admin tab on the sign-in screen, enter your ID and password, and select Sign in.',
  { id: 'start-login', link: '#/universities', linkLabel: 'Go to institutions', chips: ['start-pw', 'start-studentid', 'start-forgot'] });
add('start', ['what is the password', 'default password', 'demo password', 'which password do i use', 'password for login'],
  `For this demo every account uses the password ${PW}.`, { id: 'start-pw', chips: ['start-studentid', 'start-forgot'] });
add('start', ['what is the student login', 'student id', 'student username', 'student roll number to login', 'what roll number do i use'],
  `At KPRIET the demo student logs in with roll number 25CS324 and password ${PW}. At other colleges the sample student is 25CSE101.`, { id: 'start-studentid', chips: ['start-pw', 'start-facultyid'] });
add('start', ['what is the faculty login', 'teacher login', 'staff id', 'faculty username', 'how does a teacher log in'],
  `At KPRIET the demo faculty login is CS014 with password ${PW}. Choose the Faculty tab on the sign-in screen.`, { id: 'start-facultyid', chips: ['start-adminid', 'teach-1'] });
add('start', ['what is the admin login', 'admin username', 'how do i log in as admin', 'administrator login'],
  `KPRIET’s college admin is kpriet.admin, and there is a platform super admin named superadmin. Both use password ${PW} on the Admin tab.`, { id: 'start-adminid', chips: ['admin-1'] });
add('start', ['i forgot my password', 'reset password', 'forgot password', 'cant remember my password', 'recover my account'],
  'On the sign-in screen choose Forgot password, enter your account email, and you’ll get a one-time code to set a new one. In the demo the code is shown on screen; a new password must contain at least one letter and one digit.', { id: 'start-forgot', chips: ['start-changepw'] });
add('start', ['how do i change my password', 'change password', 'update my password', 'set a new password'],
  'Open your profile (or admin Settings) and choose Change password, or use the Change password link in the top-right account menu. New passwords need at least one letter and one digit.', { id: 'start-changepw', chips: ['start-forgot'] });
add('start', ['what are the roles', 'what roles exist', 'types of accounts', 'student teacher admin', 'who can use nerd'],
  'nerd has three kinds of account: Student, Faculty (teachers) and Admin (college, university and platform administrators). Each sees a portal built for what they do.', { id: 'start-roles', chips: ['start-studentid', 'start-facultyid', 'admin-roles'] });
add('start', ['how do i navigate', 'how do i get around', 'where is the menu', 'how to use the app', 'find my way around'],
  'Everything is in the left sidebar — your dashboard, attendance, courses, timetable, classroom, clubs and more. The top bar has search, language, notifications and your account menu.', { id: 'start-nav', chips: ['start-search', 'notif-1'] });
add('start', ['how do i search', 'search', 'find a student', 'global search', 'search bar'],
  'Use the search box in the top bar. Students can search their courses and notifications; teachers search their courses and students; admins search students, staff, courses and departments.', { id: 'start-search' });
add('start', ['how do i sign out', 'log out', 'logout', 'sign out of my account'],
  'Open the account menu at the top-right (your name) and choose Sign out.', { chips: ['start-changepw'] });
add('start', ['remember me', 'stay signed in', 'keep me logged in', 'does it remember my login'],
  'Tick Remember me on the sign-in screen to stay signed in for 30 days on this device. Without it you stay signed in for the session only.', {});
add('start', ['what is nerd', 'what is this app', 'what does nerd do', 'tell me about nerd'],
  'nerd is an academic monitoring platform for universities and colleges — attendance tracking and prediction, explainable academic-risk alerts, voice-based mark entry, timetables, a classroom, clubs, events and a campus guide, all in one place.', { chips: ['about-1', 'attend-risk'] });

/* ---------------- Attendance & risk ---------------- */
add('attend', ['how do i see my attendance', 'view attendance', 'where is my attendance', 'check attendance', 'my attendance percentage'],
  'Open Attendance from the sidebar. You’ll see your overall percentage plus a subject-by-subject breakdown, with a trend chart you can tap for the exact figure on any date.', { link: '#/student/attendance', linkLabel: 'Open attendance', chips: ['attend-threshold', 'attend-improve'] });
add('attend', ['what attendance do i need', 'minimum attendance', 'attendance requirement', 'required percentage', 'how much attendance is needed', 'what is the attendance threshold', 'attendance rule', 'attendance policy', 'how is attendance status decided', 'what does safe mean', 'what is critical attendance'],
  'You need at least 75% in each course (your college can change this). Safe means 80% or more with more than two classes to spare. Attention means you are close: under 80%, or two absences would take you below the line. Critical means you are already under 75%.', { id: 'attend-threshold', chips: ['attend-improve', 'attend-risk'] });
add('attend', ['how do i improve my attendance', 'improve attendance', 'raise my attendance', 'fix low attendance', 'my attendance is low'],
  'nerd shows how many classes in a row you need to attend to get back above the line. Attend every upcoming session in the flagged course, and watch the predicted percentage recover on your dashboard.', { id: 'attend-improve', chips: ['attend-threshold', 'study-attend'] });
add('attend', ['what is academic risk', 'what does risk mean', 'explain risk', 'what is risk', 'how does risk work'],
  'Academic risk is nerd’s early warning that a course may be heading for trouble. Every alert lists the reasons (declining attendance, low marks, a drop in performance), so you know exactly what to act on.', { id: 'attend-risk', link: '#/student/risk', linkLabel: 'Open risk', chips: ['attend-risklevels', 'attend-improve'] });
add('attend', ['what are the risk levels', 'risk levels', 'what is high risk', 'what is attention', 'normal attention high'],
  'There are three levels: Normal (on track), Attention (something to watch), and High (needs action now). Each course shows its level with the reasons behind it.', { id: 'attend-risklevels', chips: ['attend-risk'] });
add('attend', ['why am i at risk', 'why is my course flagged', 'reason for my risk', 'what is causing my risk'],
  'Open Performance, then the Risk tab. The flagged course lists its reasons — for example attendance below the line, a recent mark drop, or a declining trend. Each reason is something concrete you can improve.', { chips: ['attend-improve', 'attend-risklevels'] });
add('attend', ['how is attendance predicted', 'attendance prediction', 'predicted attendance', 'how does the prediction work'],
  'nerd projects where your attendance is heading from your recent pattern, so a dip is flagged before it becomes a shortage. It also tells you the classes needed to recover.', { chips: ['attend-threshold', 'attend-improve'] });
add('attend', ['see attendance by subject', 'subject wise attendance', 'per course attendance', 'attendance for each subject'],
  'Your Attendance page and the dashboard’s Your courses table both break attendance down by subject, each with its own percentage and status.', { link: '#/student/attendance', linkLabel: 'Open attendance', chips: ['attend-threshold'] });

/* ---------------- Marks & performance ---------------- */
add('marks', ['how do i see my marks', 'view marks', 'where are my marks', 'check my grades', 'my results', 'see my scores'],
  'Open Performance from the sidebar to see your marks by course and assessment, along with your performance trend.', { id: 'marks-1', link: '#/student/performance', linkLabel: 'Open performance', chips: ['marks-cgpa', 'marks-notify'] });
add('marks', ['what is my cgpa', 'see cgpa', 'where is my cgpa', 'cgpa and sgpa', 'my gpa'],
  'Your current CGPA and latest SGPA appear on your dashboard and profile. CGPA is your cumulative average across semesters; SGPA is for the current one.', { id: 'marks-cgpa', chips: ['marks-1', 'study-cgpa'] });
add('marks', ['what is sgpa', 'difference between cgpa and sgpa', 'sgpa meaning', 'explain sgpa'],
  'SGPA is your grade-point average for a single semester. CGPA is the running average across all semesters so far.', { chips: ['marks-cgpa'] });
add('marks', ['will i be told when marks change', 'mark notifications', 'notify me of new marks', 'do i get alerts for marks'],
  'Yes — when a teacher posts or updates your marks, nerd sends you a notification automatically, and it appears in your notification centre.', { id: 'marks-notify', chips: ['notif-1'] });
add('marks', ['how do i see my performance trend', 'performance over time', 'am i improving', 'my performance chart'],
  'The Performance page shows a trend line of your results. Tap any point to see the exact value and date.', { link: '#/student/performance', linkLabel: 'Open performance', chips: ['marks-1'] });

/* ---------------- Timetable ---------------- */
add('time', ['where is my timetable', 'view timetable', 'my class schedule', 'see timetable', 'weekly schedule', 'my periods'],
  'Open Timetable from the sidebar for your weekly grid — all seven periods a day, with tea and lunch breaks and the mentor hour marked.', { id: 'time-1', link: '#/student/timetable', linkLabel: 'Open timetable', chips: ['time-staff', 'class-1'] });
add('time', ['teacher timetable', 'staff timetable', 'my teaching schedule', 'when do i teach'],
  'Faculty have a Timetable page too, showing the sections and periods you teach across the week.', { id: 'time-staff', link: '#/staff/timetable', linkLabel: 'Open teaching timetable', chips: ['teach-1'] });
add('time', ['are labs shown', 'lab periods', 'does the timetable show labs', 'practical sessions'],
  'Yes — labs appear as two-period blocks, and Saturday carries activity slots like remedial classes, seminars and club hours.', {});

/* ---------------- Classroom ---------------- */
add('class', ['what is classroom', 'how does classroom work', 'classroom feature', 'about classroom'],
  'Classroom is nerd’s space for each course: teachers post assignments, notes and materials, and students read the stream and submit their work — much like Google Classroom.', { id: 'class-1', link: '#/student/classroom', linkLabel: 'Open classroom', chips: ['class-submit', 'class-deadline'] });
add('class', ['how do i submit an assignment', 'submit work', 'turn in assignment', 'hand in my assignment', 'upload my submission'],
  'Open Classroom, pick the assignment, and submit your response there. You can attach a PDF (up to 12 MB) if the assignment needs a file.', { id: 'class-submit', link: '#/student/classroom', linkLabel: 'Open classroom', chips: ['class-pdf', 'class-deadline'] });
add('class', ['can i upload a pdf', 'attach pdf', 'pdf upload', 'submit a pdf', 'upload a file'],
  'Yes — students can attach a PDF to a submission, and teachers can attach PDF notes and materials to a post. The limit is 12 MB per file.', { id: 'class-pdf', chips: ['class-submit'] });
add('class', ['where are my deadlines', 'upcoming deadlines', 'assignment due dates', 'when is my assignment due', 'my deadlines'],
  'Your dashboard and Classroom show upcoming assignment deadlines, drawn from what your teachers have posted.', { id: 'class-deadline', link: '#/student/classroom', linkLabel: 'Open classroom', chips: ['class-submit'] });
add('class', ['how do teachers post an assignment', 'create assignment', 'post a note', 'teacher classroom'],
  'In Classroom a teacher can post an assignment, note or material, attach a PDF, and edit or delete it later. Posting a new assignment notifies the whole class.', { link: '#/staff/classroom', linkLabel: 'Open classroom (staff)', chips: ['class-submit'] });

/* ---------------- Clubs ---------------- */
add('clubs', ['what clubs are there', 'list of clubs', 'see clubs', 'available clubs', 'student clubs'],
  'Open Clubs from the sidebar to browse your college’s clubs — technical, cultural and wellbeing groups such as Ignitron, IEEE, Robotics, Sangamam and the Mental Health club.', { id: 'clubs-1', link: '#/student/clubs', linkLabel: 'Open clubs', chips: ['clubs-join'] });
add('clubs', ['how do i join a club', 'join a club', 'sign up for a club', 'become a club member', 'club membership'],
  'Open Clubs, choose one and fill the short membership form — your name and roll number are pre-filled; add your phone and what interests you. You can leave a club any time from the same page.', { id: 'clubs-join', link: '#/student/clubs', linkLabel: 'Open clubs', chips: ['clubs-leave'] });
add('clubs', ['how do i leave a club', 'leave a club', 'cancel club membership', 'unjoin a club'],
  'On the Clubs page, open a club you’ve joined and choose Leave. Your spot is freed immediately.', { id: 'clubs-leave', chips: ['clubs-join'] });
add('clubs', ['can teachers see club members', 'club roster', 'who manages clubs', 'club members list'],
  'Faculty can see each club’s roster, including members’ phone numbers, so they can organise activities.', {});

/* ---------------- Events & campus guide ---------------- */
add('events', ['what events are on', 'upcoming events', 'campus events', 'see events', 'college events'],
  'Campus events appear on your student dashboard in a Campus events card, and in full in the Campus Guide. When an admin publishes an event, you’re notified.', { link: '#/campus', linkLabel: 'Open campus guide', chips: ['events-register', 'events-guide'] });
add('events', ['how do i register for an event', 'register for an event', 'sign up for an event', 'event registration', 'join an event'],
  'On the Campus events card (or in the Campus Guide) choose Register. It switches to Registered, and you can Cancel any time. Admins can see who has registered.', { id: 'events-register', chips: ['events-cancel'] });
add('events', ['how do i cancel an event registration', 'cancel my event', 'unregister from an event', 'remove my registration'],
  'Open the event and choose Cancel on the card. Your registration is removed right away.', { id: 'events-cancel', chips: ['events-register'] });
add('events', ['what is the campus guide', 'campus guide', 'kpr compass', 'what is kpr compass', 'campus map'],
  'The Campus Guide (KPR Compass at KPRIET) helps you find your way around campus: search places, get routes and GPS directions, see events, scan QR codes and check in as a visitor, in English or Tamil.', { id: 'events-guide', link: '#/campus', linkLabel: 'Open campus guide', chips: ['events-routes', 'events-qr'] });
add('events', ['how do i get directions', 'campus routes', 'find a place on campus', 'navigate campus', 'gps directions'],
  'In the Campus Guide, search for a place and choose directions — it draws a route and can use GPS to guide you there.', { id: 'events-routes', chips: ['events-guide'] });
add('events', ['what are the qr codes for', 'qr code', 'scan qr', 'visitor check in', 'how do visitors check in'],
  'Places in the Campus Guide have QR codes you can scan to jump straight to them, and visitors can check in through the guide.', { id: 'events-qr', chips: ['events-guide'] });
add('events', ['why is an admin event not showing', 'admin added event not visible', 'event not appearing', 'published event missing'],
  'A campus event shows to students once it’s published. On publish, nerd notifies the college and the event appears in the Campus events card and the guide. If you don’t see it, make sure it was published.', { chips: ['events-register'] });

/* ---------------- Notifications & language ---------------- */
add('notif', ['where are my notifications', 'notification centre', 'see notifications', 'my alerts', 'notifications'],
  'Open Notifications from the sidebar, or the bell in the top bar. New alerts stay under New until you read them; read ones are filed by category under Read, where you can delete what you no longer need.', { id: 'notif-1', link: '#/student/notifications', linkLabel: 'Open notifications', chips: ['notif-types', 'notif-lang'] });
add('notif', ['what notifications will i get', 'types of notifications', 'what am i notified about', 'notification categories'],
  'You’re notified about marks, attendance, academic risk, courses, registrations, events, clubs, classroom posts and announcements — all filed by category.', { id: 'notif-types', chips: ['notif-1'] });
add('notif', ['how do i change the language', 'change language', 'switch language', 'tamil', 'hindi', 'language options', 'translate the app'],
  'Use the globe button in the top bar to switch between English, Tamil and Hindi. The whole interface translates and your choice is remembered on this device.', { id: 'notif-lang', chips: ['notif-1'] });
add('notif', ['mark all as read', 'clear notifications', 'how do i read all notifications', 'mark everything read'],
  'In the notification centre choose Mark all as read; everything moves to the Read tab, organised by category.', { chips: ['notif-1'] });

/* ---------------- Institutions (static) ---------------- */
add('inst', ['how many institutions are there', 'how many colleges', 'how many universities', 'list institutions', 'what institutions are on nerd', 'which colleges are on nerd', 'which universities are on nerd', 'what colleges use nerd', 'list of colleges'],
  'nerd hosts 14 universities and 28 colleges across India — from Anna University and KPRIET to the IITs, NITs, BITS, VIT and more. Browse them all from the home page.', { id: 'inst-1', link: '#/universities', linkLabel: 'Browse institutions', chips: ['inst-logos'] });
add('inst', ['do institutions have logos', 'real logos', 'college logos', 'where are the logos', 'institution branding'],
  'Yes — institutions carry their real crests across the app. Admins can also upload or replace an institution’s logo from Settings.', { id: 'inst-logos', chips: ['admin-logo'] });

/* ---------------- For teachers ---------------- */
add('teach', ['what can teachers do', 'teacher features', 'faculty tools', 'what is in the staff portal', 'teacher portal'],
  'As faculty you can take attendance, enter and update marks (including by voice), manage your Classroom, see your timetable and students, run analytics, monitor course risk and manage clubs.', { id: 'teach-1', chips: ['teach-voice', 'teach-marks'] });
add('teach', ['what is voice entry', 'voice mark entry', 'enter marks by voice', 'how does voice entry work', 'voice marks'],
  'Voice Entry lets teachers read marks aloud instead of typing. It’s noise-gated — it listens to the nearest, loudest speaker only, shows a sensitivity meter, supports hold-to-talk and rejects low-confidence words so marks stay accurate.', { id: 'teach-voice', link: '#/staff/go/voice', linkLabel: 'Open voice entry', chips: ['teach-voicerange', 'teach-sheets'] });
add('teach', ['can i say a range in voice entry', 'voice range', 'say c5 to e5', 'enter a range by voice'],
  'Yes — saying something like “C5 to E5” fills every cell in that range, including the ones in between.', { id: 'teach-voicerange', chips: ['teach-voice'] });
add('teach', ['what are voice sheets', 'voice sheet', 'excel style sheet', 'mark sheet'],
  'Voice Sheets are an Excel-style grid where you can enter and review marks quickly, by keyboard or voice.', { id: 'teach-sheets', link: '#/staff/sheets', linkLabel: 'Open voice sheets', chips: ['teach-voice'] });
add('teach', ['how do i enter marks', 'add marks', 'record marks', 'mark entry', 'put in marks'],
  'Teachers enter marks from the Marks or Voice Sheets area — by typing or by voice. Students are notified automatically when marks are posted or changed.', { id: 'teach-marks', link: '#/staff/go/marks', linkLabel: 'Open marks', chips: ['teach-voice', 'marks-notify'] });
add('teach', ['how do i take attendance', 'mark attendance', 'record attendance', 'attendance entry'],
  'Open Attendance in the staff portal, pick the class and session, and mark who’s present. Risk updates follow automatically.', { link: '#/staff/go/attendance', linkLabel: 'Open attendance', chips: ['teach-marks'] });
add('teach', ['can teachers monitor risk', 'risk monitoring staff', 'see which students are at risk', 'class risk'],
  'Analytics & Risk shows which students in your courses are flagged and why, so you can step in early.', { link: '#/staff/risk', linkLabel: 'Open Analytics & Risk', chips: ['attend-risk'] });

/* ---------------- For admins ---------------- */
add('admin', ['what can admins do', 'admin features', 'admin portal', 'administration tools', 'what is in the admin portal'],
  'Admins look after people and portals: students, teachers and other admins, which features the student and teacher portals show, course requests, announcements, departments, campuses, the campus guide, imports and the audit log. Attendance, marks and classroom work stay with teachers.', { id: 'admin-1', chips: ['admin-addstudent', 'admin-portals', 'admin-import'] });
add('admin', ['what are the admin roles', 'admin levels', 'college vs university admin', 'super admin', 'types of admin'],
  'College admins look after one college, university admins after every college in their university, and the super admin after the whole platform.', { id: 'admin-roles', chips: ['admin-1'] });
add('admin', ['how do i add a student', 'add a student', 'add new student', 'create a student account', 'new student', 'enroll a student', 'register a new student'],
  'Open Students and choose Add student. Fill in the name, roll number, department and batch, then save. To add many at once, use Import CSV on the same page.', { id: 'admin-addstudent', link: '#/admin/records/students', linkLabel: 'Open students', chips: ['admin-import', 'admin-addteacher'] });
add('admin', ['how do i add a teacher', 'add a teacher', 'add faculty', 'add new staff', 'create a teacher account', 'new teacher'],
  'Open Teachers and choose Add teacher. Enter their name, employee code, department and designation, then save.', { id: 'admin-addteacher', link: '#/admin/records/staff', linkLabel: 'Open teachers', chips: ['admin-addstudent', 'admin-import'] });
add('admin', ['turn a portal feature off', 'switch off a feature', 'disable a feature', 'turn off clubs', 'close the student portal', 'portal settings', 'manage portals', 'turn a feature on', 'enable a feature', 'hide timetable', 'student and teacher portals'],
  'Open Student & teacher portals. Every feature (timetable, classroom, clubs, voice entry, campus guide and nerd AI) has its own switch, and changes apply right away. Turning off Portal sign-in closes that portal completely.', { id: 'admin-portals', link: '#/admin/portals', linkLabel: 'Open portals', chips: ['admin-1'] });
add('admin', ['import students from csv', 'bulk upload students', 'import csv', 'upload students in bulk', 'bulk import', 'export data', 'download records as csv'],
  'Open Import / Export, download the CSV template, fill it in and upload it. nerd checks every row first and shows what needs fixing before anything is saved. Exports work from the same page.', { id: 'admin-import', link: '#/admin/data', linkLabel: 'Open import / export', chips: ['admin-addstudent'] });
add('admin', ['send a notification', 'send an announcement', 'notify students', 'broadcast a message', 'announce something'],
  'Open Notifications, write a title and message, choose who should get it (students, teachers or both) and send.', { id: 'admin-notify', link: '#/admin/notifications', linkLabel: 'Open notifications', chips: ['admin-1'] });
add('admin', ['audit logs', 'who changed what', 'see recent changes', 'activity log', 'history of changes', 'audit trail'],
  'Audit Logs list every change made in the admin portal: who did it, when, and what it looked like before and after.', { id: 'admin-audit', link: '#/admin/audit', linkLabel: 'Open audit logs', chips: ['admin-1'] });
add('admin', ['add a department', 'manage departments', 'create department', 'add a campus', 'manage campuses'],
  'Departments and Campuses are under Institution in the sidebar. Choose Add on either page to create one.', { id: 'admin-dept', link: '#/admin/records/departments', linkLabel: 'Open departments', chips: ['admin-1'] });
add('admin', ['how do i upload a logo', 'change institution logo', 'add college logo', 'upload branding', 'replace the logo'],
  'In Settings, open the Institution logo card and upload a PNG, JPG, WEBP or SVG (up to 2 MB). College admins set their college logo; university and super admins set the university one.', { id: 'admin-logo', link: '#/admin/settings', linkLabel: 'Open settings', chips: ['inst-logos'] });
add('admin', ['how do course approvals work', 'approve a course', 'course registration approval', 'student course request', 'course requests'],
  'When a student asks to add an elective, it shows up under Course requests. Approve or decline it and the student is told either way.', { link: '#/admin/registrations', linkLabel: 'Open course requests', chips: ['admin-1'] });
add('admin', ['can admins manage assessments', 'admin assessments', 'do admins enter marks', 'assessment management', 'can admin see attendance'],
  'No. Attendance, marks, assignments and notes belong to teachers. Admins look after people, portals and settings.', {});

/* ---------------- About nerd / the assistant ---------------- */
add('about', ['who are you', 'what are you', 'are you a robot', 'are you ai', 'what is nerd ai'],
  'I’m nerd AI, the helper built into nerd. Ask about your attendance, marks, timetable, deadlines, clubs, events or anything on the platform.', { id: 'about-1', chips: ['about-how', 'start-login'] });
add('about', ['how do you work', 'how were you trained', 'how do you answer', 'how does this chatbot work'],
  'I read your own records (attendance, marks, timetable, deadlines) and a set of answers about nerd. If your college has switched on the online assistant, I can also answer general questions.', { id: 'about-how', chips: ['about-1'] });
add('about', ['thank you', 'thanks', 'thx', 'ty', 'thank u'],
  'Happy to help! Ask me anything else, or pick a topic below.', { chips: [] });
add('about', ['hi', 'hello', 'hey', 'good morning', 'namaste', 'start', 'help'],
  'Hi! I’m nerd AI. What would you like help with? Pick a topic or type your question.', { id: 'start-1', chips: [] });
add('about', ['who made this', 'who built nerd', 'who created this app', 'developer'],
  'nerd is a hackathon project — a multi-university academic monitoring platform. This assistant is part of it.', {});
add('about', ['is my data safe', 'privacy', 'is this secure', 'data privacy', 'are these real students'],
  'This is a demo with fictional people, so no real student data is used. I only ever see your own records, never anyone else’s.', {});

/* ---------------- Study help ---------------- */
add('study', ['how do i improve my attendance', 'tips to improve attendance', 'attendance advice', 'my attendance is low what do i do'],
  'Treat the 75% line as the floor, not the goal. Attend every session in any flagged course first, use nerd’s “classes needed to recover” number as a target, and set a reminder for early-morning periods you tend to miss.', { id: 'study-attend', chips: ['attend-improve', 'study-cgpa'] });
add('study', ['how do i improve my cgpa', 'raise my cgpa', 'improve grades', 'how to get better marks', 'tips for better marks'],
  'Focus on the courses dragging your average, not the ones you already do well in. Keep up with Classroom assignments, clear doubts early rather than before exams, and watch your Performance trend to see what’s working.', { id: 'study-cgpa', chips: ['marks-cgpa', 'study-exam'] });
add('study', ['how do i prepare for exams', 'exam tips', 'study tips', 'how to study', 'exam preparation'],
  'Space your revision over several days instead of one long night, practise past questions actively, and review the topics behind any Attention or High-risk course first — those are where marks are most at stake.', { id: 'study-exam', chips: ['study-stress', 'study-time'] });
add('study', ['i am stressed', 'exam stress', 'feeling anxious', 'i feel overwhelmed', 'study stress'],
  'That’s very common. Break work into small sessions with short breaks, keep sleep regular, and reach out — many colleges here have a Mental Health club you can find under Clubs. You don’t have to manage it alone.', { id: 'study-stress', chips: ['clubs-1'] });
add('study', ['how do i manage my time', 'time management', 'balance studies', 'study schedule', 'how to be productive'],
  'Use your Timetable as the backbone of your week, block fixed slots for assignments right after they’re posted in Classroom, and tackle the hardest subject when your focus is best. Small, regular effort beats last-minute cramming.', { id: 'study-time', chips: ['time-1', 'study-exam'] });
add('study', ['i have a backlog', 'arrear', 'failed a subject', 'how to clear backlog', 'what is a backlog'],
  'A backlog is a course you still need to clear. Prioritise it alongside your current load, use Classroom materials and your teacher’s office hours, and keep its attendance up so you’re eligible for the exam.', { chips: ['study-exam', 'attend-threshold'] });

/* ---------------- Generated: per-institution facts ---------------- */
function openDb() {
  const p = process.env.DB_PATH;
  if (!p || !fs.existsSync(p)) return null;
  try { return new DatabaseSync(p); } catch { return null; }
}
const db = openDb();
let instCount = 0;
if (db) {
  const unis = db.prepare('SELECT code, name, short_name, location, type, established FROM universities WHERE active = 1 ORDER BY id').all();
  const cols = db.prepare('SELECT c.code, c.name, c.short_name, c.location, c.category, c.established, c.website, u.name AS uni FROM colleges c JOIN universities u ON u.id = c.university_id WHERE c.active = 1 ORDER BY c.id').all();
  const low = (s) => String(s || '').toLowerCase();
  for (const u of unis) {
    const nm = u.name, sn = u.short_name || u.name;
    const facts = [`${nm} (${sn}) is a ${low(u.type)} on nerd`, u.location ? `located in ${u.location}` : '', u.established ? `established in ${u.established}` : ''].filter(Boolean).join(', ') + '.';
    add('inst', [`tell me about ${low(nm)}`, `about ${low(sn)}`, `what is ${low(sn)}`, `where is ${low(sn)}`, `${low(sn)}`],
      facts, { id: `uni-${low(u.code)}`, link: '#/universities', linkLabel: 'Browse institutions' });
    add('inst', [`what is the code for ${low(sn)}`, `${low(sn)} code`, `code of ${low(nm)}`, `short name for ${low(nm)}`],
      `On nerd, ${nm} uses the code ${u.code}${sn && sn !== nm ? ` (shown as ${sn})` : ''}.`, { id: `unicode-${low(u.code)}` });
    if (u.established) add('inst', [`when was ${low(sn)} established`, `${low(sn)} established`, `${low(sn)} founded`, `how old is ${low(sn)}`, `${low(sn)} year`],
      `${nm} was established in ${u.established}.`, { id: `uniyear-${low(u.code)}` });
    instCount++;
  }
  for (const c of cols) {
    const nm = c.name, sn = c.short_name || c.name;
    const bits = [`${nm}${sn && sn !== nm ? ` (${sn})` : ''} is on nerd under ${c.uni}`, c.location ? `in ${c.location}` : '', c.category ? c.category.replace(/·/g, '—') : '', c.established ? `established ${c.established}` : ''].filter(Boolean).join(', ') + '.';
    const extra = c.website ? ` Website: ${c.website}.` : '';
    add('inst', [`tell me about ${low(nm)}`, `about ${low(sn)}`, `what is ${low(sn)}`, `where is ${low(sn)}`, `which university is ${low(sn)} under`, `${low(sn)}`],
      bits + extra, { id: `col-${low(c.code)}`, link: '#/universities', linkLabel: 'Browse institutions' });
    add('inst', [`what is the code for ${low(sn)}`, `${low(sn)} code`, `code of ${low(nm)}`, `login code for ${low(sn)}`],
      `On nerd, ${nm} uses the college code ${c.code}.`, { id: `colcode-${low(c.code)}` });
    add('inst', [`which university is ${low(sn)} affiliated to`, `${low(sn)} affiliation`, `who runs ${low(sn)}`, `${low(sn)} parent university`],
      `${nm} sits under ${c.uni} on nerd${c.category ? `, as ${c.category.replace(/·/g, '—').toLowerCase()}` : ''}.`, { id: `colaff-${low(c.code)}` });
    if (c.established) add('inst', [`when was ${low(sn)} established`, `${low(sn)} established`, `${low(sn)} founded`, `how old is ${low(sn)}`, `${low(sn)} year`],
      `${nm} was established in ${c.established}.`, { id: `colyear-${low(c.code)}` });
    instCount++;
  }
  db.close();
}

/* ---------------- paraphrase expansion ----------------
   Add natural alternative phrasings users actually type, derived from existing ones.
   Keeps recall high without hand-writing every variant. Deduped per intent. */
const PREFIX = [
  [/^how do i /, ['how can i ', 'how to ', 'how do you ', 'how would i ']],
  [/^what is /, ["what's ", 'what does ', 'explain ']],
  [/^what are /, ["what're ", 'explain ']],
  [/^where is /, ['where can i find ', 'where do i find ', "where's "]],
  [/^where are /, ['where can i find ', 'where do i find ']],
  [/^see /, ['view ', 'show me ', 'i want to see ']],
  [/^can i /, ['could i ', 'am i able to ', 'is it possible to ']],
];
for (const it of intents) {
  const have = new Set(it.q.map((s) => s.toLowerCase()));
  const extra = [];
  for (const base of it.q.slice(0, 4)) {
    const b = base.toLowerCase();
    for (const [re, reps] of PREFIX) {
      if (re.test(b)) for (const r of reps) { const v = b.replace(re, r); if (!have.has(v)) { have.add(v); extra.push(v); } }
    }
    if (extra.length >= 6) break;
  }
  it.q = it.q.concat(extra.slice(0, 6));
}

/* ---------------- plainer wording ----------------
   Answers read better as normal sentences, so em-dashes become commas or full stops. */
const SENT = /^(it|it’s|you|you’re|your|they|so|nerd|each|everything|that|this|there|the|a|an|and|many|both|just)\b/i;
for (const it of intents) {
  it.a = it.a.replace(/\s+—\s+([^—]*?)\s+—\s+/g, ' ($1) ').replace(/\s+—\s+(.)/g, (m, ch, off, str) => {
    const rest = str.slice(off).replace(/^\s+—\s+/, '');
    return SENT.test(rest) && !/^(a|an|the|and)\b/i.test(rest) ? '. ' + ch.toUpperCase() : ', ' + ch;
  });
}

/* ---------------- category item lists ---------------- */
const catItems = {};
for (const c of CATS) catItems[c.id] = [];
for (const it of intents) if (catItems[it.cat]) catItems[it.cat].push(it.id);

/* Pick a tidy, curated subset of up to 8 items to show as the menu for each category
   (institution category would otherwise list dozens). */
const MENU_PICK = {
  start: ['start-login', 'start-pw', 'start-studentid', 'start-forgot', 'start-changepw', 'start-roles'],
  inst: ['inst-1', 'inst-logos', 'uni-au', 'col-kpriet', 'col-iitm', 'col-bitsp'],
};
const categories = CATS.map((c) => ({ ...c, items: (MENU_PICK[c.id] || catItems[c.id]).filter((id) => intents.some((i) => i.id === id)).slice(0, 8) }));

/* count total question phrasings */
const qCount = intents.reduce((s, i) => s + i.q.length, 0);

const out = `/* nerd AI knowledge base — generated by nerdai-build.js. Do not edit by hand.
   ${intents.length} intents, ${qCount} question phrasings (${instCount} institution entries). */
window.NerdAIKB = ${JSON.stringify({ meta: { intents: intents.length, questions: qCount }, categories, intents })};
`;
const target = process.argv[2] || path.join(__dirname, 'nerdai-data.js');
fs.writeFileSync(target, out);
console.error(`Wrote ${target}: ${intents.length} intents, ${qCount} question phrasings, ${instCount} institutions.`);
