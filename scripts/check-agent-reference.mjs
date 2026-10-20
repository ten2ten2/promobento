import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const s=readFileSync(new URL('../docs/design/agent-studio-reference.html',import.meta.url),'utf8');
for(const text of ['Offline design reference','STATIC DESIGN SAMPLE','preparing','budget','conflict','BLOCK','15 seconds','30 seconds','Use device setting','aria-live','max="899"'])assert.ok(s.toLowerCase().includes(text.toLowerCase()),'Missing reference state: '+text);
assert.equal((s.match(/<option value="(?:tiktok|x|youtube|youtube_shorts|instagram_feed|instagram_reels):/g)||[]).length,7);
assert.ok(!/<script[^>]+src=|<link[^>]+href=["']https?:/i.test(s),'Offline reference must not fetch external code/fonts');
console.log('Agent Studio reference structure passed (7 targets, fixed durations, conflict/budget/QA states, offline labels). Not a production UI or generated-video test.');
