// ==UserScript==
// @name         YouTube Livechat Channel Resolver
// @namespace    https://zerody.one/
// @version      0.1
// @description  A simple script to resolve the channel-id from any livechat comment on youtube.
// @author       ZerodyOne
// @match        https://www.youtube.com/live_chat*
// @grant        none
// ==/UserScript==


// script container object
var ytcr = {};

// channel-id <=> contextMenuEndpointParams
ytcr.mappedChannelIds = []

// backup the original XMLHttpRequest open function
ytcr.originalRequestOpen = XMLHttpRequest.prototype.open;

// helper function used to intercept and modify youtube api responses
ytcr.responseProxy = function(callback) {
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

        return ytcr.originalRequestOpen.apply(this, arguments);
    };
};

ytcr.extractAuthorExternalChannelIds = function(chatData) {

    // lets deal with this stupid json object...
    var availableCommentActions = chatData.continuationContents ? chatData.continuationContents.liveChatContinuation.actions : chatData.contents.liveChatRenderer.actions;
    if(!availableCommentActions || !Array.isArray(availableCommentActions)) return;

    availableCommentActions.forEach(action => {
        if(!action.addChatItemAction) return;

        var messageItem = action.addChatItemAction.item.liveChatTextMessageRenderer;
        if(!messageItem || !messageItem.authorExternalChannelId) return;

        // remove old entries
        if(ytcr.mappedChannelIds.length > 5000) ytcr.mappedChannelIds.shift();

        ytcr.mappedChannelIds.push({
            channelId: messageItem.authorExternalChannelId,
            commentId: messageItem.id,
            contextMenuEndpointParams: messageItem.contextMenuEndpoint.liveChatItemContextMenuEndpoint.params
        });
    });

    console.info(ytcr.mappedChannelIds.length + " Channel-IDs mapped!");
}

ytcr.generateMenuLinkItem = function(url, text, icon) {
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

ytcr.appendAdditionalChannelContextItems = function(reqUrl, response) {
    // parse the url to get the "params" variable used to identitfy the mapped channel id
    var urlParams = new URLSearchParams(new URL(reqUrl).search);
    var params = urlParams.get("params");
    var mappedChannel = ytcr.mappedChannelIds.find(x => x.contextMenuEndpointParams === params);

    // in some cases, no channel id is available
    if(!mappedChannel) {
        console.error("Endpoint Params " + params + " not mapped!");

        // returning the unmodified context item list
        return response;
    }

    // parse the orignal server response
    var responseData = JSON.parse(response);

    // append visit channel menu item
    responseData.response.liveChatItemContextMenuSupportedRenderers.menuRenderer.items.push(ytcr.generateMenuLinkItem("/channel/" + mappedChannel.channelId, "Visit Channel", "ACCOUNT_BOX"));

    // append social blade statistic shortcut
    responseData.response.liveChatItemContextMenuSupportedRenderers.menuRenderer.items.push(ytcr.generateMenuLinkItem("https://socialblade.com/youtube/channel/" + mappedChannel.channelId, "Socialblade Statistic", "MONETIZATION_ON"));

    // re-stringify json object to overwrite the original server response
    response = JSON.stringify(responseData);

    return response;
}


// proxy function for processing and editing the api responses
ytcr.responseProxy(function(reqUrl, responseText) {
    try {
        // we will extract the channel-ids from the "get_live_chat" response
        if(reqUrl.startsWith("https://www.youtube.com/live_chat/get_live_chat?")) ytcr.extractAuthorExternalChannelIds(JSON.parse(responseText).response);

        // when you open the context menu this request will be fired to load the context menu options. We will modify the response to append additional items
        if(reqUrl.startsWith("https://www.youtube.com/live_chat/get_live_chat_item_context_menu?")) return ytcr.appendAdditionalChannelContextItems(reqUrl, responseText);

    } catch(ex) {
        console.error("YouTube Livechat Channel Resolver - Exception!!!:", ex);
    }

    // return the original response by default
    return responseText;
});


// hijack youtube inital variable data from page source and rename it before it gets overwritten by youtube
// idk how to do it better...
ytcr.scripts = document.getElementsByTagName("script");
for (var script of ytcr.scripts) {
    if(script.text.indexOf("window[\"ytInitialData\"]") >= 0) {
        window.eval(script.text.replace("ytInitialData", "ytInitialData_original"));
    }
}

// process chat comments from inital data
if(window.ytInitialData_original) ytcr.extractAuthorExternalChannelIds(window.ytInitialData_original);


