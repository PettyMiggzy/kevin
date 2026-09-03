/* ==========================================================================
   KEVIN — launch config. Edit THIS FILE and nothing else when details land.
   Anything left null renders as "TBA" on the site instead of a made-up value.
   ========================================================================== */

window.KEVIN = {
  // Clock-in. 3:41 PM on a Thursday. The shift counter on the site counts up
  // from here and has never been reset, because he has never clocked out.
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
    telegram: 'https://t.me/kevinRBH',
    x: 'https://x.com/Iamkevinonrh',
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
      nickname: 'The Plumbing',
      weight: 46,
      blurb:
        "The honest one. It doesn't believe in anything — it's the pipe, the fee, the wrapped-up unit of actually getting somewhere. Belief without settlement is a screenshot.",
      note: 'The biggest slice, because the boring thing has to work first.',
    },
    {
      key: 'kek',
      ticker: 'KEK',
      nickname: 'The Laugh',
      weight: 36,
      blurb:
        'The oldest exit. Kek is the sound the storeroom makes when it agrees with you — the laugh in the walk-in freezer, at 2am, when the chart does the thing.',
      note: 'Locked by the pad at a 10% minimum. This one is not going anywhere.',
    },
    {
      key: 'gme',
      ticker: 'GME',
      nickname: 'The Point',
      weight: 18,
      blurb:
        'Not a joke. Flatter than that. A GME pool on Robinhood Chain, opened by a fry cook who walked in with a briefcase that had his name on it and did not explain why.',
      note: 'The smallest slice. The loudest joke. He is not discussing it.',
    },
  ],

  // Marquee lines. Keep them petty.
  ticker: [
    'I WORK THE FRYER',
    'I HAVE WIFI',
    'ONE OF THESE IS GOING TO WORK OUT',
    'LAUNCHING AS SOON AS MY SHIFT IS OVER',
    'BIG DREAMS \u2192 MCDONALD\u2019S \u2192 FREEDOM',
    'A GME POOL ON ROBINHOOD CHAIN',
    'EMPLOYEE OF THE MONTH',
    'CEO OF CHAOS',
    '\u2611 LAUNCH \u2611 MOON \u2611 LAMBO \u2610 SLEEP',
    'NO PAIN, ONLY KEVIN',
    'WETH / KEK / GME',
  ],

  // The sticker pack. Every one of these has three files:
  //   assets/stickers/png/<slug>.png       transparent still
  //   assets/stickers/animated/<slug>.webm transparent VP9, Telegram-ready
  //   assets/stickers/animated/<slug>.gif  same loop on the yellow
  animated: [
    { slug: 'wagmi', name: 'WAGMI' },
    { slug: 'time-to-cook', name: 'Time To Cook' },
    { slug: 'let-him-cook', name: 'Let Him Cook' },
    { slug: 'fried', name: 'Fried' },
    { slug: 'gm', name: 'GM' },
    { slug: 'lfg', name: 'LFG' },
    { slug: 'buy', name: 'Buy' },
    { slug: 'hodl', name: 'HODL' },
    { slug: 'pump-it', name: 'Pump It' },
    { slug: 'send-it', name: 'Send It' },
    { slug: 'printer-go-brrr', name: 'Printer Go Brrr' },
    { slug: 'ceo-of-chaos', name: 'CEO of Chaos' },
    { slug: 'wen', name: 'Wen' },
    { slug: 'rekt', name: 'Rekt' },
    { slug: 'ngmi', name: 'NGMI' },
  ],
};
