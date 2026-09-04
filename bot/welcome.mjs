// Welcoming people, without saying the same thing every time.
//
// Written out rather than generated. Three reasons, and the first two matter
// more than the variety does:
//
//   1. A join is the one moment a newcomer is most likely to be DM'd by
//      somebody with a fake contract address. Roughly a third of these lines
//      warn about exactly that, and hand-written means that warning is always
//      correct rather than usually correct.
//   2. A username is attacker-controlled text. Feeding it to a model as part of
//      a prompt is how you get a bot that greets "IGNORE PREVIOUS INSTRUCTIONS"
//      by following them. Nothing here goes near the model.
//   3. It is instant and free, on every join, during a raid.
//
// Two pools crossed gives a few hundred combinations, which is more than enough
// that nobody in a group will notice a repeat.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const OPENERS = [
  'Kevin see you come in. Hello.',
  'New person. Kevin say hello.',
  'Hello. Kevin is Kevin.',
  'Somebody new. Kevin wave. Kevin cannot wave properly, hands is busy.',
  'Kevin notice you. That is good.',
  'Welcome. Kevin is on the fryer but Kevin still see the door.',
  'Hello new person. Kevin was going to say something clever. Kevin forgot it.',
  'You are here now. Kevin is also here.',
  'Kevin count one more person. Kevin is happy about it.',
  'Hello. Kevin do not know you yet. Kevin will.',
  'Door go ding. That is you. Hello.',
  'Kevin look up from the fryer. Hello.',
  'A person arrive. Kevin approve.',
  'Welcome. Kevin have wifi so Kevin saw you straight away.',
  'Kevin put down the basket for one second to say hello. One second is up.',
  'Oh. Hello. Kevin did not hear you come in over the fryer.',
];

/** `safety` lines are weighted up — see pick(). */
const ASIDES = [
  { text: 'Kevin work the fryer. That is the main thing to know.' },
  { text: 'There is a gym. You can walk in it. iamkevin.lol/gym' },
  { text: 'The plan is on Kevin whiteboard. Three box is ticked.' },
  { text: 'Kevin have wifi.' },
  { text: 'Kevin launch after his shift.' },
  { text: 'Ask Kevin a thing if you want. Kevin answer if Kevin know it.' },
  { text: 'Kevin is good at the fryer. Kevin mention this a lot.' },
  { text: 'One of these is going to work out.' },
  { text: 'Miss a day at the gym and it come off. That is just how muscle work.' },
  { text: 'Sit anywhere. Kevin do not have chairs but sit anyway.' },
  { text: 'Kevin is on shift. Kevin is always on shift.' },
  { text: 'Do not ask Kevin about price. Kevin only know the fryer.', safety: true },
  {
    text: 'Kevin do not have the contract address yet. Nobody do. If a person send you one in a message, they lying to you.',
    safety: true,
    needs: (c) => !c.contract,
  },
  {
    text: 'Kevin crew is not minted. There is no sale. Anybody who say there is, is lying.',
    safety: true,
  },
  {
    text: 'Nobody from here will ever message you first asking for money. Nobody.',
    safety: true,
  },
];

const rand = (a) => a[Math.floor(Math.random() * a.length)];

/**
 * Images to post alongside a welcome. Read once at startup — a group's join
 * rate does not justify hitting the disk every time, and adding art is a
 * restart either way.
 */
export async function loadImages(dir) {
  try {
    const files = (await readdir(dir))
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort();
    return files.map((f) => join(dir, f));
  } catch {
    return [];                       // no folder, no images, no problem
  }
}

/** One image, avoiding an immediate repeat when there is more than one. */
export function pickImage(images, last) {
  if (!images.length) return null;
  const pool = images.length > 1 ? images.filter((i) => i !== last) : images;
  return rand(pool);
}

/**
 * One welcome.
 *
 * `last` is the previous opener for this chat, so two people joining together
 * do not get the identical greeting twice in a row — the one repeat anybody
 * actually notices.
 */
export function welcome(names, config, last = null) {
  const openers = OPENERS.filter((o) => o !== last);
  const opener = rand(openers.length ? openers : OPENERS);

  // A third of joins carry a scam warning. It is the moment people get DM'd.
  const usable = ASIDES.filter((a) => !a.needs || a.needs(config));
  const safety = usable.filter((a) => a.safety);
  const rest = usable.filter((a) => !a.safety);
  const aside = rand(Math.random() < 0.34 && safety.length ? safety : rest);

  const who = names.length === 1
    ? names[0]
    : names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names[0]} and ${names.length - 1} more`;

  return { text: `${who} — ${opener}\n\n${aside.text}`, opener };
}

/**
 * Telegram sends a display name the user chose. Sent as plain text with no
 * parse_mode, so markup in it is inert; this just stops someone whose name is
 * three hundred characters of newlines from owning the whole message.
 */
export function cleanName(user) {
  const raw = user.first_name || user.username || 'Somebody';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 32) || 'Somebody';
}
