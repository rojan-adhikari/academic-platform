// Shared weekly-timetable definitions: period clock and day names, used by the
// seed (to lay out slots) and the API (so the client renders times without duplicating them).
const PERIODS = [
  { p: 1, start: '08:55', end: '09:50' },
  { p: 2, start: '09:50', end: '10:45' },
  { p: 3, start: '11:05', end: '12:00' },
  { p: 4, start: '12:00', end: '12:55' },
  { p: 5, start: '13:45', end: '14:35' },
  { p: 6, start: '14:35', end: '15:25' },
  { p: 7, start: '15:25', end: '16:15' },
];
// Breaks sit after a period number (tea after 2, lunch after 4).
const BREAKS = { 2: { name: 'Tea Break', mins: 20 }, 4: { name: 'Lunch Break', mins: 50 } };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MENTOR_HOUR = { start: '08:45', end: '08:55', name: 'Mentor Hour' };

// How many weekly periods a course needs, by its course_type.
function weeklyLoad(type) {
  if (type === 'Lab') return 2;        // one double block
  if (type === 'TwL') return 4;        // theory-with-lab
  if (type === 'TwP') return 3;
  return 3;                            // plain theory / foundation
}

module.exports = { PERIODS, BREAKS, DAYS, MENTOR_HOUR, weeklyLoad };
