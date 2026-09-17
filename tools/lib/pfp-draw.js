// Runs in the browser. Everything is drawn in Kevin's own idiom — flat fill,
// heavy black outline, no shading — so a trait never looks bolted on.
(() => {
  // Measured once off assets/refs/16-kevin-idle.png (1024x1024). If the base
  // drawing is ever replaced, re-measure — do not scale these by eye.
  //   head:  hair top to the bottom of the cream face
  //   eyes:  centre between the two white ovals, and the span they cover
  //   mouth: the black triangle
  const A = {
    head:  { x: 204, y: 118, w: 616, h: 556, cx: 512, cy: 396 },
    eyes:  { cx: 604, cy: 282, span: 404, tilt: -0.19 },
    mouth: { x: 470, y: 468 },
    // His head is not a circle and it is not level: the hair mass peaks at
    // x616 y134 and sweeps down to the left, so anything worn on it has to sit
    // on that slope. A symmetric hat centred on the head's bounding box floats
    // off the side of it, which is exactly what the first pass did.
    dome:  { cx: 590, y: 196, w: 372, tilt: -0.30 },
  };

  let base = null;      // the character, backdrop removed
  let box = null;       // his bounding box inside that canvas
  let PARTS = {};       // illustrated prop assets, keyed by e.g. "hat-cap"
  const INK = '#0B0B0B';

  /**
   * Draw an illustrated prop, scaled to width w with its own aspect ratio
   * preserved, anchored so the point (ax*w, ay*h) of the image lands at
   * (cx, cy). Missing assets skip silently rather than crashing a whole
   * 1000-image run over one bad trait name.
   */
  function drawPart(x, img, cx, cy, w, ax = 0.5, ay = 1) {
    if (!img) return;
    const h = w * (img.naturalHeight / img.naturalWidth);
    x.drawImage(img, cx - ax * w, cy - ay * h, w, h);
  }

  window.__pfpInit = async (dataUri, partData) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h), p = d.data;
    const bg = [p[0], p[1], p[2]];
    const near = (k) => Math.abs(p[k*4]-bg[0])<=30 && Math.abs(p[k*4+1]-bg[1])<=30 && Math.abs(p[k*4+2]-bg[2])<=30;
    const gone = new Uint8Array(w*h), st = [];
    const seed = (k) => { if (!gone[k] && near(k)) { gone[k]=1; st.push(k); } };
    for (let i=0;i<w;i++){ seed(i); seed((h-1)*w+i); }
    for (let j=0;j<h;j++){ seed(j*w); seed(j*w+w-1); }
    while (st.length) {
      const k = st.pop(), cx = k%w, cy = (k/w)|0;
      if (cx>0) seed(k-1); if (cx<w-1) seed(k+1);
      if (cy>0) seed(k-w); if (cy<h-1) seed(k+w);
    }
    for (let k=0;k<w*h;k++) if (gone[k]) p[k*4+3]=0;
    x.putImageData(d, 0, 0);
    let x0=w,y0=h,x1=-1,y1=-1;
    for (let k=0;k<w*h;k++){ if (!p[k*4+3]) continue; const cx=k%w, cy=(k/w)|0;
      if (cx<x0)x0=cx; if (cx>x1)x1=cx; if (cy<y0)y0=cy; if (cy>y1)y1=cy; }
    base = c; box = { x0, y0, x1, y1, w: x1-x0+1, h: y1-y0+1 };

    PARTS = {};
    for (const [name, uri] of Object.entries(partData || {})) {
      const p = new Image();
      p.src = uri;
      await p.decode();
      PARTS[name] = p;
    }
  };

  /** Recolour his red without touching the cream face, white eyes or ink. */
  function furShift(src, degrees) {
    if (!degrees) return src;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let k = 0; k < p.length; k += 4) {
      if (!p[k+3]) continue;
      const r = p[k]/255, g = p[k+1]/255, b = p[k+2]/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2, s = max-min;
      if (s < 0.18) continue;                       // ink, cream and whites are unsaturated enough to skip
      let hue = 0;
      if (max === r) hue = ((g-b)/s + 6) % 6;
      else if (max === g) hue = (b-r)/s + 2;
      else hue = (r-g)/s + 4;
      hue *= 60;
      if (!(hue < 25 || hue > 335)) continue;       // only the reds move
      const nh = (((hue + degrees) % 360) + 360) % 360;
      const cc = (1 - Math.abs(2*l - 1)) * (s / Math.max(1e-6, 1 - Math.abs(2*l-1)));
      const hp = nh / 60, xx = cc * (1 - Math.abs((hp % 2) - 1));
      let rr=0,gg=0,bb=0;
      if (hp<1){rr=cc;gg=xx;} else if (hp<2){rr=xx;gg=cc;} else if (hp<3){gg=cc;bb=xx;}
      else if (hp<4){gg=xx;bb=cc;} else if (hp<5){rr=xx;bb=cc;} else {rr=cc;bb=xx;}
      const m = l - cc/2;
      p[k]=Math.round((rr+m)*255); p[k+1]=Math.round((gg+m)*255); p[k+2]=Math.round((bb+m)*255);
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  const stroke = (x, w) => { x.lineWidth = w; x.strokeStyle = INK; x.lineJoin = 'round'; x.stroke(); };
  function poly(x, pts, fill, lw = 7) {
    x.beginPath();
    pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.closePath();
    if (fill) { x.fillStyle = fill; x.fill(); }
    stroke(x, lw);
  }
  function ellipse(x, cx, cy, rx, ry, fill, lw = 7, rot = 0) {
    x.beginPath(); x.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    if (fill) { x.fillStyle = fill; x.fill(); }
    stroke(x, lw);
  }
  function rect(x, rx, ry, rw, rh, fill, lw = 7, r = 8) {
    x.beginPath(); x.roundRect(rx, ry, rw, rh, r);
    if (fill) { x.fillStyle = fill; x.fill(); }
    stroke(x, lw);
  }

  window.__pfpDraw = (traits, size) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const S = size;

    // Background
    const bgv = traits.background.value;
    if (bgv === 'rays') {
      x.fillStyle = '#FFE500'; x.fillRect(0, 0, S, S);
      x.save(); x.translate(S/2, S*0.46);
      for (let i = 0; i < 16; i++) {
        x.rotate(Math.PI*2/16);
        if (i % 2) continue;
        x.fillStyle = 'rgba(255,255,255,.5)';
        x.beginPath(); x.moveTo(0,0); x.lineTo(S, -S*0.13); x.lineTo(S, S*0.13); x.closePath(); x.fill();
      }
      x.restore();
    } else if (bgv === 'gold') {
      const g = x.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, '#FFE9A0'); g.addColorStop(.5, '#E8B923'); g.addColorStop(1, '#8A6A0B');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
    } else { x.fillStyle = bgv; x.fillRect(0, 0, S, S); }

    // Character, framed as a portrait. Every number here is MEASURED off
    // assets/refs/16-kevin-idle.png, not guessed at as a fraction of his
    // bounding box — fractions put the hats through the top of the frame and
    // the shades above his eyes, because his head is not a predictable share
    // of a body that has legs.
    const art = furShift(base, traits.fur.value);
    const scale = (S * 0.86) / A.head.w;
    const ox = S/2 - A.head.cx * scale;
    const oy = S*0.44 - A.head.cy * scale;
    x.drawImage(art, ox, oy, base.width * scale, base.height * scale);

    const at = (sx, sy) => [ox + sx*scale, oy + sy*scale];
    const [hx, hy] = at(A.head.cx, A.head.y);          // head centre x, head top y
    const hw = A.head.w * scale;
    const [eyeCx, eyeY] = at(A.eyes.cx, A.eyes.cy);
    const [mouthX, mouthY] = at(A.mouth.x, A.mouth.y);

    // --- eyes ---
    const e = traits.eyes.value;
    x.save(); x.translate(eyeCx, eyeY); x.rotate(A.eyes.tilt); x.translate(-eyeCx, -eyeY);
    if (e === 'shades' || e === 'visorshades' || e === 'threed') {
      drawPart(x, PARTS[`eyes-${e}`], eyeCx, eyeY, A.eyes.span*scale*1.1, 0.5, 0.5);
    } else if (e === 'laser') {
      for (const sx of [-1, 1]) {
        const g = x.createLinearGradient(eyeCx+sx*hw*0.16, eyeY, eyeCx+sx*S, eyeY+S*0.1);
        g.addColorStop(0, 'rgba(255,60,60,.95)'); g.addColorStop(1, 'rgba(255,60,60,0)');
        x.strokeStyle = g; x.lineWidth = hw*0.09; x.lineCap = 'round';
        x.beginPath(); x.moveTo(eyeCx+sx*hw*0.16, eyeY); x.lineTo(eyeCx+sx*S, eyeY+S*0.12); x.stroke();
      }
    } else if (e === 'money' || e === 'spiral') {
      x.font = `700 ${hw*0.30}px "Arial Black",sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 8; x.strokeStyle = INK; x.fillStyle = e === 'money' ? '#2FB457' : '#111';
      for (const sx of [-0.20, 0.20]) {
        const ch = e === 'money' ? '$' : '@';
        x.strokeText(ch, eyeCx+A.eyes.span*scale*sx*0.9, eyeY); x.fillText(ch, eyeCx+A.eyes.span*scale*sx*0.9, eyeY);
      }
    }

    x.restore();

    // --- mouth ---
    const m = traits.mouth.value;
    if (m === 'cigar' || m === 'joint') {
      drawPart(x, PARTS[`mouth-${m}`], mouthX, mouthY, hw * (m === 'cigar' ? 0.42 : 0.38), 0, 0.5);
    } else if (m === 'lolly') {
      drawPart(x, PARTS['mouth-lolly'], mouthX, mouthY + hw*0.05, hw*0.30, 0.15, 0.9);
    } else if (m === 'tooth') {
      drawPart(x, PARTS['mouth-tooth'], mouthX + hw*0.01, mouthY + hw*0.02, hw*0.10, 0.3, 0.3);
    }

    // --- hat ---
    const hat = traits.hat.value;
    const [dcx, dcy] = at(A.dome.cx, A.dome.y);
    const dw = A.dome.w * scale;
    x.save(); x.translate(dcx, dcy); x.rotate(A.dome.tilt);
    if (hat === 'cap') drawPart(x, PARTS['hat-cap'], 0, dw*0.15, dw*1.2, 0.42, 0.65);
    else if (hat === 'visor') drawPart(x, PARTS['hat-visor'], 0, dw*0.13, dw*1.1, 0.5, 0.50);
    else if (hat === 'band') drawPart(x, PARTS['hat-band'], 0, dw*0.11, dw*0.92, 0.5, 0.42);
    else if (hat === 'crown') drawPart(x, PARTS['hat-crown'], 0, dw*0.10, dw*0.85, 0.5, 0.68);
    else if (hat === 'tophat') drawPart(x, PARTS['hat-tophat'], 0, dw*0.08, dw*1.05, 0.5, 0.78);
    else if (hat === 'halo') drawPart(x, PARTS['hat-halo'], 0, -dw*0.22, dw*0.9, 0.5, 0.5);
    else if (hat === 'horns') drawPart(x, PARTS['hat-horns'], 0, dw*0.02, dw*0.7, 0.5, 0.65);

    x.restore();

    // --- aura, over everything ---
    const a = traits.aura.value;
    if (a === 'sparks' || a === 'rainbow') {
      for (let i = 0; i < 16; i++) {
        const ang = (i/16)*Math.PI*2, r = S*0.40 + (i%3)*S*0.02;
        x.fillStyle = a === 'rainbow' ? `hsl(${i*22},90%,60%)` : '#FFF';
        const px = S/2 + Math.cos(ang)*r, py = S*0.46 + Math.sin(ang)*r*0.9;
        poly(x, [[px,py-S*0.028],[px+S*0.012,py],[px,py+S*0.028],[px-S*0.012,py]], x.fillStyle, 3);
      }
    } else if (a === 'smoke' || a === 'flames') {
      x.globalAlpha = a === 'smoke' ? .42 : .6;
      for (let i = 0; i < 9; i++) {
        const px = S*0.14 + (i*S*0.09) % (S*0.8), py = S*(0.90 - (i%4)*0.06);
        ellipse(x, px, py, S*0.05, S*0.035, a === 'smoke' ? '#CFCFCF' : '#FF7A1A', 0);
      }
      x.globalAlpha = 1;
    }
    return c.toDataURL('image/png');
  };

  window.__pfpSheet = () => null;
})();
