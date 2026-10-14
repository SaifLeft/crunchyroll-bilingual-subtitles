// Subtitle parsers (ASS with styles/overrides + WebVTT) for the page world.
// Both return { info: {playResX, playResY}, cues: [cue] } sorted by start, where
//   cue = { id, start, end, layer, align (numpad 1-9), pos: {x, y} | null, mL, mR, mV, lines: [[{ t, s }]] }
// and s is a resolved style { font, fs, bold, italic, underline, strike, primary, outlineColor, backColor,
//   outline, shadow, borderStyle, spacing } (shared between segments, never mutated after parsing).
(function (g) {
    'use strict';

    let nextId = 1;

    const assColor = v => {
        const s = String(v == null ? '' : v).trim();
        const n = /^&?H/i.test(s) ? parseInt(s.replace(/^&?H/i, '').replace(/&$/, ''), 16) : parseInt(s, 10);
        if (isNaN(n)) return null;
        return { r: n & 255, g: (n >>> 8) & 255, b: (n >>> 16) & 255, a: 1 - ((n >>> 24) & 255) / 255 };
    };
    const assAlpha = v => {
        const n = parseInt(String(v).replace(/^&?H/i, '').replace(/&$/, ''), 16);
        return isNaN(n) ? null : 1 - (n & 255) / 255;
    };
    const withAlpha = (c, a) => Object.assign({}, c, { a });

    function splitFields(str, n) {
        const out = [];
        let i = 0;
        while (out.length < n - 1) {
            const j = str.indexOf(',', i);
            if (j < 0) break;
            out.push(str.slice(i, j));
            i = j + 1;
        }
        out.push(str.slice(i));
        return out;
    }

    function assTime(s) {
        const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.:](\d+))?/.exec((s || '').trim());
        if (!m) return NaN;
        return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? parseFloat('0.' + m[4]) : 0);
    }

    const BASE_STYLE = {
        font: 'Arial', fs: 48, bold: false, italic: false, underline: false, strike: false,
        primary: { r: 255, g: 255, b: 255, a: 1 }, outlineColor: { r: 0, g: 0, b: 0, a: 1 }, backColor: { r: 0, g: 0, b: 0, a: 0.5 },
        outline: 2, shadow: 1, borderStyle: 1, spacing: 0, align: 2, mL: 10, mR: 10, mV: 10
    };

    function styleFrom(fmt, line) {
        const f = {};
        splitFields(line, fmt.length).forEach((v, i) => { f[fmt[i]] = v.trim(); });
        const num = (k, d) => (isNaN(parseFloat(f[k])) ? d : parseFloat(f[k]));
        return {
            font: f.fontname || BASE_STYLE.font, fs: num('fontsize', 48),
            bold: num('bold', 0) !== 0, italic: num('italic', 0) !== 0, underline: num('underline', 0) !== 0, strike: num('strikeout', 0) !== 0,
            primary: assColor(f.primarycolour) || BASE_STYLE.primary, outlineColor: assColor(f.outlinecolour) || BASE_STYLE.outlineColor,
            backColor: assColor(f.backcolour) || BASE_STYLE.backColor, outline: num('outline', 2), shadow: num('shadow', 1),
            borderStyle: num('borderstyle', 1), spacing: num('spacing', 0), align: num('alignment', 2),
            mL: num('marginl', 10), mR: num('marginr', 10), mV: num('marginv', 10)
        };
    }

    const LEGACY_ALIGN = { 1: 1, 2: 2, 3: 3, 5: 7, 6: 8, 7: 9, 9: 4, 10: 5, 11: 6 };
    const TOKEN = /\{([^}]*)\}|(\\[Nn])|(\\h)|([^{\\]+)|([\\{])/g;
    const TAG = /\\(\d?[a-zA-Z]+)(\([^)]*\)|[^\\]*)/g;

    // Walks the override blocks of one Dialogue text, resolving the style of every run.
    function parseText(body, base, styles) {
        const ev = { align: null, pos: null, skip: false, lines: [[]] };
        let cur = base;
        // an empty argument (e.g. "{\c}") resets to the line style's colour
        const recolor = (prop, arg) => {
            const c = arg ? assColor(arg) : base[prop];
            if (c) cur[prop] = withAlpha(c, cur[prop].a);
        };
        const apply = block => {
            cur = Object.assign({}, cur);
            TAG.lastIndex = 0;
            let m;
            while ((m = TAG.exec(block))) {
                const name = m[1].toLowerCase();
                const arg = m[2].trim();
                const num = parseFloat(arg);
                switch (name) {
                    case 'i': cur.italic = arg === '' ? base.italic : arg !== '0'; break;
                    case 'b': cur.bold = arg === '' ? base.bold : arg !== '0'; break;
                    case 'u': cur.underline = arg === '1'; break;
                    case 's': cur.strike = arg === '1'; break;
                    case 'c': case '1c': recolor('primary', arg); break;
                    case '3c': recolor('outlineColor', arg); break;
                    case '4c': recolor('backColor', arg); break;
                    case 'alpha': { const a = assAlpha(arg); if (a != null) { cur.primary = withAlpha(cur.primary, a); cur.outlineColor = withAlpha(cur.outlineColor, a); cur.backColor = withAlpha(cur.backColor, a); } break; }
                    case '1a': { const a = assAlpha(arg); if (a != null) cur.primary = withAlpha(cur.primary, a); break; }
                    case '3a': { const a = assAlpha(arg); if (a != null) cur.outlineColor = withAlpha(cur.outlineColor, a); break; }
                    case '4a': { const a = assAlpha(arg); if (a != null) cur.backColor = withAlpha(cur.backColor, a); break; }
                    case 'fs': cur.fs = num > 0 ? num : base.fs; break;
                    case 'fn': cur.font = arg || base.font; break;
                    case 'fsp': cur.spacing = isNaN(num) ? 0 : num; break;
                    case 'bord': cur.outline = isNaN(num) ? base.outline : num; break;
                    case 'shad': cur.shadow = isNaN(num) ? base.shadow : num; break;
                    case 'an': if (num >= 1 && num <= 9) ev.align = num; break;
                    case 'a': if (LEGACY_ALIGN[num]) ev.align = LEGACY_ALIGN[num]; break;
                    case 'pos': case 'move': {
                        const p = arg.replace(/[()]/g, '').split(',').map(parseFloat);
                        if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) ev.pos = { x: p[0], y: p[1] };
                        break;
                    }
                    case 'r': cur = styles[arg] || base; break;
                    case 'p': if (num > 0) ev.skip = true; break; // vector drawings are not reproduced
                    default: break; // animations, clips, blur, karaoke ... are ignored
                }
            }
        };
        let m;
        TOKEN.lastIndex = 0;
        while ((m = TOKEN.exec(body))) {
            if (m[1] !== undefined) apply(m[1]);
            else if (m[2]) ev.lines.push([]);
            else ev.lines[ev.lines.length - 1].push({ t: m[3] ? ' ' : (m[4] || m[5]), s: cur });
        }
        ev.lines = ev.lines.filter(l => l.some(seg => seg.t.trim()));
        return ev;
    }

    function parseASS(src) {
        const info = { playResX: 0, playResY: 0 };
        const styles = {};
        const cues = [];
        const seen = new Set();
        let section = '';
        let styleFmt = null;
        let evFmt = null;
        for (const raw of src.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line[0] === ';') continue;
            if (line[0] === '[') { section = line.toLowerCase(); continue; }
            if (section === '[script info]') {
                const m = /^playres([xy]):\s*(\d+)/i.exec(line);
                if (m) info['playRes' + m[1].toUpperCase()] = +m[2];
            } else if (/styles/.test(section)) {
                if (/^format:/i.test(line)) styleFmt = line.slice(7).split(',').map(s => s.trim().toLowerCase());
                else if (/^style:/i.test(line) && styleFmt) {
                    const body = line.slice(6).trim();
                    styles[body.split(',')[0].trim()] = styleFrom(styleFmt, body);
                }
            } else if (section === '[events]') {
                if (/^format:/i.test(line)) { evFmt = line.slice(7).split(',').map(s => s.trim().toLowerCase()); continue; }
                if (!evFmt || !/^dialogue:/i.test(line)) continue;
                const f = splitFields(line.slice(9).trim(), evFmt.length);
                const get = k => f[evFmt.indexOf(k)];
                const start = assTime(get('start'));
                const end = assTime(get('end'));
                if (!(end > start)) continue;
                const base = styles[(get('style') || '').trim()] || styles.Default || BASE_STYLE;
                const ev = parseText(get('text') || '', base, styles);
                if (ev.skip || !ev.lines.length) continue;
                const margin = (k, d) => (parseInt(get(k), 10) > 0 ? parseInt(get(k), 10) : d);
                const cue = {
                    start, end, layer: parseInt(get('layer'), 10) || 0, align: ev.align || base.align, pos: ev.pos,
                    mL: margin('marginl', base.mL), mR: margin('marginr', base.mR), mV: margin('marginv', base.mV), lines: ev.lines
                };
                const key = [cue.start, cue.end, cue.layer, cue.align, cue.pos && cue.pos.x + ',' + cue.pos.y, cue.lines.map(l => l.map(s => s.t).join('')).join('\n')].join('|');
                if (seen.has(key)) continue;
                seen.add(key);
                cue.id = nextId++;
                cues.push(cue);
            }
        }
        if (!info.playResY) info.playResY = info.playResX ? Math.round(info.playResX * 3 / 4) : 288;
        if (!info.playResX) info.playResX = Math.round(info.playResY * 4 / 3);
        return { info, cues: cues.sort((a, b) => a.start - b.start) };
    }

    // ---- WebVTT: plain text laid out like a default bottom-centred ASS style ----
    const VTT_STYLE = Object.assign({}, BASE_STYLE, { font: 'Arial', fs: 60, bold: true, outline: 2.8, shadow: 0 });
    const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };
    const CUE_TIME = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})/;

    function vttTime(s) {
        const p = s.replace(',', '.').split(':').map(parseFloat);
        return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    }

    function parseVTT(src) {
        const cues = [];
        for (const block of src.replace(/\r/g, '').split(/\n{2,}/)) {
            const rows = block.split('\n');
            const i = rows.findIndex(l => CUE_TIME.test(l));
            if (i < 0) continue;
            const m = CUE_TIME.exec(rows[i]);
            const lines = rows.slice(i + 1)
                .map(l => l.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp|quot|#39);/g, e => ENTITIES[e]).trim())
                .filter(Boolean).map(t => [{ t, s: VTT_STYLE }]);
            if (lines.length) cues.push({ id: nextId++, start: vttTime(m[1]), end: vttTime(m[2]), layer: 0, align: 2, pos: null, mL: 60, mR: 60, mV: 50, lines });
        }
        return { info: { playResX: 1920, playResY: 1080 }, cues: cues.sort((a, b) => a.start - b.start) };
    }

    g.__crbsParsers = { parseASS, parseVTT };
})(window);
