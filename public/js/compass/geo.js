/* GPS alignment, route snapping and turn prompts (ported from KPR Compass). */
(function(){'use strict';
const ANCHORS=['admin','mechanical','kalaiarangam'];
function coefficients(c){const points=ANCHORS.map(id=>c.nodes.find(n=>n.id===id)).filter((n)=>!!n&&Number.isFinite(n.lat)&&Number.isFinite(n.lon));if(points.length!==3)return null;const [a,b,d]=points;const det=(b.x-a.x)*(d.y-a.y)-(d.x-a.x)*(b.y-a.y);if(Math.abs(det)<.001)return null;const slope=(key)=>{const ab=b[key]-a[key],ad=d[key]-a[key];return {dx:(ab*(d.y-a.y)-ad*(b.y-a.y))/det,dy:((b.x-a.x)*ad-(d.x-a.x)*ab)/det}};return {anchor:a,lat:slope('lat'),lon:slope('lon')}}
function mapToGeo(c,x,y){const v=coefficients(c);if(!v)return null;return {lat:v.anchor.lat+v.lat.dx*(x-v.anchor.x)+v.lat.dy*(y-v.anchor.y),lon:v.anchor.lon+v.lon.dx*(x-v.anchor.x)+v.lon.dy*(y-v.anchor.y)}}
function geoToMap(c,lat,lon){const v=coefficients(c);if(!v)return null;const dl=lat-v.anchor.lat,dn=lon-v.anchor.lon;const det=v.lat.dx*v.lon.dy-v.lat.dy*v.lon.dx;if(Math.abs(det)<1e-12)return null;return {x:v.anchor.x+(dl*v.lon.dy-dn*v.lat.dy)/det,y:v.anchor.y+(v.lat.dx*dn-v.lon.dx*dl)/det}}
function meters(a,b){const r=Math.PI/180;const dLat=(b.lat-a.lat)*r,dLon=(b.lon-a.lon)*r;const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLon/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)))}
function direction(a,b){return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}
function angle(a,b){return ((b-a+540)%360)-180}
function nearestSegment(c,ids,p){let best={index:0,distance:Infinity};for(let i=0;i<ids.length-1;i++){const a=c.nodes.find(n=>n.id===ids[i]),b=c.nodes.find(n=>n.id===ids[i+1]);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));const q={x:a.x+t*dx,y:a.y+t*dy};const pa=mapToGeo(c,p.x,p.y),qa=mapToGeo(c,q.x,q.y);const d=pa&&qa?meters(pa,qa):Infinity;if(d<best.distance)best={index:i,distance:d}}return best}
function liveRoute(c,fix,to,accessible=false){const pos=geoToMap(c,fix.lat,fix.lon);if(!pos||pos.x<0||pos.x>100||pos.y<0||pos.y>100)return null;const candidates=c.nodes.filter(n=>n.floor===0&&c.edges.some(e=>!e.closed&&(!accessible||!e.stairs)&&(e.from===n.id||e.to===n.id))).map(n=>({node:n,dist:meters(fix,mapToGeo(c,n.x,n.y))})).sort((a,b)=>a.dist-b.dist);for(const candidate of candidates.slice(0,8)){if(candidate.dist>Math.max(65,fix.accuracy*2))break;const path=CompassData.route(c,candidate.node.id,to,accessible);if(path)return {...path,nearest:candidate.node.id,snapDistance:candidate.dist}}return null}
function liveInstruction(c,ids,fix,lang='en'){const p=geoToMap(c,fix.lat,fix.lon);if(!p||p.x<0||p.x>100||p.y<0||p.y>100)return {text:lang==='ta'?'வளாகத்திற்கு வெளியே இருக்கிறீர்கள். Google Maps வழிகாட்டுதலைப் பயன்படுத்துங்கள்.':'You are outside the mapped campus. Use Google Maps to reach KPRIET.',speak:false,kind:'outside'};
 if(fix.accuracy>25)return {text:lang==='ta'?`GPS துல்லியம் ±${Math.round(fix.accuracy)} மீ. திறந்த வெளியில் செல்லுங்கள்.`:`GPS accuracy ±${Math.round(fix.accuracy)} m. Move outdoors for a clearer fix.`,speak:false,kind:'weak'};
 const final=c.nodes.find(n=>n.id===ids.at(-1));if(final){const g=mapToGeo(c,final.x,final.y);if(meters(fix,g)<Math.max(12,fix.accuracy))return {text:lang==='ta'?`${final.name} அருகில் வந்துவிட்டீர்கள்.`:`You are near ${final.name}.`,speak:true,kind:'arrival'}}
 if(ids.length<2)return {text:lang==='ta'?`${final?.name||'இலக்கு'} நோக்கி செல்லுங்கள்.`:`Continue toward ${final?.name||'your destination'}.`,speak:true,kind:'straight'};
 const seg=nearestSegment(c,ids,p);if(seg.distance>Math.max(25,fix.accuracy*1.6))return {text:lang==='ta'?'குறிக்கப்பட்ட பாதையிலிருந்து விலகியுள்ளீர்கள். வரைபடத்தைப் பாருங்கள்.':'You appear away from the mapped route. Check the map and reorient.',speak:false,kind:'offroute'};
 const a=c.nodes.find(n=>n.id===ids[seg.index]),b=c.nodes.find(n=>n.id===ids[seg.index+1]),after=c.nodes.find(n=>n.id===ids[seg.index+2]);const bGeo=mapToGeo(c,b.x,b.y);const toJunction=meters(fix,bGeo);
 if(after&&toJunction<Math.max(17,fix.accuracy*1.15)){const turn=angle(direction(a,b),direction(b,after));if(Math.abs(turn)>38){const side=turn>0?'right':'left';return {text:lang==='ta'?`${b.name} அருகில் ${side==='right'?'வலது':'இடது'} பக்கம் திரும்புங்கள்.`:`At ${b.name}, turn ${side}.`,speak:true,kind:side}}}
 return {text:lang==='ta'?`${b.name} நோக்கி நேராக செல்லுங்கள்.`:`Go straight toward ${b.name}.`,speak:true,kind:'straight'}
}

window.CompassGeo={mapToGeo,geoToMap,meters,liveRoute,liveInstruction};
})();
