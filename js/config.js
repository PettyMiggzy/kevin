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

  // The GME that the KEVIN pools earn, going back to people who hold.
  //
  // NOTHING HERE IS A PROMISE, and the wording is careful on purpose: an
  // airdrop that is announced and then does not happen is worse than one that
  // was never mentioned. `confirmed` stays false until it is actually built,
  // funded and dated, and while it is false Kevin may only ever HINT — no
  // date, no amount, no "hold to qualify", which is the line between a nice
  // idea and telling people to buy.
  //
  // Set to null to remove it from the bot's facts entirely.
  airdrop: {
    token: 'GME',
    confirmed: false,
    who: 'people holding $KEVIN, weighted by how much and how long',
    note: 'No date, no amount, no snapshot taken.',
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
  // stays disabled until then. EIP-55 checksum verified before publishing —
  // a mixed-case address that fails its own checksum is a typo, and a typo
  // here is somebody's money.
  //
  // CORRECTED. An earlier version of this comment claimed this address was "the
  // OLD BASE token". That was wrong, and it was asserted with a confidence
  // nothing here had earned — no chain was ever queried to check it. Two
  // sessions then repeated it back to the owner as fact and told him his own
  // contract address was the wrong one.
  //
  // Checked properly, twice, from different machines:
  //   eth_getCode(0x63D7fa...9e284A, latest) on Base mainnet -> "0x"
  // Empty. Nothing has ever been deployed at this address on Base, so it cannot
  // be an old Base token. It is the new one, won at auction on kekfun, trading
  // from the 7th. Until then no explorer will show it, which is expected and is
  // NOT evidence against it.
  //
  // EIP-55 checksum verified before publishing — every capital in it is where
  // keccak says it belongs, so it is not a transposed typo. That matters more
  // than usual here: while nothing is indexed, the checksum is the only
  // independent check anyone can run, and a typo would otherwise go unnoticed
  // until the group had already memorised it.
  contract: '0x63D7fa99022794f594F724e7C38Ff0bE3F9e284A',

  // When it actually starts trading. Publishing the address BEFORE this is
  // deliberate and protective: the group gets to memorise the real one while
  // it is calm, so on launch day, when the fakes appear, they already know.
  // Until this passes, the site and the bot both say plainly that it is not
  // live yet and not to try to buy.
  contractLiveAt: '2026-09-07T00:00:00Z',

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
      weight: 45,
      blurb:
        "The honest one. It doesn't believe in anything — it's the pipe, the fee, the wrapped-up unit of actually getting somewhere. Belief without settlement is a screenshot.",
      note: 'The biggest slice, because the boring thing has to work first.',
    },
    {
      key: 'kek',
      ticker: 'KEK',
      nickname: 'The Laugh',
      weight: 40,
      blurb:
        'The oldest exit. Kek is the sound the storeroom makes when it agrees with you — the laugh in the walk-in freezer, at 2am, when the chart does the thing.',
      note: 'Locked by the pad at a 10% minimum. This one is not going anywhere.',
    },
    {
      key: 'gme',
      ticker: 'GME',
      nickname: 'The Point',
      weight: 15,
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
    'BIG DREAMS \u2192 MCKEVIN\u2019S \u2192 FREEDOM',
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
    // Real frame animation, cut from Todd's hand-drawn walk cycles.
    { slug: 'walk-front', name: 'Walk Front' },
    { slug: 'walk-back', name: 'Walk Back' },
    { slug: 'walk-left', name: 'Walk Left' },
    { slug: 'walk-right', name: 'Walk Right' },
    { slug: 'walk-diagonal', name: 'Walk Diagonal' },
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
