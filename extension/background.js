// Colours the toolbar icon on Crunchyroll tabs and greys it out everywhere else.
const SIZES = [16, 32, 48, 128];
const iconSet = suffix => Object.fromEntries(SIZES.map(s => [s, `icons/icon${s}${suffix}.png`]));
const ACTIVE = iconSet('');
const IDLE = iconSet('_grey');
const CRUNCHYROLL = /^https?:\/\/([^/]+\.)?crunchyroll\.com(\/|$)/i;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    chrome.action.setIcon({ tabId, path: CRUNCHYROLL.test(tab.url) ? ACTIVE : IDLE });
});
