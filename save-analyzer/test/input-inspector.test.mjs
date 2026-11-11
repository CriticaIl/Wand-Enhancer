// SaveForge 2.3.3: Input Inspector analysis (src/trainer/input-inspector.js). Pure functions on
// source text and element-like objects: what does the game check a textbox for, with evidence?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchOutcome, derivePattern, describeComparison, findCases, findComparisons, parseString, renpyAnswers, rpgMakerNameChecks, sensitiveReason, sugarCubeSlugs, sugarCubeTextboxes } from '../src/trainer/input-inspector.js';

const vals = (cs) => cs.flatMap((c) => c.values);
const SC_REF = /(?:\$answer|State\.variables\.answer)(?![\w$])/;

test('parseString: quotes, escapes, templates with code are not literals', () => {
  assert.deepEqual(parseString(`"sword\\"fish" x`, 0), { value: 'sword"fish', end: 13 });
  assert.equal(parseString("'abc'", 0).value, 'abc');
  assert.equal(parseString('`a${b}`', 0), null);
});

test('SugarCube: is / eq / == / === / isnot, both orders, chains, impossible checks', () => {
  const src = [
    '<<textbox "$answer" "" "Gate">>',
    '<<if $answer is "swordfish">>[[Vault]]',
    '<<elseif $answer.toLowerCase().trim() eq "open sesame">><<set $doorOpen to true>>',
    '<<elseif "Mellon" === $answer>>Friend.',
    '<<elseif $answer.toLowerCase() == "Shout">>never',
    '<<elseif $answer isnot "">>Wrong.<</if>>',
  ].join('\n');
  const cs = findComparisons(src, SC_REF, 'sc');
  assert.deepEqual(vals(cs), ['swordfish', 'open sesame', 'Mellon', 'Shout'], 'the empty-text check is not an answer');
  const lower = cs.find((c) => c.values[0] === 'open sesame');
  assert.deepEqual(lower.norm.sort(), ['lower', 'trim']);
  const [a] = describeComparison(lower);
  assert.ok(a.notes.some((n) => /letter case does not matter/.test(n)));
  assert.ok(a.notes.some((n) => /spaces/.test(n)));
  const shout = describeComparison(cs.find((c) => c.values[0] === 'Shout'))[0];
  assert.match(shout.impossible, /can never succeed/);
  assert.equal(branchOutcome(src, cs[0].end, 'sc').text, 'goes to passage “Vault”');
  assert.match(branchOutcome(src, lower.end, 'sc').text, /sets \$doorOpen to true/);
});

test('SugarCube: switch/case, includes lists, regex tests', () => {
  const src = '<<switch $answer.toLowerCase()>><<case "red" "crimson">>A<<case "blue">>B<</switch>>\n<<if ["oak", "ash"].includes($answer)>>tree<</if>>\n<<if /^(north|south)$/i.test($answer)>>dir<</if>>';
  const cases = findCases(src, SC_REF, 'sc');
  assert.deepEqual(vals(cases), ['red', 'crimson', 'blue']);
  assert.deepEqual(cases[0].norm, ['lower']);
  const cs = findComparisons(src, SC_REF, 'sc');
  assert.deepEqual(cs.find((c) => c.op === 'in').values, ['oak', 'ash']);
  const pat = cs.find((c) => c.op === 'pattern');
  assert.equal(pat.pattern, '^(north|south)$');
  assert.deepEqual(describeComparison(pat).map((a) => a.value), ['north', 'south']);
  assert.deepEqual(derivePattern('^a.b$'), null, 'real regex syntax: no single answer is claimed');
});

test('SugarCube: textbox macros and the names SugarCube gives their inputs', () => {
  const t = sugarCubeTextboxes('<<textbox "$player.name" "Max">> <<textbox "$code" "" "Lock">> <<numberbox "_n" 0>> <<textbox "$a" "" passage "Next">>');
  assert.deepEqual(t.map((x) => [x.macro, x.receiver, x.target]), [['textbox', '$player.name', null], ['textbox', '$code', 'Lock'], ['numberbox', '_n', null], ['textbox', '$a', 'Next']]);
  assert.ok(sugarCubeSlugs('$player.name').includes('playername'), 'legacy slug');
  assert.ok(sugarCubeSlugs('$answer').includes('answer'));
});

test('Harlowe: is / is in (a:) / contains / (lowercase:), with branch outcomes', () => {
  const src = '(input-box: bind $word, "=XXX=", 1)\n(if: (lowercase: $word) is "riddle")[(go-to: "Win")](else-if: $word is in (a: "map", "chart"))[(set: $nav to true)](else-if: $word contains "key")[Close.]';
  const ref = /\$word(?![\w])/;
  const cs = findComparisons(src, ref, 'harlowe');
  assert.deepEqual(vals(cs), ['riddle', 'map', 'chart', 'key']);
  assert.deepEqual(cs[0].norm, ['lower']);
  assert.equal(cs.find((c) => c.op === 'contains').values[0], 'key');
  assert.equal(branchOutcome(src, cs[0].end, 'harlowe').text, 'goes to passage “Win”');
  assert.match(branchOutcome(src, cs[1].end, 'harlowe').text, /sets \$nav to true/);
});

test('JavaScript handlers: .value comparisons, variables holding the text, switch, startsWith', () => {
  const code = `function check() {
    const a = document.getElementById('ans').value.trim().toLowerCase();
    if (a === 'echo') { door.open = true; }
    switch (a) { case "map": showMap(); break; case 'compass': break; }
    if (document.getElementById('ans').value.startsWith("HELLO")) {}
    if (score > 3) {}
  }`;
  const direct = /(?:getElementById\(\s*["']ans["']\s*\)\.value)/;
  const cs = findComparisons(code, direct, 'js');
  assert.deepEqual(vals(cs), ['HELLO']);
  assert.equal(cs[0].op, 'starts');
  const v = /(?<lead>^|[^\w$.'"])a(?![\w$])/;
  const cv = findComparisons(code, v, 'js', ['trim', 'lower']);
  assert.deepEqual(vals(cv), ['echo']);
  assert.deepEqual(cv[0].norm.sort(), ['lower', 'trim']);
  assert.deepEqual(vals(findCases(code, v, 'js')), ['map', 'compass']);
  assert.match(branchOutcome(code, cv[0].end, 'js').text, /sets door\.open = true/);
});

test('Python (Ren’Py): ==, in (tuple), "x" in answer, normalised by an earlier reassignment', () => {
  const data = {
    current: { type: 'Python', file: 'game/script.rpy', line: 40, source: 'answer = renpy.input("The password?", length=20)' },
    steps: [{ source: 'answer = answer.strip().lower()', file: 'game/script.rpy', line: 41 }],
    checks: [
      { cond: 'answer == "swordfish"', file: 'game/script.rpy', line: 43, then: [{ jump: 'vault' }] },
      { cond: 'answer in ("open sesame", "mellon")', file: 'game/script.rpy', line: 45, then: [{ say: 'The door opens.' }] },
      { cond: '"key" in answer', file: 'game/script.rpy', line: 47, then: [] },
      { cond: 'my_answer == "nope"', file: 'game/script.rpy', line: 49, then: [] },
      { cond: 'True', file: 'game/script.rpy', line: 51, then: [{ say: 'Wrong.' }] },
    ],
  };
  const r = renpyAnswers(data);
  assert.equal(r.found, true);
  assert.equal(r.field.variable, 'answer');
  assert.deepEqual(r.answers.map((a) => a.value), ['swordfish', 'open sesame', 'mellon', 'key'], 'my_answer is another variable');
  assert.ok(r.answers[0].notes.some((n) => /letter case does not matter/.test(n)), 'answer = answer.strip().lower() before the check');
  assert.equal(r.answers[0].evidence.where, 'game/script.rpy:43');
  assert.equal(r.answers[0].outcome, 'jumps to vault');
  assert.match(r.field.steps[0], /answer\.strip\(\)\.lower\(\)/);
  assert.equal(renpyAnswers({ current: { type: 'Say', file: 'game/script.rpy', line: 9, source: '' }, checks: [] }).found, false, 'not waiting for an input: nothing is claimed');
});

test('RPG Maker: Conditional Branch → Actor → Name is, and script conditions on the actor’s name', () => {
  const lists = [
    { where: 'Map 1 › event 3 “Sphinx” › page 1', list: [{ code: 303, parameters: [1, 8] }, { code: 111, parameters: [4, 1, 1, 'Oedipus'] }, { code: 111, parameters: [4, 2, 1, 'Other'] }, { code: 111, parameters: [12, '$gameActors.actor(1).name().toLowerCase() === "man"'] }] },
  ];
  const r = rpgMakerNameChecks(lists);
  assert.deepEqual(r.actors, [1]);
  const a1 = r.answers.filter((a) => a.actor === 1);
  assert.deepEqual(a1.map((a) => a.value), ['Oedipus', 'man']);
  assert.match(a1[0].evidence.code, /Name is “Oedipus”/);
  assert.ok(a1[1].notes.some((n) => /letter case does not matter/.test(n)));
});

test('sensitive fields: login, password, account, payment fields are never inspected; story textboxes are', () => {
  const el = (attrs, extra = {}) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null), tagName: 'INPUT', closest: () => null, form: null, ...extra });
  assert.match(sensitiveReason(el({ type: 'password' })), /password/);
  assert.match(sensitiveReason(el({ type: 'email' })), /e-mail/);
  assert.match(sensitiveReason(el({ type: 'text', autocomplete: 'username' })), /autocomplete/);
  assert.match(sensitiveReason(el({ type: 'text', name: 'login' })), /login/);
  assert.match(sensitiveReason(el({ type: 'text', placeholder: 'Card number' })), /payment|account|login/);
  const form = { getAttribute: (n) => (n === 'method' ? 'post' : null), querySelector: () => null };
  assert.match(sensitiveReason(el({ type: 'text', name: 'q' }, { form })), /server/);
  const pwForm = { getAttribute: () => null, querySelector: (s) => (/password/.test(s) ? {} : null) };
  assert.match(sensitiveReason(el({ type: 'text', name: 'user' }, { form: pwForm })), /password field/);
  assert.equal(sensitiveReason(el({ type: 'text', name: 'riddle' })), null);
  // a SugarCube textbox asking for an in-game password is game logic, not an account
  assert.equal(sensitiveReason(el({ type: 'text', class: 'macro-textbox', name: 'textbox-password', placeholder: 'Password' })), null);
  assert.match(sensitiveReason(el({ type: 'password', class: 'macro-textbox' })), /password field/, 'but never a browser password field');
});
