// The Venice prompt pack.
//
// The whole point of this file is CONSISTENCY. Image models drift — ask for
// "Kevin" ten times and you get ten different characters, which is fatal for a
// meme brand where the face has to be instantly recognisable. So every scene
// prompt is built from the same locked KEVIN block and the same STYLE block,
// and only the situation changes.
//
// Edit SCENES to add memes. Do not edit KEVIN without a very good reason.

/** The character. Locked. This paragraph is the brand. */
export const KEVIN =
  'KEVIN is a small simple cartoon character: a rounded red creature whose head ' +
  'is covered by a smooth red hood-like shape that hangs down the left side in ' +
  'thick blunt red dreadlock points; a pale cream oval face fills the lower right ' +
  'of the head; two very large white oval eyes sit high and close together, the ' +
  'right eye noticeably bigger than the left, each with a small black pupil ' +
  'looking slightly off to the left, never at the camera; a tiny solid black ' +
  'triangular open mouth below them; a small red body, short red arms and two ' +
  'thin straight red legs with no knees and simple red shoes';

/** The look. Also locked. */
export const STYLE =
  '2D cartoon illustration in a clean western comic style, bold uniform black ' +
  'outlines, flat cel shading with one clear light source, bright saturated ' +
  'colours, crisp vector-like edges, detailed painted background, bright blue ' +
  'sky with fluffy white clouds where outdoors, dynamic wide cinematic ' +
  'composition, high contrast, poster quality';

/** What we never want back. */
export const NEGATIVE =
  'photorealistic, 3d render, cgi, blurry, soft focus, muddy colours, gradient ' +
  'noise, deformed anatomy, extra limbs, extra fingers, distorted face, ' +
  'asymmetrical mess, watermark, signature, low resolution, jpeg artifacts, ' +
  'misspelled text, garbled lettering, realistic human, horror, gore, ' +
  'sexualised, multiple different character designs';

const scene = (id, situation, opts = {}) => ({
  id,
  situation,
  ...opts,
  prompt: `${KEVIN}. SCENE: ${situation}. STYLE: ${STYLE}.`,
});

/**
 * Text in images: only the models that are actually good at lettering get
 * scenes with signage — ideogram-v4, gpt-image-2 and nano-banana-pro. Anything
 * else will hand you beautiful gibberish on the billboard.
 */
export const SCENES = [
  scene(
    'robinhood-hq',
    'Kevin walks confidently up the front path of a large modern glass corporate ' +
      'office building, carrying a battered brown briefcase with the word "KEVIN" ' +
      'stencilled on it in black. A wooden arrow sign on the left reads ' +
      '"HEADQUARTERS". Neat green hedges line the path, small dust puffs kick up ' +
      'behind his feet. He is not looking at the building. He has been walking ' +
      'toward it for sixteen years'
  ),
  scene(
    'getaway',
    'Kevin rides in a shopping cart overflowing with cash down a city street, ' +
      'wearing a red cap and black sunglasses, one arm resting on the rim, ' +
      'completely relaxed. A police car chases far behind with its lights on. ' +
      'Dollar bills fly through the air. A large billboard on the right reads ' +
      '"IAMKEVIN.LOL". A green highway sign on the left reads "BIG DREAMS" and ' +
      '"WETH / KEK / GME". Two tiny Kevins on the pavement hold a cardboard sign ' +
      'reading "FREE KEVIN"'
  ),
  scene(
    'gym',
    'Kevin as an absurdly muscular bodybuilder in a red tank top mid-flex outside ' +
      'a gym, sweating, holding a black shaker bottle. A huge sign over the ' +
      'building reads "KEVIN\'S GYM" in red block letters, with a banner beneath ' +
      'reading "NO PAIN, ONLY KEVIN". Other small Kevins struggle under barbells ' +
      'in the background. A speech bubble reads "LEG DAY? MORE LIKE LEG YAY"'
  ),
  scene(
    'the-no',
    'A dim 2009 school computer lab at dusk. On a chunky beige CRT monitor is a ' +
      'crude MS Paint drawing of Kevin on a bright yellow background. A grey ' +
      'Windows dialog box on screen reads "Save changes to Untitled?" with Yes, ' +
      'No and Cancel buttons, and the mouse cursor hovers over "No". The chair is ' +
      'empty, the room is empty, the clock on the wall reads 3:41. Kevin inside ' +
      'the screen is looking out at the empty chair'
  ),
  scene(
    'receipts',
    'Kevin stands in a vast archive room lit by a single hanging bulb, in front ' +
      'of towering filing cabinets stretching into the dark, every drawer labelled ' +
      'with a date. He holds one paper receipt up to the light with both hands, ' +
      'expression flat and unbothered. Loose receipts drift across the floor. A ' +
      'stencilled sign on the wall reads "RECEIPTS"'
  ),
  scene(
    'three-pools',
    'Kevin stands with his back to the viewer at the edge of three glowing liquid ' +
      'pools set into a dark stone floor, each with a carved stone marker: the ' +
      'left pool silver-blue labelled "WETH", the middle pool bright green ' +
      'labelled "KEK", the right pool deep red labelled "GME". Shafts of light ' +
      'come down from above. He is looking at the red one'
  ),
  scene(
    'the-burn',
    'Kevin stands calmly beside a flaming steel oil drum on a night city rooftop, ' +
      'feeding a thick stack of banknotes into the fire one at a time, completely ' +
      'expressionless. Embers rise into the dark. The city glitters behind him. A ' +
      'small hand-painted sign wired to the drum reads "MINE"'
  ),
  scene(
    'gta-wait',
    'Kevin sits alone on a worn couch in a dark living room lit only by a TV, ' +
      'holding a game controller with both hands, surrounded by an enormous pile ' +
      'of torn-off calendar pages reaching his knees. A thick layer of dust sits ' +
      'on his shoulders. The TV shows only the words "COMING SOON". He has not ' +
      'moved in years'
  ),
  scene(
    'courtroom',
    'Kevin stands at a wooden courtroom podium in a tiny red suit, sliding a ' +
      'single sheet of paper across to a huge intimidating judge, calm and ' +
      'unbothered. The gallery is packed with hundreds of identical small Kevins. ' +
      'A brass sign on the bench reads "ORDER"'
  ),
  scene(
    'billboard-city',
    'A huge illuminated billboard high above a busy night city intersection shows ' +
      'a giant close-up of Kevin\'s face with the text "IAMKEVIN.LOL" beneath it. ' +
      'Rain-slick streets, neon reflections, traffic streaking below. A tiny real ' +
      'Kevin stands on the pavement far below, looking up at himself',
    { model: 'ideogram-v4' }
  ),
  scene(
    'pfp',
    'Tight head-and-shoulders portrait of Kevin, centred, filling the frame, ' +
      'against a flat bright yellow background with no scenery at all. Clean ' +
      'crisp edges suitable for a profile picture',
    { aspect_ratio: '1:1', width: 1024, height: 1024 }
  ),
  scene(
    'diner',
    'Kevin sits alone in a red vinyl booth of a bright 1950s American diner at ' +
      'night, a burger and a milkshake untouched in front of him, staring flatly ' +
      'at the empty seat across the table. Neon signage glows outside the window. ' +
      'A laminated menu on the table reads "STILL HERE"'
  ),
];

/** Sensible defaults per model family. */
export const MODEL_PRESETS = {
  'ideogram-v4': { note: 'best at readable signage and lettering', width: 1280, height: 720 },
  'gpt-image-2': { note: 'excellent text, clean cartoon linework', quality: 'high', width: 1280, height: 720 },
  'nano-banana-pro': { note: 'strong all-rounder, huge prompt budget', aspect_ratio: '16:9' },
  'seedream-v5-pro': { note: 'punchy saturated illustration', width: 1280, height: 720 },
  'flux-2-max': { note: 'crisp detail, weaker at long text', width: 1280, height: 720 },
  'krea-v2-large': { note: 'supports style_references — use to lock the character', width: 1280, height: 720 },
};
