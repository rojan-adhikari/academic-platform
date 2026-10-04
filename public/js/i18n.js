/* Full-UI language switch (English / Tamil / Hindi).
   One mechanism covers every page: a phrase dictionary plus a MutationObserver that
   translates text nodes and key attributes as the SPA renders. Only exact, whole UI
   phrases are matched, so names, codes, numbers and other data are never touched. */
(function () {
  'use strict';
  const LANGS = [['en', 'English'], ['ta', 'தமிழ்'], ['hi', 'हिन्दी']];
  const NATIVE = { en: 'English', ta: 'தமிழ்', hi: 'हिन्दी' };

  // en phrase -> { ta, hi }. Kept to whole UI labels; anything absent falls back to English.
  const T = {
    // ---- navigation & chrome ----
    'Dashboard': ['டாஷ்போர்டு', 'डैशबोर्ड'],
    'Attendance': ['வருகை', 'उपस्थिति'],
    'My Courses': ['எனது பாடங்கள்', 'मेरे पाठ्यक्रम'],
    'Performance': ['செயல்திறன்', 'प्रदर्शन'],
    'Academic Performance': ['கல்விச் செயல்திறன்', 'शैक्षणिक प्रदर्शन'],
    'Academic Risk': ['கல்வி ஆபத்து', 'शैक्षणिक जोखिम'],
    'Notifications': ['அறிவிப்புகள்', 'सूचनाएँ'],
    'Campus Guide': ['வளாக வழிகாட்டி', 'कैंपस गाइड'],
    'Academic Profile': ['கல்வி சுயவிவரம்', 'शैक्षणिक प्रोफ़ाइल'],
    'Profile': ['சுயவிவரம்', 'प्रोफ़ाइल'],
    'Students': ['மாணவர்கள்', 'छात्र'],
    'Staff': ['பணியாளர்கள்', 'कर्मचारी'],
    'Teachers': ['ஆசிரியர்கள்', 'शिक्षक'],
    'Marks': ['மதிப்பெண்கள்', 'अंक'],
    'Voice Entry': ['குரல் பதிவு', 'वॉइस एंट्री'],
    'Voice Sheets': ['குரல் தாள்கள்', 'वॉइस शीट'],
    'Analytics': ['பகுப்பாய்வு', 'विश्लेषण'],
    'Risk Monitoring': ['ஆபத்து கண்காணிப்பு', 'जोखिम निगरानी'],
    'Timetable': ['கால அட்டவணை', 'समय सारिणी'],
    'My Timetable': ['எனது கால அட்டவணை', 'मेरी समय सारिणी'],
    'Teaching Timetable': ['கற்பித்தல் அட்டவணை', 'शिक्षण समय सारिणी'],
    'Classroom': ['வகுப்பறை', 'कक्षा'],
    'Clubs': ['மன்றங்கள்', 'क्लब'],
    'Deadlines': ['காலக்கெடுக்கள்', 'समय-सीमाएँ'],
    'Overview': ['மேலோட்டம்', 'अवलोकन'],
    'Academics': ['கல்வி', 'शिक्षण'],
    'Operations': ['செயல்பாடுகள்', 'संचालन'],
    'People': ['நபர்கள்', 'लोग'],
    'Settings': ['அமைப்புகள்', 'सेटिंग्स'],
    'Audit Logs': ['தணிக்கை பதிவுகள்', 'ऑडिट लॉग'],
    'Import / Export': ['இறக்குமதி / ஏற்றுமதி', 'आयात / निर्यात'],
    'Course approvals': ['பாட ஒப்புதல்கள்', 'पाठ्यक्रम अनुमोदन'],
    'Registrations': ['பதிவுகள்', 'पंजीकरण'],
    'Departments': ['துறைகள்', 'विभाग'],
    'Programmes': ['திட்டங்கள்', 'कार्यक्रम'],
    'Sections': ['பிரிவுகள்', 'अनुभाग'],
    'Hierarchy drill-down': ['படிநிலை விவரம்', 'पदानुक्रम विवरण'],
    'Administrator dashboard': ['நிர்வாகி டாஷ்போர்டு', 'प्रशासक डैशबोर्ड'],
    'Sign out': ['வெளியேறு', 'साइन आउट'],
    'Change password': ['கடவுச்சொல்லை மாற்று', 'पासवर्ड बदलें'],
    'Profile & password': ['சுயவிவரம் & கடவுச்சொல்', 'प्रोफ़ाइल और पासवर्ड'],

    // ---- common words / status ----
    'New': ['புதியது', 'नया'],
    'Read': ['படித்தது', 'पढ़ा गया'],
    'All categories': ['அனைத்து வகைகள்', 'सभी श्रेणियाँ'],
    'Registration': ['பதிவு', 'पंजीकरण'],
    'Announcements': ['அறிவிப்புகள்', 'घोषणाएँ'],
    'System': ['அமைப்பு', 'सिस्टम'],
    'Courses': ['பாடங்கள்', 'पाठ्यक्रम'],
    'Code': ['குறியீடு', 'कोड'],
    'Course': ['பாடம்', 'पाठ्यक्रम'],
    'Credits': ['கிரெடிட்கள்', 'क्रेडिट'],
    'Faculty': ['ஆசிரியர்', 'संकाय'],
    'Section': ['பிரிவு', 'अनुभाग'],
    'Department': ['துறை', 'विभाग'],
    'Members': ['உறுப்பினர்கள்', 'सदस्य'],
    'Coordinator': ['ஒருங்கிணைப்பாளர்', 'समन्वयक'],
    'Member': ['உறுப்பினர்', 'सदस्य'],
    'present': ['வருகை', 'उपस्थित'],
    'Registered': ['பதிவுசெய்யப்பட்டது', 'पंजीकृत'],
    'Required:': ['தேவை:', 'आवश्यक:'],
    'Student': ['மாணவர்', 'छात्र'],
    'Administrator': ['நிர்வாகி', 'प्रशासक'],

    // ---- buttons / actions ----
    'Sign in': ['உள்நுழை', 'साइन इन'],
    "Today's classes": ['இன்றைய வகுப்புகள்', 'आज की कक्षाएँ'],
    'Internal marks': ['உள் மதிப்பெண்கள்', 'आंतरिक अंक'],
    'Enrolment': ['சேர்க்கை', 'नामांकन'],
    'Institution': ['நிறுவனம்', 'संस्थान'],
    'Contact': ['தொடர்பு', 'संपर्क'],
    'Employment': ['பணி விவரம்', 'रोज़गार'],
    'Credits earned': ['பெற்ற கிரெடிட்கள்', 'अर्जित क्रेडिट'],
    'This semester': ['இந்த பருவம்', 'यह सेमेस्टर'],
    'Teaching load': ['கற்பித்தல் சுமை', 'शिक्षण भार'],
    'Periods per week': ['வாரத்திற்கு பாடவேளைகள்', 'प्रति सप्ताह पीरियड'],
    'Registered courses': ['பதிவுசெய்த பாடங்கள்', 'पंजीकृत पाठ्यक्रम'],
    'Assigned courses': ['ஒதுக்கப்பட்ட பாடங்கள்', 'आवंटित पाठ्यक्रम'],
    'Permissions': ['அனுமதிகள்', 'अनुमतियाँ'],
    'Marks still to enter': ['உள்ளிட வேண்டிய மதிப்பெண்கள்', 'दर्ज करने के लिए शेष अंक'],
    'No classes scheduled.': ['வகுப்புகள் இல்லை.', 'कोई कक्षा निर्धारित नहीं।'],
    'Welcome back': ['மீண்டும் வரவேற்கிறோம்', 'पुनः स्वागत है'],
    'Send code': ['குறியீட்டை அனுப்பு', 'कोड भेजें'],
    'Mark all as read': ['அனைத்தையும் படித்ததாகக் குறி', 'सभी को पढ़ा हुआ चिह्नित करें'],
    'Mark as read': ['படித்ததாகக் குறி', 'पढ़ा हुआ चिह्नित करें'],
    'Mark unread': ['படிக்காததாகக் குறி', 'अपठित चिह्नित करें'],
    'Open': ['திற', 'खोलें'],
    'Delete': ['நீக்கு', 'हटाएँ'],
    'Delete selected': ['தேர்ந்தெடுத்ததை நீக்கு', 'चयनित हटाएँ'],
    'Delete all read': ['படித்த அனைத்தையும் நீக்கு', 'सभी पढ़े हटाएँ'],
    'Select all on page': ['பக்கத்தில் அனைத்தையும் தேர்வு', 'पृष्ठ पर सभी चुनें'],
    'Retry': ['மீண்டும் முயற்சி', 'पुनः प्रयास'],
    'Cancel': ['ரத்து', 'रद्द करें'],
    'Confirm': ['உறுதிப்படுத்து', 'पुष्टि करें'],
    'Save': ['சேமி', 'सहेजें'],
    'Join': ['சேர்', 'शामिल हों'],
    'Leave': ['விலகு', 'छोड़ें'],
    'Joined': ['சேர்ந்தது', 'शामिल'],
    'Request': ['கோரிக்கை', 'अनुरोध'],
    'Approve': ['ஒப்புக்கொள்', 'स्वीकृत करें'],
    'Decline': ['நிராகரி', 'अस्वीकार करें'],
    'Withdraw': ['திரும்பப் பெறு', 'वापस लें'],
    'Submit': ['சமர்ப்பி', 'जमा करें'],
    'Post': ['இடுகை', 'पोस्ट करें'],
    'Edit': ['திருத்து', 'संपादित करें'],
    'View members': ['உறுப்பினர்களைக் காண்க', 'सदस्य देखें'],
    'Forgot password?': ['கடவுச்சொல் மறந்துவிட்டதா?', 'पासवर्ड भूल गए?'],
    'Add a course': ['ஒரு பாடத்தைச் சேர்', 'पाठ्यक्रम जोड़ें'],
    'Add': ['சேர்', 'जोड़ें'],

    // ---- clubs ----
    'Clubs & Societies': ['மன்றங்கள் & சங்கங்கள்', 'क्लब और समितियाँ'],
    'My clubs': ['எனது மன்றங்கள்', 'मेरे क्लब'],
    'You are not in any clubs yet.': ['நீங்கள் இன்னும் எந்த மன்றத்திலும் இல்லை.', 'आप अभी किसी क्लब में नहीं हैं।'],
    'Browse clubs and join the ones you like.': ['மன்றங்களைப் பார்த்து விரும்புவதில் சேருங்கள்.', 'क्लब देखें और पसंदीदा में शामिल हों।'],

    // ---- timetable ----
    'Weekly timetable': ['வாராந்திர கால அட்டவணை', 'साप्ताहिक समय सारिणी'],
    'Mentor Hour': ['வழிகாட்டி நேரம்', 'मेंटर आवर'],
    'Tea Break': ['தேநீர் இடைவேளை', 'चाय विराम'],
    'Lunch Break': ['மதிய உணவு இடைவேளை', 'दोपहर भोजन विराम'],
    'No classes scheduled.': ['வகுப்புகள் எதுவும் இல்லை.', 'कोई कक्षा निर्धारित नहीं।'],
    'Period': ['பாடவேளை', 'कालांश'],
    'Monday': ['திங்கள்', 'सोमवार'], 'Tuesday': ['செவ்வாய்', 'मंगलवार'], 'Wednesday': ['புதன்', 'बुधवार'],
    'Thursday': ['வியாழன்', 'गुरुवार'], 'Friday': ['வெள்ளி', 'शुक्रवार'], 'Saturday': ['சனி', 'शनिवार'],
    'Mon': ['திங்', 'सोम'], 'Tue': ['செவ்', 'मंगल'], 'Wed': ['புத', 'बुध'], 'Thu': ['வியா', 'गुरु'], 'Fri': ['வெள்', 'शुक्र'], 'Sat': ['சனி', 'शनि'],

    // ---- classroom / deadlines ----
    'Upcoming deadlines': ['வரவிருக்கும் காலக்கெடுக்கள்', 'आगामी समय-सीमाएँ'],
    'Past deadlines': ['கடந்த காலக்கெடுக்கள்', 'बीती समय-सीमाएँ'],
    'No upcoming deadlines.': ['வரவிருக்கும் காலக்கெடு இல்லை.', 'कोई आगामी समय-सीमा नहीं।'],
    'Stream': ['ஸ்ட்ரீம்', 'स्ट्रीम'],
    'Assignment': ['பணி', 'असाइनमेंट'],
    'Note': ['குறிப்பு', 'नोट'],
    'Material': ['பொருள்', 'सामग्री'],
    'Due date': ['கடைசி தேதி', 'नियत तिथि'],
    'Points': ['புள்ளிகள்', 'अंक'],
    'Title': ['தலைப்பு', 'शीर्षक'],
    'Details': ['விவரங்கள்', 'विवरण'],
    'Link': ['இணைப்பு', 'लिंक'],
    'Submit assignment': ['பணியைச் சமர்ப்பி', 'असाइनमेंट जमा करें'],
    'Submitted': ['சமர்ப்பிக்கப்பட்டது', 'जमा किया गया'],
    'New assignment': ['புதிய பணி', 'नया असाइनमेंट'],
    'New note': ['புதிய குறிப்பு', 'नया नोट'],
    'New material': ['புதிய பொருள்', 'नई सामग्री'],
    'Submissions': ['சமர்ப்பிப்புகள்', 'सबमिशन'],
    'No posts yet.': ['இதுவரை இடுகைகள் இல்லை.', 'अभी कोई पोस्ट नहीं।'],
    'Pick a course to open its classroom.': ['வகுப்பறையைத் திறக்க ஒரு பாடத்தைத் தேர்ந்தெடுக்கவும்.', 'कक्षा खोलने के लिए एक पाठ्यक्रम चुनें।'],
    'PDF attachment (optional)': ['PDF இணைப்பு (விருப்பம்)', 'PDF अटैचमेंट (वैकल्पिक)'],
    'Upload PDF': ['PDF பதிவேற்று', 'PDF अपलोड करें'],
    'Submission link (optional)': ['சமர்ப்பிப்பு இணைப்பு (விருப்பம்)', 'सबमिशन लिंक (वैकल्पिक)'],
    'Note (optional)': ['குறிப்பு (விருப்பம்)', 'नोट (वैकल्पिक)'],
    'Phone number': ['தொலைபேசி எண்', 'फ़ोन नंबर'],
    'Roll number': ['பதிவெண்', 'रोल नंबर'],
    'Why do you want to join?': ['ஏன் சேர விரும்புகிறீர்கள்?', 'आप क्यों शामिल होना चाहते हैं?'],
    'Join club': ['மன்றத்தில் சேர்', 'क्लब में शामिल हों'],
    'Name': ['பெயர்', 'नाम'],

    // ---- dashboards / cards / status ----
    'Needs your attention': ['உங்கள் கவனம் தேவை', 'आपके ध्यान की आवश्यकता'],
    'Overall attendance': ['மொத்த வருகை', 'कुल उपस्थिति'],
    'Current performance': ['தற்போதைய செயல்திறன்', 'वर्तमान प्रदर्शन'],
    'Academic risk': ['கல்வி ஆபத்து', 'शैक्षणिक जोखिम'],
    'Unread notifications': ['படிக்காத அறிவிப்புகள்', 'अपठित सूचनाएँ'],
    'Subject-wise attendance': ['பாடவாரியான வருகை', 'विषयवार उपस्थिति'],
    'Risk by course': ['பாடவாரியான ஆபத்து', 'पाठ्यक्रमवार जोखिम'],
    'Status': ['நிலை', 'स्थिति'],
    'Prediction': ['கணிப்பு', 'पूर्वानुमान'],
    'Safe': ['பாதுகாப்பு', 'सुरक्षित'],
    'Attention': ['கவனம்', 'ध्यान'],
    'Critical': ['ஆபத்து', 'गंभीर'],
    'Normal': ['சாதாரணம்', 'सामान्य'],
    'High': ['அதிகம்', 'उच्च'],
    'High Risk': ['அதிக ஆபத்து', 'उच्च जोखिम'],
    'See why →': ['காரணம் காண்க →', 'कारण देखें →'],
    'Explanation →': ['விளக்கம் →', 'व्याख्या →'],
    'Details & predictions →': ['விவரங்கள் & கணிப்புகள் →', 'विवरण और पूर्वानुमान →'],
    'Open notification centre →': ['அறிவிப்பு மையத்தைத் திற →', 'सूचना केंद्र खोलें →'],
    'All →': ['அனைத்தும் →', 'सभी →'],
    'Previous SGPA': ['முந்தைய SGPA', 'पिछला SGPA'],
    'Academic report': ['கல்வி அறிக்கை', 'शैक्षणिक रिपोर्ट'],
    'per course.': ['ஒரு பாடத்திற்கு.', 'प्रति पाठ्यक्रम।'],
    "You're all caught up.": ['நீங்கள் அனைத்தையும் பார்த்துவிட்டீர்கள்.', 'आप पूरी तरह अपडेट हैं।'],
    'No records found.': ['பதிவுகள் எதுவும் இல்லை.', 'कोई रिकॉर्ड नहीं मिला।'],
    'Recent announcements': ['சமீபத்திய அறிவிப்புகள்', 'हाल की घोषणाएँ'],
    'Academic details': ['கல்வி விவரங்கள்', 'शैक्षणिक विवरण'],
    'Attendance trend': ['வருகைப் போக்கு', 'उपस्थिति प्रवृत्ति'],
    'New notifications': ['புதிய அறிவிப்புகள்', 'नई सूचनाएँ'],
    'Full profile →': ['முழு சுயவிவரம் →', 'पूरा प्रोफ़ाइल →'],
    'Weekly, all courses': ['வாராந்திரம், அனைத்துப் பாடங்களும்', 'साप्ताहिक, सभी पाठ्यक्रम'],
    'University': ['பல்கலைக்கழகம்', 'विश्वविद्यालय'],
    'College': ['கல்லூரி', 'कॉलेज'],
    'Programme': ['திட்டம்', 'कार्यक्रम'],
    'Regulation': ['ஒழுங்குமுறை', 'विनियमन'],
    'Batch': ['தொகுதி', 'बैच'],
    'Academic year': ['கல்வியாண்டு', 'शैक्षणिक वर्ष'],
    'Semester': ['பருவம்', 'सेमेस्टर'],

    // ---- public / landing / login ----
    'One nation.': ['ஒரே தேசம்.', 'एक राष्ट्र।'],
    'Every campus.': ['ஒவ்வொரு வளாகமும்.', 'हर कैंपस।'],
    'Find your institution': ['உங்கள் நிறுவனத்தைக் கண்டறியுங்கள்', 'अपना संस्थान खोजें'],
    'Institutions': ['நிறுவனங்கள்', 'संस्थान'],
    'Platform': ['தளம்', 'प्लेटफ़ॉर्म'],
    'Support': ['உதவி', 'सहायता'],
    'Open my portal': ['எனது போர்ட்டலைத் திற', 'मेरा पोर्टल खोलें'],
    'universities': ['பல்கலைக்கழகங்கள்', 'विश्वविद्यालय'],
    'colleges': ['கல்லூரிகள்', 'कॉलेज'],
    'students': ['மாணவர்கள்', 'छात्र'],
    'faculty': ['ஆசிரியர்கள்', 'संकाय'],
    'Choose the portal you want to open.': ['திறக்க வேண்டிய போர்ட்டலைத் தேர்ந்தெடுக்கவும்.', 'जो पोर्टल खोलना है उसे चुनें।'],
    'Keep me signed in on this device': ['இந்த சாதனத்தில் உள்நுழைந்தே இரு', 'इस डिवाइस पर साइन इन रखें'],
    'Reset your password': ['உங்கள் கடவுச்சொல்லை மீட்டமை', 'अपना पासवर्ड रीसेट करें'],
    'One-time code': ['ஒருமுறை குறியீடு', 'वन-टाइम कोड'],
    'Verification code': ['சரிபார்ப்பு குறியீடு', 'सत्यापन कोड'],
    'New password': ['புதிய கடவுச்சொல்', 'नया पासवर्ड'],
    'Verify and sign in': ['சரிபார்த்து உள்நுழை', 'सत्यापित करके साइन इन करें'],
    'Reset password': ['கடவுச்சொல்லை மீட்டமை', 'पासवर्ड रीसेट करें'],
    'Faculty': ['ஆசிரியர்', 'संकाय'],
    'Password': ['கடவுச்சொல்', 'पासवर्ड'],
    'Change': ['மாற்று', 'बदलें'],
    'Search your courses and notifications': ['உங்கள் பாடங்கள் மற்றும் அறிவிப்புகளைத் தேடுங்கள்', 'अपने पाठ्यक्रम और सूचनाएँ खोजें'],
    'Search your courses and students': ['உங்கள் பாடங்கள் மற்றும் மாணவர்களைத் தேடுங்கள்', 'अपने पाठ्यक्रम और छात्र खोजें'],
    'Search students, staff, courses, departments': ['மாணவர்கள், பணியாளர்கள், பாடங்கள், துறைகளைத் தேடுங்கள்', 'छात्र, कर्मचारी, पाठ्यक्रम, विभाग खोजें'],
  };

  // Generated sentences with live numbers: translated by pattern so the whole page switches.
  const PATTERNS = [
    { re: /^Missing the next class would take attendance below ([\d.]+)%\.$/,
      ta: (m) => `அடுத்த வகுப்பைத் தவறவிட்டால் வருகை ${m[1]}%க்கு கீழே செல்லும்.`, hi: (m) => `अगली कक्षा चूकने पर उपस्थिति ${m[1]}% से नीचे चली जाएगी।` },
    { re: /^If you miss the next (\d+) classes?, attendance will fall below ([\d.]+)%\.$/,
      ta: (m) => `அடுத்த ${m[1]} வகுப்புகளைத் தவறவிட்டால் வருகை ${m[2]}%க்கு கீழே விழும்.`, hi: (m) => `यदि आप अगली ${m[1]} कक्षाएँ चूकते हैं, तो उपस्थिति ${m[2]}% से नीचे आ जाएगी।` },
    { re: /^(\d+) items?$/, ta: (m) => `${m[1]} உருப்படிகள்`, hi: (m) => `${m[1]} आइटम` },
    { re: /^(\d+) member(s)?$/, ta: (m) => `${m[1]} உறுப்பினர்கள்`, hi: (m) => `${m[1]} सदस्य` },
    { re: /^(\d+) post(s)?$/, ta: (m) => `${m[1]} இடுகைகள்`, hi: (m) => `${m[1]} पोस्ट` },
    { re: /^(\d+) course(s)? · (\d+) credits$/, ta: (m) => `${m[1]} பாடங்கள் · ${m[2]} கிரெடிட்கள்`, hi: (m) => `${m[1]} पाठ्यक्रम · ${m[2]} क्रेडिट` },
    { re: /^Required: $/, ta: () => 'தேவை: ', hi: () => 'आवश्यक: ' },
    { re: /^(.+): attendance ([\d.]+)%$/,
      ta: (m) => `${m[1]}: வருகை ${m[2]}%`, hi: (m) => `${m[1]}: उपस्थिति ${m[2]}%` },
    { re: /^Attendance is below the (\d+)% threshold \(([\d.]+)%\)$/,
      ta: (m) => `வருகை ${m[1]}% வரம்பிற்குக் கீழே உள்ளது (${m[2]}%)`, hi: (m) => `उपस्थिति ${m[1]}% सीमा से नीचे है (${m[2]}%)` },
    { re: /^Attendance is close to the (\d+)% threshold \(([\d.]+)%\)$/,
      ta: (m) => `வருகை ${m[1]}% வரம்பிற்கு அருகில் உள்ளது (${m[2]}%)`, hi: (m) => `उपस्थिति ${m[1]}% सीमा के करीब है (${m[2]}%)` },
    { re: /^Attendance is declining: ([\d.]+)% in the last (\d+) classes against ([\d.]+)% overall$/,
      ta: (m) => `வருகை குறைந்து வருகிறது: கடைசி ${m[2]} வகுப்புகளில் ${m[1]}%, மொத்தம் ${m[3]}%`, hi: (m) => `उपस्थिति घट रही है: पिछली ${m[2]} कक्षाओं में ${m[1]}%, कुल ${m[3]}%` },
    { re: /^Recent assessment performance decreased: ([\d.]+)% in (.+) against ([\d.]+)% earlier$/,
      ta: (m) => `சமீபத்திய மதிப்பீட்டுத் திறன் குறைந்தது: ${m[2]} இல் ${m[1]}%, முன்பு ${m[3]}%`, hi: (m) => `हालिया मूल्यांकन प्रदर्शन घटा: ${m[2]} में ${m[1]}%, पहले ${m[3]}%` },
    { re: /^Assignment performance is declining: ([\d.]+)% in (.+) against ([\d.]+)% earlier$/,
      ta: (m) => `பணித் திறன் குறைந்து வருகிறது: ${m[2]} இல் ${m[1]}%, முன்பு ${m[3]}%`, hi: (m) => `असाइनमेंट प्रदर्शन घट रहा है: ${m[2]} में ${m[1]}%, पहले ${m[3]}%` },
    { re: /^Assessment average is low \(([\d.]+)%\)$/,
      ta: (m) => `மதிப்பீட்டு சராசரி குறைவு (${m[1]}%)`, hi: (m) => `मूल्यांकन औसत कम है (${m[1]}%)` },
    { re: /^Assignment performance is low \(([\d.]+)%\)$/,
      ta: (m) => `பணித் திறன் குறைவு (${m[1]}%)`, hi: (m) => `असाइनमेंट प्रदर्शन कम है (${m[1]}%)` },
    { re: /^Attendance is healthy \(([\d.]+)%\)$/,
      ta: (m) => `வருகை ஆரோக்கியமாக உள்ளது (${m[1]}%)`, hi: (m) => `उपस्थिति अच्छी है (${m[1]}%)` },
    { re: /^Assessment average is strong \(([\d.]+)%\)$/,
      ta: (m) => `மதிப்பீட்டு சராசரி சிறப்பு (${m[1]}%)`, hi: (m) => `मूल्यांकन औसत मजबूत है (${m[1]}%)` },
    { re: /^Assignments are on track \(([\d.]+)%\)$/,
      ta: (m) => `பணிகள் சரியான பாதையில் (${m[1]}%)`, hi: (m) => `असाइनमेंट सही राह पर हैं (${m[1]}%)` },
    { re: /^Previous academic performance is weak \(average SGPA ([\d.]+)\)$/,
      ta: (m) => `முந்தைய கல்வித் திறன் பலவீனம் (சராசரி SGPA ${m[1]})`, hi: (m) => `पिछला शैक्षणिक प्रदर्शन कमजोर है (औसत SGPA ${m[1]})` },
    { re: /^Good morning, (.+)$/, ta: (m) => `காலை வணக்கம், ${m[1]}`, hi: (m) => `सुप्रभात, ${m[1]}` },
    { re: /^Good afternoon, (.+)$/, ta: (m) => `மதிய வணக்கம், ${m[1]}`, hi: (m) => `नमस्कार, ${m[1]}` },
    { re: /^Good evening, (.+)$/, ta: (m) => `மாலை வணக்கம், ${m[1]}`, hi: (m) => `शुभ संध्या, ${m[1]}` },
    { re: /^Welcome, (.+)$/,
      ta: (m) => `வரவேற்கிறோம், ${m[1]}`, hi: (m) => `स्वागत है, ${m[1]}` },
    { re: /^Previous SGPA ([\d.]+) · CGPA ([\d.]+)$/,
      ta: (m) => `முந்தைய SGPA ${m[1]} · CGPA ${m[2]}`, hi: (m) => `पिछला SGPA ${m[1]} · CGPA ${m[2]}` },
    { re: /^Required ([\d.]+)%$/,
      ta: (m) => `தேவை ${m[1]}%`, hi: (m) => `आवश्यक ${m[1]}%` },
  ];

  let lang = 'en';
  try { lang = localStorage.getItem('nerd-lang') || 'en'; } catch { /* storage off */ }
  if (!NATIVE[lang]) lang = 'en';

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT', 'TEXTAREA', 'CODE', 'NODESCRIPT']);
  function lookup(key) { const e = T[key]; if (!e) return null; const i = lang === 'ta' ? 0 : lang === 'hi' ? 1 : -1; return i < 0 ? null : e[i]; }

  function patternTranslate(key) {
    if (lang === 'en') return null;
    for (const p of PATTERNS) {
      const m = p.re.exec(key);
      if (m) { const fn = lang === 'ta' ? p.ta : p.hi; return fn ? fn(m) : null; }
    }
    return null;
  }
  function translateTextNode(node) {
    const raw = node.nodeValue;
    const key = raw.trim();
    if (!key || key.length > 140 || /^[\d\s.,%:/·—–-]+$/.test(key)) return;
    const tr = lookup(key) || patternTranslate(key);
    if (tr && tr !== key) {
      const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
      node.nodeValue = lead + tr + trail;
    }
  }
  function translateAttrs(el) {
    for (const a of ['placeholder', 'aria-label', 'title']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const tr = lookup(v.trim());
      if (tr && tr !== v) el.setAttribute(a, tr);
    }
  }
  function walk(node) {
    if (lang === 'en') return;
    if (node.nodeType === 3) { translateTextNode(node); return; }
    if (node.nodeType !== 1 || SKIP_TAGS.has(node.tagName)) return;
    translateAttrs(node);
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  let observer = null;
  function startObserver() {
    const app = document.getElementById('app');
    if (!app || observer) return;
    observer = new MutationObserver((muts) => {
      if (lang === 'en') return;
      for (const m of muts) {
        if (m.type === 'characterData') translateTextNode(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(app, { childList: true, subtree: true, characterData: true });
  }

  function retranslate() {
    const app = document.getElementById('app');
    if (app) walk(app);
    document.documentElement.setAttribute('lang', lang);
  }

  function set(l) {
    if (!NATIVE[l] || l === lang) { closeMenu(); return; }
    lang = l;
    try { localStorage.setItem('nerd-lang', l); } catch { /* storage off */ }
    document.documentElement.setAttribute('lang', l);
    closeMenu();
    // Re-render the current view from scratch (English), then the observer + a full
    // pass translate it. Falling back to English for anything not in the dictionary.
    if (window.App && App.render) App.render();
    retranslate();
  }

  function closeMenu() { const d = document.getElementById('lang-dd'); if (d) d.remove(); }
  function menu(ev) {
    if (ev) ev.stopPropagation();
    if (document.getElementById('lang-dd')) { closeMenu(); return; }
    const d = document.createElement('div');
    d.className = 'dropdown lang-dd'; d.id = 'lang-dd';
    d.innerHTML = LANGS.map(([code, label]) => `<button data-lang="${code}"${code === lang ? ' class="active"' : ''}>${label}</button>`).join('');
    document.body.appendChild(d);
    const btn = document.getElementById('lang-btn');
    if (btn) { const r = btn.getBoundingClientRect(); d.style.top = (r.bottom + 6) + 'px'; d.style.right = (window.innerWidth - r.right) + 'px'; }
    d.querySelectorAll('button').forEach((b) => { b.onclick = () => set(b.dataset.lang); });
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('#lang-dd') && !e.target.closest('#lang-btn')) closeMenu(); });

  // Start translating as soon as the app shell exists, and keep the current language on boot.
  function boot() {
    startObserver();
    retranslate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.App = window.App || {};
  window.App.i18n = { get lang() { return lang; }, set, menu, langs: LANGS, native: NATIVE, retranslate, startObserver };
})();
