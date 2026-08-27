document.addEventListener("DOMContentLoaded", function () {
  const apiKey = document.getElementById("apiKey");
  const baseURL = document.getElementById("baseURL");
  const model = document.getElementById("model");
  const ttsMode = document.getElementById("ttsMode");
  const ttsRelay = document.getElementById("ttsRelay");
  const autoPdf = document.getElementById("autoPdf");
  const msg = document.getElementById("msg");

  chrome.storage.local.get(["apiKey", "baseURL", "model", "ttsMode", "ttsRelay", "autoPdf"], function (o) {
    apiKey.value = o.apiKey || "";
    baseURL.value = o.baseURL || "";
    model.value = o.model || "";
    ttsMode.value = o.ttsMode || "youdao";
    ttsRelay.value = o.ttsRelay || "http://localhost:8787";
    autoPdf.checked = o.autoPdf === undefined ? true : !!o.autoPdf;
  });

  const openVocab = document.getElementById("openVocab");
  if (openVocab) openVocab.addEventListener("click", function () {
    chrome.tabs.create({ url: chrome.runtime.getURL("vocab.html") });
  });

  document.getElementById("save").addEventListener("click", function () {
    chrome.storage.local.set(
      {
        apiKey: apiKey.value.trim(),
        baseURL: baseURL.value.trim(),
        model: model.value.trim(),
        ttsMode: ttsMode.value,
        ttsRelay: ttsRelay.value.trim(),
        autoPdf: autoPdf.checked
      },
      function () {
        chrome.runtime.sendMessage({ type: "SET_AUTOPDF", value: autoPdf.checked }, function () {
          msg.textContent = "已保存 ✓";
          setTimeout(function () { msg.textContent = ""; }, 2000);
        });
      }
    );
  });
});
