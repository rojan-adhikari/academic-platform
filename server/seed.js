// Seeds the platform with real, publicly known Indian universities and colleges, populated with GENERATED people and
// academic records. No real student or staff data is used: every name, roll number, mark and attendance record is synthetic.
// Usage: npm run seed   (drops and recreates data/platform.db)
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const risk = require('./engine/risk');
const scope = require('./scope');
const { logoFor } = require('./lib');

const DEMO_PASSWORD = '123456';

function mulberry32(seed) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(42);
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const salt = crypto.randomBytes(16).toString('hex');
const PW = auth.hashPasswordFast(DEMO_PASSWORD, salt);

const FIRST_M = ['Aarav', 'Vikram', 'Karthik', 'Arjun', 'Siddharth', 'Naveen', 'Pranav', 'Rohit', 'Harish', 'Gokul', 'Dinesh', 'Manoj', 'Surya', 'Ajay', 'Bharath', 'Yash', 'Imran', 'Joel', 'Nikhil', 'Varun', 'Kiran', 'Tarun', 'Aditya', 'Sanjay', 'Deepak', 'Hari', 'Lokesh', 'Prakash', 'Ravi', 'Sabari'];
const FIRST_F = ['Priya', 'Divya', 'Sneha', 'Kavya', 'Meera', 'Lakshmi', 'Nandhini', 'Pooja', 'Shruthi', 'Aishwarya', 'Harini', 'Janani', 'Keerthana', 'Swathi', 'Ananya', 'Fathima', 'Riya', 'Sandhya', 'Varsha', 'Bhavana', 'Ishita', 'Nisha', 'Sowmya', 'Tanvi', 'Gayathri'];
const LAST = ['Kumar', 'Krishnan', 'Raman', 'Iyer', 'Nair', 'Reddy', 'Pillai', 'Menon', 'Rao', 'Subramanian', 'Natarajan', 'Shetty', 'Joseph', 'Thomas', 'Das', 'Bose', 'Patel', 'Gupta', 'Singh', 'Mehta', 'Varghese', 'Chandran', 'Murugan', 'Selvam', 'Babu', 'Ganesan', 'Hegde', 'Kulkarni', 'Mishra', 'Paul'];

const CATALOG = {
  CSE: [
    ['CS2301', 'Data Structures', 'Core', 'TwL', 4], ['CS2302', 'Object Oriented Programming', 'Core', 'Theory', 3],
    ['MA2301', 'Discrete Mathematics', 'Foundation', 'Theory', 4], ['CS2303', 'Digital Principles and Computer Organization', 'Core', 'Theory', 3],
    ['CS2311', 'Data Structures Laboratory', 'Core', 'Lab', 2],
  ],
  CSE5: [
    ['CS3501', 'Computer Networks', 'Core', 'Theory', 3], ['CS3502', 'Operating Systems', 'Core', 'TwL', 4],
    ['CS3503', 'Theory of Computation', 'Core', 'Theory', 3], ['CS3551', 'Machine Learning', 'Professional Elective', 'Theory', 3],
    ['CS3511', 'Networks Laboratory', 'Core', 'Lab', 2],
  ],
  CSE4: [['CS2401', 'Design and Analysis of Algorithms', 'Core', 'TwL', 4], ['CS2402', 'Database Management Systems', 'Core', 'Theory', 3]],
  IT: [
    ['IT2301', 'Data Structures', 'Core', 'TwL', 4], ['IT2302', 'Database Management Systems', 'Core', 'Theory', 3],
    ['MA2304', 'Probability and Statistics', 'Foundation', 'Theory', 4], ['IT2303', 'Web Technologies', 'Core', 'Theory', 3],
    ['IT2311', 'Database Laboratory', 'Core', 'Lab', 2],
  ],
  ECE: [
    ['EC2301', 'Electronic Devices and Circuits', 'Core', 'TwL', 4], ['EC2302', 'Signals and Systems', 'Core', 'Theory', 4],
    ['EC2303', 'Digital Electronics', 'Core', 'Theory', 3], ['MA2302', 'Linear Algebra and Transforms', 'Foundation', 'Theory', 4],
    ['EC2311', 'Electronic Devices Laboratory', 'Core', 'Lab', 2],
  ],
  MECH: [
    ['ME2301', 'Engineering Thermodynamics', 'Core', 'Theory', 4], ['ME2302', 'Strength of Materials', 'Core', 'TwL', 4],
    ['ME2303', 'Manufacturing Processes', 'Core', 'Theory', 3], ['MA2303', 'Transforms and Partial Differential Equations', 'Foundation', 'Theory', 4],
    ['ME2311', 'Manufacturing Technology Laboratory', 'Core', 'Lab', 2],
  ],
  EEE: [
    ['EE2301', 'Electric Circuit Analysis', 'Core', 'TwL', 4], ['EE2302', 'Electrical Machines I', 'Core', 'Theory', 4],
    ['EE2303', 'Electromagnetic Fields', 'Core', 'Theory', 3], ['MA2308', 'Complex Variables and Transforms', 'Foundation', 'Theory', 4],
    ['EE2311', 'Electrical Machines Laboratory', 'Core', 'Lab', 2],
  ],
  AIDS: [
    ['AD2301', 'Data Structures and Algorithms', 'Core', 'TwL', 4], ['AD2302', 'Foundations of Data Science', 'Core', 'Theory', 3],
    ['MA2305', 'Probability and Statistics', 'Foundation', 'Theory', 4], ['AD2303', 'Database Design and Management', 'Core', 'Theory', 3],
    ['AD2311', 'Data Science Laboratory', 'Core', 'Lab', 2],
  ],
  BME: [
    ['BM2301', 'Human Anatomy and Physiology', 'Core', 'Theory', 3], ['BM2302', 'Biomedical Sensors and Instrumentation', 'Core', 'TwL', 4],
    ['BM2303', 'Electric Circuits and Electron Devices', 'Core', 'Theory', 3], ['MA2306', 'Biostatistics and Linear Algebra', 'Foundation', 'Theory', 4],
    ['BM2311', 'Biomedical Instrumentation Laboratory', 'Core', 'Lab', 2],
  ],
  CIVIL: [
    ['CE2301', 'Mechanics of Solids', 'Core', 'TwL', 4], ['CE2302', 'Fluid Mechanics', 'Core', 'Theory', 4],
    ['CE2303', 'Surveying', 'Core', 'Theory', 3], ['MA2307', 'Transforms and Partial Differential Equations', 'Foundation', 'Theory', 4],
    ['CE2311', 'Surveying Laboratory', 'Core', 'Lab', 2],
  ],
  MATH: [
    ['MT2301', 'Real Analysis', 'Core', 'Theory', 4], ['MT2302', 'Abstract Algebra', 'Core', 'Theory', 4],
    ['MT2303', 'Differential Equations', 'Core', 'Theory', 4], ['MT2304', 'Numerical Methods', 'Core', 'TwL', 4],
    ['MT2311', 'Mathematical Software Laboratory', 'Core', 'Lab', 2],
  ],
  PHY: [
    ['PH2301', 'Classical Mechanics', 'Core', 'Theory', 4], ['PH2302', 'Electricity and Magnetism', 'Core', 'Theory', 4],
    ['PH2303', 'Thermal Physics', 'Core', 'Theory', 3], ['PH2304', 'Mathematical Physics', 'Foundation', 'Theory', 4],
    ['PH2311', 'Physics Laboratory', 'Core', 'Lab', 2],
  ],
  ECO: [
    ['ES2301', 'Intermediate Microeconomics', 'Core', 'Theory', 4], ['ES2302', 'Intermediate Macroeconomics', 'Core', 'Theory', 4],
    ['ES2303', 'Statistical Methods for Economics', 'Foundation', 'TwL', 4], ['ES2304', 'Indian Economy', 'Core', 'Theory', 3],
    ['ES2311', 'Econometrics Laboratory', 'Core', 'Lab', 2],
  ],
  COM: [
    ['CM2301', 'Corporate Accounting', 'Core', 'Theory', 4], ['CM2302', 'Business Law', 'Core', 'Theory', 3],
    ['CM2303', 'Cost Accounting', 'Core', 'TwL', 4], ['CM2304', 'Business Statistics', 'Foundation', 'Theory', 4],
    ['CM2311', 'Computerised Accounting Laboratory', 'Core', 'Lab', 2],
  ],
};
// code: [department name, staff prefix, degree (null = use the college default), faculty]
const DEPTS = {
  CSE: ['Computer Science and Engineering', 'CS', null, 'eng'], ECE: ['Electronics and Communication Engineering', 'EC', null, 'eng'],
  MECH: ['Mechanical Engineering', 'ME', null, 'eng'], EEE: ['Electrical and Electronics Engineering', 'EE', null, 'eng'],
  IT: ['Information Technology', 'IT', null, 'eng'], CIVIL: ['Civil Engineering', 'CE', null, 'eng'],
  AIDS: ['Artificial Intelligence and Data Science', 'AD', 'B.Tech', 'eng'], BME: ['Biomedical Engineering', 'BM', null, 'eng'],
  MATH: ['Mathematics', 'MT', 'B.Sc.', 'sci'], PHY: ['Physics', 'PH', 'B.Sc.', 'sci'],
  ECO: ['Economics', 'ES', 'B.A.', 'arts'], COM: ['Commerce', 'CM', 'B.Com.', 'arts'],
};
const FACULTY_NAMES = { eng: 'Faculty of Engineering and Technology', sci: 'Faculty of Science', arts: 'Faculty of Arts and Commerce' };
const DEGREE_CODE = { 'B.E.': 'BE', 'B.Tech': 'BTECH', 'B.Sc.': 'BSC', 'B.A.': 'BA', 'B.Com.': 'BCOM' };

// Public institution names and locations. Every student, staff member, mark and attendance record is generated.
// The first college is the flagship: it carries the richest data, the campus guide and the demo storyline.
const UNIVERSITIES = [
  { code: 'AU', name: 'Anna University', short: 'Anna University', location: 'Chennai, Tamil Nadu', affiliation: 'State technical university · affiliating', type: 'State University', est: 1978, accent: '#7a1f2b',
    colleges: [
      { code: 'KPRIET', name: 'KPR Institute of Engineering and Technology', short: 'KPRIET', location: 'Arasur, Coimbatore, Tamil Nadu', category: 'Autonomous · Affiliated to Anna University', est: 2009, website: 'https://www.kpriet.ac.in', accent: '#123d73',
        depts: ['CSE', 'ECE', 'MECH', 'EEE', 'AIDS', 'BME'], flagship: true, cseSections: ['A', 'B'], cseSem5: true, campusGuide: true },
      { code: 'CEG', name: 'College of Engineering, Guindy', short: 'CEG', location: 'Guindy, Chennai, Tamil Nadu', category: 'University department campus', est: 1794, accent: '#7a1f2b', depts: ['CSE', 'CIVIL'] },
      { code: 'MITC', name: 'Madras Institute of Technology', short: 'MIT Chennai', location: 'Chromepet, Chennai, Tamil Nadu', category: 'University department campus', est: 1949, accent: '#4a2c6d', depts: ['IT', 'ECE'] },
      { code: 'PSGCT', name: 'PSG College of Technology', short: 'PSG Tech', location: 'Peelamedu, Coimbatore, Tamil Nadu', category: 'Autonomous · Affiliated to Anna University', est: 1951, accent: '#1d4f91', depts: ['CSE', 'MECH'] },
      { code: 'CIT', name: 'Coimbatore Institute of Technology', short: 'CIT', location: 'Coimbatore, Tamil Nadu', category: 'Autonomous · Affiliated to Anna University', est: 1956, accent: '#8a3b12', depts: ['EEE', 'CSE'] },
      { code: 'KCT', name: 'Kumaraguru College of Technology', short: 'KCT', location: 'Saravanampatti, Coimbatore, Tamil Nadu', category: 'Autonomous · Affiliated to Anna University', est: 1984, accent: '#0f6b5c', depts: ['CSE', 'ECE'] },
      { code: 'SSN', name: 'Sri Sivasubramaniya Nadar College of Engineering', short: 'SSN', location: 'Kalavakkam, Chennai, Tamil Nadu', category: 'Autonomous · Affiliated to Anna University', est: 1996, accent: '#1f3f6e', depts: ['CSE', 'IT'] },
    ] },
  { code: 'IITM', name: 'Indian Institute of Technology Madras', short: 'IIT Madras', location: 'Chennai, Tamil Nadu', affiliation: 'Institute of National Importance', type: 'Institute of National Importance', est: 1959, accent: '#7b2d26', degree: 'B.Tech',
    colleges: [{ code: 'IITM', name: 'IIT Madras', short: 'IIT Madras', location: 'Chennai, Tamil Nadu', category: 'Institute of National Importance', est: 1959, accent: '#7b2d26', depts: ['CSE', 'EEE'] }] },
  { code: 'IITB', name: 'Indian Institute of Technology Bombay', short: 'IIT Bombay', location: 'Powai, Mumbai, Maharashtra', affiliation: 'Institute of National Importance', type: 'Institute of National Importance', est: 1958, accent: '#1b3b6f', degree: 'B.Tech',
    colleges: [{ code: 'IITB', name: 'IIT Bombay', short: 'IIT Bombay', location: 'Powai, Mumbai, Maharashtra', category: 'Institute of National Importance', est: 1958, accent: '#1b3b6f', depts: ['CSE', 'MECH'] }] },
  { code: 'IITD', name: 'Indian Institute of Technology Delhi', short: 'IIT Delhi', location: 'Hauz Khas, New Delhi', affiliation: 'Institute of National Importance', type: 'Institute of National Importance', est: 1961, accent: '#5a2a1a', degree: 'B.Tech',
    colleges: [{ code: 'IITD', name: 'IIT Delhi', short: 'IIT Delhi', location: 'Hauz Khas, New Delhi', category: 'Institute of National Importance', est: 1961, accent: '#5a2a1a', depts: ['CSE', 'CIVIL'] }] },
  { code: 'NITT', name: 'National Institute of Technology Tiruchirappalli', short: 'NIT Trichy', location: 'Tiruchirappalli, Tamil Nadu', affiliation: 'Institute of National Importance', type: 'Institute of National Importance', est: 1964, accent: '#24456b', degree: 'B.Tech',
    colleges: [{ code: 'NITT', name: 'NIT Tiruchirappalli', short: 'NIT Trichy', location: 'Tiruchirappalli, Tamil Nadu', category: 'Institute of National Importance', est: 1964, accent: '#24456b', depts: ['CSE', 'ECE'] }] },
  { code: 'BITS', name: 'Birla Institute of Technology and Science, Pilani', short: 'BITS Pilani', location: 'Pilani, Rajasthan', affiliation: 'Deemed to be university · multi-campus', type: 'Deemed University', est: 1964, accent: '#1c3d6e',
    colleges: [
      { code: 'BITSP', name: 'BITS Pilani, Pilani Campus', short: 'BITS Pilani', location: 'Pilani, Rajasthan', category: 'University campus', est: 1964, accent: '#1c3d6e', depts: ['CSE', 'EEE'] },
      { code: 'BITSG', name: 'BITS Pilani, K K Birla Goa Campus', short: 'BITS Goa', location: 'Zuarinagar, Goa', category: 'University campus', est: 2004, accent: '#22607a', depts: ['CSE'] },
      { code: 'BITSH', name: 'BITS Pilani, Hyderabad Campus', short: 'BITS Hyderabad', location: 'Jawahar Nagar, Hyderabad, Telangana', category: 'University campus', est: 2008, accent: '#4b3a75', depts: ['ECE'] },
    ] },
  { code: 'VIT', name: 'Vellore Institute of Technology', short: 'VIT', location: 'Vellore, Tamil Nadu', affiliation: 'Deemed to be university · multi-campus', type: 'Deemed University', est: 1984, accent: '#1a4f8b', degree: 'B.Tech',
    colleges: [
      { code: 'VITV', name: 'VIT Vellore', short: 'VIT Vellore', location: 'Katpadi, Vellore, Tamil Nadu', category: 'University campus', est: 1984, accent: '#1a4f8b', depts: ['CSE', 'IT'] },
      { code: 'VITC', name: 'VIT Chennai', short: 'VIT Chennai', location: 'Kelambakkam, Chennai, Tamil Nadu', category: 'University campus', est: 2010, accent: '#2a6a8f', depts: ['CSE'] },
    ] },
  { code: 'DU', name: 'University of Delhi', short: 'Delhi University', location: 'New Delhi', affiliation: 'Central university · collegiate', type: 'Central University', est: 1922, accent: '#6d2836',
    colleges: [
      { code: 'SSC', name: "St. Stephen's College", short: "St. Stephen's", location: 'North Campus, New Delhi', category: 'Constituent college', est: 1881, accent: '#6d2836', depts: ['MATH', 'ECO'] },
      { code: 'HINDU', name: 'Hindu College', short: 'Hindu College', location: 'North Campus, New Delhi', category: 'Constituent college', est: 1899, accent: '#8a4b1a', depts: ['PHY', 'ECO'] },
      { code: 'SRCC', name: 'Shri Ram College of Commerce', short: 'SRCC', location: 'North Campus, New Delhi', category: 'Constituent college', est: 1926, accent: '#23476e', depts: ['COM', 'ECO'] },
    ] },
  { code: 'MU', name: 'University of Mumbai', short: 'Mumbai University', location: 'Mumbai, Maharashtra', affiliation: 'State university · affiliating', type: 'State University', est: 1857, accent: '#2b3f73',
    colleges: [
      { code: 'VJTI', name: 'Veermata Jijabai Technological Institute', short: 'VJTI', location: 'Matunga, Mumbai, Maharashtra', category: 'Autonomous · Affiliated to University of Mumbai', est: 1887, degree: 'B.Tech', accent: '#2b3f73', depts: ['CSE', 'CIVIL'] },
      { code: 'SXC', name: "St. Xavier's College", short: "St. Xavier's", location: 'Fort, Mumbai, Maharashtra', category: 'Autonomous · Affiliated to University of Mumbai', est: 1869, accent: '#174a7c', depts: ['MATH', 'PHY'] },
    ] },
  { code: 'VTU', name: 'Visvesvaraya Technological University', short: 'VTU', location: 'Belagavi, Karnataka', affiliation: 'State technical university · affiliating', type: 'State University', est: 1998, accent: '#7c2f1d',
    colleges: [
      { code: 'RVCE', name: 'R V College of Engineering', short: 'RVCE', location: 'Mysuru Road, Bengaluru, Karnataka', category: 'Autonomous · Affiliated to VTU', est: 1963, accent: '#7c2f1d', depts: ['CSE', 'ECE'] },
      { code: 'BMSCE', name: 'B.M.S. College of Engineering', short: 'BMSCE', location: 'Basavanagudi, Bengaluru, Karnataka', category: 'Autonomous · Affiliated to VTU', est: 1946, accent: '#1e4b7a', depts: ['CSE', 'MECH'] },
    ] },
  { code: 'JU', name: 'Jadavpur University', short: 'Jadavpur University', location: 'Kolkata, West Bengal', affiliation: 'State university', type: 'State University', est: 1955, accent: '#5c2a52',
    colleges: [{ code: 'JUFET', name: 'Jadavpur University, Faculty of Engineering and Technology', short: 'JU Engineering', location: 'Jadavpur, Kolkata, West Bengal', category: 'University faculty', est: 1955, accent: '#5c2a52', depts: ['CSE', 'EEE'] }] },
  { code: 'AMRITA', name: 'Amrita Vishwa Vidyapeetham', short: 'Amrita', location: 'Coimbatore, Tamil Nadu', affiliation: 'Deemed to be university · multi-campus', type: 'Deemed University', est: 2003, accent: '#8b1d41', degree: 'B.Tech',
    colleges: [
      { code: 'ASECB', name: 'Amrita School of Engineering, Coimbatore', short: 'Amrita Coimbatore', location: 'Ettimadai, Coimbatore, Tamil Nadu', category: 'University campus', est: 1994, accent: '#8b1d41', depts: ['CSE', 'AIDS'] },
      { code: 'ASEAP', name: 'Amrita School of Engineering, Amritapuri', short: 'Amrita Amritapuri', location: 'Kollam, Kerala', category: 'University campus', est: 2002, accent: '#a0442a', depts: ['CSE'] },
    ] },
  { code: 'MAHE', name: 'Manipal Academy of Higher Education', short: 'MAHE', location: 'Manipal, Karnataka', affiliation: 'Deemed to be university', type: 'Deemed University', est: 1993, accent: '#c25b12', degree: 'B.Tech',
    colleges: [{ code: 'MITM', name: 'Manipal Institute of Technology', short: 'MIT Manipal', location: 'Manipal, Karnataka', category: 'Constituent institution', est: 1957, accent: '#c25b12', depts: ['CSE', 'MECH'] }] },
  { code: 'SRMIST', name: 'SRM Institute of Science and Technology', short: 'SRM IST', location: 'Kattankulathur, Chengalpattu, Tamil Nadu', affiliation: 'Deemed to be university', type: 'Deemed University', est: 1985, accent: '#0e4a8a', degree: 'B.Tech',
    colleges: [{ code: 'SRMKTR', name: 'SRM IST, Kattankulathur Campus', short: 'SRM KTR', location: 'Kattankulathur, Chengalpattu, Tamil Nadu', category: 'University campus', est: 1985, accent: '#0e4a8a', depts: ['CSE', 'ECE'] }] },
];

// ---------- calendar ----------
const SEM_START = new Date('2026-07-14T00:00:00Z');
const SEM_LAST_CLASS = new Date('2026-10-01T00:00:00Z');
const weekdays = [];
for (let d = new Date(SEM_START); d <= SEM_LAST_CLASS; d.setUTCDate(d.getUTCDate() + 1)) {
  const wd = d.getUTCDay();
  if (wd >= 1 && wd <= 5) weekdays.push({ date: d.toISOString().slice(0, 10), wd });
}
function sessionDates(courseIdx, type) {
  const days = type === 'Lab' ? [((courseIdx + 2) % 5) + 1] : type === 'TwL' ? [1, 2, 4, 5] : [((courseIdx) % 5) + 1, ((courseIdx + 2) % 5) + 1, ((courseIdx + 4) % 5) + 1];
  return weekdays.filter((w) => days.includes(w.wd)).map((w) => w.date);
}

function ins(table, row) {
  const keys = Object.keys(row);
  const r = db.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => row[k]));
  return Number(r.lastInsertRowid);
}

const TT = require('./timetable');
// Lay out a full weekly timetable for one section from its real offerings, so faculty
// names and class times stay consistent with the data. Labs occupy a 2-period block;
// theory subjects repeat across Mon-Fri to fill every period; Saturday is a light
// half-day of activities. Breaks (tea/lunch) and the mentor hour are implied by the clock.
function genTimetable(cid, sectionId, offerings) {
  if (!offerings.length) return;
  const DAYS = 5, PER = 7;
  const grid = Array.from({ length: DAYS + 1 }, () => Array(PER + 1).fill(null));
  const labs = offerings.filter((o) => o.type === 'Lab');
  const theory = offerings.filter((o) => o.type !== 'Lab');
  const blocks = [[5, 6], [3, 4], [1, 2], [6, 7], [2, 3]];
  let bi = 0;
  // 1. Each lab goes in one 2-period block, spread across different days.
  labs.forEach((lab, i) => {
    const d = (i % DAYS) + 1;
    for (let t = 0; t < blocks.length; t++) {
      const [a, b] = blocks[(bi + t) % blocks.length];
      if (!grid[d][a] && !grid[d][b]) { grid[d][a] = lab.oid; grid[d][b] = lab.oid; bi++; break; }
    }
  });
  // 2. Fill every remaining weekday slot with theory subjects, round-robin, avoiding the
  //    same subject in two back-to-back periods.
  const pool = theory.length ? theory : offerings;
  let k = 0;
  for (let d = 1; d <= DAYS; d++) {
    for (let p = 1; p <= PER; p++) {
      if (grid[d][p]) continue;
      let oid, tries = 0;
      do { oid = pool[k % pool.length].oid; k++; tries++; } while (tries < pool.length && oid === grid[d][p - 1]);
      grid[d][p] = oid;
    }
  }
  for (let d = 1; d <= DAYS; d++) for (let p = 1; p <= PER; p++) if (grid[d][p]) ins('timetable_slots', { college_id: cid, section_id: sectionId, day: d, period: p, offering_id: grid[d][p], kind: 'class' });
  // 3. Light Saturday: activity blocks, not tied to a course.
  const sat = [[1, 'Remedial / Tutorial'], [2, 'Seminar'], [3, 'Club Activity']];
  for (const [p, label] of sat) ins('timetable_slots', { college_id: cid, section_id: sectionId, day: 6, period: p, label, kind: 'activity' });
}

// Build a small but valid PDF (correct xref offsets) so a seeded teacher "material" has a
// real, openable file, demonstrating the classroom PDF upload/read without any external asset.
function minimalPdf(title, line) {
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const stream = `BT /F1 20 Tf 72 720 Td (${title}) Tj 0 -30 Td /F1 12 Tf (${line}) Tj ET`;
  objs.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offs.forEach((o) => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
function seedPdfFile(cid, offeringId, uploaderUserId, name, title, line) {
  const dir = require('path').join(require('path').dirname(db.DB_PATH), 'uploads', 'classroom');
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const buf = minimalPdf(title, line);
  fs.writeFileSync(require('path').join(dir, `${id}.pdf`), buf);
  ins('classroom_files', { id, college_id: cid, offering_id: offeringId, uploaded_by: uploaderUserId, mime: 'application/pdf', name, size: buf.length, path: `${id}.pdf` });
  return { id, name };
}

// A couple of upcoming campus-guide events for the flagship, so the student/staff Campus events
// surface and cross-portal notifications are demonstrable out of the box.
function seedCampusEvents(cid) {
  const row = db.get('SELECT payload FROM campus_guides WHERE college_id = ?', cid);
  if (!row) return;
  let data; try { data = JSON.parse(row.payload); } catch { return; }
  const venue = (data.nodes.find((n) => n.kind !== 'junction') || data.nodes[0] || {}).id;
  if (!venue) return;
  const d = (days, h, m) => { const x = new Date('2026-10-02T00:00:00'); x.setDate(x.getDate() + days); x.setHours(h, m, 0, 0); return x.toISOString(); };
  data.events = [
    { id: crypto.randomUUID(), title: 'Ignitron Tech Symposium 2026', venue, time: 'Day 1 · 10:00 AM', instructions: 'Keynotes, project expo and workshops. Open to all departments.', registrationOpen: true, startsAt: d(6, 10, 0), endsAt: d(7, 17, 0) },
    { id: crypto.randomUUID(), title: 'Sangamam Cultural Night', venue, time: '6:00 PM onwards', instructions: 'Music, dance and drama by student clubs.', registrationOpen: false, startsAt: d(12, 18, 0), endsAt: d(12, 22, 0) },
  ];
  db.run('UPDATE campus_guides SET payload = ? WHERE college_id = ?', JSON.stringify(data), cid);
}

// Clubs offered across colleges. The flagship carries the named ones the brief called out.
const CLUB_POOL = [
  ['Ignitron', 'Technical', 'Electronics and robotics build club: embedded systems, drones and maker projects.'],
  ['IEEE Student Branch', 'Technical', 'IEEE chapter: paper presentations, workshops and technical talks.'],
  ['Robotics Club', 'Technical', 'Design and program competitive and service robots.'],
  ['Coding Club', 'Technical', 'Competitive programming, hackathons and open-source contribution.'],
  ['Sangamam', 'Cultural', 'The cultural collective: music, dance, drama and the annual fest.'],
  ['Mental Health Club', 'Wellbeing', 'Peer support, mindfulness sessions and wellbeing drives.'],
  ['Literary Society', 'Cultural', 'Debates, quizzing, creative writing and the campus magazine.'],
  ['Sports Club', 'Sports', 'Inter-department tournaments and fitness meets.'],
  ['NSS Unit', 'Service', 'National Service Scheme: community outreach and social projects.'],
  ['Entrepreneurship Cell', 'Entrepreneurship', 'Startup mentoring, pitch days and the innovation incubator.'],
  ['Photography Club', 'Cultural', 'Photowalks, editing workshops and campus coverage.'],
  ['Eco Club', 'Service', 'Sustainability drives, tree planting and campus greening.'],
];

function seed() {
  if (fs.existsSync(db.DB_PATH)) { db.close(); for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(db.DB_PATH + ext); } catch { /* none */ } } }
  fs.rmSync(require('path').join(require('path').dirname(db.DB_PATH), 'uploads'), { recursive: true, force: true });
  db.open();
  const t0 = Date.now();
  const used = new Set();
  const uniqueName = (gender) => {
    for (let i = 0; i < 50; i++) {
      const f = pick(gender === 'Female' ? FIRST_F : FIRST_M), l = pick(LAST);
      if (!used.has(f + l)) { used.add(f + l); return [f, l]; }
    }
    return [pick(FIRST_M), pick(LAST)];
  };
  ['RojanAdhikari', 'AnjaliMenon', 'RahulSharma', 'RahulVerma'].forEach((n) => used.add(n));

  const attIns = db.open().prepare('INSERT INTO attendance (college_id, session_id, offering_id, student_id, present) VALUES (?,?,?,?,?)');
  const markIns = db.open().prepare("INSERT INTO marks (college_id, assessment_id, student_id, marks, entry_method, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)");
  const summary = { universities: 0, colleges: 0, students: 0, staff: 0, offerings: 0 };
  const demo = {};

  db.tx(() => {
    ins('platform', { id: 1, name: 'nerd', demo_mode: 1 });
    for (const [role, perms] of Object.entries(scope.DEFAULT_GRANTS)) for (const p of perms) ins('role_permissions', { role, permission: p, allowed: 1 });
    ins('settings', { scope_type: 'platform', scope_id: 0, key: 'attendance_threshold', value: '75' });
    demo.superAdmin = ins('users', { role: 'super_admin', login_id: 'superadmin', email: 'superadmin@nerd.local', name: 'Platform Super Admin', password_hash: PW });

    for (const U of UNIVERSITIES) {
      summary.universities++;
      const uid = ins('universities', { code: U.code, name: U.name, short_name: U.short, location: U.location, affiliation: U.affiliation, type: U.type, established: U.est, accent: U.accent, logo: logoFor(U.code), active: U.active ?? 1 });
      if (!U.colleges.length) continue;
      ins('users', { university_id: uid, role: 'university_admin', login_id: `${U.code.toLowerCase()}.admin`, email: `admin@${U.code.toLowerCase()}.nerd.local`, name: `${U.short} Administrator`, password_hash: PW });

      for (const C of U.colleges) {
        summary.colleges++;
        const cid = ins('colleges', { university_id: uid, code: C.code, name: C.name, short_name: C.short, location: C.location, institution_code: C.inst || null, category: C.category, established: C.est, website: C.website || null, accent: C.accent, logo: logoFor(C.code) });
        const degreeDefault = C.degree || U.degree || 'B.E.';
        const base = { university_id: uid, college_id: cid };
        if (C.threshold) ins('settings', { scope_type: 'college', scope_id: cid, key: 'attendance_threshold', value: String(C.threshold) });
        ins('campuses', { ...base, name: `${C.short} Main Campus`, address: C.location });
        const facIds = {};
        const facultyFor = (k) => facIds[k] || (facIds[k] = ins('faculties', { ...base, name: FACULTY_NAMES[k] }));
        const regs = {
          R2021: ins('regulations', { ...base, code: 'R2021', name: 'Regulation 2021', effective_year: 2021, total_semesters: 8, min_credits: 165 }),
          R2025: ins('regulations', { ...base, code: 'R2025', name: 'Regulation 2025', effective_year: 2025, total_semesters: 8, min_credits: 160 }),
        };
        ins('academic_years', { ...base, name: '2025-26', start_date: '2025-07-01', end_date: '2026-06-30', is_current: 0 });
        const ay = ins('academic_years', { ...base, name: '2026-27', start_date: '2026-07-01', end_date: '2027-06-30', is_current: 1 });
        const semId = ins('semesters', { ...base, academic_year_id: ay, term: 'Odd', name: '2026-27 Odd Semester', start_date: '2026-07-14', end_date: '2026-11-28', is_current: 1 });
        ins('semesters', { ...base, academic_year_id: ay, term: 'Even', name: '2026-27 Even Semester', start_date: '2027-01-04', end_date: '2027-05-15', is_current: 0 });
        if (C.campusGuide) { require('./routes/campus').seedGuide(cid, 'KPR Compass'); seedCampusEvents(cid); }
        ins('users', { ...base, role: 'college_admin', login_id: `${C.code.toLowerCase()}.admin`, email: `admin@${C.code.toLowerCase()}.nerd.local`, name: `${C.short} Administrator`, password_hash: PW });
        let staffSeq = 1;

        for (const D of C.depts) {
          const [deptName, staffPrefix, deptDegree, facultyKey] = DEPTS[D];
          const degree = deptDegree || degreeDefault;
          const years = ['B.Sc.', 'B.A.', 'B.Com.'].includes(degree) ? 3 : 4;
          const did = ins('departments', { ...base, faculty_id: facultyFor(facultyKey), code: D, name: deptName });
          const pid = ins('programmes', { ...base, department_id: did, code: `${DEGREE_CODE[degree]}-${D}`, name: `${degree} ${deptName}`, degree_type: 'UG', duration_years: years });
          if (D === 'CSE' && C.flagship) ins('users', { ...base, department_id: did, role: 'department_admin', login_id: `${C.code.toLowerCase()}.cse.admin`, email: `cse.admin@${C.code.toLowerCase()}.nerd.local`, name: `${C.short} CSE Department Admin`, password_hash: PW });

          // Staff for this department
          const isDemoDept = !!C.flagship && D === 'CSE';
          const staffList = [];
          const mkStaff = (name, code, designation, gender) => {
            const u = ins('users', { ...base, department_id: did, role: 'staff', login_id: code, email: `${code.toLowerCase()}@${C.code.toLowerCase()}.nerd.local`, name, password_hash: PW });
            const id = ins('staff', { ...base, user_id: u, department_id: did, employee_code: code, designation });
            summary.staff++;
            staffList.push({ id, user: u, name, code, gender });
            return id;
          };
          if (isDemoDept) {
            demo.profStaff = mkStaff('Dr. Kavitha Raman', 'CS014', 'Associate Professor');
            mkStaff('Prof. Arun Prakash', 'CS021', 'Assistant Professor');
            mkStaff('Dr. Meena Subramanian', 'CS008', 'Professor');
            mkStaff('Dr. Senthil Kumar', 'MA003', 'Associate Professor');
            mkStaff('Ms. Divya Krishnan', 'CS030', 'Assistant Professor');
            mkStaff('Dr. Vignesh Babu', 'CS017', 'Associate Professor');
            mkStaff('Dr. Farah Ahmed', 'CS025', 'Assistant Professor');
          } else {
            for (let i = 0; i < (C.flagship ? 4 : 3); i++) {
              const g = rand() < 0.5 ? 'Female' : 'Male';
              const [f, l] = uniqueName(g);
              mkStaff(`${pick(['Dr.', 'Prof.', g === 'Female' ? 'Ms.' : 'Mr.'])} ${f} ${l}`, `${staffPrefix}${String(staffSeq++).padStart(3, '0')}`, pick(['Assistant Professor', 'Associate Professor', 'Professor']));
            }
          }

          // Batches, sections, courses, offerings
          const cohorts = [{ name: `2025-${2025 + years}`, start: 2025, sem: 3, reg: 'R2025', catalog: D, sections: isDemoDept ? C.cseSections : ['A'] }];
          if (isDemoDept && C.cseSem5) cohorts.push({ name: '2024-2028', start: 2024, sem: 5, reg: 'R2021', catalog: 'CSE5', sections: ['A'] });
          for (const ch of cohorts) {
            const bid = ins('batches', { ...base, programme_id: pid, regulation_id: regs[ch.reg], name: ch.name, start_year: ch.start, end_year: ch.start + years, current_semester: ch.sem });
            const courseIds = CATALOG[ch.catalog].map(([code, name, category, type, credits]) =>
              ({ id: ins('courses', { ...base, department_id: did, regulation_id: regs[ch.reg], programme_id: pid, semester_number: ch.sem, code, name, category, course_type: type, credits }), code, name, type }));
            if (ch.catalog === 'CSE') CATALOG.CSE4.forEach(([code, name, category, type, credits]) => ins('courses', { ...base, department_id: did, regulation_id: regs[ch.reg], programme_id: pid, semester_number: 4, code, name, category, course_type: type, credits }));

            for (const secName of ch.sections) {
              const secId = ins('sections', { ...base, batch_id: bid, name: secName });
              const offerings = courseIds.map((c, idx) => {
                let staffId;
                if (isDemoDept && ch.sem === 3) staffId = staffList[[0, 1, 3, 2, 4][idx]].id;
                else if (isDemoDept) staffId = staffList[[5, 2, 5, 6, 4][idx]].id;
                else staffId = staffList[(idx + secName.charCodeAt(0)) % staffList.length].id;
                const oid = ins('course_offerings', { ...base, course_id: c.id, semester_id: semId, batch_id: bid, section_id: secId, staff_id: staffId });
                summary.offerings++;
                return { ...c, oid, idx, staffId };
              });

              // Weekly class timetable for this section, laid out from its real offerings.
              genTimetable(cid, secId, offerings);

              // Open electives: offered to the demo section but students are NOT auto-enrolled,
              // so the course-registration "Add a course" flow has real options to request.
              if (isDemoDept && ch.sem === 3 && secName === 'A') {
                demo.sectionA = secId;
                const electives = [
                  ['CS2391', 'Open Elective: Cloud Computing Basics', 'Open Elective', 'Theory', 3, staffList[5].id],
                  ['CS2392', 'Open Elective: UI/UX Design', 'Open Elective', 'Theory', 3, staffList[4].id],
                  ['HS2301', 'Professional Communication', 'Humanities', 'Theory', 2, staffList[6].id],
                ];
                for (const [code, name, category, type, credits, staffId] of electives) {
                  const ecid = ins('courses', { ...base, department_id: did, regulation_id: regs[ch.reg], programme_id: pid, semester_number: ch.sem, code, name, category, course_type: type, credits });
                  ins('course_offerings', { ...base, course_id: ecid, semester_id: semId, batch_id: bid, section_id: secId, staff_id: staffId, registration_open: 1 });
                  summary.offerings++;
                }
              }

              // Students
              const n = isDemoDept && ch.sem === 3 && secName === 'A' ? 34 : C.flagship ? 30 : 20;
              const students = [];
              for (let i = 0; i < n; i++) {
                let first, last, gender, profile = null;
                if (isDemoDept && ch.sem === 3 && secName === 'A' && i < 4) {
                  [first, last, gender, profile] = [['Rojan', 'Adhikari', 'Male', 'rojan'], ['Anjali', 'Menon', 'Female', 'steady'], ['Rahul', 'Sharma', 'Male', 'steady'], ['Rahul', 'Verma', 'Male', 'struggling']][i];
                } else { gender = rand() < 0.48 ? 'Female' : 'Male'; [first, last] = uniqueName(gender); }
                const prefix = `${String(ch.start).slice(2)}${D}`;
                // The flagship demo student signs in with a short, easy roll number.
                const roll = first === 'Rojan' ? '25CS324' : `${prefix}${secName === 'A' ? 1 : 2}${String(i + 1).padStart(2, '0')}`;
                const u = ins('users', { ...base, department_id: did, role: 'student', login_id: roll, email: `${roll.toLowerCase()}@${C.code.toLowerCase()}.nerd.local`, name: `${first} ${last}`, password_hash: PW });
                const sid = ins('students', { ...base, user_id: u, department_id: did, programme_id: pid, batch_id: bid, section_id: secId, regulation_id: regs[ch.reg], roll_no: roll, first_name: first, last_name: last, gender, current_semester: ch.sem });
                summary.students++;
                const r = rand();
                if (!profile) profile = r < 0.1 ? 'struggling' : r < 0.2 ? 'declining' : 'steady';
                const ability = profile === 'rojan' ? 1.4 : profile === 'struggling' ? -1.1 + 0.4 * gauss() : 0.3 + 0.8 * gauss();
                const attBase = profile === 'rojan' ? 0.84 : profile === 'struggling' ? clamp(0.68 + 0.05 * gauss(), 0.5, 0.78) : clamp(0.88 + 0.05 * gauss(), 0.74, 0.99);
                students.push({ sid, u, first, last, profile, ability, attBase });
                if (first === 'Rojan') { demo.rojan = sid; demo.rojanUser = u; }
                for (let s = 1; s < ch.sem; s++) {
                  let sgpa = clamp(7.1 + 0.9 * ability + 0.35 * gauss() - (profile === 'declining' ? 0.25 * s : 0), 4, 10);
                  if (profile === 'rojan') sgpa = s === 1 ? 8.1 : 7.3;
                  ins('academic_history', { college_id: cid, student_id: sid, semester_number: s, sgpa: Math.round(sgpa * 10) / 10, attendance_pct: Math.round(attBase * 1000) / 10, credits_earned: 21 });
                }
                for (const o of offerings) ins('course_registrations', { university_id: uid, college_id: cid, student_id: sid, offering_id: o.oid, status: 'Registered', registered_at: '2026-07-08 10:00:00' });
              }

              // Attendance sessions + records
              for (const o of offerings) {
                const dates = sessionDates(o.idx, o.type);
                const sessIds = dates.map((dt) => ins('attendance_sessions', { college_id: cid, offering_id: o.oid, held_on: dt, period: 1, created_by: null }));
                for (const st of students) {
                  let pattern;
                  if (st.profile === 'rojan' && o.code === 'CS2301') {
                    // 76.x% overall, with only 4 of the last 8 classes attended (declining).
                    const total = sessIds.length; const targetPresent = Math.round(total * 0.762);
                    const recent = [1, 0, 1, 0, 0, 1, 0, 1];
                    const earlyPresent = targetPresent - recent.reduce((a, b) => a + b, 0);
                    const early = new Array(total - 8).fill(1);
                    const absentCount = (total - 8) - earlyPresent;
                    for (let k = 0; k < absentCount; k++) early[Math.floor(((k + 0.5) * early.length) / absentCount)] = 0;
                    pattern = early.concat(recent);
                  } else {
                    const late = st.profile === 'declining' ? 0.22 : 0;
                    pattern = sessIds.map((_, i) => (rand() < clamp(st.attBase + 0.03 * gauss() - (i > sessIds.length * 0.75 ? late : 0), 0.2, 0.995) ? 1 : 0));
                  }
                  sessIds.forEach((sess, i) => attIns.run(cid, sess, o.oid, st.sid, pattern[i]));
                }

                // Assessments (configurable per offering; this is the demo structure)
                const plan = o.type === 'Lab'
                  ? [['Lab Exercise 1', 'LE1', 'lab', 25, 1, 1, '2026-08-07'], ['Lab Exercise 2', 'LE2', 'lab', 25, 1, 2, '2026-09-11'], ['Lab Record', 'REC', 'assignment', 20, 1, 3, '2026-09-25']]
                  : [['Quiz 1', 'Q1', 'quiz', 10, 1, 1, '2026-08-05'], ['Assignment 1', 'A1', 'assignment', 10, 1, 2, '2026-08-12'],
                    ['Internal Assessment 1', 'IA1', 'internal', 25, 2.5, 3, '2026-09-15'], ['Assignment 2', 'A2', 'assignment', 10, 1, 4, '2026-09-26']];
                const staffUser = db.get('SELECT user_id FROM staff WHERE id = ?', o.staffId).user_id;
                for (const [name, short, kind, max, weight, seq, date] of plan) {
                  const aid = ins('assessments', { college_id: cid, offering_id: o.oid, name, short_name: short, kind, max_marks: max, weight, sequence: seq, held_on: kind === 'assignment' ? null : date, due_on: kind === 'assignment' ? date : null });
                  for (const st of students) {
                    let pct;
                    if (st.profile === 'rojan' && o.code === 'CS2301') {
                      if (short === 'IA1') { demo.ia1 = aid; demo.dsOffering = o.oid; continue; } // left blank for the voice-entry demo
                      pct = { Q1: 0.95, A1: 0.9, A2: 0.6 }[short];
                    } else {
                      const late = st.profile === 'declining' && seq >= 3 ? -0.18 : 0;
                      pct = clamp(0.7 + 0.12 * st.ability + 0.08 * gauss() + late, 0.12, 1);
                    }
                    const val = Math.round(pct * max * 2) / 2;
                    markIns.run(cid, aid, st.sid, val, 'manual', staffUser, `${date} 16:00:00`);
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  // Demo announcements, audit history and notifications
  const niet = db.get("SELECT * FROM colleges WHERE code = 'KPRIET'");
  const nietAdmin = db.get("SELECT * FROM users WHERE login_id = 'kpriet.admin'");
  db.tx(() => {
    ins('announcements', { university_id: niet.university_id, college_id: niet.id, audience: 'all', title: 'Internal Assessment 2 schedule', body: 'Internal Assessment 2 for all odd-semester courses will be held from 26 Oct 2026. Detailed timetable will follow.', created_by: nietAdmin.id, created_at: '2026-09-29 09:30:00' });
    ins('announcements', { university_id: niet.university_id, college_id: null, audience: 'all', title: 'University academic calendar published', body: 'The 2026-27 academic calendar for all affiliated colleges is now available.', created_by: null, created_at: '2026-07-02 10:00:00' });
    ins('announcements', { university_id: niet.university_id, college_id: niet.id, offering_id: demo.dsOffering, audience: 'students', title: 'Data Structures: extra problem-solving session', body: 'An optional problem-solving session on trees and heaps will be held on Saturday at 10:00 in Lab 3.', created_by: db.get('SELECT user_id FROM staff WHERE id = ?', demo.profStaff).user_id, created_at: '2026-09-30 15:10:00' });
    const audit = [
      ['create', 'course_offering', 'Assigned Dr. Kavitha Raman to Data Structures (CSE 2025-2029, Section A)', null, '{"staff":"CS014 - Dr. Kavitha Raman"}', '2026-07-06 11:02:00'],
      ['update', 'settings', 'Confirmed attendance threshold for the college', '{"attendance_threshold":75}', '{"attendance_threshold":75}', '2026-07-07 09:15:00'],
      ['import', 'students', 'Imported 94 students for CSE batch 2025-2029', null, '{"rows":94}', '2026-07-08 09:40:00'],
      ['update', 'marks', 'Corrected Quiz 1 mark in Data Structures', '{"marks":7}', '{"marks":8}', '2026-08-07 12:30:00'],
    ];
    for (const [action, entity, summaryText, prev, next, at] of audit) ins('audit_logs', { university_id: niet.university_id, college_id: niet.id, user_id: nietAdmin.id, user_name: nietAdmin.name, role: 'college_admin', action, entity, summary: summaryText, previous_value: prev, new_value: next, ip: '10.0.0.12', user_agent: 'seed', created_at: at });
  });

  // Clubs per college + demo memberships, and a Google-Classroom-style stream for the demo section.
  db.tx(() => {
    for (const col of db.all('SELECT id, university_id, code FROM colleges')) {
      const staff = db.all('SELECT id FROM staff WHERE college_id = ?', col.id);
      if (!staff.length) continue;
      const flagship = col.code === 'KPRIET';
      // Flagship gets the full named set; others a rotating subset of 4.
      const picks = flagship ? CLUB_POOL.slice(0, 8)
        : [CLUB_POOL[1], CLUB_POOL[4], CLUB_POOL[5], CLUB_POOL[(col.id % 4) + 7]];
      const studentsHere = db.all('SELECT id FROM students WHERE college_id = ?', col.id).map((r) => r.id);
      picks.forEach((c, i) => {
        const clubId = ins('clubs', { university_id: col.university_id, college_id: col.id, name: c[0], category: c[1], description: c[2], lead_staff_id: staff[i % staff.length].id });
        // Seed a few members so staff rosters are not empty.
        const n = Math.min(studentsHere.length, flagship ? 8 : 4);
        for (let k = 0; k < n; k++) {
          const sid = studentsHere[(i * 5 + k * 3) % studentsHere.length];
          const phone = `9${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`;
          try { ins('club_memberships', { club_id: clubId, college_id: col.id, student_id: sid, role: k === 0 ? 'Coordinator' : 'Member', phone, interest: pick(['Keen to learn and contribute', 'Interested in the activities', 'Want to build projects with the team', 'Looking to develop new skills']) }); } catch { /* dup */ }
        }
      });
    }
    // Rojan (demo student) joins two flagship clubs so the student view is populated.
    if (demo.rojan) {
      for (const name of ['Ignitron', 'Coding Club']) {
        const club = db.get('SELECT id, college_id FROM clubs WHERE college_id = ? AND name = ?', niet.id, name);
        if (club) try { ins('club_memberships', { club_id: club.id, college_id: club.college_id, student_id: demo.rojan, role: 'Member', phone: '9842612345', interest: 'Keen to build hardware and software projects' }); } catch { /* dup */ }
      }
    }

    // Classroom posts for the demo section's offerings (notes + assignments with deadlines).
    if (demo.sectionA) {
      const offs = db.all(`SELECT o.id, o.staff_id, c.name, c.code FROM course_offerings o JOIN courses c ON c.id = o.course_id
        WHERE o.section_id = ? ORDER BY o.id`, demo.sectionA);
      for (const o of offs) {
        const authorId = o.staff_id ? db.get('SELECT user_id FROM staff WHERE id = ?', o.staff_id)?.user_id : null;
        ins('classroom_posts', { college_id: niet.id, offering_id: o.id, author_id: authorId, kind: 'note',
          title: `Welcome to ${o.name}`, body: `Course notes and weekly materials for ${o.code} will be posted here. Check the stream regularly.`, created_at: '2026-07-16 09:00:00', updated_at: '2026-07-16 09:00:00' });
        if (o.code === 'CS2301') {
          const pdf = seedPdfFile(niet.id, o.id, authorId, 'DS-Unit2-Notes.pdf', 'Data Structures - Unit 2 Notes', 'Linked Lists and Stacks');
          ins('classroom_posts', { college_id: niet.id, offering_id: o.id, author_id: authorId, kind: 'material',
            title: 'Unit 2 notes: Linked Lists & Stacks', body: 'Lecture notes for the current unit. Download the PDF below.', file_id: pdf.id, file_name: pdf.name, created_at: '2026-09-20 10:00:00', updated_at: '2026-09-20 10:00:00' });
          ins('classroom_posts', { college_id: niet.id, offering_id: o.id, author_id: authorId, kind: 'assignment', points: 20,
            title: 'Assignment 3: Binary Trees', body: 'Implement insert, delete and traversal for a BST. Submit your repository link.', due_on: '2026-10-10', created_at: '2026-09-28 11:00:00', updated_at: '2026-09-28 11:00:00' });
        } else {
          ins('classroom_posts', { college_id: niet.id, offering_id: o.id, author_id: authorId, kind: 'assignment', points: 10,
            title: `${o.code} assignment`, body: 'Complete the exercises shared in class and submit before the deadline.', due_on: '2026-10-14', created_at: '2026-09-29 12:00:00', updated_at: '2026-09-29 12:00:00' });
        }
      }
    }
  });

  // Model training (synthetic) and initial risk analysis for every student
  const metrics = risk.trainAndRegister();
  const ids = db.all('SELECT id FROM students').map((r) => r.id);
  db.tx(() => { for (const id of ids) risk.recomputeStudent(id, 'initial'); });

  // Initial notifications for students already in attention/critical attendance or high risk
  db.tx(() => {
    const rows = db.all(`SELECT r.student_id, r.offering_id, r.level, r.factors, s.user_id, s.college_id, c.name AS course
      FROM risk_analysis r JOIN students s ON s.id = r.student_id JOIN course_offerings o ON o.id = r.offering_id JOIN courses c ON c.id = o.course_id
      WHERE r.is_latest = 1 AND r.level != 'Normal'`);
    for (const r of rows) {
      const f = JSON.parse(r.factors).factors;
      ins('notifications', { college_id: r.college_id, user_id: r.user_id, type: 'risk', severity: r.level === 'High' ? 'critical' : 'warning', title: `Academic risk: ${r.level} in ${r.course}`, body: f.length ? `Main reasons: ${f.slice(0, 2).map((x) => x.text).join('; ')}.` : 'Review your course progress.', link: '#/student/risk', dedupe_key: `risk:${r.offering_id}:${r.level}:initial`, created_at: '2026-10-01 18:00:00' });
    }
    const studs = db.all('SELECT s.id, s.user_id, s.college_id FROM students s');
    for (const s of studs) {
      ins('notifications', { college_id: s.college_id, user_id: s.user_id, type: 'marks', severity: 'info', title: 'New marks available', body: 'Assignment 2 marks have been published for your courses.', link: '#/student/performance', is_read: 1, created_at: '2026-09-27 17:00:00' });
      ins('notifications', { college_id: s.college_id, user_id: s.user_id, type: 'admin', severity: 'info', title: 'Internal Assessment 2 schedule', body: 'Internal Assessment 2 will be held from 26 Oct 2026.', link: '#/student/notifications', created_at: '2026-09-29 09:30:00' });
    }
  });

  const rojanRisk = db.get('SELECT level, probability FROM risk_analysis WHERE student_id = ? AND offering_id = ? AND is_latest = 1', demo.rojan, demo.dsOffering);
  console.log(`Seeded demo data in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, summary);
  console.log('Synthetic model hold-out metrics:', metrics);
  console.log('Rojan / Data Structures risk before voice entry:', rojanRisk);
  return summary;
}

if (require.main === module) { seed(); db.close(); }
module.exports = { seed, DEMO_PASSWORD };
