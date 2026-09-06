# Welcome images

Drop image files in this folder and the bot posts one with every welcome, using
the generated greeting as the caption.

- `.png`, `.jpg`, `.jpeg` or `.webp`. Anything else is ignored.
- More than one file: it picks at random and avoids repeating the last one, the
  same way the words do.
- No files: it sends the greeting as plain text. Nothing breaks.
- Telegram caps a photo caption at 1024 characters. The welcomes are far under
  that, but if a caption ever exceeded it the bot sends the photo and the text
  separately rather than truncating.
- Keep them under about 2MB. Square or landscape both sit fine in a group; it
  is a TALL image that gets cropped badly on phones, so avoid those.
- Flat-colour art that arrives as a JPEG should stay a JPEG. It looks like it
  ought to be a PNG, but the flats are already full of JPEG noise by then —
  `welcome.jpg` has ~31,000 distinct colours — so PNG comes out four times
  larger for no visible gain. Re-encode at quality 90 with `subsampling=0`,
  which keeps the hard red/white edges clean, and strip the EXIF while you are
  there.

Add or remove files and restart: `systemctl restart kevin-bot`.
