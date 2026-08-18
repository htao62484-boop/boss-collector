const SITE_HOST_PATTERN = /^https:\/\/([a-z0-9-]+\.)?zhipin\.com\//i;

function isBossSiteUrl(url) {
  return typeof url === "string" && SITE_HOST_PATTERN.test(url);
}

async function ensureContentInjected(tabId, url) {
  if (!tabId || !isBossSiteUrl(url)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (_err) {
    // ignore
  }
}

async function ensureInjectedForOpenBossTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ["https://*.zhipin.com/*"] });
    for (const tab of tabs) {
      if (tab && tab.id) {
        await ensureContentInjected(tab.id, tab.url || "");
      }
    }
  } catch (_err) {
    // ignore
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  ensureInjectedForOpenBossTabs();
});

chrome.runtime.onStartup.addListener(() => {
  ensureInjectedForOpenBossTabs();
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (_err) {
    // ignore
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || (tab && tab.url) || "";
  if (!isBossSiteUrl(url)) return;
  if (changeInfo.status === "complete" || changeInfo.url) {
    ensureContentInjected(tabId, url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await ensureContentInjected(tabId, tab && tab.url);
  } catch (_err) {
    // ignore
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "bzp_open_panel") {
    return false;
  }

  (async () => {
    try {
      const windowId = sender && sender.tab ? sender.tab.windowId : undefined;
      if (windowId === undefined) {
        sendResponse({ ok: false, error: "missing window id" });
        return;
      }
      await chrome.sidePanel.open({ windowId });
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true;
});
