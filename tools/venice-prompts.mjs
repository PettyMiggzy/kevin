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
  'KEVIN is a bold cartoon character built like this, and these proportions are ' +
  'the whole character — do not restyle them: ' +
  'HEAD — a large rounded BRIGHT RED HOOD that covers the top, back and sides ' +
  'of his head like a snug helmet or balaclava, with several THICK BLUNT ' +
  'DREADLOCK SPIKES flaring outward and downward from the sides of the hood, ' +
  'longer and heavier on his left, each spike ending in a rounded point. ' +
  'EYES — TWO ENORMOUS WHITE OVAL EYES, each nearly a third of the head, set ' +
  'high on the face, tilted slightly toward each other, and CUTTING UP INTO ' +
  'THE RED HOOD so the white breaks the hood outline; each eye has a thick ' +
  'black outline and one small black oval pupil. ' +
  'FACE — a PALE CREAM MUZZLE shape begins between and below the eyes and ' +
  'bulges downward and forward over the mouth, outlined in thick black, like a ' +
  'rounded snout with no nose. ' +
  'MOUTH — a wide open black mouth with a pink tongue when he is loud, or one ' +
  'small solid black triangle when he is not. ' +
  'HANDS — oversized RED MITTEN HANDS with three or four thick blunt fingers, ' +
  'much bigger than you would expect for his size. ' +
  'BODY — a small rounded red body, far too small for the head, with short red ' +
  'arms and tiny red feet. ' +
  'LINE — heavy uniform black outlines everywhere, flat bright cel-shaded ' +
  'colour, no nose, no eyebrows, no teeth, no visible neck';

/**
 * The look. Also locked, and there is only one — every reference shares the
 * same rendering: bold 2D cartoon character, heavy black outlines, cel shading,
 * painted detailed background. What changes between images is the SETTING and
 * the LIGHT, and those belong in the scene description, not in a second style
 * block. Splitting mood out into "styles" just gives the model a second thing
 * to drift on.
 */
export const STYLE =
  'bold 2D cartoon illustration, heavy black outlines on the character, flat ' +
  'cel shading with one clear light source, saturated colours, crisp clean ' +
  'linework, richly painted detailed background behind him, strong contrast ' +
  'between character and environment, dynamic cinematic composition, poster ' +
  'quality, no gradients on the character himself';

/** What we never want back. */
export const NEGATIVE =
  'photorealistic, 3d render, cgi, blurry, soft focus, muddy colours, gradient ' +
  'noise, deformed anatomy, extra limbs, extra fingers, distorted face, ' +
  'asymmetrical mess, watermark, signature, low resolution, jpeg artifacts, ' +
  'misspelled text, garbled lettering, realistic human, horror, gore, ' +
  'sexualised, multiple different character designs, hair parted down one side ' +
  'only, human hair, small eyes, eyes fully inside the muzzle, realistic hands, ' +
  'five fingers, long limbs, tall body, no hood';

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

  scene(
    'toxic-lab',
    'Kevin stands with his arms folded in a dark underground control room, ' +
      'wearing an oversized black puffer jacket covered in acid-yellow "KEVIN" ' +
      'tags and paint splatter. Enormous dripping graffiti letters spelling ' +
      '"KEVIN" cover the wall behind him. Glowing screens show green charts ' +
      'climbing. Tipped-over paint buckets leak acid-yellow across the floor. A ' +
      'cardboard box beside him reads "100X KEVIN GAINS". Lit only by the ' +
      'screens — acid yellow-green glow against deep black, wet paint drips ' +
      'catching the light, heavy shadow, gritty texture on every surface'
  ),
  scene(
    'toxic-throne',
    'Kevin sits slouched on a scrapyard throne welded out of server racks and ' +
      'oil drums in a dark neon-lit warehouse, one arm draped over the armrest. ' +
      'Acid-yellow graffiti reading "TOLD NO" drips down the concrete wall ' +
      'behind him, screens flickering on either side. Dark warehouse lit in ' +
      'acid yellow-green and black, hard rim light down one side of him, deep ' +
      'shadows everywhere else'
  ),

  scene(
    'moon-run',
    'Kevin sprints straight at the camera in wide-angle terror, mouth open in a ' +
      'scream, arms flung out, as an enormous cratered moon fills the entire sky ' +
      'behind him and crashes toward the road. Rocks and debris streak past. ' +
      'Shot from a low wide-angle lens with heavy foreshortening, sharp radial ' +
      'speed lines, debris streaking past the camera. Night sky, stars, moonlit dust'
  ),
  scene(
    'candle-surf',
    'Kevin rides a colossal green candlestick chart bar upward like a surfboard, ' +
      'wind tearing at him, arms out for balance, mouth open in a yell, the city ' +
      'shrinking far below and red candles collapsing behind him. Extreme ' +
      'wide-angle from below, speed lines tearing past, dramatic sunset light'
  ),
];

/** Sensible defaults per model family. */
export const MODEL_PRESETS = {
  'ideogram-v4': { note: 'best at readable signage and lettering', aspect_ratio: '16:9' },
  'gpt-image-2': { note: 'excellent text, clean cartoon linework', quality: 'high', aspect_ratio: '16:9' },
  'nano-banana-pro': { note: 'strong all-rounder, huge prompt budget', aspect_ratio: '16:9' },
  'seedream-v5-pro': { note: 'punchy saturated illustration', aspect_ratio: '16:9' },
  'flux-2-max': { note: 'crisp detail, weaker at long text', aspect_ratio: '16:9' },
  'krea-v2-large': { note: 'supports style_references — use to lock the character', aspect_ratio: '16:9' },
  'qwen-image-3-pro': { note: 'clean lines, good text', aspect_ratio: '16:9' },
};
