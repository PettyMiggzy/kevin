/* The world, as data.
 *
 * Everything about a place lives in this file: which painting it uses, where
 * the floor is, what is standing on it, and what there is to do. The engine in
 * world/index.html knows how to walk around A zone and nothing about which
 * zones exist — so adding a place is adding a painting and an entry here, not
 * touching the engine.
 *
 * COORDINATES are the painting's own pixels, 1536x864. That is deliberate: you
 * can open the .jpg in any image viewer, read a position straight off it, and
 * type it in. No editor, no tilemap, no export step.
 *
 * SPOTS are the things worth walking up to. Three kinds:
 *   to:   walk in — another zone in this world
 *   href: leave — a page that already exists (the gym, the card room, the docs)
 *   neither: scenery with a name, which is honest about the parts that are not
 *            built rather than pretending they lead somewhere.
 * `ext: true` means the href is off this site and opens in a new tab.
 *
 * EXITS are walked into rather than clicked, because that is what a street
 * corner does.
 *
 * JOBS are the one interactive thing here: pick up at the counter, walk it to
 * every marker, come back. Both jobs in this file are the same six lines of
 * engine code wearing different hats, which is the only reason there are two.
 */
window.KEVIN_ZONES = {

  /* ---------- outside ---------------------------------------------- */

  block: {
    name: "Kevin's Block",
    art: '../assets/png/world/block.jpg?v=e2e64ce2',
    spawn: { x: 880, y: 660 },
    // Traced off the painting. Keeps him on the paving.
    floor: [[700,455],[1180,455],[1470,720],[1430,830],[430,830],[330,700],[470,520]],
    spots: [
      { x:300,  y:470, r:200, signY:300, name:"McKEVIN'S",
        tip:"McKevin's. Where the shift is, and where $KEVIN comes from." },
      { x:776,  y:340, r:205, signY:150, name:'THE STOREROOM',
        tip:'The storeroom. Four contracts written and tested. None deployed.' },
      { x:995,  y:380, r:150, signY:212, name:"KEVIN'S GYM",
        tip:'The gym.', href:'../gym/' },
      { x:1270, y:452, r:160, signY:300, name:'THE CARD ROOM',
        tip:'The card room. He is not good at it.', href:'../poker/' },
    ],
    exits: [
      { x:1460, y:800, r:120, label:'DOWNTOWN →', to:'downtown', at:{ x:180, y:700 } },
      { x:430,  y:800, r:120, label:'← HOME',     to:'neighbourhood', at:{ x:1360, y:700 } },
    ],
  },

  downtown: {
    name: 'Downtown',
    art: '../assets/png/world/downtown.jpg?v=02f603c7',
    spawn: { x: 300, y: 690 },
    // Up to the kerb, so the shopfronts are reachable from the road.
    floor: [[170,400],[1390,400],[1470,830],[80,830]],
    spots: [
      { x:345,  y:362, r:170, signY:180, name:"McKEVIN'S",
        tip:"McKevin's downtown. The big one. His shift is in there.",
        to:'mckevins', at:{ x:790, y:720 } },
      { x:532,  y:352, r:150, signY:200, name:'GAME SHOP',
        tip:'The game shop. Everything he has built is on a shelf in there.',
        to:'gameshop', at:{ x:768, y:740 } },
      { x:716,  y:350, r:160, signY:78,  name:'THE BROKERAGE',
        tip:'The brokerage. The swap is at the desk.',
        to:'brokerage', at:{ x:790, y:760 } },
      { x:905,  y:356, r:165, signY:130, name:"KEVIN'S GYM",
        tip:'The gym.', href:'../gym/' },
    ],
    exits: [ { x:140, y:780, r:130, label:'← THE BLOCK', to:'block', at:{ x:1300, y:720 } } ],
  },

  neighbourhood: {
    name: 'His Street',
    art: '../assets/png/world/neighbourhood.jpg?v=8d57196b',
    spawn: { x: 1300, y: 690 },
    floor: [[110,545],[1430,545],[1470,830],[70,830]],
    spots: [
      { x:340,  y:520, r:160, signY:250, name:"KEVIN'S HOUSE",
        tip:'His house. The whiteboard with the plan on it is in there.',
        to:'house', at:{ x:768, y:720 } },
      { x:620,  y:520, r:150, signY:250, name:'NUMBER 12',
        tip:'Number 12. Nobody has ever answered the door.' },
      { x:940,  y:520, r:150, signY:250, name:'THE ROUND',
        tip:'Where the paper round starts.' },
    ],
    // The paper round. Bag at the gate, five doorsteps, two papers a trip.
    job: {
      id:'round', title:'THE PAPER ROUND', unit:'PAPERS', carry:2,
      pickup:{ x:940, y:600, r:110, label:'THE BAG' },
      drops:[[250,580],[520,580],[790,592],[1180,600],[1350,700]],
      idle:'The bag is by the gate. Walk into it.',
      done:'Round finished. Nobody tipped.',
    },
    exits: [ { x:1430, y:780, r:130, label:'THE BLOCK →', to:'block', at:{ x:560, y:740 } } ],
  },

  /* ---------- inside ------------------------------------------------ */

  mckevins: {
    name: "McKevin's",
    art: '../assets/png/world/mckevins.jpg?v=96874cba',
    spawn: { x: 790, y: 720 },
    floor: [[445,348],[1145,348],[1175,660],[1500,860],[40,860],[360,660]],
    spots: [
      { x:640, y:330, r:150, flat:true, name:'THE TILLS',
        tip:'Two tills, one of them works.' },
      { x:960, y:330, r:150, flat:true, name:'THE FRYER',
        tip:'The fryer. Where he is meant to be.' },
    ],
    // The shift. Six tables, two trays a trip.
    job: {
      id:'shift', title:'THE SHIFT', unit:'TRAYS', carry:2,
      pickup:{ x:790, y:372, r:120, label:'PASS' },
      drops:[[480,440],[430,560],[420,680],[1120,440],[1150,560],[1190,680]],
      idle:'Trays are up. Walk into the pass.',
      done:'Shift over. He is still not management.',
    },
    exits: [ { x:768, y:845, r:110, label:'↓ OUT TO DOWNTOWN', to:'downtown', at:{ x:345, y:470 } } ],
  },

  gameshop: {
    name: 'The Game Shop',
    art: '../assets/png/world/gameshop.jpg?v=64c63ff2',
    spawn: { x: 768, y: 740 },
    floor: [[380,545],[1180,545],[1250,700],[1500,860],[40,860],[110,700]],
    spots: [
      { x:250,  y:515, r:180, flat:true, name:"KEVIN'S GYM",
        tip:'On the shelf, boxed, finished. Press E.', href:'../gym/' },
      { x:1290, y:515, r:180, flat:true, name:'THE CARD ROOM',
        tip:'Also on the shelf. Texas hold’em. Press E.', href:'../poker/' },
      { x:700,  y:492, r:150, flat:true, name:'THE COUNTER',
        tip:'He has looked in this window most days for a year.' },
      { x:1080, y:492, r:140, flat:true, name:'BARGAIN BIN',
        tip:'Bargain bin. Whatever gets built next ends up in here first.' },
    ],
    exits: [ { x:768, y:845, r:110, label:'↓ OUT TO DOWNTOWN', to:'downtown', at:{ x:532, y:470 } } ],
  },

  brokerage: {
    name: 'The Brokerage',
    art: '../assets/png/world/brokerage.jpg?v=a2052004',
    spawn: { x: 790, y: 760 },
    floor: [[470,618],[1130,618],[1270,690],[1500,862],[40,862],[250,700],[430,660]],
    spots: [
      { x:700,  y:600, r:200, flat:true, name:'THE DESK',
        tip:'The swap. This one is real — it opens kekfun. Press E.',
        href:'https://kekfun.xyz', ext:true },
      { x:1020, y:600, r:200, flat:true, name:'THE SCREENS',
        tip:'The live chart. New tab. Press E.',
        href:'https://dexscreener.com/robinhood/0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A',
        ext:true },
      { x:1285, y:615, r:170, flat:true, name:'THE LIFT',
        tip:'The lift only goes to floors that exist. So far: this one.' },
    ],
    exits: [ { x:790, y:848, r:110, label:'↓ OUT TO DOWNTOWN', to:'downtown', at:{ x:716, y:470 } } ],
  },

  house: {
    name: "Kevin's House",
    art: '../assets/png/world/house.jpg?v=a69ad818',
    spawn: { x: 768, y: 720 },
    floor: [[490,440],[1080,440],[1130,610],[1270,820],[1280,862],[120,862],[320,745],[350,580],[450,480]],
    spots: [
      { x:720, y:330, r:220, flat:true, name:'THE WHITEBOARD',
        tip:'The plan. Three of four boxes ticked. Press E.', href:'../docs/' },
      { x:500, y:390, r:150, flat:true, name:'THE TELLY',
        tip:'Burns only. Press E.', href:'../#burn' },
      { x:930, y:360, r:175, flat:true, name:'THE DESK',
        tip:'Where the posts come from. Press E.', href:'../kit/' },
      { x:350, y:530, r:160, flat:true, name:'THE SOFA',
        tip:'The sofa. He has slept on it more than in the bed.' },
    ],
    exits: [ { x:768, y:848, r:110, label:'↓ OUT TO THE STREET', to:'neighbourhood', at:{ x:340, y:600 } } ],
  },
};
