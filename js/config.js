/* ==========================================================================
   KEVIN — launch config. Edit THIS FILE and nothing else when details land.
   Anything left null renders as "TBA" on the site instead of a made-up value.
   ========================================================================== */

window.KEVIN = {
  // The Click. 3:41 PM on a Thursday, 2009. The grudge clock counts from here.
  theClick: '2009-05-14T15:41:00',

  // The burn. The creator's own auction allocation gets destroyed.
  //   wallet  — the bidding wallet, published BEFORE the auction opens
  //   burnAddr— where it goes and never comes back
  //   burned  — running total, updated as each daily claim is burned
  //   receipts— [{ date, amount, tx }] as they happen; drives the burn log
  burn: {
    wallet: null,
    burnAddr: '0x000000000000000000000000000000000000dEaD',
    burned: null,
    receipts: [],
  },

  // Launch mechanics, taken from the kekfun docs. These are protocol rules
  // enforced on-chain by TokenFactory, not promises anybody here is making.
  mechanics: {
    supply: '1,000,000,000',
    sold: 40,          // % sold through the auction
    lockedLp: 60,      // % into locked LP
    creator: 0,        // % to the creator. zero. enforced by the factory.
    saleDays: 4,
    perDay: 10,        // % of supply released each day
    vestDays: 30,      // linear vest from settle
    chainId: 4663,
    auctionType: 'VRGDA (variable rate gradual dutch auction)',
    explorer: 'https://robinhoodchain.blockscout.com/',
  },

  // The chain. Yes, that one. Read the joke on the site.
  chain: 'Robinhood Chain',

  // GTA 6. He has been waiting since the 2013 trailer. Update this the moment
  // Rockstar moves it again, which they will. Set to null to render "DELAYED".
  gta6: '2026-11-19T00:00:00Z',

  // Contract address. Paste it here the moment it exists; the copy button
  // stays disabled until then.
  contract: null,

  // Where people actually buy. Auction lives on the kekfun launchpad.
  links: {
    launchpad: 'https://kekfun.xyz',
    telegram: null,
    x: null,
    chart: null,
    docs: 'docs/LORE.md',
  },

  // Auction window. ISO-8601 with a timezone offset, e.g. '2026-03-04T18:00:00Z'.
  // Both null => the countdown block shows TBA.
  auction: {
    startsAt: null,
    endsAt: null,
    durationDays: 4,
  },

  // The three pools that open when the auction settles and Kevin hits the DEX.
  // Launch composition, exactly as configured on the kekfun pad.
  // These three add up to 100. KEK is locked at a 10% minimum by the pad.
  pools: [
    {
      key: 'weth',
      ticker: 'WETH',
      nickname: 'The Gas',
      weight: 46,
      blurb:
        "The honest one. It doesn't believe in anything — it's the plumbing, the fee, the wrapped-up unit of actually getting somewhere. Belief without settlement is a screenshot.",
      note: 'The biggest slice, because the boring thing has to work first.',
    },
    {
      key: 'kek',
      ticker: 'KEK',
      nickname: 'The Laugh',
      weight: 36,
      blurb:
        'The oldest exit. Kek is the sound the void makes when it agrees with you — the laugh at the funeral, in the elevator, when the chart does the thing.',
      note: 'Locked by the pad at a 10% minimum. This one is not going anywhere.',
    },
    {
      key: 'gme',
      ticker: 'GME',
      nickname: 'The Grudge',
      weight: 18,
      blurb:
        'Not a joke. Colder. Made of everyone told no by a system that later got caught telling itself yes. Made of buy buttons that stopped working. Made of receipts.',
      note: 'The smallest slice and the entire reason any of this is funny.',
    },
  ],

  // Marquee lines. Keep them petty.
  ticker: [
    'TOLD NO. STAYED ANYWAY',
    'NOBODY CLICKED YES',
    'A GME POOL ON ROBINHOOD CHAIN',
    'THE WONK IS LOAD-BEARING',
    'HE IS LOOKING LEFT OF YOU',
    'NO MARKETING. ONLY GRUDGES',
    'STILL WAITING ON GTA 6',
    'RECEIPTS OR IT DIDN\u2019T HAPPEN',
    'WETH / KEK / GME',
    'SAVED AT 3:41 PM',
    'HE REMEMBERS WHAT YOU SAID IN MARCH',
  ],

  // The sticker pack. Files live in assets/stickers/.
  stickers: [
    { slug: 'petty', name: 'Petty' },
    { slug: 'og', name: 'OG' },
    { slug: 'noted', name: 'Noted' },
    { slug: 'receipts', name: 'Receipts' },
    { slug: 'told-no', name: 'Told No' },
    { slug: 'laser', name: 'Send It' },
    { slug: 'rekt', name: 'Rekt' },
    { slug: 'smoothbrain', name: 'Smoothbrain' },
    { slug: 'chad', name: 'No Comment' },
    { slug: 'thinking', name: 'Hmmm' },
    { slug: 'cope', name: 'Cope' },
    { slug: 'gm', name: 'GM' },
    { slug: 'wen', name: 'Wen' },
    { slug: 'diamond', name: 'Still Here' },
    { slug: 'mine', name: 'Mine Now' },
    { slug: 'fine', name: "I'm Fine" },
    { slug: 'kek', name: 'Kek' },
    { slug: 'ngmi', name: 'Ngmi' },
  ],
};
