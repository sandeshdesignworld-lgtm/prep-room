import { computeProgress, relativeDay } from "../.test-build/progress.js";
let pass=0,fail=0;
const ok=(n,c)=>{c?pass++:fail++;console.log(`${c?"ok  ":"FAIL"}  ${n}`);};
const iso=(daysAgo)=>{const d=new Date();d.setDate(d.getDate()-daysAgo);return d.toISOString();};
const S=(id,mode,daysAgo,score,signals)=>({id,mode,title:id,messages:[],createdAt:iso(daysAgo),updatedAt:iso(daysAgo),
  ...(score!==undefined?{debrief:{score,verdict:"v",strengths:[],improvements:[],stronger_line:[],delivery:[]}}:{}),
  ...(signals?{roleplay:{scenario:{counterpart:"x",situation:"",opening:"",difficulty:"realistic"},messages:[],startedAt:iso(daysAgo),signals}}:{})});

console.log("--- empty ---");
const e=computeProgress([]);
ok("no sessions is safe", e.totalSessions===0 && e.averageScore===null && e.bestScore===null);
ok("no trend from nothing", e.trend===null);
ok("no delivery from nothing", e.delivery===null);
ok("no streak from nothing", e.currentStreakDays===0);

console.log("--- counting ---");
const p=computeProgress([S("a","interview",5,4),S("b","interview",3,6),S("c","social",1),S("d","general",0,8)]);
ok("counts all sessions", p.totalSessions===4);
ok("counts only scored runs as practice", p.practiceRuns===3);
ok("average over scored only", p.averageScore===6);
ok("best score", p.bestScore===8);
ok("modes ranked by count", p.byMode[0].mode==="interview" && p.byMode[0].sessions===2);
ok("scores ordered oldest first", p.scores.map(s=>s.score).join()==="4,6,8");

console.log("--- trend needs enough data ---");
ok("2 scores -> no trend", computeProgress([S("a","interview",2,3),S("b","interview",1,9)]).trend===null);
ok("3 scores -> no trend", computeProgress([S("a","interview",3,3),S("b","interview",2,4),S("c","interview",1,9)]).trend===null);
const t=computeProgress([S("a","interview",4,3),S("b","interview",3,3),S("c","interview",2,7),S("d","interview",1,7)]);
ok("4 scores -> trend = +4", t.trend===4);

console.log("--- streak ---");
ok("today only = 1", computeProgress([S("a","general",0)]).currentStreakDays===1);
ok("today+yesterday = 2", computeProgress([S("a","general",1),S("b","general",0)]).currentStreakDays===2);
ok("gap breaks the streak", computeProgress([S("a","general",5),S("b","general",4)]).currentStreakDays===0);
ok("yesterday still counts", computeProgress([S("a","general",1)]).currentStreakDays===1);
ok("same day twice = 1 active day", computeProgress([S("a","general",0),S("b","general",0)]).activeDays===1);

console.log("--- delivery averages ---");
const sig=[{t:0,turn:0,facing:1,smile:0,brow:0,gazeDown:0,jawOpen:0,openness:0.6,tilt:0,fidget:0.2}];
const d=computeProgress([S("a","interview",1,5,sig),S("b","interview",0,6)]);
ok("delivery only from runs that had signals", d.delivery && d.delivery.runs===1);
ok("facing averaged", d.delivery.facing===1);
ok("stillness is inverted fidget", Math.abs(d.delivery.stillness-0.8)<1e-9);

console.log("--- dates ---");
ok("today", relativeDay(iso(0))==="Today");
ok("yesterday", relativeDay(iso(1))==="Yesterday");
ok("3 days", relativeDay(iso(3))==="3 days ago");
ok("bad date is safe", relativeDay("not-a-date")==="");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
