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
- Keep them under about 2MB and roughly landscape — Telegram scales them down
  in a group and a tall image gets cropped badly on phones.

Add or remove files and restart: `systemctl restart kevin-bot`.
