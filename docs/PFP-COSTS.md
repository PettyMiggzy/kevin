# What 500 AI variations would cost, and why we did not

Checked against the Venice models endpoint on 2026-09-05, not estimated.

## Generation models — exact prices

39 image models are listed with pricing. Per image, USD:

| Tier | Models | Each | **500** | **1,000** |
|---|---|---|---|---|
| Cheapest | `venice-sd35`, `z-image-turbo`, `wai-Illustrious` | $0.01 | **$5** | $10 |
| Mid | `recraft-v4` | $0.05 | **$25** | $50 |
| Upper | `qwen-image-2-pro` | $0.10 | **$50** | $100 |
| | `luma-uni-1-max` | $0.12 | **$60** | $120 |
| | `gpt-image-1-5` | $0.26 | **$130** | $260 |
| Dearest | `recraft-v4-pro` | $0.29 | **$145** | $290 |

## The one I cannot quote

The sticker pipeline edits with **`firered-image-edit`**, and that model is not
in the priced list under any model type the API exposes — `image`, `edit` and
`image_edit` all come back without it. So I have no price for the thing we have
actually been spending on, and I am not going to invent one.

The honest way to find out is one call with a balance reading either side of
it. The account is empty, so that will have to wait until it is topped up. It
is worth doing before any batch: a run of 500 at an unknown unit price is how
$9 batches turn into $90 ones.

## Why the collection is not generated this way

The 1,000 PFPs cost nothing and took about four minutes, because they are
layered traits over one drawing rather than 1,000 trips through a model.

That is not only a cost argument. **500 generations gives 500 different
characters.** This project has already lost two full sticker packs to exactly
that: the model added sneakers and a six-pack, then quills, then ears and a
snout, and every batch had to be thrown away. At 500 units, sold as a
collection, that is not fixable afterwards — a holder whose Kevin has the wrong
face owns a different character from their neighbour.

Layered traits also give the things a collection needs and generation cannot:
provable uniqueness, a rarity table, tiers that mean something, and a seed that
regenerates the exact set if a file is ever lost.

## Where AI generation IS worth paying for

Not the collection. The one-offs:

- **Hero art** — the banner, the poster, a launch-day image. One piece, checked
  by eye, at $0.10–$0.29 a go. Cheap and the drift does not matter because you
  keep going until you like it.
- **New trait art** — get a model to draw ONE hat, or one pair of glasses, then
  add it to the generator as a layer. Ten new traits at $0.05 each is fifty
  cents and multiplies the combination space for the whole collection.

That second one is the good trade: pay for art once, composite it a thousand
times for free.
