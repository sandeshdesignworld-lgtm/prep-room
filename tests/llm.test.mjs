import { isProviderFault, describeFailure, providerOrder, register,
         NoProviderError, AllProvidersFailed, statusOf } from "../.test-build/llm.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const apiErr = (status, message) => Object.assign(new Error(message), { status });

// --- the real errors that took this app down ---
console.log("--- money problems always fail over ---");
eq("anthropic out of credit (400)", isProviderFault(
  apiErr(400, "Your credit balance is too low to access the Anthropic API.")), true);
eq("openai quota (429 insufficient_quota)", isProviderFault(
  apiErr(429, "You exceeded your current quota, please check your plan and billing details.")), true);
eq("a billing error with no status", isProviderFault(
  Object.assign(new Error("billing hard limit reached"), {})), true);

console.log("--- their fault: ask someone else ---");
eq("401 rejected key", isProviderFault(apiErr(401, "invalid api key")), true);
eq("403 forbidden", isProviderFault(apiErr(403, "forbidden")), true);
eq("404 model not visible", isProviderFault(apiErr(404, "model not found")), true);
eq("429 rate limit", isProviderFault(apiErr(429, "rate limit")), true);
eq("500", isProviderFault(apiErr(500, "internal")), true);
eq("503", isProviderFault(apiErr(503, "overloaded")), true);
eq("connection never landed", isProviderFault(new Error("Connection error")), true);

console.log("--- our fault: do NOT double the latency for the same failure ---");
eq("plain 400 bad request", isProviderFault(apiErr(400, "messages: at least one required")), false);
eq("422 unprocessable", isProviderFault(apiErr(422, "bad shape")), false);
eq("a bare error", isProviderFault(new Error("something odd")), false);

console.log("--- what the user is told ---");
eq("out of credit is named, not hidden", describeFailure(
  apiErr(400, "Your credit balance is too low")), 
  { status: 402, message: "The coach is out of credit. Top up the API account and it'll start answering again." });
eq("openai quota reads the same", describeFailure(
  apiErr(429, "You exceeded your current quota")).status, 402);
eq("rejected key", describeFailure(apiErr(401, "bad key")),
  { status: 500, message: "The server's API key was rejected." });
eq("no provider configured", describeFailure(new NoProviderError()),
  { status: 500, message: "The server isn't configured with an API key yet." });
eq("5xx is theirs", describeFailure(apiErr(502, "bad gateway")).status, 502);

console.log("--- AllProvidersFailed reports the PRIMARY's reason ---");
const both = new AllProvidersFailed([
  { provider: "openai", error: apiErr(429, "You exceeded your current quota") },
  { provider: "anthropic", error: apiErr(400, "Your credit balance is too low") },
]);
eq("both broke: user hears about credit", describeFailure(both).status, 402);
eq("and the primary's error is kept", statusOf(both.first), 429);

// --- ordering ---
console.log("--- who goes first ---");
const fake = (name, keyed) => ({ name, configured: () => keyed, streamText: () => {}, parseJson: async () => null });
register(fake("openai", true));
register(fake("anthropic", true));
process.env.LLM_PRIMARY = "";
eq("openai leads by default", providerOrder().map(p => p.name), ["openai", "anthropic"]);
process.env.LLM_PRIMARY = "anthropic";
eq("LLM_PRIMARY flips it", providerOrder().map(p => p.name), ["anthropic", "openai"]);
process.env.LLM_PRIMARY = "";
register(fake("openai", false));
eq("a provider with no key is skipped", providerOrder().map(p => p.name), ["anthropic"]);
register(fake("anthropic", false));
eq("no keys at all means nobody", providerOrder().map(p => p.name), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
