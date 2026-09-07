import { parseJsonLoose, cleanLine } from "../.test-build/json.js";
let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?pass++:fail++;
  console.log(`${ok?"ok  ":"FAIL"}  ${n}${ok?"":`\n        got  ${JSON.stringify(g)}\n        want ${JSON.stringify(w)}`}`);};

const ok=(n,c)=>{c?pass++:fail++;console.log(`${c?"ok  ":"FAIL"}  ${n}`);};

eq("plain json", parseJsonLoose('{"score":7}'), {score:7});
eq("json fence", parseJsonLoose('```json\n{"score":7}\n```'), {score:7});
eq("bare fence", parseJsonLoose('```\n{"score":7}\n```'), {score:7});
eq("prose before and after", parseJsonLoose('Here you go:\n{"score":7}\nHope that helps!'), {score:7});
eq("nested objects", parseJsonLoose('noise {"a":{"b":[1,2]},"c":3} tail'), {a:{b:[1,2]},c:3});
eq("brace inside a string", parseJsonLoose('{"verdict":"strong } finish","score":8}'), {verdict:"strong } finish",score:8});
eq("escaped quote inside string", parseJsonLoose('{"v":"they said \\"no\\" firmly"}'), {v:'they said "no" firmly'});
eq("escaped backslash before quote", parseJsonLoose('{"v":"path\\\\"}'), {v:"path\\"});
eq("fence plus prose", parseJsonLoose('Sure.\n```json\n{"a":1}\n```\nDone.'), {a:1});
eq("garbage returns null", parseJsonLoose('no json here at all'), null);
eq("unbalanced returns null", parseJsonLoose('{"a":1'), null);
eq("empty returns null", parseJsonLoose('   '), null);
eq("array at top level is not an object but still parses", parseJsonLoose('[1,2]'), [1,2]);

console.log("--- stray escapes ---");
ok("a literal backslash-u becomes the character",
  cleanLine("sharpen this \\u2014 like so") === "sharpen this — like so");
ok("several in one line", cleanLine("\\u201cyes\\u201d") === "“yes”");
ok("real text is untouched", cleanLine("  8 LPA, plain and simple  ") === "8 LPA, plain and simple");
ok("a lone surrogate is left alone", cleanLine("\\ud800") === "\\ud800");
ok("nothing to decode", cleanLine("no escapes here") === "no escapes here");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
