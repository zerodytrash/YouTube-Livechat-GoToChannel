// ==UserScript==
// @name            YouTube Livechat GoToChannel
// @namespace       https://github.com/zerodytrash/YouTube-Livechat-GoToChannel
// @version         0.9
// @description     A simple script to restore the "Go To Channel" option on any livechat comment on YouTube.
// @description:de  Ein einfaches script um die "Zum Kanal" Funktion bei allen Livechat-Kommentaren auf YouTube wiederherzustellen.
// @author          Zerody (https://github.com/zerodytrash)
// @icon            https://www.google.com/s2/favicons?domain=youtube.com
// @updateURL       https://github.com/zerodytrash/YouTube-Livechat-GoToChannel/raw/master/YouTube%20Livechat%20Channel%20Resolver.user.js
// @downloadURL     https://github.com/zerodytrash/YouTube-Livechat-GoToChannel/raw/master/YouTube%20Livechat%20Channel%20Resolver.user.js
// @supportURL      https://github.com/zerodytrash/YouTube-Livechat-GoToChannel/issues
// @license         MIT
// @match           https://www.youtube.com/*
// @grant           none
// @compatible      chrome Chrome + Tampermonkey or Violentmonkey
// @compatible      firefox Firefox + Greasemonkey or Tampermonkey or Violentmonkey
// @compatible      opera Opera + Tampermonkey or Violentmonkey
// @compatible      edge Edge + Tampermonkey or Violentmonkey
// @compatible      safari Safari + Tampermonkey or Violentmonkey
// ==/UserScript==

var main = function() {

    // channel-id <=> contextMenuEndpointParams
    var mappedChannelIds = []

    // backup the original XMLHttpRequest open function
    var originalRequestOpen = XMLHttpRequest.prototype.open;

    // backup the original fetch function
    var originalFetch = window.fetch;

    // helper functions used to intercept and modify youtube api responses
    var responseProxy = function(callback) {
        XMLHttpRequest.prototype.open = function() {
            this.addEventListener("readystatechange", function(event) {

                if (this.readyState === 4) {

                    var response = callback(this.responseURL, event.target.responseText);

                    // re-define response content properties and remove "read-only" flags
                    Object.defineProperty(this, "response", {writable: true});
                    Object.defineProperty(this, "responseText", {writable: true});

                    this.response = response;
                    this.responseText = response;
                }
            });

            return originalRequestOpen.apply(this, arguments);
        };

        // since july 2020 YouTube uses the Fetch-API to retrieve context menu items
        window.fetch = (...args) => (async(args) => {
            var result = await originalFetch(...args);
            var json = await result.json();

            // returns the original result if the request fails
            if(json === null) return result;

            var responseText = JSON.stringify(json);
            var responseTextModified = callback(result.url, responseText);

            result.json = function() {
                return new Promise(function(resolve, reject) {
                    resolve(JSON.parse(responseTextModified));
                })
            };

            result.text = function() {
                return new Promise(function(resolve, reject) {
                    resolve(responseTextModified);
                })
            };

            return result;
        })(args);
    };

    var extractCommentActionChannelId = function(action) {
        if (action.replayChatItemAction) {
            action.replayChatItemAction.actions.forEach(extractCommentActionChannelId);
            return;
        }

        if(!action.addChatItemAction) return;
        
        var messageItem = action.addChatItemAction.item;
        var mappedItem = messageItem.liveChatPaidMessageRenderer ?? messageItem.liveChatTextMessageRenderer
                ?? messageItem.liveChatPaidStickerRenderer ?? messageItem.liveChatMembershipItemRenderer
                ?? messageItem.liveChatAutoModMessageRenderer?.autoModeratedItem.liveChatTextMessageRenderer;
        if(!mappedItem || !mappedItem.authorExternalChannelId) return;

        // remove old entries
        if(mappedChannelIds.length > 5000) mappedChannelIds.shift();

        mappedChannelIds.push({
            channelId: mappedItem.authorExternalChannelId,
            commentId: mappedItem.id,
            contextMenuEndpointParams: mappedItem.contextMenuEndpoint.liveChatItemContextMenuEndpoint.params
        });
    }

    var extractAuthorExternalChannelIds = function(chatData) {
        // lets deal with this stupid json object...
        var availableCommentActions = chatData.continuationContents ? chatData.continuationContents.liveChatContinuation.actions : chatData.contents.liveChatRenderer.actions;
        if(!availableCommentActions || !Array.isArray(availableCommentActions)) return;

        availableCommentActions.forEach(extractCommentActionChannelId);

        console.info(mappedChannelIds.length + " Channel-IDs mapped!");
    }

    var generateMenuLinkItem = function(url, text, icon) {
        return {
            "menuNavigationItemRenderer": {
                "text": {
                    "runs": [
                        {
                            "text": text
                        }
                    ]
                },
                "icon": {
                    "iconType": icon
                },
                "navigationEndpoint":{
                    "commandMetadata":{
                        "webCommandMetadata":{
                            "url": url,
                            "webPageType": "WEB_PAGE_TYPE_UNKNOWN",
                            "rootVe": 0
                        }
                    },
                    "urlEndpoint":{
                        "url": url,
                        "target": "TARGET_NEW_WINDOW"
                    }
                }
            }
        }
    }

    var appendAdditionalChannelContextItems = function(reqUrl, response) {
        // parse the url to get the "params" variable used to identitfy the mapped channel id
        var urlParams = new URLSearchParams(new URL(reqUrl).search);
        var params = urlParams.get("params");
        var mappedChannel = mappedChannelIds.find(x => x.contextMenuEndpointParams === params);

        // in some cases, no channel id is available
        if(!mappedChannel) {
            console.error("Endpoint Params " + params + " not mapped!");

            // returning the unmodified context item list
            return response;
        }

        // parse the orignal server response
        var responseData = JSON.parse(response);

        // legacy stuff: the "response"-attribute has been removed since the fetch-api update. But we should keep this for backward compatibility.
        var mainMenuRendererNode = (responseData.response ? responseData.response : responseData).liveChatItemContextMenuSupportedRenderers;
        // remove link channel for moderator
        if(mainMenuRendererNode.menuRenderer.items[0].menuNavigationItemRenderer?.icon.iconType == "ACCOUNT_CIRCLE") mainMenuRendererNode.menuRenderer.items.shift();

        // append social blade statistic shortcut
        mainMenuRendererNode.menuRenderer.items.unshift(generateMenuLinkItem("https://socialblade.com/youtube/channel/" + mappedChannel.channelId, "Socialblade Statistic", "MONETIZATION_ON"));
        
        // append social blade statistic shortcut
        mainMenuRendererNode.menuRenderer.items.unshift(generateMenuLinkItem("https://playboard.co/en/channel/" + mappedChannel.channelId, "PlayBoard Statistic", "INSIGHTS"));
      
        // append visit channel menu item
        mainMenuRendererNode.menuRenderer.items.unshift(generateMenuLinkItem("/channel/" + mappedChannel.channelId, "Visit Channel", "ACCOUNT_CIRCLE"));
        
        // re-stringify json object to overwrite the original server response
        response = JSON.stringify(responseData);

        return response;
    }


    // proxy function for processing and editing the api responses
    responseProxy(function(reqUrl, responseText) {
        try {
            // we will extract the channel-ids from the "get_live_chat" response
            // old api endpoint:
            if(reqUrl.startsWith("https://www.youtube.com/live_chat/get_live_chat?")) extractAuthorExternalChannelIds(JSON.parse(responseText).response);
            if(reqUrl.startsWith("https://www.youtube.com/live_chat/get_live_chat_replay?")) extractAuthorExternalChannelIds(JSON.parse(responseText).response);

            // new api endpoint (since july 2020):
            if(reqUrl.startsWith("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?")) extractAuthorExternalChannelIds(JSON.parse(responseText));
            if(reqUrl.startsWith("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay?")) extractAuthorExternalChannelIds(JSON.parse(responseText));

            // when you open the context menu one of the following requests will be fired to load the context menu options. We will modify the response to append additional items
            // old api endpoint:
            if(reqUrl.startsWith("https://www.youtube.com/live_chat/get_live_chat_item_context_menu?")) return appendAdditionalChannelContextItems(reqUrl, responseText);

            // new api endpoint (since june 2020):
            if(reqUrl.startsWith("https://www.youtube.com/youtubei/v1/live_chat/get_item_context_menu?")) return appendAdditionalChannelContextItems(reqUrl, responseText);

        } catch(ex) {
            console.error("YouTube Livechat Channel Resolver - Exception!!!:", ex);
        }

        // return the original response by default
        return responseText;
    });


    // hijack youtube inital variable data from page source and rename it before it gets overwritten by youtube
    // idk how to do it better...
    var scripts = document.getElementsByTagName("script");
    for (var script of scripts) {
        if(script.text.indexOf("window[\"ytInitialData\"]") >= 0) {
            window.eval(script.text.replace("ytInitialData", "ytInitialData_original"));
        }
    }

    // process chat comments from inital data
    if(window.ytInitialData_original) extractAuthorExternalChannelIds(window.ytInitialData_original);

}

// Just a trick to get around the sandbox restrictions in Firefox / Greasemonkey
// The Greasemonkey security model does not allow to execute code directly in the context of the website
// Unfortunately, we need this to manipulate the XmlHttpRequest object
// UnsafeWindow does not work in this case. See https://wiki.greasespot.net/UnsafeWindow
// So we have to inject the script directly into the website
var injectScript = function(frameWindow) {

    console.info("Run Fury, run!");

    frameWindow.eval("("+ main.toString() +")();");
}

// We need this to detect the chat frame in firefox
// Greasemonkey does not execute the script directly in iframes
// See https://github.com/greasemonkey/greasemonkey/issues/2574
var retrieveChatFrameWindow = function() {

    // Chrome (Tampermonkey) will execute the userscript directly into the iframe, thats fine.
    if(window.location.pathname === "/live_chat" || window.location.pathname === "/live_chat_replay") return window;

    // Unfortunately, Firefox (Greasemonkey) runs the script only in the main window.
    // We have to navigate into the correct chat iframe
    for (var i = 0; i < window.frames.length; i++) {
        try {
            if(window.frames[i].location) {
                var pathname = window.frames[i].location.pathname;
                if(pathname === "/live_chat" || pathname === "/live_chat_replay") return frames[i];
            }
        } catch(ex) { }
    }
}

// Chrome => Instant execution
// Firefox => Retry until the chat frame is loaded
var tryBrowserIndependentExecution = function() {

    var destinationFrameWindow = retrieveChatFrameWindow();

    // window found & ready?
    if(!destinationFrameWindow || !destinationFrameWindow.document || destinationFrameWindow.document.readyState != "complete") {
        setTimeout(tryBrowserIndependentExecution, 1000);
        return;
    }

    // script already injected?
    if(destinationFrameWindow.channelResolverInitialized) return;

    // Inject main script
    injectScript(destinationFrameWindow);

    // Flag window as initalizied to prevent mutiple executions
    destinationFrameWindow.channelResolverInitialized = true;
}

'use strict';

tryBrowserIndependentExecution();
