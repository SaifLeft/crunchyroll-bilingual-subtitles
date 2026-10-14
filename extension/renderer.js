// Draws parsed cues (see parsers.js) over the picture area of a <video>, honouring ASS styles:
// alignment, margins, colours, outline/shadow, \pos signs and layers (different layers overlap,
// events in the same layer stack). Several tracks are stacked, first track first.
(function (g) {
    'use strict';

    const CSS = `
#crbs-overlay{position:absolute;pointer-events:none;isolation:isolate;overflow:hidden;font-weight:400;font-style:normal;line-height:1.2}
#crbs-overlay .crbs-zone{position:absolute;left:0;right:0;display:flex;flex-direction:column}
#crbs-overlay .crbs-z-m{top:50%;transform:translateY(-50%)}
#crbs-overlay .crbs-blk{display:grid}
#crbs-overlay .crbs-lay{grid-area:1/1;display:flex;flex-direction:column;box-sizing:border-box}
#crbs-overlay .crbs-z-b .crbs-lay{align-self:end}
#crbs-overlay .crbs-z-t .crbs-lay{align-self:start}
#crbs-overlay .crbs-ev{box-sizing:border-box}
#crbs-overlay .crbs-ln{white-space:pre-wrap;unicode-bidi:plaintext}`;

    const css = c => `rgba(${c.r},${c.g},${c.b},${+c.a.toFixed(3)})`;
    const H_ALIGN = ['flex-start', 'center', 'flex-end'];
    const H_TEXT = ['left', 'center', 'right'];

    // Smooth outline: a ring of hard text-shadows (text-stroke gives spiky corners).
    function outline(r, color) {
        const n = Math.min(36, Math.max(12, Math.ceil(r * 6)));
        const out = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            out.push(`${(Math.cos(a) * r).toFixed(2)}px ${(Math.sin(a) * r).toFixed(2)}px 0 ${color}`);
        }
        return out.join(',');
    }

    function segStyle(s, k) {
        const r = s.outline * k;
        let st = `color:${css(s.primary)};font-size:${(s.fs * k).toFixed(2)}px;` +
            `font-family:"${String(s.font).replace(/["\\]/g, '')}",Arial,"Noto Sans Arabic","Segoe UI",sans-serif;` +
            `font-weight:${s.bold ? 700 : 400};font-style:${s.italic ? 'italic' : 'normal'};`;
        const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
        if (deco) st += `text-decoration:${deco};`;
        if (s.spacing) st += `letter-spacing:${(s.spacing * k).toFixed(2)}px;`;
        const shadows = [];
        if (s.borderStyle === 3) st += `background:${css(s.outlineColor)};padding:${r.toFixed(1)}px;`;
        else {
            if (r > 0.3) shadows.push(outline(r, css(s.outlineColor)));
            if (s.shadow > 0) { const d = (s.shadow * k).toFixed(2); shadows.push(`${d}px ${d}px 0 ${css(s.backColor)}`); }
        }
        if (shadows.length) st += `text-shadow:${shadows.join(',')};`;
        return st;
    }

    const div = cls => { const e = document.createElement('div'); e.className = cls; return e; };

    function eventEl(cue, k, scale) {
        const el = div('crbs-ev');
        const h = (cue.align - 1) % 3;
        el.style.textAlign = H_TEXT[h];
        el.style.alignSelf = H_ALIGN[h];
        el.style.margin = `0 ${(cue.mR * scale).toFixed(1)}px 0 ${(cue.mL * scale).toFixed(1)}px`;
        el.style.maxWidth = `calc(100% - ${((cue.mL + cue.mR) * scale).toFixed(1)}px)`;
        for (const line of cue.lines) {
            const ln = div('crbs-ln');
            ln.dir = 'auto';
            for (const seg of line) {
                const sp = document.createElement('span');
                sp.style.cssText = segStyle(seg.s, k);
                sp.textContent = seg.t;
                ln.appendChild(sp);
            }
            el.appendChild(ln);
        }
        return el;
    }

    function create() {
        const root = document.createElement('div');
        root.id = 'crbs-overlay';
        let lastSig = '';
        let styled = false;

        // tracks: [{ info, events: [cue] }] in display order; user: { size, lift (% of picture height) }
        function draw(video, host, tracks, user) {
            if (!styled) {
                styled = true;
                const s = document.createElement('style');
                s.textContent = CSS;
                (document.head || document.documentElement).appendChild(s);
            }
            const ew = host.clientWidth, eh = host.clientHeight;
            const ar = (video.videoWidth || 16) / (video.videoHeight || 9);
            let w = ew, h = ew / ar;
            if (h > eh) { h = eh; w = eh * ar; }
            const x = (ew - w) / 2, y = (eh - h) / 2;
            const sig = [Math.round(x), Math.round(y), Math.round(w), Math.round(h), user.size, user.lift]
                .concat(tracks.map(t => t.events.map(e => e.id).join(','))).join('|');
            if (sig === lastSig) return;
            lastSig = sig;
            root.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
            root.textContent = '';

            const zones = {};
            const blocks = { b: [], t: [], m: [] }; // per zone, in display order: [{ lay, mv }] of every block
            const zoneFor = v => zones[v] || (zones[v] = root.appendChild(div('crbs-zone crbs-z-' + v)));
            for (const tr of tracks) {
                const scale = h / tr.info.playResY;
                const k = scale * user.size;
                const groups = {};
                for (const cue of tr.events) {
                    if (cue.pos) {
                        const el = eventEl(cue, k, scale);
                        const hx = (cue.align - 1) % 3, vy = cue.align >= 7 ? 0 : cue.align >= 4 ? 1 : 2;
                        Object.assign(el.style, {
                            position: 'absolute', margin: '0', width: 'max-content', maxWidth: '90%', zIndex: 10 + cue.layer,
                            left: (cue.pos.x / tr.info.playResX * 100) + '%', top: (cue.pos.y / tr.info.playResY * 100) + '%',
                            transform: `translate(${-hx * 50}%,${-vy * 50}%)`
                        });
                        root.appendChild(el);
                        continue;
                    }
                    const v = cue.align >= 7 ? 't' : cue.align >= 4 ? 'm' : 'b';
                    const byLayer = groups[v] || (groups[v] = {});
                    const grp = byLayer[cue.layer] || (byLayer[cue.layer] = { cues: [], mv: 0 });
                    grp.cues.push(cue);
                    grp.mv = Math.max(grp.mv, cue.mV * scale);
                }
                for (const v of Object.keys(groups)) {
                    const blk = div('crbs-blk');
                    const lays = [];
                    for (const layer of Object.keys(groups[v]).map(Number).sort((a, b) => a - b)) {
                        const lay = div('crbs-lay');
                        lay.style.zIndex = layer;
                        groups[v][layer].cues.forEach(cue => lay.appendChild(eventEl(cue, k, scale)));
                        blk.appendChild(lay);
                        lays.push({ lay, mv: groups[v][layer].mv });
                    }
                    zoneFor(v).appendChild(blk);
                    blocks[v].push(lays);
                }
            }
            // Each layer keeps its own vertical margin (shadow layers are often offset on purpose); only the
            // block nearest the picture edge gets it, so stacked tracks stay close together.
            if (blocks.b.length) blocks.b[blocks.b.length - 1].forEach(l => { l.lay.style.paddingBottom = l.mv + 'px'; });
            if (blocks.t.length) blocks.t[0].forEach(l => { l.lay.style.paddingTop = l.mv + 'px'; });
            if (zones.b) zones.b.style.bottom = (h * user.lift / 100) + 'px';
        }

        return { el: root, draw };
    }

    g.__crbsRenderer = { create };
})(window);
