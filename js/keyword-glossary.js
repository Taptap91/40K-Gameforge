// Plain-English explanations of the core abilities and weapon keywords, shown in the keyword popup on a datasheet.
// These are short summaries in our own words (the full Core Rules text stays one tap away in the popup);
// the number or value on the datasheet ("Cleave 1", "Anti-Vehicle 4+", "Feel No Pain 5+") is filled in and bolded.
import { esc } from "./core.js?v=8.77";
import { normName } from "./text.js?v=8.77";

const b = v => `<strong>${esc(String(v))}</strong>`;

/** Each entry takes the value from the datasheet (a string like "1", "5+", "6\"", "D6+2", or "" when there is none)
 *  and the part of the name before the value (for "Anti-Vehicle 4+" that is "Vehicle"), and returns HTML. */
const GLOSSARY = {
  anti: (v, kw) => `Against ${kw ? b(kw.toUpperCase()) : "the named type of"} units, an unmodified wound roll of ${v ? b(v) : "the listed number"} counts as a critical wound (the best kind of wound), which can switch on other rules such as Devastating Wounds.`,
  assault: () => `Units with this weapon can use <em>assault shooting</em>, a special way of shooting described in the Core Rules (10.05).`,
  blast: v => `Against a big unit this weapon fires more shots: for every 5 models in the target's unit (rounding down), add ${b(v || 1)} additional attack ${(v || 1) == 1 ? "die" : "dice"}.`,
  cleave: v => `Against a single target, for every 5 models in the target's unit (rounding down), add ${b(v || 1)} additional attack ${(v || 1) == 1 ? "die" : "dice"}. It only works if all of this weapon's attacks are aimed at one target.`,
  "close quarters": () => `Lets the unit shoot even while engaged in a fight (close-quarters shooting, 10.06). If it shoots another way instead, each non-Monster/Vehicle model picks <em>either</em> its Close-Quarters weapons <em>or</em> its other ranged weapons, not both.`,
  pistol: () => `Works exactly like Close-Quarters: the unit can shoot with it even while engaged in a fight. Each non-Monster/Vehicle model picks either its Pistols or its other ranged weapons when shooting another way, not both.`,
  "deadly demise": v => `When this model is destroyed, roll a D6. On a ${b("6")}, every unit within ${b('6"')} of it suffers ${b(v || "X")} mortal ${(v || "X") == 1 ? "wound" : "wounds"}.`,
  "deep strike": () => `When this unit arrives by ingress move, it can be set up anywhere on the battlefield more than ${b('8"')} from every enemy unit (even in the enemy deployment zone). Every model in the unit needs this ability.`,
  "devastating wounds": () => `A critical wound ends that attack and instead hits the target with mortal wounds equal to the weapon's Damage. Only enough to hurt one model is applied; any extra is lost.`,
  "extra attacks": () => `The model makes these attacks <em>in addition to</em> the attacks from its other melee weapon, rather than choosing between them.`,
  "feel no pain": v => `Each time this model would lose a wound, roll a D6. On a ${b(v || "X+")} the wound is ignored.`,
  "fights first": () => `If every model in the unit has this, the unit fights in the "Fights First" step, before units that don't.`,
  "firing deck": v => `When this Transport shoots, up to ${b(v || "X")} embarked ${(v || "X") == 1 ? "model" : "models"} can add one of their ranged weapons (not One Shot) to its attacks. The embarked units can't shoot themselves that turn.`,
  hazardous: () => `After the unit finishes shooting or fighting, make one hazard roll for each Hazardous weapon it used (see 06.03). Failing can hurt your own models.`,
  heavy: () => `Add ${b("+1")} to hit when shooting if the unit is not engaged, was not set up this turn, and no model moved more than ${b('3"')} this turn.`,
  hover: () => `When this unit takes to the skies, its maximum move is not reduced by ${b('2"')}.`,
  "ignores cover": () => `The target cannot get the benefit of cover against attacks from this weapon, even from rules like Stealth.`,
  "indirect fire": () => `Units with this weapon can shoot using indirect shooting (10.07), aiming at targets they can't see.`,
  infiltrators: () => `During deployment, if every model has it, the unit can be set up anywhere more than ${b('8"')} from the enemy deployment zone and all enemy units.`,
  lance: () => `If the attacker made a charge move this turn, add ${b("+1")} to the wound roll.`,
  leader: () => `Before the battle, this unit can be attached to a bodyguard unit to lead it. The two then act as one attached unit. A bodyguard unit normally gets one leader and one support unit.`,
  support: () => `Before the battle, this unit can be attached to a bodyguard unit to support it. The two then act as one attached unit. A bodyguard unit normally gets one leader and one support unit.`,
  "lethal hits": () => `A critical hit automatically wounds the target, so you skip the wound roll. You may choose not to, if you'd rather roll (a skipped roll can't be a critical wound).`,
  "lone operative": v => `Unless attached to another unit, enemies can only see and target this unit from within ${b(v || '12"')}. Indirect Fire weapons can't target it from further away either.`,
  melta: v => `If the target is within half range, add ${b(v || "X")} to the weapon's Damage for those attacks.`,
  "one shot": () => `This weapon can only be used once per battle.`,
  precision: () => `If the target unit contains a visible Character, you can choose to have these attacks allocated to that Character first, instead of to the other models.`,
  psychic: () => `You can ignore any or all modifiers to this weapon's BS/WS and to its hit rolls. Its attacks count as psychic attacks.`,
  "rapid fire": v => `If the target is within half range, add ${b(v || "X")} additional attack ${(v || "X") == 1 ? "die" : "dice"}.`,
  scouts: v => `Before the battle starts, this unit can make a free move of up to ${b(v || 'X"')}, ending more than ${b('8"')} from all enemy units. Every model in the unit needs this ability.`,
  stealth: () => `If every model in the unit has it, the unit gets the benefit of cover against all ranged attacks.`,
  "super heavy walker": () => `When moving normally, advancing or falling back, this unit can move through other models (except Titanic) and over terrain ${b('4"')} or lower. It can also choose to gain Mobile for the move, but then rolls a D6 at the end: on a ${b("1")} it is battle-shocked.`,
  "sustained hits": v => `A critical hit scores ${b(v || "X")} extra ${(v || "X") == 1 ? "hit" : "hits"} on the target, on top of the original hit.`,
  torrent: () => `This weapon's attacks automatically hit; no hit roll is made.`,
  "twin linked": () => `You can re-roll the wound roll for each attack with this weapon.`,
  damaged: v => `While this model has ${b(v || "X")} wounds or fewer left, it is damaged and its attacks get ${b("-1")} to hit.`,
};

/** "Cleave 1", "[Anti-Vehicle 4+]", "Feel No Pain 5+", "Scouts 6\"" → { key, value, kw } */
function parse(name) {
  const raw = String(name).replace(/\[|\]/g, "").trim();
  const anti = raw.match(/^anti[\s-]+(.+?)(?:\s+(\d\+))?$/i);
  if (anti) return { key: "anti", value: anti[2] || "", kw: anti[1] };
  const m = raw.match(/^(.*?)(?:\s+(d?\d+(?:\+\d+)?\+?"?|x))?$/i);
  return { key: normName(m[1] || raw), value: m[2] || "", kw: "" };
}

/** HTML explaining a keyword in plain English, or null when we have no summary for it. */
function simpleKeywordHTML(name) {
  const { key, value, kw } = parse(name);
  const fn = GLOSSARY[key];
  if (!fn) return null;
  return fn(value, kw);
}

export { simpleKeywordHTML };
