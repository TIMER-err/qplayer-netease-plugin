"use strict";

var SCRIPT_URL = "https://acstatic-dun.126.net/tool.min.js";
var PRODUCT_NUMBER = "YD00000558929251";
var BUSINESS_ID = "bd5d2f973ef74cd2a61325a412ae54d9";

function quote(value) {
  return JSON.stringify(String(value)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Build the provider-specific browser probe. QPlayer only supplies an isolated system
 * WebView and the qplayerWebAuthDone string callback; all 易盾 behavior stays here. */
function script(originUrl) {
  return "(function(){'use strict';"
    + "if(window.__qplayerWatchmanStarted)return;"
    + "window.__qplayerWatchmanStarted=true;"
    + "var finished=false;"
    + "try{Object.defineProperty(window.document,'referrer',{configurable:true,"
    + "get:function(){return " + quote(originUrl) + ";}});}"
    + "catch(ignored){}"
    + "function report(token,error){"
    + "if(finished)return;finished=true;"
    + "window.qplayerWebAuthDone(JSON.stringify({token:token||'',error:error||''}));}"
    + "function message(error,fallback){"
    + "try{return error&&error.message?String(error.message):fallback;}"
    + "catch(ignored){return fallback;}}"
    + "function acquire(instance){"
    + "function getToken(){try{instance.getToken(" + quote(BUSINESS_ID)
    + ",function(token){if(token)report(String(token),'');"
    + "else report('','watchman returned an empty token');});}"
    + "catch(error){report('',message(error,'watchman token request failed'));}}"
    + "try{var raw=instance.getInstance&&instance.getInstance();"
    + "if(raw&&typeof raw.I==='function'){var resumed=false;"
    + "function resume(){if(resumed)return;resumed=true;clearTimeout(timer);getToken();}"
    + "var timer=setTimeout(resume,15000);raw.I(resume);}"
    + "else getToken();}catch(error){getToken();}}"
    + "function initialize(){try{window.initWatchman({auto:true,productNumber:"
    + quote(PRODUCT_NUMBER)
    + ",onload:function(instance){acquire(instance);},"
    + "onerror:function(error){report('',message(error,'watchman initialization failed'));}});}"
    + "catch(error){report('',message(error,'watchman initialization failed'));}}"
    + "var sdk=document.createElement('script');sdk.async=true;sdk.src=" + quote(SCRIPT_URL) + ";"
    + "sdk.onload=initialize;"
    + "sdk.onerror=function(){report('','watchman SDK failed to load');};"
    + "(document.head||document.documentElement).appendChild(sdk);"
    + "})();";
}

function tokenFromResult(payload) {
  var parsed;
  try {
    parsed = JSON.parse(String(payload || ""));
  } catch (error) {
    throw new Error("watchman returned an invalid result");
  }
  if (parsed && parsed.token) return String(parsed.token);
  throw new Error(parsed && parsed.error
    ? String(parsed.error) : "watchman returned an empty token");
}

module.exports = {
  script: script,
  tokenFromResult: tokenFromResult
};
