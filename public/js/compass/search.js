/* Campus search with department aliases (ported from KPR Compass). */
(function(){'use strict';
const aliases={
 admin:['administrative','admin block','administration','ai ds','ai and ds','aids','artificial intelligence and data science'],
 cse:['cs','cse','computer science','computer science and engineering','cse department','computer department'],
 ece:['ec','ece','electronics','electronics communication','electronics and communication engineering','ece department'],
 'civil-eee':['ce','civil','civil engineering','eee','ee','electrical','electrical and electronics engineering'],
 mechanical:['me','mech','mechanical engineering','mechanical department'],
 chemical:['chem','chemical engineering'],biomedical:['bm','bme','bio med','biomedical engineering'],
 kprcas1:['s and h','sh','s h','science and humanities','science humanities block 1'],kprcas2:['s and h','sh','s h','science and humanities','science humanities block 2'],
 library:['book','books','central library'],imperial:['imperial hall','auditorium'],
 gents:['mens restroom','men toilet','boys toilet','washroom'],ladies:['womens restroom','women toilet','girls toilet','washroom'],
 car:['car parking','parking'],bike:['bike parking','two wheeler parking'],food:['food court','canteen'],
 security:['main gate','gate','security gate'],entry:['campus entrance','main entrance']
};
const norm=(v)=>v.toLocaleLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
function score(q,title,other,terms=[]){const t=norm(title),h=norm(other),a=terms.map(norm);if(t===q||a.includes(q))return 100;if(t.startsWith(q)||a.some(x=>x.startsWith(q)))return 80;if(q.length>=3&&(t.includes(q)||a.some(x=>x.includes(q))))return 60;if(q.length>=3&&h.includes(q))return 45;if(q.length<3)return 0;const words=q.split(' ');return words.every(w=>[t,h,...a].some(x=>x.split(' ').some(token=>token.startsWith(w))))?25:0}
function searchCampus(c,input){const q=norm(input);if(!q)return [];const found=[];
 for(const n of c.nodes){if(n.kind==='junction')continue;const s=score(q,n.name,[n.id,n.kind,n.detail].join(' '),[...(aliases[n.id]||[]),...(n.aliases||[])]);if(s)found.push({kind:'place',id:n.id,node:n.id,title:n.name,subtitle:aliases[n.id]?.find(x=>x.length>12)|| (n.kind==='building'?'Academic building':'Campus place'),score:s})}
 for(const r of c.rooms||[]){if(!r.verified)continue;const building=c.nodes.find(n=>n.id===r.building);const s=score(q,r.name,[r.department,r.roomNumber,building?.name].join(' '));if(s)found.push({kind:'room',id:r.id,node:r.checkpoint||r.building,title:r.name,subtitle:[r.department,building?.name,r.floor===null?'':`Floor ${r.floor}`,r.roomNumber].filter(Boolean).join(' · '),score:s+3})}
 for(const e of c.events){const place=CompassData.venueName(c,e.venue);const s=score(q,e.title,[place,e.time,e.instructions].join(' '));if(s)found.push({kind:'event',id:e.id,node:CompassData.venueNode(c,e.venue),title:e.title,subtitle:`${e.time} · ${place}`,score:s+2})}
 for(const f of c.facilities){const place=c.nodes.find(n=>n.id===f.node);const s=score(q,f.name,[f.kind,place?.name].join(' '));if(s&&norm(f.name)!==norm(place?.name||''))found.push({kind:'facility',id:f.id,node:f.node,title:f.name,subtitle:place?.name||'Facility',score:s+1})}
 return found.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title))}

window.CompassSearch={searchCampus,norm};
})();
