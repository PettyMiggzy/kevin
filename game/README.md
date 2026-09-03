# KEVIN'S GYM

A 3D gym for Kevin, built to run in a phone browser.

**The hook:** miss a day and you lose muscle. Muscle is a decaying stat driven by
real elapsed time, and the character visibly shrinks or grows with it. Showing up
is the game.

## Why 3D and not sprites

Muscle has to change continuously and be visible from every angle. In 2D that
means a sprite per muscle tier, per exercise, per angle — hundreds of drawings. In
3D it is one model with muscle on a blend shape: move one slider and every
existing animation plays correctly on every physique. For this specific game 3D is
the cheaper option, not the expensive one.

## proto/toon.html

Render-style proof. Open it over http and you get flat cel shading with thick
black outlines — the art style, running live in WebGL. Placeholder geometry, but
the look is real.

```bash
python3 -m http.server 8000   # then open /game/proto/toon.html
```

Verified working headlessly in Chromium via SwiftShader, which means the look can
be regression-tested from CI without a GPU.

## Status

Researching the stack — asset sources, engine, character rigging, backend. Nothing
committed to yet beyond the render style above.
