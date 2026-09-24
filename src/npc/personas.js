// Deterministic NPC identities (names, jobs, personalities, speech styles) so that the
// same person can be met again and remember you.
import { mulberry32 } from '../../shared/rng.js';

const FIRST = ['Marcus', 'Tasha', 'Leo', 'Priya', 'Dante', 'Keisha', 'Tommy', 'Ines', 'Rafael', 'Bree', 'Omar', 'Chloe', 'Victor', 'Maya', 'Gus', 'Nia', 'Hector', 'Jade', 'Walt', 'Yuki', 'Darnell', 'Rosa', 'Ivan', 'Lena', 'Carl', 'Zoe', 'Benny', 'Amara', 'Frank', 'Lucia', 'Jamal', 'Sofia', 'Ray', 'Tia', 'Mo', 'Greta', 'Dwayne', 'Ana', 'Sal', 'Kira', 'Otis', 'Mei', 'Big Tony', 'Doreen', 'Rico', 'Hannah', 'Earl', 'Fatima', 'Cody', 'Esperanza'];
const LAST = ['Reyes', 'Johnson', 'Kowalski', 'Patel', 'Okafor', 'Nguyen', 'Brooks', 'Silva', 'Murphy', 'Haddad', 'Chen', 'Walker', 'Rossi', 'Diaz', 'Kim', 'Moreau', 'Baker', 'Ivanova', 'Lopez', 'Mensah'];
const TRAITS = ['cheerful', 'grumpy', 'paranoid', 'flirty', 'nerdy', 'sarcastic', 'overly polite', 'conspiracy-minded', 'hyper', 'sleepy', 'dramatic', 'deadpan', 'nosy', 'philosophical', 'competitive', 'gossipy', 'anxious', 'cocky', 'wholesome', 'blunt'];
const JOBS = {
  civilian: ['barista', 'accountant', 'dog walker', 'student', 'retired teacher', 'food truck owner', 'influencer', 'bike courier', 'nurse on a day off', 'street musician', 'real estate agent', 'tourist from out of town', 'gym bro', 'office worker on lunch break'],
  shopkeeper: ['shop owner', 'cashier'], police: ['Bayview PD officer'], gang: ['Eastside crew member'], junkie: ['down-on-their-luck drifter'],
  resident: ['homeowner'], worker: ['dock worker', 'construction worker', 'mechanic'], athlete: ['semi-pro athlete'], medic: ['paramedic'],
};
const QUIRKS = ['always hungry', 'obsessed with their car', 'thinks the gorilla in the tech fleece is a legend', 'is saving up for a boat', 'hates pigeons', 'is training for a marathon', 'collects umbrella hats', 'swears they saw a UFO over North Mountain', 'is late for something', 'just got dumped', 'won a small lottery prize', 'is writing a rap album', 'knows everybody at the pier', 'is afraid of the ocean', 'wants to wrestle at the Dome one day'];
const STYLES = {
  civilian: 'casual everyday speech', shopkeeper: 'friendly but business-minded, mentions products and prices', police: 'authoritative, suspicious, uses police jargon, asks questions',
  gang: 'aggressive street slang, territorial, suspicious of outsiders', junkie: 'rambling, erratic, asks for spare change, harmless', resident: 'protective of their home',
  worker: 'tired, practical, blue-collar humour', athlete: 'hyped, sporty, competitive', medic: 'calm, caring, medical',
};

export function personaFor(id, role = 'civilian', extra = {}) {
  const r = mulberry32(hash(String(id)));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const first = extra.name || pick(FIRST);
  const p = {
    id: String(id), role,
    name: extra.name ? extra.name : `${first} ${pick(LAST)}`,
    short: first,
    trait: pick(TRAITS), trait2: pick(TRAITS),
    job: extra.job || pick(JOBS[role] || JOBS.civilian),
    quirk: pick(QUIRKS),
    style: STYLES[role] || STYLES.civilian,
    age: 18 + Math.floor(r() * 55),
  };
  return p;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// Built-in fallback dialogue when Gemini is unavailable.
export const FALLBACK = {
  civilian: ['Nice day in Bayview, huh?', 'Have you seen the gorilla in the tech fleece? Legend.', "I'm kinda busy, sorry.", 'Watch out for the traffic on Pier Street.', 'You look like you need a coffee.', 'The pier ferris wheel is the best view in town.'],
  shopkeeper: ["Welcome in! Let me know if you need anything.", "Everything's fairly priced, I promise.", 'No shoplifting, alright?'],
  police: ['Keep it moving, citizen.', "I've got my eye on you.", 'Report any suspicious activity.', "Don't make me write you up."],
  gang: ["You lost? This ain't your block.", 'Walk away, homie.', 'Eastside runs this.'],
  junkie: ['Hey... hey... you got a dollar?', "I used to be somebody, man...", 'Do you hear the seagulls talking too?'],
  resident: ['What are you doing in my house?!', 'Get out before I call the cops!', 'Can I help you?!'],
  worker: ['Long shift, man.', "Don't touch the forklift."],
  athlete: ["Let's go! You wanna run a game?", 'Leg day never ends.'],
  medic: ['Stay safe out there.', 'Need a check-up? Come by the hospital.'],
};
