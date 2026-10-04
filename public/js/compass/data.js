/* KPR Compass campus data, route finder and validator (ported from the KPR Compass project).
   Shared by the browser (window.CompassData) and the server (require). */
(function (root) {
'use strict';
const n=(id,name,x,y,kind='place',detail='')=>({id,name,x,y,floor:0,kind,detail});
const e=(id,from,to,meters,note='')=>({id,from,to,meters,note});
// The numbered destinations and their positions are transcribed from KPRIET's published Campus Layout PDF.
// Connector points and edge weights trace visible roads for route selection; weights are not measured distances.
const sample={version:4,verified:true,mapName:'KPRIET Campus Layout',mapImages:{'0':'/assets/compass/kpriet-campus-layout.webp'},sourceUrl:'https://www.kpriet.ac.in/asset/frontend/pdf/general/campusmap_kpriet-1.pdf',distanceVerified:false,accessibilityVerified:false,gpsCalibrated:false,
 nodes:[
 n('entry','Campus approach',59.6,83,'start','Southern approach shown on the campus layout'),
 n('security','Security Gate · 13',4.5,49,'entrance','Security Gate on the published layout'),
 n('west-junction','West junction',43.2,48.5,'junction'),
 n('parking-junction','Parking junction',52.5,54.4,'junction'),
 n('central-junction','Central junction',43.5,58.9,'junction'),
 n('centre-road','Central campus road',50.0,63.0,'junction'),
 n('admin-junction','Academic junction',62,63.2,'junction'),
 n('south-junction','South junction',59.5,72.5,'junction'),
 n('east-junction','East junction',91,64.5,'junction'),
 n('east-mid','East campus road',91,55.0,'junction'),
 n('east-north','East campus road',89,33.7,'junction'),
 n('north-junction','North campus road',44,34,'junction'),
 n('hostel-junction','Hostel junction',44,45,'junction'),
 {...n('admin','Administrative and AI & DS Block · 01',61,56.7,'building'),lat:11.07658,lon:77.14206},
 n('imperial','Imperial Hall · 02',58.5,61.1,'venue','Also T & P, CoE and Exam Cell on the layout'),
 n('rd','R & D · 03',62,61.1,'building'),
 {...n('mechanical','Mechanical Block · 04',84,60.4,'building'),lat:11.07632,lon:77.14319},
 n('civil-eee','Civil & EEE Block · 05',84,63,'building'),
 n('kprcas1','S&H Block 1 · 06',65,68,'building'),
 n('kprcas2','S&H Block 2 · 07',55,68,'building'),
 n('workshop','Engineering Workshop · 08',80,67,'building'),
 n('structural','Structural Engineering Lab · 09',94,59.6,'building'),
 n('food','Food Court · 10',34,47.3,'food'),
 n('bike','Bike Parking · 11',22,47,'parking'),
 n('car','Car Parking · 12',39.5,54.5,'parking'),
 n('cafeteria','Cafeteria Dining · 14',28.5,47,'food'),
 n('stationery','Stationery · 15',39,47,'place'),
 n('chemical','Chemical Engineering & S&H Block · 16',74,44,'building'),
 n('biomedical','Biomedical Block · 17',84,47.6,'building'),
 n('ece','ECE Block · 18',80,51,'building'),
 n('cse','CSE Block · 19',83,55,'building'),
 n('theatre','Open Theatre · 20',72,55.1,'venue'),
 {...n('kalaiarangam','KPR Kalaiarangam · 21',61,43,'venue'),lat:11.07782,lon:77.14215},
 n('garden','Garden Cafe · 22',74,61,'food'),
 n('library','Central Library · 23',56,65,'library'),
 n('gents','Gents Toilet · 24',65,64,'restroom'),
 n('ladies','Ladies Toilet · 25',60,64,'restroom'),
 n('ganga','Ganga Girls Hostel · 26',83,78,'hostel'),
 n('yamuna','Yamuna Girls Hostel & Mess · 27',73,76,'hostel'),
 n('kaveri','Kaveri Girls Hostel · 28',65,76,'hostel'),
 n('bharathi','Bharathi Boys Hostel & Mess · 29',75,30,'hostel'),
 n('cheran','Cheran Boys Hostel · 30',70,35,'hostel'),
 n('cholan','Cholan Boys Hostel · 31',55,32,'hostel'),
 n('pandian','Pandian Boys Hostel · 32',49,32,'hostel'),
 n('pallavan','Pallavan Boys Hostel · 33',53,29,'hostel'),
 n('basketball','Basketball Courts · 34',47,24,'sports'),
 n('tennis','Tennis Courts · 35',55,23,'sports'),
 n('volleyball','Volleyball Courts · 36',55,26,'sports'),
 n('throwball','Throwball Courts · 37',63,23,'sports'),
 n('handball','Handball Courts · 38',63,26,'sports'),
 n('khokho','Kho Kho Courts · 39',69,23,'sports'),
 n('badminton','Ball Badminton Courts · 40',69,26,'sports'),
 n('cricket','Cricket Ground · 41',53,11,'sports'),
 n('track','400 m Track & Football Ground · 42',70,11,'sports'),
 n('ped','Physical Education Room · 43',50,19,'sports'),
 n('indoor-badminton','Indoor Badminton Courts · 44',49,16,'sports'),
 n('gym','Multipurpose Hall & Gym · 45',47,37,'building'),
 n('celebration','Celebration Zone · 46',51,36,'place'),
 ],
 edges:[
 e('en-s','entry','south-junction',80,'Follow the southern approach on the campus layout'),
 e('s-a','south-junction','admin-junction',85,'Continue toward the academic blocks'),
 e('a-centre','admin-junction','centre-road',70,'Continue along the academic road'),e('centre-c','centre-road','central-junction',65,'Turn toward the centre of campus'),
 e('c-p','central-junction','parking-junction',55),e('p-w','parking-junction','west-junction',65),e('w-g','west-junction','security',200,'Continue west toward the Security Gate'),
 e('w-h','west-junction','hostel-junction',55),e('h-n','hostel-junction','north-junction',95),e('n-ne','north-junction','east-north',210),e('ne-e','east-north','east-junction',240),e('e-a','east-junction','admin-junction',180),
 e('w-food','west-junction','food',45),e('food-bike','food','bike',45),e('food-cafe','food','cafeteria',20),e('w-st','west-junction','stationery',25),e('p-car','parking-junction','car',30),
 e('a-admin','admin-junction','admin',45),e('a-imp','admin-junction','imperial',20),e('a-rd','admin-junction','rd',25),e('e-mech','east-junction','mechanical',30),e('e-civil','east-junction','civil-eee',35),
 e('s-k1','south-junction','kprcas1',35),e('s-k2','south-junction','kprcas2',35),e('e-work','east-junction','workshop',45),e('ne-struct','east-north','structural',100),
 e('h-kalai','hostel-junction','kalaiarangam',80),e('kalai-chem','kalaiarangam','chemical',75),e('chem-bio','chemical','biomedical',50),e('bio-ece','biomedical','ece',45),e('ece-cse','ece','cse',45),e('cse-mid','cse','east-mid',45),e('mid-e','east-mid','east-junction',60),e('a-theatre','admin-junction','theatre',65),e('a-garden','admin-junction','garden',75),
 e('a-library','admin-junction','library',25),e('a-gents','admin-junction','gents',20),e('a-ladies','admin-junction','ladies',15),
 e('n-pandian','north-junction','pandian',45),e('pandian-cholan','pandian','cholan',35),e('cholan-pallavan','cholan','pallavan',30),e('n-basket','north-junction','basketball',60),e('basket-tennis','basketball','tennis',40),e('tennis-volley','tennis','volleyball',25),e('tennis-throw','tennis','throwball',40),e('throw-hand','throwball','handball',25),e('throw-kho','throwball','khokho',35),e('kho-badminton','khokho','badminton',25),e('basket-ped','basketball','ped',35),e('ped-indoor','ped','indoor-badminton',25),e('ped-cricket','ped','cricket',80),e('cricket-track','cricket','track',85),e('h-gym','hostel-junction','gym',70),e('gym-celebration','gym','celebration',25),e('ne-bharathi','east-north','bharathi',90),e('bharathi-cheran','bharathi','cheran',35),e('s-kaveri','south-junction','kaveri',45),e('kaveri-yamuna','kaveri','yamuna',40),e('yamuna-ganga','yamuna','ganga',50)
 ],
 events:[],rooms:[{id:'ragam-hall',name:'Ragam Hall',department:'Event venue',building:'library',floor:null,roomNumber:'',directions:'Above the Central Library. Follow the building signs for the hall.',verified:true},{id:'thanam-hall',name:'Thanam Hall',department:'Event venue',building:'mechanical',floor:null,roomNumber:'',directions:'Inside the Mechanical Block. Follow the building signs for the hall.',verified:true}],facilities:[
 {id:'food',name:'Food Court',kind:'food',node:'food'},{id:'cafe',name:'Cafeteria Dining',kind:'food',node:'cafeteria'},{id:'garden',name:'Garden Cafe',kind:'food',node:'garden'},
 {id:'car',name:'Car Parking',kind:'parking',node:'car'},{id:'bike',name:'Bike Parking',kind:'parking',node:'bike'},
 {id:'gents',name:'Gents Toilet',kind:'restroom',node:'gents'},{id:'ladies',name:'Ladies Toilet',kind:'restroom',node:'ladies'},
 {id:'library',name:'Central Library',kind:'library',node:'library'},{id:'stationery',name:'Stationery',kind:'place',node:'stationery'}
 ],alerts:[]};
function route(c,from,to,accessible=false){
 const dist=new Map(c.nodes.map(n=>[n.id,Infinity]));const prev=new Map();const pending=new Set(c.nodes.map(n=>n.id));if(!dist.has(from)||!dist.has(to))return null;dist.set(from,0);
 while(pending.size){let u='';let min=Infinity;for(const id of pending){const d=dist.get(id);if(d<min){min=d;u=id}}if(!u||!isFinite(min))break;pending.delete(u);if(u===to)break;for(const edge of c.edges){if(edge.closed||(accessible&&edge.stairs))continue;const v=edge.from===u?edge.to:edge.to===u?edge.from:null;if(!v||!pending.has(v))continue;const next=min+edge.meters;if(next<dist.get(v)){dist.set(v,next);prev.set(v,{node:u,edge})}}}
 if(!isFinite(dist.get(to)))return null;const ids=[to],edges=[];let at=to;while(at!==from){const p=prev.get(at);if(!p)return null;edges.unshift(p.edge);at=p.node;ids.unshift(at)}return {ids,edges,meters:dist.get(to),minutes:Math.max(1,Math.ceil(dist.get(to)/75))};
}
function venueName(c,id){return c.rooms?.find(r=>r.id===id)?.name||c.nodes.find(n=>n.id===id)?.name||'Venue'}
function venueNode(c,id){const r=c.rooms?.find(r=>r.id===id);return r?.checkpoint||r?.building||id}
function validCampus(input){return input&&typeof input.mapName==='string'&&typeof input.verified==='boolean'&&Array.isArray(input.nodes)&&input.nodes.length>0&&new Set(input.nodes.map((n)=>n.id)).size===input.nodes.length&&input.nodes.every((n)=>typeof n.id==='string'&&!!n.id&&typeof n.name==='string'&&(n.aliases===undefined||Array.isArray(n.aliases)&&n.aliases.every((a)=>typeof a==='string'))&&Number.isFinite(n.x)&&n.x>=0&&n.x<=100&&Number.isFinite(n.y)&&n.y>=0&&n.y<=100&&Number.isInteger(n.floor)&&(n.lat===undefined||Number.isFinite(n.lat))&&(n.lon===undefined||Number.isFinite(n.lon)))&&Array.isArray(input.edges)&&input.edges.every((e)=>typeof e.id==='string'&&typeof e.from==='string'&&typeof e.to==='string'&&Number.isFinite(e.meters)&&e.meters>0&&input.nodes.some((n)=>n.id===e.from)&&input.nodes.some((n)=>n.id===e.to))&&Array.isArray(input.events)&&input.events.every((e)=>typeof e.id==='string'&&typeof e.title==='string'&&typeof e.time==='string'&&typeof e.instructions==='string'&&(e.description===undefined||typeof e.description==='string'&&e.description.length<=1000)&&(e.startsAt===undefined||typeof e.startsAt==='string'&&Number.isFinite(Date.parse(e.startsAt)))&&(e.endsAt===undefined||typeof e.endsAt==='string'&&Number.isFinite(Date.parse(e.endsAt)))&&(e.registrationOpen===undefined||typeof e.registrationOpen==='boolean')&&(e.posterUrl===undefined||typeof e.posterUrl==='string'&&/^\/api\/campus\/files\/[a-f0-9-]{36}$/.test(e.posterUrl))&&['titleTa','descriptionTa','instructionsTa','timeTa'].every(k=>e[k]===undefined||typeof e[k]==='string'&&e[k].length<=1000)&&(input.nodes.some((n)=>n.id===e.venue)||input.rooms?.some((r)=>r.id===e.venue&&r.verified)))&&(!input.rooms||Array.isArray(input.rooms)&&new Set(input.rooms.map((r)=>r.id)).size===input.rooms.length&&input.rooms.every((r)=>!input.nodes.some((n)=>n.id===r.id)&&typeof r.id==='string'&&typeof r.name==='string'&&typeof r.department==='string'&&typeof r.roomNumber==='string'&&typeof r.directions==='string'&&(r.floor===null||Number.isInteger(r.floor))&&typeof r.verified==='boolean'&&input.nodes.some((n)=>n.id===r.building)&&(r.checkpoint===undefined||input.nodes.some((n)=>n.id===r.checkpoint))))&&Array.isArray(input.facilities)&&input.facilities.every((f)=>typeof f.id==='string'&&typeof f.name==='string'&&input.nodes.some((n)=>n.id===f.node))&&Array.isArray(input.alerts)&&input.alerts.every((a)=>typeof a.id==='string'&&typeof a.message==='string')}

const api = { sample, route, venueName, venueNode, validCampus };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CompassData = api;
})(typeof window !== 'undefined' ? window : globalThis);
