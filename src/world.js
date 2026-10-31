// Seeded, static conceptual generator. No claim of physically simulated tectonics.
export function hashSeed(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const fract = x => x - Math.floor(x);
function noise(x,y,z,s){ const v = Math.sin(x*12.9898+y*78.233+z*37.719+s*0.0000181)*43758.5453; return fract(v)*2-1; }
export function sampleCell(seed, lat, lon) {
 const s=hashSeed(seed), la=lat*Math.PI/180, lo=lon*Math.PI/180, x=Math.cos(la)*Math.cos(lo), y=Math.sin(la), z=Math.cos(la)*Math.sin(lo);
 // Low-order spherical waves with deterministic trigonometric perturbations.
 const p=Math.sin(2.7*x+1.3*Math.sin(3.2*z+s*.000001))+Math.cos(4.3*z-2.2*y+s*.000003)*.55+Math.sin(6.8*y+3*x)*.28;
 const ridge=Math.abs(Math.sin(7*x+5*z+s*.00001)*Math.cos(6*y-2*z));
 const elevation=clamp(Math.round((p*.42+ridge*.35-.16)*3800),-5900,6600);
 const temperature=clamp(31-57*Math.pow(Math.abs(lat)/90,1.55)-Math.max(0,elevation)*.0062+4*Math.sin(lo),-65,47);
 const wetBelt=36+30*Math.cos(la*4.4); const shadow= ridge>0.71 && elevation>900 ? .36 : 1;
 const rainfall=Math.max(0,Math.round((wetBelt+22*Math.sin(lo*2+y*4)+30*Math.cos(la*7))*shadow * (elevation<0?1.15:1)));
 const plate=Math.floor((Math.atan2(z,x)+Math.PI)/ (2*Math.PI/8)+Math.sin(y*6)*.5+8)%8;
 let biome='Ocean';
 if (elevation>=0) { if(temperature<-8) biome='Ice'; else if(temperature<3) biome='Tundra'; else if(rainfall<23) biome='Desert'; else if(rainfall<43) biome='Grassland'; else if(temperature>22&&rainfall>76) biome='Rainforest'; else if(temperature<13) biome='Boreal forest'; else biome='Temperate forest'; }
 return {lat:Math.round(lat*100)/100,lon:Math.round(lon*100)/100,elevation,temperature:Math.round(temperature*10)/10,rainfall,biome,plate};
}
export function createWorld(seed){const random=rng(hashSeed(seed));const settlements=[];let attempts=0;while(settlements.length<8&&attempts<3000){attempts++;const lat=(random()*140)-70,lon=(random()*360)-180;const c=sampleCell(seed,lat,lon);if(c.elevation>0&&c.elevation<1800&&c.temperature>3&&c.rainfall>30&&settlements.every(t=>Math.hypot(t.lat-lat,(t.lon-lon)*Math.cos(lat*Math.PI/180))>24)){settlements.push({name:['Aster','Vela','Orin','Keth','Nadir','Sora','Mira','Eris'][settlements.length],lat:Math.round(lat*10)/10,lon:Math.round(lon*10)/10,founded:Math.floor(random()*1400)+100,biome:c.biome});}}
 const timeline=settlements.map(t=>({year:t.founded,event:t.name+' founded in '+t.biome.toLowerCase()})).sort((a,b)=>a.year-b.year);
 return {seed:String(seed),version:'prototype-0.1',settlements,timeline};}
export function buildGrid(seed,step=8){const cells=[];for(let lat=-86;lat<=86;lat+=step)for(let lon=-180;lon<180;lon+=step)cells.push(sampleCell(seed,lat,lon));return cells;}
