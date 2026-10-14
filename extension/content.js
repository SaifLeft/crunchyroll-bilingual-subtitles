// Crunchyroll Bilingual Subtitles v2 - runs in the page world (manifest "world": "MAIN").
// Reads the site's own playback JSON, adds every official subtitle language (whatever the dub) to the
// player's own "Subtitles/CC" menu, and draws the ticked tracks together over the video.
(function () {
    'use strict';
    if (window.__crbsLoaded) return;
    window.__crbsLoaded = true;

    const { parseASS, parseVTT } = window.__crbsParsers;
    const renderer = window.__crbsRenderer.create();
    const rawFetch = window.fetch.bind(window);
    const PLAY_RE = /\/playback\/v\d+\/([A-Za-z0-9]+)\/web\/([^/?#]+)\/play(?:[?#]|$)/;
    const GEAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>';
    const CHECK = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="kat:text-white"><path fill-rule="evenodd" clip-rule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM15.7929 8.29289L17.2071 9.70711L10.5 16.4142L6.79289 12.7071L8.20711 11.2929L10.5 13.5858L15.7929 8.29289Z" fill="currentColor"></path></svg>';

    const store = {
        get(k, d) { try { const v = localStorage.getItem('crbs.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem('crbs.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
    };

    const STR = {
        en: {
            title: 'Bilingual subtitles', settings: 'Settings',
            loading: 'Loading the other languages…', noauth: 'Session not ready yet - close and reopen this menu in a few seconds.',
            error: 'Could not load the other languages', errorTip: 'Switch the audio to Japanese once and they will appear here.',
            none: 'No other version of this episode exists.', sync: 'Sync', size: 'Size', pos: 'Position'
        },
        ar: {
            title: 'ترجمة ثنائية اللغة', settings: 'الإعدادات',
            loading: 'جارٍ تحميل اللغات الأخرى…', noauth: 'الجلسة غير جاهزة بعد، أغلق القائمة وافتحها بعد ثوانٍ.',
            error: 'تعذّر تحميل اللغات الأخرى', errorTip: 'حوّل الصوت إلى اليابانية مرة واحدة وستظهر هنا.',
            none: 'لا توجد نسخة أخرى لهذه الحلقة.', sync: 'توقيت', size: 'الحجم', pos: 'الموضع'
        }
    };
    const T = k => STR[/^ar/i.test(document.documentElement.lang || navigator.language) ? 'ar' : 'en'][k];

    // Same names Crunchyroll shows in its own menus.
    const NAMES = {
        'en-US': 'English', 'en-IN': 'English (India)', 'ja-JP': '日本語', 'id-ID': 'Bahasa Indonesia', 'ms-MY': 'Bahasa Melayu',
        'de-DE': 'Deutsch', 'es-419': 'Español (América Latina)', 'es-ES': 'Español (España)', 'fr-FR': 'Français', 'it-IT': 'Italiano',
        'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)', 'pl-PL': 'Polski', 'vi-VN': 'Tiếng Việt', 'ru-RU': 'Русский',
        'ar-SA': 'العربية', 'th-TH': 'ไทย', 'hi-IN': 'हिंदी', 'ta-IN': 'தமிழ்', 'te-IN': 'తెలుగు', 'ko-KR': '한국어', 'zh-CN': '中文 (简体)',
        'zh-HK': '中文 (繁體)', 'zh-TW': '中文 (繁體)', 'tr-TR': 'Türkçe', 'ca-ES': 'Català', 'fil-PH': 'Filipino', 'uk-UA': 'Українська'
    };
    function langName(code) {
        if (NAMES[code]) return NAMES[code];
        try { return new Intl.DisplayNames([code], { type: 'language' }).of(code) || code; } catch (e) { return code; }
    }

    const S = {
        guid: null, device: 'chrome', auth: null, versions: [], episode: new Set(),
        sources: new Map(),             // version guid -> [{key, lang, kind, format, url}]
        cues: new Map(),                // `${guid}|${key}` -> {info, cues} | 'loading' | 'error'
        orig: 'idle', origCode: 0,      // state of fetching the original version's tracks
        hardSub: false,                 // the stream being played has a subtitle burned in
        gear: false,                    // the settings rows of the menu section are unfolded
        selected: store.get('selected', []),
        style: Object.assign({ size: 1, lift: 0 }, store.get('style', {})),
        offsets: store.get('offsets', {})
    };

    // ---------- network hooks: learn about tracks from the site's own playback call ----------
    const sameOrigin = url => /^\/(?!\/)/.test(url) || url.indexOf(location.origin + '/') === 0;

    // The site's session header is kept in memory only and is only ever sent back to our own origin.
    function grabAuth(res, init) {
        const h = init && init.headers;
        let a = null;
        if (h instanceof Headers) a = h.get('authorization');
        else if (Array.isArray(h)) { const p = h.find(x => /^authorization$/i.test(x[0])); a = p && p[1]; }
        else if (h && typeof h === 'object') { const k = Object.keys(h).find(x => /^authorization$/i.test(x)); a = k && h[k]; }
        if (!a && typeof Request !== 'undefined' && res instanceof Request) a = res.headers.get('authorization');
        if (a && /^Bearer\s/i.test(a)) S.auth = a;
    }

    // A manifest that is not ".../clean/..." has the subtitle burned into the picture: it cannot be hidden.
    const MANIFEST_RE = /\/playback\/v2\/manifest\/[^/]+\/static\/majin\/[^/]+\/([^/]+)\/cenc\//;
    function noteManifest(url) {
        const m = MANIFEST_RE.exec(url);
        if (!m) return;
        S.hardSub = m[1] !== 'clean';
        if (S.hardSub && S.selected.length) setTimeout(clearNativeSubtitle, 800);
    }

    function installHooks() {
        window.fetch = function (res, init) {
            const p = rawFetch.apply(window, arguments);
            try {
                const url = typeof res === 'string' ? res : (res && res.url) || String(res);
                if (sameOrigin(url)) {
                    noteManifest(url);
                    grabAuth(res, init);
                    const m = PLAY_RE.exec(url);
                    if (m) p.then(r => (r.ok ? r.clone().json() : null)).then(j => j && onPlay(j, m[1], m[2])).catch(() => {});
                }
            } catch (e) { /* never break the site's request */ }
            return p;
        };

        const xOpen = XMLHttpRequest.prototype.open;
        const xSet = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.open = function (method, url) {
            try {
                this.__crbsUrl = String(url);
                if (sameOrigin(this.__crbsUrl)) noteManifest(this.__crbsUrl);
                const m = sameOrigin(this.__crbsUrl) && PLAY_RE.exec(this.__crbsUrl);
                if (m) {
                    this.addEventListener('load', () => {
                        try { onPlay(this.responseType === 'json' ? this.response : JSON.parse(this.responseText), m[1], m[2]); } catch (e) { /* ignore */ }
                    });
                }
            } catch (e) { /* ignore */ }
            return xOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
            try { if (/^authorization$/i.test(k) && /^Bearer\s/i.test(v) && sameOrigin(this.__crbsUrl || '')) S.auth = v; } catch (e) { /* ignore */ }
            return xSet.apply(this, arguments);
        };
    }
    if (!window.__crbsTest) installHooks(); // the test harness feeds onPlay() itself

    // ---------- tracks ----------
    let menuSig = '';
    const refreshMenu = () => { menuSig = ''; };

    function collect(json) {
        const out = [];
        for (const [kind, map] of [['sub', json.subtitles], ['cc', json.captions]]) {
            for (const [lang, t] of Object.entries(map || {})) {
                if (!t || !t.url || lang === 'none') continue;
                const format = t.format || (/\.vtt(\?|$)/.test(t.url) ? 'vtt' : 'ass');
                out.push({ key: kind + ':' + lang, lang, kind, format, url: t.url });
            }
        }
        return out;
    }

    function onPlay(json, guid, device) {
        if (!json || typeof json !== 'object') return;
        const versions = Array.isArray(json.versions) ? json.versions : [];
        if (!S.episode.has(guid)) {
            S.sources.clear(); S.cues.clear(); S.orig = 'idle'; S.origCode = 0;
            S.versions = versions;
            S.episode = new Set([guid].concat(versions.map(v => v.guid)));
        }
        S.guid = guid; S.device = device;
        S.sources.set(guid, collect(json));
        if (versions.some(v => v.original && v.guid === guid)) S.orig = 'ok'; // already on the original
        // a saved language that this dub does not ship: fetch it, but let the site's own stream start first
        const have = new Set(getTracks().map(t => t.key));
        if (S.selected.some(k => !have.has(k))) setTimeout(loadOriginal, 1500);
        refreshMenu();
    }

    function getTracks() {
        const seen = new Map();
        const order = [S.guid].concat([...S.sources.keys()].filter(g => g !== S.guid));
        for (const g of order) {
            for (const t of S.sources.get(g) || []) if (!seen.has(t.key)) seen.set(t.key, Object.assign({ from: g, own: g === S.guid }, t));
        }
        return [...seen.values()];
    }

    // Other languages only ship with the original version, so fetch its playback JSON once per episode.
    async function loadOriginal() {
        if (S.orig === 'noauth' && S.auth) S.orig = 'idle';
        if (S.orig !== 'idle') return;
        const orig = S.versions.find(v => v.original && v.guid !== S.guid);
        if (!orig) { S.orig = 'none'; return refreshMenu(); }
        if (!S.auth) { S.orig = 'noauth'; return refreshMenu(); }
        S.orig = 'loading';
        refreshMenu();
        const episode = S.episode;
        try {
            const headers = { Authorization: S.auth };
            const r = await rawFetch(`/playback/v3/${orig.guid}/web/${S.device}/play`, { headers, credentials: 'include' });
            if (episode !== S.episode) return;
            if (!r.ok) { S.orig = 'error'; S.origCode = r.status; return refreshMenu(); }
            const j = await r.json();
            if (episode !== S.episode) return;
            S.sources.set(orig.guid, collect(j));
            S.orig = 'ok';
            // release the extra playback session so it does not count against the stream limit
            if (j.token) {
                const release = tries => rawFetch(`/playback/v1/token/${orig.guid}/${encodeURIComponent(j.token)}`, { method: 'DELETE', headers, credentials: 'include' })
                    .then(r => { if (!r.ok && tries > 0) setTimeout(() => release(tries - 1), 2000); })
                    .catch(() => { if (tries > 0) setTimeout(() => release(tries - 1), 2000); });
                release(2);
            }
        } catch (e) {
            if (episode === S.episode) { S.orig = 'error'; S.origCode = 0; }
        }
        refreshMenu();
    }

    function trackData(t) {
        const id = t.from + '|' + t.key;
        const c = S.cues.get(id);
        if (c && typeof c === 'object') return c;
        if (c === undefined) {
            S.cues.set(id, 'loading');
            rawFetch(t.url, { credentials: 'omit' })
                .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
                .then(txt => { S.cues.set(id, t.format === 'vtt' ? parseVTT(txt) : parseASS(txt)); refreshMenu(); })
                .catch(() => { S.cues.set(id, 'error'); refreshMenu(); });
        }
        return null;
    }

    const offsetKey = t => S.guid + '|' + t.key;
    const getOffset = t => S.offsets[offsetKey(t)] || 0;
    function setOffset(t, v) {
        S.offsets[offsetKey(t)] = Math.round(v * 10) / 10;
        store.set('offsets', S.offsets);
        refreshMenu();
    }

    function toggleTrack(key) {
        S.selected = S.selected.includes(key) ? S.selected.filter(k => k !== key) : S.selected.concat(key);
        store.set('selected', S.selected);
        if (S.selected.length) setNativeNone(); else restoreNative();
        refreshMenu();
    }

    function setStyle(patch) {
        Object.assign(S.style, patch);
        store.set('style', S.style);
        refreshMenu();
    }

    // ---------- overlay drawn over the video ----------
    let video = null, host = null;

    function ensureDom() {
        const v = document.querySelector('video');
        if (!v || !v.parentElement) {
            renderer.el.style.display = 'none';
            video = null;
            return false;
        }
        video = v; host = v.parentElement;
        if (renderer.el.parentElement !== host) host.appendChild(renderer.el);
        renderer.el.style.display = '';
        return true;
    }

    // Hide the site's own subtitle layer while ours are on screen (it is the sibling holding the <ul>).
    function setNativeHidden(hide) {
        const ul = host.querySelector('ul');
        const layer = ul && [...host.children].find(c => c !== renderer.el && c.contains(ul));
        if (layer) layer.style.visibility = hide ? 'hidden' : '';
    }

    function tick() {
        if (!ensureDom()) return;
        ensureMenu();
        const t = video.currentTime;
        const tracks = getTracks();
        const active = [];
        for (const key of S.selected) {
            const tr = tracks.find(x => x.key === key);
            const data = tr && trackData(tr);
            if (!data) continue;
            const off = getOffset(tr);
            const events = [];
            for (const c of data.cues) {
                if (c.start + off > t) break;
                if (c.end + off > t) events.push(c);
            }
            active.push({ info: data.info, events });
        }
        renderer.draw(video, host, active, S.style);
        setNativeHidden(active.length > 0);
    }

    // ---------- options inside the player's own audio / subtitle menu ----------
    let menuWasOpen = false;

    function findMenuList() {
        const root = document.querySelector('[data-testid="audio-text-track-menu"]');
        const menu = root && [...root.querySelectorAll('[role="menu"]')].find(m => /subtitle/i.test(m.getAttribute('aria-label') || ''));
        return menu ? menu.querySelector(':scope > div:not([role])') : null;
    }

    // A subtitle chosen in the player's own menu is burned into the picture (a "/clean/" stream has none),
    // so it cannot be hidden and would show twice. While ours are on, the player's own choice is set to None.
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const nativeSubItems = () => {
        const list = findMenuList();
        return list ? [...list.querySelectorAll('[role="menuitemradio"]:not([data-crbs])')] : [];
    };

    // Needs the menu open. "None" is the last native entry; a soft [CC] caption can be hidden, so it is left alone.
    function setNativeNone() {
        const items = nativeSubItems();
        const cur = items.find(i => i.getAttribute('aria-checked') === 'true');
        if (!cur || cur === items[items.length - 1] || /\[CC\]/i.test(cur.getAttribute('aria-label') || '')) return;
        store.set('nativeSub', cur.getAttribute('aria-label'));
        items[items.length - 1].click();
    }

    function restoreNative() {
        const label = store.get('nativeSub', null);
        const item = label && nativeSubItems().find(i => i.getAttribute('aria-label') === label);
        if (item) { item.click(); store.set('nativeSub', null); }
    }

    // Same thing without the user's click: open the menu out of sight, pick None, close it again.
    let clearing = false;
    async function clearNativeSubtitle() {
        const btn = document.querySelector('[data-testid="track-selection-button"]');
        if (clearing || !S.selected.length || !btn) return;
        clearing = true;
        document.documentElement.classList.add('crbs-quiet');
        try {
            const wasOpen = !!findMenuList();
            if (!wasOpen) btn.click();
            for (let i = 0; i < 20 && !nativeSubItems().length; i++) await sleep(100);
            setNativeNone();
            await sleep(300);
            if (!wasOpen && findMenuList()) btn.click();
        } finally {
            clearing = false;
            document.documentElement.classList.remove('crbs-quiet');
        }
    }
    const quiet = document.createElement('style');
    quiet.textContent = '.crbs-quiet [data-testid="audio-text-track-menu"]{opacity:0!important}';
    document.documentElement.appendChild(quiet);

    function ensureMenu() {
        const list = findMenuList();
        if (!list) { menuWasOpen = false; menuSig = ''; return; }
        if (!menuWasOpen) { menuWasOpen = true; if (!clearing) loadOriginal(); } // the menu was just opened
        if (menuSig && list.querySelector('[data-crbs]')) return;
        menuSig = 'x';
        renderMenu(list);
    }

    const el = (tag, cls, css) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (css) e.style.cssText = css;
        return e;
    };
    const textRow = (text, css) => {
        const r = el('div', 'kat:ps-20 kat:pe-20 kat:pb-13 kat:text-start', css);
        r.textContent = text;
        r.addEventListener('click', e => e.stopPropagation());
        return r;
    };
    const ctl = (text, fn) => {
        const b = el('button', '', 'background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:6px;padding:3px 9px;font:inherit;cursor:pointer');
        b.type = 'button';
        b.textContent = text;
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); });
        return b;
    };
    const ctlRow = (label, ...buttons) => {
        const r = el('div', 'kat:ps-20 kat:pe-20 kat:pb-13', 'display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:13px;color:#c8c8d0');
        r.append(label, ...buttons);
        r.addEventListener('click', e => e.stopPropagation());
        return r;
    };

    // Same markup as the native radio items, so it looks and hovers like them.
    function menuItem(tpl, label, on, fn) {
        const it = tpl.cloneNode(true);
        it.setAttribute('role', 'menuitemcheckbox');
        it.setAttribute('aria-label', label);
        it.setAttribute('aria-checked', on ? 'true' : 'false');
        it.classList.toggle('kat:bg-white/6', on);
        it.querySelector('span').textContent = label;
        it.lastElementChild.innerHTML = on ? CHECK : '';
        const act = e => { e.preventDefault(); e.stopPropagation(); fn(); };
        it.addEventListener('click', act);
        it.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') act(e); });
        return it;
    }

    function renderMenu(list) {
        list.querySelectorAll('[data-crbs]').forEach(e => e.remove());
        const tpl = list.querySelector('[role="menuitemradio"][aria-checked="false"]') || list.querySelector('[role="menuitemradio"]');
        if (!tpl) { menuSig = ''; return; } // native items are not rendered yet
        const nodes = [];

        // heading with a gear that folds every setting (size, position, sync) away
        const head = el('div', 'kat:ps-20 kat:pe-20 kat:pt-13 kat:pb-6 kat:text-start', 'display:flex;align-items:center;justify-content:space-between');
        const title = el('span', 'kat:text-sm kat:leading-20 kat:text-neutral-50', 'font-weight:700');
        title.textContent = T('title');
        const gear = el('button', '', `background:${S.gear ? 'rgba(255,255,255,.18)' : 'transparent'};color:#fff;border:0;border-radius:6px;padding:4px;line-height:0;cursor:pointer;opacity:${S.gear ? 1 : 0.75}`);
        gear.type = 'button';
        gear.title = T('settings');
        gear.setAttribute('aria-label', T('settings'));
        gear.setAttribute('aria-expanded', S.gear ? 'true' : 'false');
        gear.innerHTML = GEAR;
        gear.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); S.gear = !S.gear; refreshMenu(); });
        head.append(title, gear);
        nodes.push(head);

        const warn = { loading: T('loading'), noauth: T('noauth'), none: T('none'), error: T('error') + (S.origCode ? ` (${S.origCode})` : '') + '. ' + T('errorTip') }[S.orig];
        if (warn) nodes.push(textRow(warn, 'font-size:12.5px;color:#ffd58a'));

        const tracks = getTracks();
        if (S.gear) {
            const label = text => Object.assign(el('span', '', 'min-width:64px'), { textContent: text });
            nodes.push(ctlRow(label(T('size')),
                ctl('A-', () => setStyle({ size: Math.max(0.5, Math.round((S.style.size - 0.1) * 10) / 10) })),
                Object.assign(el('span', '', 'min-width:46px;text-align:center'), { textContent: Math.round(S.style.size * 100) + '%' }),
                ctl('A+', () => setStyle({ size: Math.min(2, Math.round((S.style.size + 0.1) * 10) / 10) }))));
            nodes.push(ctlRow(label(T('pos')),
                ctl('↑', () => setStyle({ lift: Math.min(40, S.style.lift + 2) })),
                ctl('↓', () => setStyle({ lift: Math.max(0, S.style.lift - 2) }))));
            for (const tr of tracks.filter(t => S.selected.includes(t.key))) {
                const off = getOffset(tr);
                nodes.push(ctlRow(label(`${T('sync')} · ${langName(tr.lang)}${tr.kind === 'cc' ? ' [CC]' : ''}`),
                    ctl('-1', () => setOffset(tr, off - 1)), ctl('-0.1', () => setOffset(tr, off - 0.1)),
                    Object.assign(el('span'), { textContent: (off > 0 ? '+' : '') + off.toFixed(1) + 's' }),
                    ctl('+0.1', () => setOffset(tr, off + 0.1)), ctl('+1', () => setOffset(tr, off + 1))));
            }
        }

        for (const tr of tracks) {
            nodes.push(menuItem(tpl, langName(tr.lang) + (tr.kind === 'cc' ? ' [CC]' : ''), S.selected.includes(tr.key), () => toggleTrack(tr.key)));
        }

        nodes.forEach(n => { n.setAttribute('data-crbs', ''); list.appendChild(n); });
        menuSig = 'x';
    }

    if (window.__crbsTest) window.__crbsTest.api = { S, onPlay, getTracks, noteManifest };
    setInterval(tick, 100);
})();
