// ==UserScript==
// @name         YouTube Livechat Channel Resolver
// @namespace    https://zerody.one/
// @version      0.3
// @description  A simple script to resolve the channel-id from any livechat comment on youtube.
// @author       ZerodyOne
// @match        https://www.youtube.com/*
// @grant        none
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

            if(responseText === responseTextModified) return result;

            result.json = function() {
                return JSON.parse(responseTextModified);
            }

            return result;
        })(args);
    };

    var extractAuthorExternalChannelIds = function(chatData) {

        // lets deal with this stupid json object...
        var availableCommentActions = chatData.continuationContents ? chatData.continuationContents.liveChatContinuation.actions : chatData.contents.liveChatRenderer.actions;
        if(!availableCommentActions || !Array.isArray(availableCommentActions)) return;

        availableCommentActions.forEach(action => {
            if(!action.addChatItemAction) return;

            var messageItem = action.addChatItemAction.item.liveChatTextMessageRenderer;
            if(!messageItem || !messageItem.authorExternalChannelId) return;

            // remove old entries
            if(mappedChannelIds.length > 5000) mappedChannelIds.shift();

            mappedChannelIds.push({
                channelId: messageItem.authorExternalChannelId,
                commentId: messageItem.id,
                contextMenuEndpointParams: messageItem.contextMenuEndpoint.liveChatItemContextMenuEndpoint.params
            });
        });

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

        // append visit channel menu item
        mainMenuRendererNode.menuRenderer.items.push(generateMenuLinkItem("/channel/" + mappedChannel.channelId, "Visit Channel", "ACCOUNT_BOX"));

        // append social blade statistic shortcut
        mainMenuRendererNode.menuRenderer.items.push(generateMenuLinkItem("https://socialblade.com/youtube/channel/" + mappedChannel.channelId, "Socialblade Statistic", "MONETIZATION_ON"));

        // re-stringify json object to overwrite the original server response
        response = JSON.stringify(responseData);

        return response;
    }


    // proxy function for processing and editing the api responses
    responseProxy(function(reqUrl, responseText) {
        try {
            // we will extract the channel-ids from the "get_live_chat" response
            if(reqUrl.startsWith("https://www.youtube.com/live_chat/get_live_chat?")) extractAuthorExternalChannelIds(JSON.parse(responseText).response);

            // when you open the context menu this request will be fired to load the context menu options. We will modify the response to append additional items
            // there are two api-endpoints, the first one is deprecated
            if(reqUrl.startsWith("https://www.youtube.com/live_chat/get_live_chat_item_context_menu?")) return appendAdditionalChannelContextItems(reqUrl, responseText);
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
    if(window.location.pathname === "/live_chat") return window;

    // Unfortunately, Firefox (Greasemonkey) runs the script only in the main window.
    // We have to navigate into the correct chat iframe
    for (var i = 0; i < window.frames.length; i++) {
        try {
            if(window.frames[i].location && window.frames[i].location.pathname === "/live_chat") return frames[i];

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


tryBrowserIndependentExecution();